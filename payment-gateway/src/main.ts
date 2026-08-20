import express, { type NextFunction, type Request, type Response as ExpressResponse } from "express";
import { performance } from "node:perf_hooks";
import { Transaction, VersionedTransaction } from "@solana/web3.js";
import { HTTPFacilitatorClient, type HTTPRequestContext } from "@x402/core/server";
import type { Network, PaymentPayload, PaymentRequirements } from "@x402/core/types";
import { paymentMiddleware, x402ResourceServer } from "@x402/express";
import {
  assertPaymentQuotePayable,
  paymentAttemptId,
  paymentIdentityFromPath,
  paymentMemo,
  PaymentQuoteError,
  SettlementReplayGuard,
  VerifiedPaymentAttemptTracker,
  type PaymentRouteIdentity,
} from "./payment-routing.js";
import { createStableExactSvmServerScheme } from "./x402-svm.js";
import {
  DurableSettlementQueue,
  type DurableSettlement,
} from "./durable-outbox.js";
import { persistSettlementDurably } from "./settlement-durability.js";
import {
  findUnanimousFinalizedChainSettlement,
  hasExactPreparedPaymentSemantics,
  exactAbsenceDecision,
  exactSettlementSignature,
  scanExactFinalizedChainAttempt,
  type ReconciliationAttempt,
  type SolanaRpc,
} from "./chain-reconciler.js";
import { settleWithIndependentFinality } from "./verified-settlement.js";
import { boundedFacilitatorSettlement } from "./facilitator-settlement.js";
import { boundedResponseText, boundedSolanaRpc } from "./bounded-rpc.js";
import {
  PayShProxyError,
  createDirectPayShRecipientAccountProbe,
  proxyPayShRequest,
  type BindPayShChallengesRequest,
  type DirectPayShQuote,
  type PreparedMppCredential,
} from "./direct-pay-sh-proxy.js";
import {
  waitForIndependentPayShFinality,
  type PayShReceiptEvidence,
} from "./pay-sh-finality.js";
import "./root-env.js";
import { independentRpcUrls } from "./rpc-policy.js";
import {
  browserOriginAllowed,
  secureServiceOrigin,
  secureServiceUrl,
} from "./url-policy.js";
import { reconcilerReadiness } from "./reconciler-readiness.js";
import { createReadyDependencyGuard } from "./dependency-readiness.js";
import {
  booleanEnv,
  integerEnv,
  managedRuntimeEnvironment,
  researchOrchestratorReadinessRequired,
} from "./runtime-config.js";
import {
  BundleFundingModeError,
  bundleFundingMode,
  type BundleFundingMode,
} from "./bundle-funding-mode.js";
import {
  TopUpQuoteStore,
  TopUpRequestError,
  parseTopUpAmountUsdc,
  topUpDepositFromSettlement,
  type PrepaidDepositRequest,
  type TopUpQuote,
} from "./prepaid-top-up.js";
import { isAllowedBrowserRpcRequest } from "./browser-rpc-policy.js";

const DEVNET_NETWORK = "solana:EtWTRABZaYq6iMfeYKouRu166VU2xqa1" as Network;
const DEVNET_USDC = "4zMMC9srt5Ri5X14GAgXhaHii3GnPAEERYPJgZJDncDU";
const DEFAULT_DEVNET_RPC_URL = "https://api.devnet.solana.com";
const MAX_BACKGROUND_RPC_RESPONSE_BYTES = 1024 * 1024;
const MAX_ACCOUNT_PREFLIGHT_RESPONSE_BYTES = 128 * 1024;
const MAX_INTERNAL_JSON_RESPONSE_BYTES = 1024 * 1024;
const MAX_PAY_SH_PROXY_RESPONSE_BYTES = 1024 * 1024;
const MAX_TRIGGER_RESPONSE_BYTES = 64 * 1024;
const environment = env("OPENSHELF_ENV", env("NODE_ENV", "development")).toLowerCase();
const managedEnvironment = managedRuntimeEnvironment(environment);
const rustApiUrl = secureServiceOrigin(
  "RUST_API_URL",
  env("RUST_API_URL", "http://127.0.0.1:8787"),
);
const internalToken = env("OPENSHELF_INTERNAL_TOKEN", "openshelf-local-internal");
const facilitatorUrl = secureServiceUrl(
  "X402_FACILITATOR_URL",
  env("X402_FACILITATOR_URL", "https://x402.org/facilitator"),
).replace(/\/$/, "");
const network = env("X402_NETWORK", env("OPENSHELF_X402_NETWORK", DEVNET_NETWORK)) as Network;
const browserBalanceMint = env("OPENSHELF_X402_ASSET", DEVNET_USDC);
const rpcUrl = process.env.X402_RPC_URL?.trim() || DEFAULT_DEVNET_RPC_URL;
const chainReconciliationRpcUrls = independentRpcUrls([
  rpcUrl,
  ...(process.env.X402_RECONCILIATION_RPC_URLS ?? "")
    .split(",")
    .map((value) => value.trim())
    .filter(Boolean),
]);
const payShRpcUrl = independentRpcUrls([env("PAY_SH_RPC_URL", rpcUrl)])[0];
const payShReconciliationRpcUrls = independentRpcUrls([
  payShRpcUrl,
  ...(process.env.PAY_SH_RECONCILIATION_RPC_URLS ?? "")
    .split(",")
    .map((value) => value.trim())
    .filter(Boolean),
]);
const allowedOrigin = secureServiceOrigin(
  "FRONTEND_ORIGIN",
  env("FRONTEND_ORIGIN", env("OPENSHELF_FRONTEND_ORIGIN", "http://localhost:4319")),
);
const port = integerEnv("PORT", 1402, 1, 65_535);
const rpcRateLimitPerMinute = integerEnv("X402_RPC_RATE_LIMIT_PER_MINUTE", 120, 1, 10_000);
const chainReconciliationIntervalMs = integerEnv(
  "X402_CHAIN_RECONCILIATION_INTERVAL_MS",
  30_000,
  5_000,
  300_000,
);
const chainReconciliationBatchSize = integerEnv(
  "X402_CHAIN_RECONCILIATION_BATCH_SIZE",
  25,
  1,
  100,
);
const chainReconciliationSignaturePages = integerEnv(
  "X402_CHAIN_RECONCILIATION_SIGNATURE_PAGES",
  5,
  1,
  20,
);
const settlementFinalityTimeoutMs = integerEnv(
  "X402_SETTLEMENT_FINALITY_TIMEOUT_MS",
  20_000,
  1_000,
  45_000,
);
const facilitatorSettlementTimeoutMs = integerEnv(
  "X402_FACILITATOR_SETTLEMENT_TIMEOUT_MS",
  15_000,
  100,
  30_000,
);
const settlementFinalityPollIntervalMs = integerEnv(
  "X402_SETTLEMENT_FINALITY_POLL_INTERVAL_MS",
  500,
  50,
  5_000,
);
const settlementFinalityRpcTimeoutMs = integerEnv(
  "X402_SETTLEMENT_FINALITY_RPC_TIMEOUT_MS",
  3_000,
  100,
  10_000,
);
const researchOrchestratorUrl = secureServiceOrigin(
  "RESEARCH_ORCHESTRATOR_URL",
  env("RESEARCH_ORCHESTRATOR_URL", "http://127.0.0.1:1410"),
);
const requireGlobalResearchOrchestrator = researchOrchestratorReadinessRequired(
  booleanEnv("OPENSHELF_REQUIRE_RESEARCH_ORCHESTRATOR", true),
  managedEnvironment,
);
const privatePayShUrl = secureServiceOrigin(
  "PAY_SH_PRIVATE_URL",
  env("PAY_SH_PRIVATE_URL", "http://127.0.0.1:3402"),
);
const payShFrontToken = env("OPENSHELF_PAY_FRONT_TOKEN", "openshelf-local-pay-front");
const payShOperatorWallet = process.env.OPENSHELF_PAY_OPERATOR_WALLET?.trim();
const payShFeePayerKey = process.env.OPENSHELF_PAY_GCP_KMS_PUBKEY?.trim();
const testFailpoint = process.env.OPENSHELF_TEST_FAILPOINT?.trim();
// Public standalone prepaid top-up. The gateway challenges for an exact USDC
// transfer to OPENSHELF_BUNDLE_RECEIVER (the same receiver the backend credits)
// and, once independently confirmed on-chain, posts it to the internal deposit
// route. Both the receiver and the asset read the same env the Rust backend
// reads so the challenge cannot drift from what the ledger will accept.
const DEFAULT_DEVNET_USDC = "4zMMC9srt5Ri5X14GAgXhaHii3GnPAEERYPJgZJDncDU";
const bundleReceiver = process.env.OPENSHELF_BUNDLE_RECEIVER?.trim() ?? "";
const topUpAsset = env("X402_ASSET", env("OPENSHELF_X402_ASSET", DEFAULT_DEVNET_USDC));
const topUpQuoteTtlMs = integerEnv("PREPAID_TOP_UP_TTL_MS", 5 * 60_000, 60_000, 15 * 60_000);
if (managedEnvironment && !bundleReceiver) {
  console.warn(
    "standalone prepaid top-up is disabled: set OPENSHELF_BUNDLE_RECEIVER to enable it",
  );
}

if (
  managedEnvironment &&
  (internalToken.length < 32 ||
    ["openshelf-local-internal", "change-this-before-deploy"].includes(internalToken))
) {
  throw new Error(
    "OPENSHELF_INTERNAL_TOKEN must be a non-default secret of at least 32 characters in production",
  );
}
if (managedEnvironment && !allowedOrigin.startsWith("https://")) {
  throw new Error("FRONTEND_ORIGIN must use HTTPS in production");
}
if (managedEnvironment && !rustApiUrl.startsWith("https://")) {
  throw new Error("RUST_API_URL must use HTTPS in a managed environment");
}
if (managedEnvironment && !researchOrchestratorUrl.startsWith("https://")) {
  throw new Error("RESEARCH_ORCHESTRATOR_URL must use HTTPS in a managed environment");
}
if (managedEnvironment && !facilitatorUrl.startsWith("https://")) {
  throw new Error("X402_FACILITATOR_URL must use HTTPS in a managed environment");
}
if (managedEnvironment && rpcUrl === DEFAULT_DEVNET_RPC_URL) {
  throw new Error("X402_RPC_URL must use a managed RPC endpoint in production");
}
if (managedEnvironment && chainReconciliationRpcUrls.length < 2) {
  throw new Error(
    "X402_RECONCILIATION_RPC_URLS must include a second independent RPC origin",
  );
}
if (chainReconciliationRpcUrls.length < 2) {
  console.warn(
    "x402 automatic absence release is disabled: configure a second independent RPC origin",
  );
}
if (
  managedEnvironment
  && (!payShRpcUrl.startsWith("https://") || payShRpcUrl === DEFAULT_DEVNET_RPC_URL)
) {
  throw new Error("PAY_SH_RPC_URL must use a managed HTTPS RPC endpoint");
}
if (managedEnvironment && payShReconciliationRpcUrls.length < 2) {
  throw new Error(
    "PAY_SH_RECONCILIATION_RPC_URLS must include a second independent RPC origin",
  );
}
if (managedEnvironment && !privatePayShUrl.startsWith("https://")) {
  throw new Error("PAY_SH_PRIVATE_URL must use HTTPS in a managed environment");
}
if (
  managedEnvironment
  && (payShFrontToken.length < 32 || payShFrontToken === "openshelf-local-pay-front")
) {
  throw new Error("OPENSHELF_PAY_FRONT_TOKEN must be a non-default 32-character secret");
}
if (managedEnvironment && (!payShOperatorWallet || !payShFeePayerKey)) {
  throw new Error(
    "OPENSHELF_PAY_OPERATOR_WALLET and OPENSHELF_PAY_GCP_KMS_PUBKEY are required",
  );
}
if (booleanEnv("OPENSHELF_REQUIRE_MAINNET", false) && network === DEVNET_NETWORK) {
  throw new Error("mainnet mode cannot use the Solana Devnet network");
}
if (
  testFailpoint
  && !["direct-after-prepare", "direct-after-receipt"].includes(testFailpoint)
) {
  throw new Error("OPENSHELF_TEST_FAILPOINT is not a recognized test crash point");
}
if (managedEnvironment && testFailpoint) {
  throw new Error("OPENSHELF_TEST_FAILPOINT cannot be enabled in a managed environment");
}

type PaymentQuote = {
  id: string;
  queryId: string;
  documentHandle: string;
  payTo: string;
  network: Network;
  asset: string;
  amountAtomic: string;
  priceKrw: number;
  krwPerUsdc: number;
  expiresAt: number;
  resourcePath: string;
  canonicalUrl: string;
  contentHash: string;
  documentVersion: number;
  status: string;
  consentVersion: string;
};

type PaymentBundleQuote = {
  id: string;
  queryId: string;
  documentHandles: string[];
  payTo: string;
  network: Network;
  asset: string;
  amountAtomic: string;
  budgetAtomic: string;
  minimumDepositAtomic: string;
  requiresPayment: boolean;
  availableBalanceAtomic: string;
  totalPriceKrw: number;
  krwPerUsdc: number;
  expiresAt: number;
  resourcePath: string;
  bundleHash: string;
  status: string;
};

type OpenCallFundingQuote = {
  id: string;
  payTo: string;
  network: Network;
  asset: string;
  amountAtomic: string;
  totalPriceKrw: number;
  krwPerUsdc: number;
  expiresAt: number;
  resourcePath: string;
  payloadHash: string;
  status: string;
  openCallId?: string | null;
};

type PayableQuote = PaymentQuote | PaymentBundleQuote | OpenCallFundingQuote;

type PaidDocument = {
  quoteId: string;
  citation: {
    handle: string;
    shelf: string;
    excerpt: string;
    price: number;
  };
};

type PaymentDocumentSnapshot = PaidDocument;

type OpenCallFundingSnapshot = {
  quoteId: string;
  question: string;
  target: number;
  unitPriceKrw: number;
  totalPriceKrw: number;
  payloadHash: string;
};

type RouteIdentity = PaymentRouteIdentity;
type PendingSettlement = DurableSettlement;
const pendingSettlements = new Map<string, PendingSettlement>();
const settlementReplayGuard = new SettlementReplayGuard();
const verifiedPaymentAttempts = new VerifiedPaymentAttemptTracker<PayableQuote>();
const settlementQueue = DurableSettlementQueue.fromEnvironment(managedEnvironment, internalToken);
const rpcRateWindows = new Map<string, { startedAt: number; count: number }>();
let chainReconciliationRunning = false;
let lastChainReconciliationAt: number | null = null;
let lastChainReconciliationMonotonicAt: number | null = null;
let lastChainReconciliationError: string | null = null;

class RustApiError extends Error {
  constructor(readonly status: number, message: string) {
    super(message);
  }
}

async function internalJson<T>(path: string, init: RequestInit = {}): Promise<T> {
  const response = await fetch(`${rustApiUrl}${path}`, {
    ...init,
    signal: init.signal ?? AbortSignal.timeout(20_000),
    headers: {
      "content-type": "application/json",
      "x-openshelf-internal-token": internalToken,
      "x-openshelf-payment-protocol": "exact-chain-v1",
      ...init.headers,
    },
  });
  const body = await boundedResponseText(
    response,
    MAX_INTERNAL_JSON_RESPONSE_BYTES,
    "Rust API response",
  );
  if (!response.ok) {
    let message = `Rust API ${response.status}`;
    try {
      const payload = JSON.parse(body) as { error?: { message?: string } };
      message = payload.error?.message ?? message;
    } catch {
      // Keep internal response bodies out of public gateway errors.
    }
    throw new RustApiError(response.status, message);
  }
  return JSON.parse(body) as T;
}

const directPayShProxyDependencies = {
  privatePayShBase: privatePayShUrl,
  frontToken: payShFrontToken,
  operatorWallet: payShOperatorWallet,
  feePayerKey: payShFeePayerKey,
  researchAuthorizationToken: internalToken,
  loadQuote: (quoteId: string) => internalJson<DirectPayShQuote>(
    `/internal/v1/pay-sh-quotes/${encodeURIComponent(quoteId)}`,
  ),
  recipientAssetAccountReady: createDirectPayShRecipientAccountProbe(
    payShRpcUrl,
    settlementFinalityRpcTimeoutMs,
  ),
  bindChallenges: (
    queryToken: string | undefined,
    request: BindPayShChallengesRequest,
  ) => internalJson(
    "/internal/v1/pay-sh-challenges/bind",
    {
      method: "POST",
      headers: request.researchJobId
        ? { "x-openshelf-research-protocol": "durable-mpp-v2" }
        : { "x-openshelf-query-token": queryToken ?? "" },
      body: JSON.stringify(request),
    },
  ),
  prepareDirect: (
    attemptId: string,
    queryToken: string,
    request: PreparedMppCredential & {
      queryId: string;
      documentHandle: string;
      pathPriceKrw: number;
      ownerWallet: string;
    },
  ) => internalJson(
    `/internal/v1/direct-pay-sh-attempts/${encodeURIComponent(attemptId)}/prepare`,
    {
      method: "POST",
      headers: { "x-openshelf-query-token": queryToken },
      body: JSON.stringify(request),
    },
  ),
  prepareResearch: (
    jobId: string,
    attemptId: string,
    request: PreparedMppCredential,
  ) => internalJson(
    `/internal/v1/research-jobs/${encodeURIComponent(jobId)}`
      + `/payment-attempts/${encodeURIComponent(attemptId)}/prepare`,
    {
      method: "POST",
      headers: { "x-openshelf-research-protocol": "durable-mpp-v2" },
      body: JSON.stringify(request),
    },
  ),
  recordDirectReceipt: (attemptId: string, transactionSignature: string) => internalJson(
    `/internal/v1/direct-pay-sh-attempts/${encodeURIComponent(attemptId)}/settle`,
    { method: "POST", body: JSON.stringify({ transactionSignature }) },
  ),
  recordResearchReceipt: (
    jobId: string,
    attemptId: string,
    transactionSignature: string,
  ) => internalJson(
    `/internal/v1/research-jobs/${encodeURIComponent(jobId)}`
      + `/payment-attempts/${encodeURIComponent(attemptId)}/settle`,
    {
      method: "POST",
      headers: { "x-openshelf-research-protocol": "durable-mpp-v2" },
      body: JSON.stringify({ transactionSignature }),
    },
  ),
  receiptFinalized: (evidence: PayShReceiptEvidence) => waitForIndependentPayShFinality({
    evidence,
    rpcs: payShReconciliationRpcUrls.map((endpoint) =>
      boundedSolanaRpc(endpoint, settlementFinalityRpcTimeoutMs)
    ),
    minimumViews: managedEnvironment ? 2 : 1,
    timeoutMs: settlementFinalityTimeoutMs,
    pollIntervalMs: settlementFinalityPollIntervalMs,
    nowMs: () => performance.now(),
  }),
  afterDirectPrepare: async () => crashAtTestFailpoint("direct-after-prepare"),
  afterDirectReceipt: async () => crashAtTestFailpoint("direct-after-receipt"),
};

function crashAtTestFailpoint(name: string): void {
  if (testFailpoint !== name) return;
  process.kill(process.pid, "SIGKILL");
  throw new Error(`test failpoint ${name} did not terminate the gateway`);
}

function identityFromPath(path: string): RouteIdentity {
  return paymentIdentityFromPath(path);
}

function identityFromContext(context: HTTPRequestContext): RouteIdentity {
  return identityFromPath(context.path);
}

async function loadQuote(identity: RouteIdentity): Promise<PayableQuote> {
  const quote = await (identity.kind === "document"
    ? identity.selector === "quote"
      ? internalJson<PaymentQuote>(
          `/internal/v1/x402-payment-quotes/${encodeURIComponent(identity.quoteId)}`,
        )
      : internalJson<PaymentQuote>(
          `/internal/v1/payment-quotes/${encodeURIComponent(identity.queryId)}/${encodeURIComponent(identity.handle)}`,
        )
    : identity.kind === "bundle"
      ? internalJson<PaymentBundleQuote>(
          `/internal/v1/payment-bundles/${encodeURIComponent(identity.quoteId)}`,
        )
      : internalJson<OpenCallFundingQuote>(
          `/internal/v1/open-call-funding-quotes/${encodeURIComponent(identity.quoteId)}`,
        ));
  if (quote.network !== network) {
    throw new Error(`quote network ${quote.network} does not match gateway network ${network}`);
  }
  return quote;
}

async function getQuote(identity: RouteIdentity): Promise<PayableQuote> {
  settlementReplayGuard.assertNotSettled(identity.key);
  const quote = await loadQuote(identity);
  assertPaymentQuotePayable(quote);
  if (identity.kind === "bundle") await requireResearchOrchestratorReady();
  return quote;
}

const requireResearchOrchestratorReady = createReadyDependencyGuard({
  name: "research orchestrator",
  origin: researchOrchestratorUrl,
});

async function quoteForContext(context: HTTPRequestContext): Promise<PayableQuote> {
  return getQuote(identityFromContext(context));
}

function identityFromPaymentHook(context: {
  transportContext?: unknown;
  paymentPayload: { resource?: { url?: string } };
}): RouteIdentity {
  const requestPath = (
    context.transportContext as { request?: { path?: string } } | undefined
  )?.request?.path;
  return identityFromPath(requestPath ?? context.paymentPayload.resource?.url ?? "");
}

async function claimPaymentAttempt(
  attemptId: string,
  identity: RouteIdentity,
  quote: PayableQuote,
  payer: string,
  signedTransactionBase64: string,
): Promise<void> {
  await internalJson("/internal/v1/payment-attempts", {
    method: "POST",
    body: JSON.stringify({
      settlementKind: identity.kind,
      quoteId: quote.id,
      attemptId,
      payer,
      signedTransactionBase64,
      recentBlockhash: recentBlockhashFromTransaction(signedTransactionBase64),
    }),
  });
}

async function releasePaymentAttempt(
  attemptId: string,
  identity: RouteIdentity,
  quote: PayableQuote,
): Promise<void> {
  await internalJson("/internal/v1/payment-attempts/release", {
    method: "POST",
    body: JSON.stringify({
      settlementKind: identity.kind,
      quoteId: quote.id,
      attemptId,
    }),
  });
}

async function deferPaymentAttemptReconciliation(
  attempt: ReconciliationAttempt,
  absenceObserved = false,
): Promise<void> {
  try {
    await internalJson("/internal/v1/payment-attempts/reconciliation", {
      method: "POST",
      body: JSON.stringify({
        settlementKind: attempt.settlementKind,
        quoteId: attempt.quoteId,
        attemptId: attempt.attemptId,
        absenceObserved,
      }),
    });
  } catch (error) {
    // A normal settlement can clear the attempt while the scanner is reading.
    if (error instanceof RustApiError && error.status === 404) return;
    throw error;
  }
}

async function releaseReconciledPaymentAttempt(attempt: ReconciliationAttempt): Promise<void> {
  await internalJson("/internal/v1/payment-attempts/reconciliation/release", {
    method: "POST",
    body: JSON.stringify({
      settlementKind: attempt.settlementKind,
      quoteId: attempt.quoteId,
      attemptId: attempt.attemptId,
    }),
  });
}

async function releaseVerifiedPaymentAttempt(context: {
  paymentPayload: { payload: Readonly<Record<string, unknown>> };
}): Promise<void> {
  const attemptId = paymentAttemptId(context.paymentPayload);
  const attempt = verifiedPaymentAttempts.forAttempt(attemptId);
  if (!attempt) return;
  try {
    await releasePaymentAttempt(attemptId, attempt.identity, attempt.quote);
  } finally {
    verifiedPaymentAttempts.forget(attemptId);
  }
}

async function paymentAttemptForSettlement(
  context: {
    transportContext?: unknown;
    paymentPayload: {
      resource?: { url?: string };
      payload: Readonly<Record<string, unknown>>;
    };
  },
  attemptId: string,
): Promise<{
  attemptId: string;
  identity: RouteIdentity;
  quote: PayableQuote;
  evidence: ReconciliationAttempt;
}> {
  const local = verifiedPaymentAttempts.forAttempt(attemptId);
  const durable = await internalJson<ReconciliationAttempt>(
    `/internal/v1/payment-attempts/${encodeURIComponent(attemptId)}`,
  );
  const identity = identityFromPaymentHook(context);
  if (durable.attemptId !== attemptId || durable.settlementKind !== identity.kind) {
    throw new Error("durable payment attempt does not match its settlement route");
  }
  const quote = local?.identity.key === identity.key ? local.quote : await loadQuote(identity);
  if (quote.id !== durable.quoteId) {
    throw new Error("durable payment attempt does not match its quote");
  }
  return { attemptId, identity, quote, evidence: durable };
}

async function quoteForProtectedHandler(identity: RouteIdentity): Promise<PayableQuote> {
  const attempt = verifiedPaymentAttempts.forIdentity(identity.key);
  if (!attempt) {
    throw new PaymentQuoteError(
      409,
      "payment_not_payable",
      "The verified payment attempt is unavailable. Recover it instead of paying again.",
    );
  }
  return attempt.quote;
}

async function recordSettlement(settlement: PendingSettlement): Promise<void> {
  const endpoint = settlement.settlementKind === "bundle"
    ? "/internal/v1/bundle-chain-settlements"
    : settlement.settlementKind === "open_call"
      ? "/internal/v1/open-call-chain-settlements"
      : "/internal/v1/chain-settlements";
  await internalJson(endpoint, {
    method: "POST",
    body: JSON.stringify(settlement),
  });
  if (settlement.settlementKind === "bundle") {
    void triggerResearchJob(settlement.quoteId);
  }
  pendingSettlements.delete(settlement.transactionSignature);
}

async function triggerResearchJob(jobId: string): Promise<void> {
  try {
    const response = await fetch(
      `${researchOrchestratorUrl}/internal/v1/research-jobs/${encodeURIComponent(jobId)}/run`,
      {
        method: "POST",
        signal: AbortSignal.timeout(10_000),
        headers: {
          "content-type": "application/json",
          "x-openshelf-internal-token": internalToken,
        },
      },
    );
    const body = await boundedResponseText(
      response,
      MAX_TRIGGER_RESPONSE_BYTES,
      "research orchestrator trigger response",
    );
    if (!response.ok && response.status !== 202 && response.status !== 409) {
      throw new Error(`orchestrator returned ${response.status}: ${body.slice(0, 300)}`);
    }
  } catch (error) {
    // The funding ledger is durable. Cloud Scheduler or the browser's status
    // poll can safely trigger the same idempotent job again.
    console.error("could not trigger funded research job", safeError(error));
  }
}

async function retryPendingSettlements(): Promise<void> {
  for (const settlement of pendingSettlements.values()) {
    try {
      await reconcileSettlement(settlement);
      verifiedPaymentAttempts.forget(settlement.attemptId);
    } catch (error) {
      console.error("x402 reconciliation retry failed", safeError(error));
    }
  }
}

async function reconcileSettlement(settlement: PendingSettlement): Promise<void> {
  const result = await persistSettlementDurably({
    enqueue: settlementQueue
      ? () => settlementQueue.enqueue(settlement)
      : undefined,
    record: () => recordSettlement(settlement),
    releaseVolatileCopy: () => {
      pendingSettlements.delete(settlement.transactionSignature);
    },
  });
  if (result.queueError) {
    console.error(
      "could not enqueue durable x402 reconciliation",
      safeError(result.queueError),
    );
  }
  if (result.ledgerError) {
    console.error(
      "could not write x402 settlement to Rust ledger",
      safeError(result.ledgerError),
    );
  }
}

function callSolanaRpcAt(endpoint: string): SolanaRpc {
  return async (method, params) => {
    const response = await fetchRpcWithBackoff({
      jsonrpc: "2.0",
      id: `openshelf-reconcile-${Date.now()}`,
      method,
      params,
    }, endpoint);
    if (!response.ok) {
      await response.body?.cancel().catch(() => undefined);
      throw new Error(`Solana RPC ${method} returned HTTP ${response.status}`);
    }
    const payload = JSON.parse(await boundedResponseText(
      response,
      MAX_BACKGROUND_RPC_RESPONSE_BYTES,
      `Solana RPC ${method} response`,
    )) as {
      result?: unknown;
      error?: { code?: number; message?: string };
    };
    if (payload.error) {
      throw new Error(
        `Solana RPC ${method} failed (${payload.error.code ?? "unknown"}): ` +
          (payload.error.message ?? "unknown error"),
      );
    }
    if (!("result" in payload)) throw new Error(`Solana RPC ${method} returned no result`);
    return payload.result;
  };
}

async function reconcileDueChainAttempts(): Promise<void> {
  if (chainReconciliationRunning) return;
  chainReconciliationRunning = true;
  try {
    let cycleError: string | null = null;
    const attempts = await internalJson<ReconciliationAttempt[]>(
      "/internal/v1/payment-attempts/reconciliation?" +
        new URLSearchParams({ limit: String(chainReconciliationBatchSize) }),
    );
    for (const attempt of attempts) {
      try {
        if (
          attempt.payer
          && attempt.signedTransactionBase64
          && attempt.recentBlockhash
        ) {
          const scans = await Promise.all(chainReconciliationRpcUrls.map(async (endpoint) => {
            try {
              return await scanExactFinalizedChainAttempt(
                attempt,
                callSolanaRpcAt(endpoint),
                chainReconciliationSignaturePages,
              );
            } catch {
              return { kind: "inconclusive" } as const;
            }
          }));
          const exactSettlement = exactSettlementSignature(scans);
          if (exactSettlement) {
            const settlement: PendingSettlement = {
              settlementKind: attempt.settlementKind,
              quoteId: attempt.quoteId,
              attemptId: attempt.attemptId,
              transactionSignature: exactSettlement,
              payer: attempt.payer,
              payTo: attempt.payTo,
              amountAtomic: attempt.amountAtomic,
              network: attempt.network,
              rawResponse: {
                success: true,
                transaction: exactSettlement,
                payer: attempt.payer,
                network: attempt.network,
                amount: attempt.amountAtomic,
                recovery: { method: "exact_finalized_transaction" },
              },
            };
            pendingSettlements.set(settlement.transactionSignature, settlement);
            await reconcileSettlement(settlement);
            verifiedPaymentAttempts.forget(settlement.attemptId);
            continue;
          }
          if (scans.some((scan) =>
            scan.kind === "settled" || scan.kind === "inconclusive"
          )) {
            cycleError ??=
              `${attempt.settlementKind}:${attempt.quoteId}: ` +
              "independent RPC scans did not return complete exact evidence";
            await deferPaymentAttemptReconciliation(attempt);
            continue;
          }
          const blockhashViews = await Promise.all(chainReconciliationRpcUrls.map(
            async (endpoint): Promise<boolean | null> => {
              try {
                const result = await callSolanaRpcAt(endpoint)("isBlockhashValid", [
                  attempt.recentBlockhash,
                  { commitment: "finalized" },
                ]) as { value?: unknown };
                return typeof result?.value === "boolean" ? result.value : null;
              } catch {
                return null;
              }
            },
          ));
          const absenceDecision = exactAbsenceDecision(
            scans,
            blockhashViews,
            attempt.absenceObservedAt,
          );
          if (blockhashViews.some((view) => view === null)) {
            cycleError ??=
              `${attempt.settlementKind}:${attempt.quoteId}: ` +
              "an independent RPC could not return finalized blockhash state";
          }
          if (absenceDecision === "defer") {
            await deferPaymentAttemptReconciliation(attempt);
          } else if (absenceDecision === "observe") {
            await deferPaymentAttemptReconciliation(attempt, true);
          } else {
            await releaseReconciledPaymentAttempt(attempt);
          }
          continue;
        }

        const settlement = await findUnanimousFinalizedChainSettlement(
          attempt,
          chainReconciliationRpcUrls.map(callSolanaRpcAt),
          network,
          chainReconciliationSignaturePages,
        );
        if (!settlement) {
          cycleError ??=
            `${attempt.settlementKind}:${attempt.quoteId}: ` +
            "legacy recovery did not obtain unanimous finalized evidence";
          await deferPaymentAttemptReconciliation(attempt);
          continue;
        }
        pendingSettlements.set(settlement.transactionSignature, settlement);
        await reconcileSettlement(settlement);
        verifiedPaymentAttempts.forget(settlement.attemptId);
        console.log(
          `recovered finalized x402 settlement ${settlement.transactionSignature} ` +
            `for ${settlement.settlementKind}:${settlement.quoteId}`,
        );
      } catch (error) {
        cycleError ??=
          `${attempt.settlementKind}:${attempt.quoteId}: ${safeError(error)}`;
        console.error(
          `could not reconcile ${attempt.settlementKind}:${attempt.quoteId}`,
          safeError(error),
        );
        try {
          await deferPaymentAttemptReconciliation(attempt);
        } catch (deferError) {
          cycleError =
            `${attempt.settlementKind}:${attempt.quoteId}: ` +
            `reconciliation failed (${safeError(error)}); defer failed (${safeError(deferError)})`;
          console.error(
            `could not defer ${attempt.settlementKind}:${attempt.quoteId}`,
            safeError(deferError),
          );
        }
      }
    }
    lastChainReconciliationAt = Date.now();
    lastChainReconciliationMonotonicAt = performance.now();
    lastChainReconciliationError = cycleError;
  } catch (error) {
    lastChainReconciliationError = safeError(error);
    console.error("could not list due x402 payment attempts", lastChainReconciliationError);
  } finally {
    chainReconciliationRunning = false;
  }
}

function recentBlockhashFromTransaction(transactionBase64: string): string {
  const bytes = Buffer.from(transactionBase64, "base64");
  try {
    const blockhash = Transaction.from(bytes).recentBlockhash;
    if (blockhash) return blockhash;
  } catch {
    // Versioned transactions are parsed below.
  }
  const blockhash = VersionedTransaction.deserialize(bytes).message.recentBlockhash;
  if (!blockhash) throw new Error("verified x402 transaction omitted its recent blockhash");
  return blockhash;
}

const facilitator = new HTTPFacilitatorClient({ url: facilitatorUrl });
const resourceServer = new x402ResourceServer(facilitator);
resourceServer.register(network, createStableExactSvmServerScheme());

resourceServer.onAfterVerify(async (context) => {
  if (!context.result.payer) {
    return {
      abort: true,
      reason: "payer_missing",
      message: "The verified payment did not identify its payer.",
    };
  }
  if (context.result.payer === context.requirements.payTo) {
    return {
      abort: true,
      reason: "self_payment_not_allowed",
      message: "payer and document recipient must be different wallets",
    };
  }
  let attemptId: string | undefined;
  let identity: RouteIdentity | undefined;
  let quote: PayableQuote | undefined;
  try {
    attemptId = paymentAttemptId(context.paymentPayload);
    identity = identityFromPaymentHook(context);
    quote = await getQuote(identity);
    // The Rust lease is the cross-instance fence. It is acquired after the
    // facilitator verifies the signature but before it is allowed to settle.
    const signedTransactionBase64 = String(context.paymentPayload.payload.transaction ?? "");
    const evidence: ReconciliationAttempt = {
      settlementKind: identity.kind,
      quoteId: quote.id,
      attemptId,
      reconcileAfter: Date.now(),
      createdAt: Date.now(),
      payTo: quote.payTo,
      network: quote.network,
      asset: quote.asset,
      amountAtomic: quote.amountAtomic,
      payer: context.result.payer,
      signedTransactionBase64,
      recentBlockhash: recentBlockhashFromTransaction(signedTransactionBase64),
    };
    if (!await hasExactPreparedPaymentSemantics(
      evidence,
      Buffer.from(signedTransactionBase64, "base64"),
    )) {
      throw new PaymentQuoteError(
        409,
        "payment_not_payable",
        "The verified transaction does not contain the exact quoted payment.",
      );
    }
    await claimPaymentAttempt(
      attemptId,
      identity,
      quote,
      context.result.payer,
      signedTransactionBase64,
    );
    try {
      verifiedPaymentAttempts.remember(attemptId, identity, quote);
    } catch (error) {
      await releasePaymentAttempt(attemptId, identity, quote);
      throw error;
    }
  } catch (error) {
    console.error("x402 payment attempt could not be claimed", safeError(error));
    return {
      abort: true,
      reason: error instanceof PaymentQuoteError ? error.code : "payment_attempt_unavailable",
      message: error instanceof PaymentQuoteError
        ? error.message
        : "This payment resource cannot begin settlement right now. Retry without signing again.",
    };
  }
});

resourceServer.onVerifyFailure(async (context) => {
  console.error("x402 payment verification failed", safeError(context.error));
});

resourceServer.onSettleFailure(async (context) => {
  console.error("x402 payment settlement failed", safeError(context.error));
  // A timeout or dropped facilitator response has an ambiguous chain outcome.
  // Keep the durable fence until reconciliation proves failure or records the
  // transfer; releasing here could authorize a second real payment.
  console.error("x402 payment attempt retained for reconciliation");
});

resourceServer.onVerifiedPaymentCanceled(async (context) => {
  try {
    await releaseVerifiedPaymentAttempt(context);
  } catch (error) {
    console.error("could not release canceled x402 payment attempt", safeError(error));
  }
});

resourceServer.onBeforeSettle(async (context) => {
  // x402 treats ordinary before-settle hook exceptions as advisory and would
  // fall through to a second facilitator call. This helper catches every
  // uncertainty and always returns an explicit skip-or-abort directive.
  return settleWithIndependentFinality({
    settle: () => boundedFacilitatorSettlement({
      url: facilitatorUrl,
      paymentPayload: structuredClone(context.paymentPayload) as PaymentPayload,
      paymentRequirements: structuredClone(context.requirements) as PaymentRequirements,
      timeoutMs: facilitatorSettlementTimeoutMs,
    }),
    loadAttempt: async () => {
      const attemptId = paymentAttemptId(context.paymentPayload);
      return (await paymentAttemptForSettlement(context, attemptId)).evidence;
    },
    requirements: context.requirements,
    rpcs: chainReconciliationRpcUrls.map((endpoint) =>
      boundedSolanaRpc(endpoint, settlementFinalityRpcTimeoutMs)
    ),
    expectedNetwork: network,
    timeoutMs: settlementFinalityTimeoutMs,
    pollIntervalMs: settlementFinalityPollIntervalMs,
    nowMs: () => performance.now(),
  });
});

resourceServer.onAfterSettle(async (context) => {
  if (!context.result.success || !context.result.payer) {
    console.error("unsuccessful x402 payment attempt retained for reconciliation");
    return;
  }
  let attempt;
  try {
    const attemptId = paymentAttemptId(context.paymentPayload);
    attempt = await paymentAttemptForSettlement(context, attemptId);
  } catch (error) {
    console.error(
      "x402 settled on-chain without recoverable pre-settlement state; manual reconciliation required",
      safeError(error),
    );
    return;
  }
  const { attemptId, identity, quote } = attempt;
  // Fence this resource before any fallible reconciliation call. A retry must
  // recover the existing result, never construct another transfer.
  settlementReplayGuard.markSettled(identity.key, quote.expiresAt);
  const settlement: PendingSettlement = {
    settlementKind: identity.kind,
    quoteId: quote.id,
    attemptId,
    transactionSignature: context.result.transaction,
    payer: context.result.payer,
    payTo: context.requirements.payTo,
    amountAtomic: context.result.amount ?? context.requirements.amount,
    network: context.result.network,
    rawResponse: context.result,
  };
  pendingSettlements.set(settlement.transactionSignature, settlement);
  try {
    await reconcileSettlement(settlement);
    verifiedPaymentAttempts.forget(attemptId);
  } catch (error) {
    console.error("x402 settled on-chain; reconciliation remains in memory", safeError(error));
  }
});

// --- Public standalone prepaid top-up ---------------------------------------
// A dedicated x402 resource server keeps the standalone top-up fully isolated
// from the document/bundle/open-call money path: it reuses the exact same
// scheme, facilitator, exact-semantics check, and independent-finality settle,
// but never touches the backend payment-attempt ledger. Credit is applied only
// after finality, through the idempotent internal deposit route.
type GatewayPrepaidBalance = {
  wallet: string;
  payTo: string;
  network: string;
  asset: string;
  availableAtomic: string;
};

const topUpQuotes = new TopUpQuoteStore();
const topUpReplayGuard = new SettlementReplayGuard();
const topUpVerifiedAttempts = new VerifiedPaymentAttemptTracker<TopUpQuote>();
const topUpAttemptPayers = new Map<string, string>();
const pendingTopUpDeposits = new Map<string, PrepaidDepositRequest>();

function topUpIdentityFromPath(path: string): Extract<RouteIdentity, { kind: "topup" }> {
  const pathname = path.startsWith("http") ? new URL(path).pathname : path.split("?")[0];
  const match = pathname.match(/^\/api\/v1\/paid-top-ups\/([^/]+)$/);
  if (!match) throw new Error("invalid prepaid top-up resource path");
  const quoteId = decodeURIComponent(match[1]);
  if (!quoteId) throw new Error("prepaid top-up quote id is required");
  return { kind: "topup", quoteId, key: `topup ${quoteId}` };
}

function topUpIdentityFromContext(
  context: HTTPRequestContext,
): Extract<RouteIdentity, { kind: "topup" }> {
  return topUpIdentityFromPath(context.path);
}

function topUpIdentityFromPaymentHook(context: {
  transportContext?: unknown;
  paymentPayload: { resource?: { url?: string } };
}): Extract<RouteIdentity, { kind: "topup" }> {
  const requestPath = (
    context.transportContext as { request?: { path?: string } } | undefined
  )?.request?.path;
  return topUpIdentityFromPath(requestPath ?? context.paymentPayload.resource?.url ?? "");
}

function getTopUpQuoteForIdentity(identity: { key: string; quoteId: string }): TopUpQuote {
  topUpReplayGuard.assertNotSettled(identity.key);
  const quote = topUpQuotes.get(identity.quoteId);
  if (!quote) {
    throw new PaymentQuoteError(
      409,
      "payment_not_payable",
      "This top-up is no longer payable. Start a new top-up.",
    );
  }
  assertPaymentQuotePayable(quote);
  return quote;
}

async function creditPrepaidTopUp(deposit: PrepaidDepositRequest): Promise<void> {
  try {
    await internalJson<GatewayPrepaidBalance>("/api/v1/prepaid/deposits", {
      method: "POST",
      body: JSON.stringify(deposit),
    });
    pendingTopUpDeposits.delete(deposit.transactionSignature);
  } catch (error) {
    // The transfer is already finalized on-chain. A 4xx is a permanent ledger
    // rejection (policy/amount) that a retry cannot fix; anything else is
    // transient and safe to retry because the deposit route dedupes on the
    // transaction signature.
    if (error instanceof RustApiError && error.status >= 400 && error.status < 500) {
      pendingTopUpDeposits.delete(deposit.transactionSignature);
      throw error;
    }
    pendingTopUpDeposits.set(deposit.transactionSignature, deposit);
    throw error;
  }
}

async function retryPendingTopUpDeposits(): Promise<void> {
  for (const [signature, deposit] of pendingTopUpDeposits) {
    try {
      await internalJson<GatewayPrepaidBalance>("/api/v1/prepaid/deposits", {
        method: "POST",
        body: JSON.stringify(deposit),
      });
      pendingTopUpDeposits.delete(signature);
    } catch (error) {
      if (error instanceof RustApiError && error.status >= 400 && error.status < 500) {
        pendingTopUpDeposits.delete(signature);
        console.error("prepaid top-up deposit permanently rejected on retry", safeError(error));
      }
      // Otherwise keep it queued for the next tick.
    }
  }
}

const topUpResourceServer = new x402ResourceServer(facilitator);
topUpResourceServer.register(network, createStableExactSvmServerScheme());

topUpResourceServer.onAfterVerify(async (context) => {
  if (!context.result.payer) {
    return {
      abort: true,
      reason: "payer_missing",
      message: "The verified payment did not identify its payer.",
    };
  }
  if (context.result.payer === context.requirements.payTo) {
    return {
      abort: true,
      reason: "self_payment_not_allowed",
      message: "payer and top-up recipient must be different wallets",
    };
  }
  let attemptId: string | undefined;
  try {
    attemptId = paymentAttemptId(context.paymentPayload);
    const identity = topUpIdentityFromPaymentHook(context);
    const quote = getTopUpQuoteForIdentity(identity);
    const signedTransactionBase64 = String(context.paymentPayload.payload.transaction ?? "");
    const evidence: ReconciliationAttempt = {
      settlementKind: "topup",
      quoteId: quote.id,
      attemptId,
      reconcileAfter: Date.now(),
      createdAt: Date.now(),
      payTo: quote.payTo,
      network: quote.network,
      asset: quote.asset,
      amountAtomic: quote.amountAtomic,
      payer: context.result.payer,
      signedTransactionBase64,
      recentBlockhash: recentBlockhashFromTransaction(signedTransactionBase64),
    };
    if (!await hasExactPreparedPaymentSemantics(
      evidence,
      Buffer.from(signedTransactionBase64, "base64"),
    )) {
      throw new PaymentQuoteError(
        409,
        "payment_not_payable",
        "The verified transaction does not contain the exact quoted top-up.",
      );
    }
    topUpVerifiedAttempts.remember(attemptId, identity, quote);
    topUpAttemptPayers.set(attemptId, context.result.payer);
  } catch (error) {
    console.error("prepaid top-up payment attempt could not be verified", safeError(error));
    return {
      abort: true,
      reason: error instanceof PaymentQuoteError ? error.code : "payment_attempt_unavailable",
      message: error instanceof PaymentQuoteError
        ? error.message
        : "This top-up cannot begin settlement right now. Retry without signing again.",
    };
  }
});

topUpResourceServer.onVerifyFailure(async (context) => {
  console.error("prepaid top-up verification failed", safeError(context.error));
});

topUpResourceServer.onSettleFailure(async (context) => {
  console.error("prepaid top-up settlement failed", safeError(context.error));
  console.error("prepaid top-up attempt retained for reconciliation");
});

topUpResourceServer.onVerifiedPaymentCanceled(async (context) => {
  const attemptId = paymentAttemptId(context.paymentPayload);
  topUpVerifiedAttempts.forget(attemptId);
  topUpAttemptPayers.delete(attemptId);
});

topUpResourceServer.onBeforeSettle(async (context) => {
  return settleWithIndependentFinality({
    settle: () => boundedFacilitatorSettlement({
      url: facilitatorUrl,
      paymentPayload: structuredClone(context.paymentPayload) as PaymentPayload,
      paymentRequirements: structuredClone(context.requirements) as PaymentRequirements,
      timeoutMs: facilitatorSettlementTimeoutMs,
    }),
    loadAttempt: async () => {
      const attemptId = paymentAttemptId(context.paymentPayload);
      const remembered = topUpVerifiedAttempts.forAttempt(attemptId);
      const payer = topUpAttemptPayers.get(attemptId);
      if (!remembered || !payer) {
        throw new Error("verified top-up attempt is unavailable");
      }
      const quote = remembered.quote;
      const signedTransactionBase64 = String(context.paymentPayload.payload.transaction ?? "");
      return {
        settlementKind: "topup",
        quoteId: quote.id,
        attemptId,
        reconcileAfter: Date.now(),
        createdAt: Date.now(),
        payTo: quote.payTo,
        network: quote.network,
        asset: quote.asset,
        amountAtomic: quote.amountAtomic,
        payer,
        signedTransactionBase64,
        recentBlockhash: recentBlockhashFromTransaction(signedTransactionBase64),
      } satisfies ReconciliationAttempt;
    },
    requirements: context.requirements,
    rpcs: chainReconciliationRpcUrls.map((endpoint) =>
      boundedSolanaRpc(endpoint, settlementFinalityRpcTimeoutMs)
    ),
    expectedNetwork: network,
    timeoutMs: settlementFinalityTimeoutMs,
    pollIntervalMs: settlementFinalityPollIntervalMs,
    nowMs: () => performance.now(),
  });
});

topUpResourceServer.onAfterSettle(async (context) => {
  if (!context.result.success || !context.result.payer) {
    console.error("unsuccessful prepaid top-up retained for reconciliation");
    return;
  }
  const attemptId = paymentAttemptId(context.paymentPayload);
  const attempt = topUpVerifiedAttempts.forAttempt(attemptId);
  if (!attempt || attempt.identity.kind !== "topup") {
    console.error(
      "prepaid top-up settled without verified attempt state; manual reconciliation required",
    );
    return;
  }
  const identity = attempt.identity;
  const quote = attempt.quote;
  // Fence this quote before the credit call so a retry can never settle it a
  // second time. The on-chain transfer is already final.
  topUpReplayGuard.markSettled(identity.key, quote.expiresAt);
  try {
    const deposit = topUpDepositFromSettlement(quote, context.result);
    await creditPrepaidTopUp(deposit);
  } catch (error) {
    console.error(
      "prepaid top-up settled on-chain; deposit credit deferred for retry",
      safeError(error),
    );
  } finally {
    topUpVerifiedAttempts.forget(attemptId);
    topUpAttemptPayers.delete(attemptId);
    topUpQuotes.delete(quote.id);
  }
});

const app = express();
app.disable("x-powered-by");
app.use(express.json({ limit: "32kb" }));
app.use((request, response, next) => {
  const origin = request.headers.origin;
  if (browserOriginAllowed(origin, allowedOrigin, managedEnvironment)) {
    response.setHeader("access-control-allow-origin", origin as string);
  }
  response.setHeader("vary", "Origin");
  response.setHeader("cache-control", "no-store");
  response.setHeader("x-content-type-options", "nosniff");
  response.setHeader("x-frame-options", "DENY");
  response.setHeader("access-control-allow-methods", "GET,POST,OPTIONS");
  response.setHeader(
    "access-control-allow-headers",
    // @x402/fetch adds Access-Control-Expose-Headers to its paid retry.
    // It is unusual as a request header, but must be allowed or the browser
    // blocks the signed retry during CORS preflight with `Failed to fetch`.
    "Content-Type,Payment-Signature,X-Payment,Access-Control-Expose-Headers,Solana-Client,X-Openshelf-Query-Token,X-Openshelf-Wallet-Session",
  );
  response.setHeader(
    "access-control-expose-headers",
    "Payment-Required,Payment-Response,X-Payment-Response",
  );
  if (request.method === "OPTIONS") {
    response.sendStatus(204);
    return;
  }
  next();
});

const proxyDirectPaySh = async (
  request: Request,
  response: ExpressResponse,
  next: NextFunction,
) => {
  try {
    const upstream = await proxyPayShRequest(
      {
        method: request.method,
        pathAndQuery: request.originalUrl,
        headers: webHeaders(request),
        body: request.method === "GET" || request.method === "HEAD"
          ? undefined
          : Buffer.from(JSON.stringify(request.body ?? {})),
      },
      directPayShProxyDependencies,
    );
    await writeProxyResponse(response, upstream);
  } catch (error) {
    next(error);
  }
};

// Agents use the x402 gateway as the only public Pay.sh origin. Free discovery
// calls and 402 probes pass through, while the paid retry is durably fenced
// before the private official gate can observe the credential.
app.post("/api/v1/questions/resolve", proxyDirectPaySh);
app.get(
  /^\/api\/v1\/questions\/[^/]+\/pay-sh-(?:resources|documents)\/[^/]+$/,
  proxyDirectPaySh,
);
app.get(/^\/api\/v2\/pay-sh\/documents\/[^/]+\/[^/]+\/[^/]+$/, proxyDirectPaySh);

// The x402 SVM client needs mint metadata and a recent blockhash before it can
// ask Phantom to sign. Proxy only those read-only methods so a paid RPC key can
// remain server-side and browser bursts can honor upstream Retry-After headers.
app.post("/rpc", async (request, response, next) => {
  try {
    if (
      request.headers.origin &&
      !browserOriginAllowed(request.headers.origin, allowedOrigin, managedEnvironment)
    ) {
      response.status(403).json({
        jsonrpc: "2.0",
        error: { code: -32003, message: "RPC browser origin is not allowed" },
        id: rpcRequestId(request.body),
      });
      return;
    }
    if (!consumeRpcRateLimit(request.socket.remoteAddress ?? "unknown")) {
      response.setHeader("retry-after", "60");
      response.status(429).json({
        jsonrpc: "2.0",
        error: { code: -32005, message: "RPC proxy rate limit exceeded" },
        id: rpcRequestId(request.body),
      });
      return;
    }
    const body = request.body as unknown;
    if (!isAllowedBrowserRpcRequest(body, browserBalanceMint)) {
      response.status(400).json({
        jsonrpc: "2.0",
        error: { code: -32600, message: "RPC method is not allowed" },
        id: rpcRequestId(body),
      });
      return;
    }
    const upstream = await fetchRpcWithBackoff(body);
    const payload = await boundedResponseText(
      upstream,
      MAX_ACCOUNT_PREFLIGHT_RESPONSE_BYTES,
      "browser Solana RPC response",
    );
    response.status(upstream.status).type("application/json").send(payload);
  } catch (error) {
    next(error);
  }
});

app.get("/healthz", (_request, response) => {
  response.json({
    status: "ok",
    network,
    facilitator: facilitatorUrl,
    durableSettlementQueue: settlementQueue !== null,
    pendingReconciliations: pendingSettlements.size,
    chainReconciler: {
      running: chainReconciliationRunning,
      lastCompletedAt: lastChainReconciliationAt,
      lastError: lastChainReconciliationError,
    },
  });
});

app.get("/readyz", async (_request, response) => {
  try {
    const [, , payShHealth] = await Promise.all([
      internalJson<{ status: string }>("/readyz"),
      requireGlobalResearchOrchestrator
        ? requireResearchOrchestratorReady()
        : Promise.resolve(),
      fetch(`${privatePayShUrl}/__402/health`, {
        signal: AbortSignal.timeout(5_000),
        headers: { "x-openshelf-pay-front-token": payShFrontToken },
      }),
    ]);
    if (!payShHealth.ok) {
      await payShHealth.body?.cancel().catch(() => undefined);
      throw new Error(`private Pay.sh returned HTTP ${payShHealth.status}`);
    }
    await payShHealth.body?.cancel().catch(() => undefined);
    const recovery = reconcilerReadiness({
      nowMonotonicMs: performance.now(),
      lastCompletedMonotonicMs: lastChainReconciliationMonotonicAt,
      lastError: lastChainReconciliationError,
      intervalMs: chainReconciliationIntervalMs,
    });
    if (!recovery.ready) throw new Error(recovery.reason);
    response.json({
      status: "ready",
      network,
      durableSettlementQueue: settlementQueue !== null,
      pendingReconciliations: pendingSettlements.size,
      chainReconciler: {
        running: chainReconciliationRunning,
        lastCompletedAt: lastChainReconciliationAt,
        lastError: lastChainReconciliationError,
      },
    });
  } catch (error) {
    console.error("gateway readiness check failed", safeError(error));
    response.status(503).json({
      status: "not_ready",
      pendingReconciliations: pendingSettlements.size,
    });
  }
});

// Preparing a research job is free. Phantom later funds the exact sum of the
// independent Pay.sh charges with one transfer to the bounded agent wallet.
app.post("/api/v1/payment-bundles", async (request, response, next) => {
  try {
    const accessToken = request.header("x-openshelf-query-token")?.trim();
    const walletSession = request.header("x-openshelf-wallet-session")?.trim();
    const agentProtocol = request.header("x-openshelf-agent-payment-mode")?.trim();
    if (!accessToken) {
      response.status(401).json({
        error: { code: "missing_query_token", message: "Query access token is required." },
      });
      return;
    }
    const body = request.body as {
      queryId?: unknown;
      handles?: unknown;
      topUpAtomic?: unknown;
      expectedInvoiceHash?: unknown;
    };
    if (
      typeof body?.queryId !== "string" ||
      !Array.isArray(body.handles) ||
      body.handles.length < 1 ||
      body.handles.length > 100 ||
      body.handles.some((handle) => typeof handle !== "string") ||
      (body.topUpAtomic !== undefined &&
        (typeof body.topUpAtomic !== "string" || !/^\d+$/.test(body.topUpAtomic)))
      || (body.expectedInvoiceHash !== undefined
        && (typeof body.expectedInvoiceHash !== "string"
          || !/^[0-9a-f]{64}$/.test(body.expectedInvoiceHash)))
    ) {
      response.status(400).json({
        error: {
          code: "invalid_bundle",
          message: "queryId and between 1 and 100 document handles are required.",
        },
      });
      return;
    }
    let fundingMode: BundleFundingMode;
    try {
      fundingMode = bundleFundingMode({
        walletSession,
        agentProtocol,
        topUpAtomic: body.topUpAtomic,
      });
    } catch (error) {
      if (!(error instanceof BundleFundingModeError)) throw error;
      response.status(error.status).json({
        error: { code: error.code, message: error.message },
      });
      return;
    }
    await requireResearchOrchestratorReady();
    const quote = await internalJson<PaymentBundleQuote>(
      fundingMode.kind === "prepaid"
        ? "/internal/v1/payment-bundles"
        : "/internal/v1/agent-payment-bundles",
      {
        method: "POST",
        headers: {
          "x-openshelf-query-token": accessToken,
          ...(fundingMode.kind === "prepaid"
            ? { "x-openshelf-wallet-session": fundingMode.walletSession }
            : {}),
        },
        body: JSON.stringify({
          queryId: body.queryId,
          handles: body.handles,
          ...(fundingMode.kind === "prepaid" ? { topUpAtomic: body.topUpAtomic } : {}),
          ...(body.expectedInvoiceHash
            ? { expectedInvoiceHash: body.expectedInvoiceHash }
            : {}),
        }),
      },
    );
    if (!quote.requiresPayment && quote.status === "funded") {
      void triggerResearchJob(quote.id);
    }
    response.status(201).json({
      quote,
      resourceUrl: `${request.protocol}://${request.get("host")}${quote.resourcePath}`,
    });
  } catch (error) {
    next(error);
  }
});

// Preparing a standalone top-up is free and needs no research context: the
// browser asks for a whole-USDC amount, and the gateway returns an exact x402
// resource to pay with Phantom. The credit lands on the prepaid balance once
// the transfer to OPENSHELF_BUNDLE_RECEIVER is independently finalized.
app.post("/api/v1/prepaid/top-ups", (request, response) => {
  try {
    if (!bundleReceiver) {
      response.status(503).json({
        error: {
          code: "top_up_unavailable",
          message: "Standalone prepaid top-up is not configured on this gateway.",
        },
      });
      return;
    }
    const body = request.body as { amountUsdc?: unknown };
    const amountUsdc = parseTopUpAmountUsdc(body?.amountUsdc);
    const quote = topUpQuotes.create({
      amountUsdc,
      payTo: bundleReceiver,
      network,
      asset: topUpAsset,
      ttlMs: topUpQuoteTtlMs,
    });
    response.status(201).json({
      quote,
      resourceUrl: `${request.protocol}://${request.get("host")}${quote.resourcePath}`,
    });
  } catch (error) {
    if (error instanceof TopUpRequestError) {
      response.status(error.status).json({
        error: { code: error.code, message: error.message },
      });
      return;
    }
    console.error("could not prepare prepaid top-up", safeError(error));
    response.status(502).json({
      error: { code: "gateway_error", message: "Could not prepare the top-up." },
    });
  }
});

app.use(
  paymentMiddleware(
    {
      "GET /api/v1/paid-documents/*": {
        accepts: {
          scheme: "exact",
          network,
          payTo: async (context) => (await quoteForContext(context)).payTo,
          price: async (context) => {
            const identity = identityFromContext(context);
            const quote = await getQuote(identity);
            return {
              asset: quote.asset,
              amount: quote.amountAtomic,
              extra: { memo: paymentMemo(identity, quote.id) },
            };
          },
          maxTimeoutSeconds: 60,
        },
        description: "Open one matched OPENSHELF document",
        mimeType: "application/json",
        serviceName: "OPENSHELF",
        unpaidResponseBody: async (context) => {
          const quote = await quoteForContext(context);
          return {
            contentType: "application/json",
            body: {
              error: { code: "payment_required", message: "USDC payment is required" },
              quote,
            },
          };
        },
        settlementFailedResponseBody: (_context, result) => ({
          contentType: "application/json",
          body: {
            error: {
              code: "settlement_failed",
              message: result.errorMessage ?? result.errorReason,
            },
          },
        }),
      },
      "GET /api/v1/paid-quotes/*": {
        accepts: {
          scheme: "exact",
          network,
          payTo: async (context) => (await quoteForContext(context)).payTo,
          price: async (context) => {
            const identity = identityFromContext(context);
            const quote = await getQuote(identity);
            return {
              asset: quote.asset,
              amount: quote.amountAtomic,
              extra: { memo: paymentMemo(identity, quote.id) },
            };
          },
          maxTimeoutSeconds: 60,
        },
        description: "Open one immutable Obulus evidence quote",
        mimeType: "application/json",
        serviceName: "Obulus",
        unpaidResponseBody: async (context) => {
          const quote = await quoteForContext(context);
          return {
            contentType: "application/json",
            body: {
              error: { code: "payment_required", message: "USDC payment is required" },
              quote,
            },
          };
        },
        settlementFailedResponseBody: (_context, result) => ({
          contentType: "application/json",
          body: {
            error: {
              code: "settlement_failed",
              message: result.errorMessage ?? result.errorReason,
            },
          },
        }),
      },
      "GET /api/v1/paid-bundles/*": {
        accepts: {
          scheme: "exact",
          network,
          payTo: async (context) => (await quoteForContext(context)).payTo,
          price: async (context) => {
            const identity = identityFromContext(context);
            const quote = await getQuote(identity);
            return {
              asset: quote.asset,
              amount: quote.amountAtomic,
              extra: { memo: paymentMemo(identity, quote.id) },
            };
          },
          maxTimeoutSeconds: 60,
        },
        description: "Fund a Pay.sh research job for exact matched OPENSHELF documents",
        mimeType: "application/json",
        serviceName: "OPENSHELF",
        unpaidResponseBody: async (context) => {
          const quote = await quoteForContext(context);
          return {
            contentType: "application/json",
            body: {
              error: { code: "payment_required", message: "One exact research budget deposit is required" },
              quote,
            },
          };
        },
        settlementFailedResponseBody: (_context, result) => ({
          contentType: "application/json",
          body: {
            error: {
              code: "settlement_failed",
              message: result.errorMessage ?? result.errorReason,
            },
          },
        }),
      },
      "GET /api/v1/funded-open-calls/*": {
        accepts: {
          scheme: "exact",
          network,
          payTo: async (context) => (await quoteForContext(context)).payTo,
          price: async (context) => {
            const identity = identityFromContext(context);
            const quote = await getQuote(identity);
            return {
              asset: quote.asset,
              amount: quote.amountAtomic,
              extra: { memo: paymentMemo(identity, quote.id) },
            };
          },
          maxTimeoutSeconds: 60,
        },
        description: "Fund one OPENSHELF open call on Solana Devnet",
        mimeType: "application/json",
        serviceName: "OPENSHELF",
        unpaidResponseBody: async (context) => {
          const quote = await quoteForContext(context);
          return {
            contentType: "application/json",
            body: {
              error: {
                code: "payment_required",
                message: "One exact Devnet USDC escrow payment is required",
              },
              quote,
            },
          };
        },
        settlementFailedResponseBody: (_context, result) => ({
          contentType: "application/json",
          body: {
            error: {
              code: "settlement_failed",
              message: result.errorMessage ?? result.errorReason,
            },
          },
        }),
      },
    },
    resourceServer,
    { appName: "OPENSHELF", testnet: network === DEVNET_NETWORK },
  ),
);

app.use(
  paymentMiddleware(
    {
      "GET /api/v1/paid-top-ups/*": {
        accepts: {
          scheme: "exact",
          network,
          payTo: async (context) =>
            getTopUpQuoteForIdentity(topUpIdentityFromContext(context)).payTo,
          price: async (context) => {
            const identity = topUpIdentityFromContext(context);
            const quote = getTopUpQuoteForIdentity(identity);
            return {
              asset: quote.asset,
              amount: quote.amountAtomic,
              extra: { memo: paymentMemo(identity, quote.id) },
            };
          },
          maxTimeoutSeconds: 60,
        },
        description: "Top up an OPENSHELF prepaid USDC balance",
        mimeType: "application/json",
        serviceName: "OPENSHELF",
        unpaidResponseBody: async (context) => {
          const quote = getTopUpQuoteForIdentity(topUpIdentityFromContext(context));
          return {
            contentType: "application/json",
            body: {
              error: { code: "payment_required", message: "USDC payment is required" },
              quote,
            },
          };
        },
        settlementFailedResponseBody: (_context, result) => ({
          contentType: "application/json",
          body: {
            error: {
              code: "settlement_failed",
              message: result.errorMessage ?? result.errorReason,
            },
          },
        }),
      },
    },
    topUpResourceServer,
    { appName: "OPENSHELF", testnet: network === DEVNET_NETWORK },
  ),
);

app.get("/api/v1/paid-top-ups/:id", async (request, response, next) => {
  try {
    const identity = topUpIdentityFromPath(`/api/v1/paid-top-ups/${request.params.id}`);
    const attempt = topUpVerifiedAttempts.forIdentity(identity.key);
    if (!attempt) {
      throw new PaymentQuoteError(
        409,
        "payment_not_payable",
        "This top-up has no verified payment in progress. Start a new top-up.",
      );
    }
    // The x402 middleware runs onAfterSettle (which credits the prepaid balance
    // through the internal deposit route) after this handler and before the
    // response flushes. The browser refreshes its balance from the Rust ledger
    // once this resolves.
    response.json({
      status: "settling",
      quoteId: attempt.quote.id,
      amountAtomic: attempt.quote.amountAtomic,
      network: attempt.quote.network,
    });
  } catch (error) {
    next(error);
  }
});

app.get("/api/v1/paid-documents/:queryId/:handle", async (request, response, next) => {
  try {
    const identity: RouteIdentity = {
      kind: "document",
      selector: "query",
      queryId: request.params.queryId,
      handle: request.params.handle,
      key: `document\u0000${request.params.queryId}\u0000${request.params.handle}`,
    };
    const quote = await quoteForProtectedHandler(identity);
    if (!("priceKrw" in quote)) throw new Error("document route received a bundle quote");
    // Express x402 buffers this body. Our before-settle gate invokes the
    // facilitator once and releases the buffer only after two independent RPCs
    // reproduce its exact finalized transaction; onAfterSettle then records the
    // same evidence. The snapshot endpoint is internal and read-only.
    const document = await internalJson<PaymentDocumentSnapshot>(
      `/internal/v1/payment-quotes/${encodeURIComponent(quote.id)}/snapshot`,
    );
    response.json({
      citations: [document.citation],
      settlement: {
        id: quote.id,
        count: 1,
        total: quote.priceKrw,
        network: quote.network,
      },
    });
  } catch (error) {
    next(error);
  }
});

app.get("/api/v1/paid-quotes/:quoteId", async (request, response, next) => {
  try {
    const identity: RouteIdentity = {
      kind: "document",
      selector: "quote",
      quoteId: request.params.quoteId,
      key: `document_quote\u0000${request.params.quoteId}`,
    };
    const quote = await quoteForProtectedHandler(identity);
    if (!("priceKrw" in quote)) throw new Error("document quote route received another quote type");
    const document = await internalJson<PaymentDocumentSnapshot>(
      `/internal/v1/payment-quotes/${encodeURIComponent(quote.id)}/snapshot`,
    );
    response.json({
      citations: [document.citation],
      settlement: {
        id: quote.id,
        count: 1,
        total: quote.priceKrw,
        network: quote.network,
      },
    });
  } catch (error) {
    next(error);
  }
});

app.get("/api/v1/paid-bundles/:quoteId", async (request, response, next) => {
  try {
    const identity: RouteIdentity = {
      kind: "bundle",
      quoteId: request.params.quoteId,
      key: `bundle\u0000${request.params.quoteId}`,
    };
    const quote = await quoteForProtectedHandler(identity);
    if (!("bundleHash" in quote)) throw new Error("bundle route received another quote type");
    response.json({
      jobId: quote.id,
      status: "funding",
      documentCount: quote.documentHandles.length,
      total: quote.totalPriceKrw,
      network: quote.network,
      mode: "pay_sh_orchestrated",
    });
  } catch (error) {
    next(error);
  }
});

app.get("/api/v1/research-jobs/:jobId", async (request, response, next) => {
  try {
    const accessToken = request.header("x-openshelf-query-token")?.trim();
    if (!accessToken) {
      response.status(401).json({
        error: { code: "missing_query_token", message: "Query access token is required." },
      });
      return;
    }
    const job = await internalJson<unknown>(
      `/api/v1/research-jobs/${encodeURIComponent(request.params.jobId)}`,
      { headers: { "x-openshelf-query-token": accessToken } },
    );
    const status = (job as { status?: string }).status;
    if (status === "funded") void triggerResearchJob(request.params.jobId);
    response.json(job);
  } catch (error) {
    next(error);
  }
});

app.get("/api/v1/funded-open-calls/:quoteId", async (request, response, next) => {
  try {
    const identity: RouteIdentity = {
      kind: "open_call",
      quoteId: request.params.quoteId,
      key: `open_call\u0000${request.params.quoteId}`,
    };
    const quote = await quoteForProtectedHandler(identity);
    if (!("payloadHash" in quote)) throw new Error("open-call route received another quote type");
    const snapshot = await internalJson<OpenCallFundingSnapshot>(
      `/internal/v1/open-call-funding-quotes/${encodeURIComponent(quote.id)}/snapshot`,
    );
    if (snapshot.payloadHash !== quote.payloadHash) {
      throw new Error("open-call snapshot does not match its quote commitment");
    }
    response.json({
      quoteId: quote.id,
      status: "settling",
      question: snapshot.question,
      target: snapshot.target,
      unitPriceKrw: snapshot.unitPriceKrw,
      totalPriceKrw: snapshot.totalPriceKrw,
      network: quote.network,
      mode: "open_call_escrow",
    });
  } catch (error) {
    next(error);
  }
});

app.use((error: unknown, _request: Request, response: ExpressResponse, _next: NextFunction) => {
  console.error("gateway request failed", safeError(error));
  const status = error instanceof PayShProxyError
    ? error.status
    : error instanceof PaymentQuoteError
    ? error.status
    : error instanceof RustApiError && error.status >= 400 && error.status < 500
      ? error.status
      : 502;
  const code = error instanceof PayShProxyError
    ? error.code
    : error instanceof PaymentQuoteError
    ? error.code
    : status === 401
      ? "wallet_session_invalid"
      : "gateway_error";
  const message = error instanceof PayShProxyError
    ? error.message
    : error instanceof PaymentQuoteError
    ? error.message
    : status === 401
      ? error instanceof Error ? error.message : "Wallet session expired."
      : "Payment service is temporarily unavailable.";
  response.status(status).json({
    error: {
      code,
      message,
    },
  });
});

setInterval(() => void retryPendingSettlements(), 5_000).unref();
setInterval(
  () => void reconcileDueChainAttempts(),
  chainReconciliationIntervalMs,
).unref();
setTimeout(() => void reconcileDueChainAttempts(), 1_000).unref();
setInterval(() => void retryPendingTopUpDeposits(), 5_000).unref();
setInterval(() => {
  pruneRpcRateWindows();
  settlementReplayGuard.prune();
  verifiedPaymentAttempts.prune();
  topUpReplayGuard.prune();
  topUpVerifiedAttempts.prune();
  topUpQuotes.prune();
}, 60_000).unref();
app.listen(port, "0.0.0.0", () => {
  console.log(`OPENSHELF x402 gateway listening on http://0.0.0.0:${port}`);
});

function webHeaders(request: Request): Headers {
  const headers = new Headers();
  for (const [name, value] of Object.entries(request.headers)) {
    if (Array.isArray(value)) {
      for (const item of value) headers.append(name, item);
    } else if (value !== undefined) {
      headers.set(name, value);
    }
  }
  return headers;
}

async function writeProxyResponse(
  response: ExpressResponse,
  upstream: globalThis.Response,
): Promise<void> {
  for (const [name, value] of upstream.headers) {
    if (["content-length", "content-encoding", "transfer-encoding", "connection"].includes(name)) {
      continue;
    }
    response.setHeader(name, value);
  }
  response.status(upstream.status).send(Buffer.from(await boundedResponseText(
    upstream,
    MAX_PAY_SH_PROXY_RESPONSE_BYTES,
    "Pay.sh proxy response",
  ), "utf8"));
}

function env(name: string, fallback: string): string {
  return process.env[name]?.trim() || fallback;
}

function safeError(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function rpcRequestId(body: unknown): unknown {
  return body && typeof body === "object" && !Array.isArray(body)
    ? (body as Record<string, unknown>).id ?? null
    : null;
}

function consumeRpcRateLimit(client: string): boolean {
  return consumeRateLimit(rpcRateWindows, client, rpcRateLimitPerMinute);
}

function consumeRateLimit(
  windows: Map<string, { startedAt: number; count: number }>,
  client: string,
  limit: number,
): boolean {
  const now = Date.now();
  const current = windows.get(client);
  if (!current || now - current.startedAt >= 60_000) {
    windows.set(client, { startedAt: now, count: 1 });
    return true;
  }
  if (current.count >= limit) return false;
  current.count += 1;
  return true;
}

function pruneRpcRateWindows(): void {
  const cutoff = Date.now() - 120_000;
  for (const [client, window] of rpcRateWindows) {
    if (window.startedAt < cutoff) rpcRateWindows.delete(client);
  }
}

async function fetchRpcWithBackoff(body: unknown, endpoint = rpcUrl): Promise<Response> {
  for (let attempt = 0; ; attempt += 1) {
    let response: Response;
    try {
      response = await fetch(endpoint, {
        method: "POST",
        redirect: "error",
        signal: AbortSignal.timeout(10_000),
        headers: { "content-type": "application/json" },
        body: JSON.stringify(body),
      });
    } catch (error) {
      if (attempt >= 3) throw error;
      await new Promise((resolve) => setTimeout(resolve, 1_000 * 2 ** attempt));
      continue;
    }
    if (response.status !== 429 || attempt >= 3) return response;
    await response.body?.cancel().catch(() => undefined);
    const retryAfterSeconds = Number.parseInt(response.headers.get("retry-after") ?? "", 10);
    const delayMs = Number.isFinite(retryAfterSeconds)
      ? Math.min(Math.max(retryAfterSeconds, 1) * 1_000, 10_000)
      : 1_000 * 2 ** attempt;
    await new Promise((resolve) => setTimeout(resolve, delayMs));
  }
}
