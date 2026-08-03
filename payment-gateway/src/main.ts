import express, { type NextFunction, type Request, type Response as ExpressResponse } from "express";
import { appendFile, readFile } from "node:fs/promises";
import { HTTPFacilitatorClient, type HTTPRequestContext } from "@x402/core/server";
import type { Network } from "@x402/core/types";
import { paymentMiddleware, x402ResourceServer } from "@x402/express";
import {
  assertPaymentQuoteUsable,
  paymentIdentityFromPath,
  type PaymentRouteIdentity,
} from "./payment-routing.js";
import { createStableExactSvmServerScheme } from "./x402-svm.js";
import "./root-env.js";

const DEVNET_NETWORK = "solana:EtWTRABZaYq6iMfeYKouRu166VU2xqa1" as Network;
const DEFAULT_DEVNET_RPC_URL = "https://api.devnet.solana.com";
const environment = env("OPENSHELF_ENV", env("NODE_ENV", "development")).toLowerCase();
const production = ["production", "prod"].includes(environment);
const rustApiUrl = env("RUST_API_URL", "http://127.0.0.1:8787").replace(/\/$/, "");
const internalToken = env("OPENSHELF_INTERNAL_TOKEN", "openshelf-local-internal");
const facilitatorUrl = env("X402_FACILITATOR_URL", "https://x402.org/facilitator");
const network = env("X402_NETWORK", env("OPENSHELF_X402_NETWORK", DEVNET_NETWORK)) as Network;
const rpcUrl = process.env.X402_RPC_URL?.trim() || DEFAULT_DEVNET_RPC_URL;
const allowedOrigin = env(
  "FRONTEND_ORIGIN",
  env("OPENSHELF_FRONTEND_ORIGIN", "http://localhost:4319"),
);
const port = integerEnv("PORT", 1402);
const outboxPath = env("X402_OUTBOX_PATH", "x402-outbox.ndjson");
const rpcRateLimitPerMinute = integerEnv("X402_RPC_RATE_LIMIT_PER_MINUTE", 120);
const researchOrchestratorUrl = env(
  "RESEARCH_ORCHESTRATOR_URL",
  "http://127.0.0.1:1410",
).replace(/\/$/, "");

if (
  production &&
  (internalToken.length < 32 ||
    ["openshelf-local-internal", "change-this-before-deploy"].includes(internalToken))
) {
  throw new Error(
    "OPENSHELF_INTERNAL_TOKEN must be a non-default secret of at least 32 characters in production",
  );
}
if (production && !allowedOrigin.startsWith("https://")) {
  throw new Error("FRONTEND_ORIGIN must use HTTPS in production");
}
if (production && rpcUrl === DEFAULT_DEVNET_RPC_URL) {
  throw new Error("X402_RPC_URL must use a managed RPC endpoint in production");
}
if (booleanEnv("OPENSHELF_REQUIRE_MAINNET", false) && network === DEVNET_NETWORK) {
  throw new Error("mainnet mode cannot use the Solana Devnet network");
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
type QuoteCacheEntry = { quote: Promise<PayableQuote>; expiresAt: number };
type PendingSettlement = {
  settlementKind?: "document" | "bundle" | "open_call";
  quoteId: string;
  transactionSignature: string;
  payer: string;
  payTo: string;
  amountAtomic: string;
  network: string;
  rawResponse: unknown;
};
type OutboxRecord =
  | { kind: "pending"; settlement: PendingSettlement }
  | { kind: "completed"; transactionSignature: string };

const quotes = new Map<string, QuoteCacheEntry>();
const pendingSettlements = new Map<string, PendingSettlement>();
const allowedBrowserRpcMethods = new Set(["getAccountInfo", "getLatestBlockhash"]);
const rpcRateWindows = new Map<string, { startedAt: number; count: number }>();

class RustApiError extends Error {
  constructor(readonly status: number, message: string) {
    super(message);
  }
}

async function internalJson<T>(path: string, init: RequestInit = {}): Promise<T> {
  const response = await fetch(`${rustApiUrl}${path}`, {
    ...init,
    headers: {
      "content-type": "application/json",
      "x-openshelf-internal-token": internalToken,
      ...init.headers,
    },
  });
  if (!response.ok) {
    const body = await response.text();
    let message = `Rust API ${response.status}`;
    try {
      const payload = JSON.parse(body) as { error?: { message?: string } };
      message = payload.error?.message ?? message;
    } catch {
      // Keep internal response bodies out of public gateway errors.
    }
    throw new RustApiError(response.status, message);
  }
  return (await response.json()) as T;
}

function identityFromPath(path: string): RouteIdentity {
  return paymentIdentityFromPath(path);
}

function identityFromContext(context: HTTPRequestContext): RouteIdentity {
  return identityFromPath(context.path);
}

async function getQuote(identity: RouteIdentity): Promise<PayableQuote> {
  const now = Date.now();
  const cached = quotes.get(identity.key);
  if (cached && cached.expiresAt > now + 5_000) return cached.quote;

  const quotePromise = identity.kind === "document"
    ? internalJson<PaymentQuote>(
        `/internal/v1/payment-quotes/${encodeURIComponent(identity.queryId)}/${encodeURIComponent(identity.handle)}`,
      )
    : identity.kind === "bundle"
      ? internalJson<PaymentBundleQuote>(
          `/internal/v1/payment-bundles/${encodeURIComponent(identity.quoteId)}`,
        )
      : internalJson<OpenCallFundingQuote>(
          `/internal/v1/open-call-funding-quotes/${encodeURIComponent(identity.quoteId)}`,
        );
  const entry: QuoteCacheEntry = { quote: quotePromise, expiresAt: now + 30_000 };
  quotes.set(identity.key, entry);
  try {
    const quote = await quotePromise;
    if (quote.network !== network) {
      throw new Error(`quote network ${quote.network} does not match gateway network ${network}`);
    }
    assertPaymentQuoteUsable(quote.expiresAt);
    entry.expiresAt = quote.expiresAt;
    return quote;
  } catch (error) {
    quotes.delete(identity.key);
    throw error;
  }
}

async function quoteForContext(context: HTTPRequestContext): Promise<PayableQuote> {
  return getQuote(identityFromContext(context));
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
  try {
    await appendOutbox({
      kind: "completed",
      transactionSignature: settlement.transactionSignature,
    });
  } catch (error) {
    // Replaying this entry is safe because the Rust endpoint is idempotent.
    console.error("could not mark x402 outbox entry complete", safeError(error));
  }
}

async function triggerResearchJob(jobId: string): Promise<void> {
  try {
    const response = await fetch(
      `${researchOrchestratorUrl}/internal/v1/research-jobs/${encodeURIComponent(jobId)}/run`,
      {
        method: "POST",
        headers: {
          "content-type": "application/json",
          "x-openshelf-internal-token": internalToken,
        },
      },
    );
    if (!response.ok && response.status !== 202 && response.status !== 409) {
      throw new Error(`orchestrator returned ${response.status}: ${(await response.text()).slice(0, 300)}`);
    }
  } catch (error) {
    // The funding ledger is durable. Cloud Scheduler or the browser's status
    // poll can safely trigger the same idempotent job again.
    console.error("could not trigger funded research job", safeError(error));
  }
}

async function appendOutbox(record: OutboxRecord): Promise<void> {
  await appendFile(outboxPath, `${JSON.stringify(record)}\n`, { encoding: "utf8", mode: 0o600 });
}

async function restoreOutbox(): Promise<void> {
  let contents: string;
  try {
    contents = await readFile(outboxPath, "utf8");
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return;
    throw error;
  }
  for (const line of contents.split("\n")) {
    if (!line.trim()) continue;
    try {
      const record = JSON.parse(line) as OutboxRecord;
      if (record.kind === "pending") {
        pendingSettlements.set(
          record.settlement.transactionSignature,
          record.settlement,
        );
      } else if (record.kind === "completed") {
        pendingSettlements.delete(record.transactionSignature);
      }
    } catch (error) {
      console.error("ignoring malformed x402 outbox line", safeError(error));
    }
  }
}

async function retryPendingSettlements(): Promise<void> {
  for (const settlement of pendingSettlements.values()) {
    try {
      await recordSettlement(settlement);
    } catch (error) {
      console.error("x402 reconciliation retry failed", safeError(error));
    }
  }
}

const facilitator = new HTTPFacilitatorClient({ url: facilitatorUrl });
const resourceServer = new x402ResourceServer(facilitator);
resourceServer.register(network, createStableExactSvmServerScheme());

resourceServer.onAfterVerify(async (context) => {
  if (context.result.payer && context.result.payer === context.requirements.payTo) {
    return {
      abort: true,
      reason: "self_payment_not_allowed",
      message: "payer and document recipient must be different wallets",
    };
  }
});

resourceServer.onVerifyFailure(async (context) => {
  console.error("x402 payment verification failed", safeError(context.error));
});

resourceServer.onSettleFailure(async (context) => {
  console.error("x402 payment settlement failed", safeError(context.error));
});

resourceServer.onAfterSettle(async (context) => {
  if (!context.result.success || !context.result.payer) return;
  const requestPath = (
    context.transportContext as { request?: { path?: string } } | undefined
  )?.request?.path;
  const resourceUrl = context.paymentPayload.resource?.url;
  const identity = identityFromPath(requestPath ?? resourceUrl ?? "");
  const quote = await getQuote(identity);
  const settlement: PendingSettlement = {
    settlementKind: identity.kind,
    quoteId: quote.id,
    transactionSignature: context.result.transaction,
    payer: context.result.payer,
    payTo: context.requirements.payTo,
    amountAtomic: context.result.amount ?? context.requirements.amount,
    network: context.result.network,
    rawResponse: context.result,
  };
  pendingSettlements.set(settlement.transactionSignature, settlement);
  try {
    await appendOutbox({ kind: "pending", settlement });
    await recordSettlement(settlement);
  } catch (error) {
    console.error("x402 settled on-chain; Rust ledger reconciliation queued", safeError(error));
  }
});

const app = express();
app.disable("x-powered-by");
app.use(express.json({ limit: "32kb" }));
app.use((request, response, next) => {
  const origin = request.headers.origin;
  if (origin === allowedOrigin) response.setHeader("access-control-allow-origin", origin);
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

// The x402 SVM client needs mint metadata and a recent blockhash before it can
// ask Phantom to sign. Proxy only those read-only methods so a paid RPC key can
// remain server-side and browser bursts can honor upstream Retry-After headers.
app.post("/rpc", async (request, response, next) => {
  try {
    if (production && request.headers.origin !== allowedOrigin) {
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
    if (!isAllowedBrowserRpcRequest(body)) {
      response.status(400).json({
        jsonrpc: "2.0",
        error: { code: -32600, message: "RPC method is not allowed" },
        id: rpcRequestId(body),
      });
      return;
    }
    const upstream = await fetchRpcWithBackoff(body);
    const payload = await upstream.text();
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
    pendingReconciliations: pendingSettlements.size,
  });
});

app.get("/readyz", async (_request, response) => {
  try {
    await internalJson<{ status: string }>("/readyz");
    response.json({
      status: "ready",
      network,
      pendingReconciliations: pendingSettlements.size,
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
    if (!accessToken) {
      response.status(401).json({
        error: { code: "missing_query_token", message: "Query access token is required." },
      });
      return;
    }
    if (!walletSession) {
      response.status(401).json({
        error: { code: "missing_wallet_session", message: "Verified prepaid wallet session is required." },
      });
      return;
    }
    const body = request.body as { queryId?: unknown; handles?: unknown; topUpAtomic?: unknown };
    if (
      typeof body?.queryId !== "string" ||
      !Array.isArray(body.handles) ||
      body.handles.length < 1 ||
      body.handles.length > 100 ||
      body.handles.some((handle) => typeof handle !== "string") ||
      (body.topUpAtomic !== undefined &&
        (typeof body.topUpAtomic !== "string" || !/^\d+$/.test(body.topUpAtomic)))
    ) {
      response.status(400).json({
        error: {
          code: "invalid_bundle",
          message: "queryId and between 1 and 100 document handles are required.",
        },
      });
      return;
    }
    const quote = await internalJson<PaymentBundleQuote>("/internal/v1/payment-bundles", {
      method: "POST",
      headers: {
        "x-openshelf-query-token": accessToken,
        "x-openshelf-wallet-session": walletSession,
      },
      body: JSON.stringify({
        queryId: body.queryId,
        handles: body.handles,
        topUpAtomic: body.topUpAtomic,
      }),
    });
    if (quote.requiresPayment) {
      quotes.set(`bundle\u0000${quote.id}`, {
        quote: Promise.resolve(quote),
        expiresAt: quote.expiresAt,
      });
    } else if (quote.status === "funded") {
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

app.use(
  paymentMiddleware(
    {
      "GET /api/v1/paid-documents/*": {
        accepts: {
          scheme: "exact",
          network,
          payTo: async (context) => (await quoteForContext(context)).payTo,
          price: async (context) => {
            const quote = await quoteForContext(context);
            return { asset: quote.asset, amount: quote.amountAtomic };
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
      "GET /api/v1/paid-bundles/*": {
        accepts: {
          scheme: "exact",
          network,
          payTo: async (context) => (await quoteForContext(context)).payTo,
          price: async (context) => {
            const quote = await quoteForContext(context);
            return { asset: quote.asset, amount: quote.amountAtomic };
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
            const quote = await quoteForContext(context);
            return { asset: quote.asset, amount: quote.amountAtomic };
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

app.get("/api/v1/paid-documents/:queryId/:handle", async (request, response, next) => {
  try {
    const identity: RouteIdentity = {
      kind: "document",
      queryId: request.params.queryId,
      handle: request.params.handle,
      key: `document\u0000${request.params.queryId}\u0000${request.params.handle}`,
    };
    const quote = await getQuote(identity);
    if (!("priceKrw" in quote)) throw new Error("document route received a bundle quote");
    // Express x402 buffers this body, settles on-chain, runs onAfterSettle,
    // and releases it only after success. The snapshot endpoint is internal
    // and read-only; it does not claim that payment or delivery has happened.
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
    const quote = await getQuote(identity);
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
    const quote = await getQuote(identity);
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
  const status = error instanceof RustApiError && error.status >= 400 && error.status < 500
    ? error.status
    : 502;
  response.status(status).json({
    error: {
      code: status === 401 ? "wallet_session_invalid" : "gateway_error",
      message: status === 401 ? error instanceof Error ? error.message : "Wallet session expired." : "Payment service is temporarily unavailable.",
    },
  });
});

await restoreOutbox();
setInterval(() => void retryPendingSettlements(), 5_000).unref();
setInterval(() => pruneRpcRateWindows(), 60_000).unref();
app.listen(port, "0.0.0.0", () => {
  console.log(`OPENSHELF x402 gateway listening on http://0.0.0.0:${port}`);
});

function env(name: string, fallback: string): string {
  return process.env[name]?.trim() || fallback;
}

function integerEnv(name: string, fallback: number): number {
  const parsed = Number.parseInt(process.env[name] ?? "", 10);
  return Number.isInteger(parsed) && parsed > 0 ? parsed : fallback;
}

function booleanEnv(name: string, fallback: boolean): boolean {
  const value = process.env[name]?.trim().toLowerCase();
  if (["1", "true", "yes", "on"].includes(value ?? "")) return true;
  if (["0", "false", "no", "off"].includes(value ?? "")) return false;
  return fallback;
}

function safeError(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function isAllowedBrowserRpcRequest(
  body: unknown,
): body is { jsonrpc: "2.0"; id?: unknown; method: string; params?: unknown[] } {
  if (!body || typeof body !== "object" || Array.isArray(body)) return false;
  const request = body as Record<string, unknown>;
  return (
    request.jsonrpc === "2.0" &&
    typeof request.method === "string" &&
    allowedBrowserRpcMethods.has(request.method) &&
    (request.params === undefined || Array.isArray(request.params))
  );
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

async function fetchRpcWithBackoff(body: unknown): Promise<Response> {
  for (let attempt = 0; ; attempt += 1) {
    const response = await fetch(rpcUrl, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
    });
    if (response.status !== 429 || attempt >= 3) return response;
    const retryAfterSeconds = Number.parseInt(response.headers.get("retry-after") ?? "", 10);
    const delayMs = Number.isFinite(retryAfterSeconds)
      ? Math.min(Math.max(retryAfterSeconds, 1) * 1_000, 10_000)
      : 1_000 * 2 ** attempt;
    await new Promise((resolve) => setTimeout(resolve, delayMs));
  }
}
