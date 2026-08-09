import { createHash, timingSafeEqual } from "node:crypto";
import { base58 } from "@scure/base";
import { Challenge, Credential, Receipt } from "mppx";
import { findAssociatedTokenPda, TOKEN_PROGRAM_ADDRESS } from "@solana-program/token";
import {
  address,
  getPublicKeyFromAddress,
  getTransactionDecoder,
  signatureBytes,
  verifySignature,
} from "@solana/kit";
import { Transaction, VersionedTransaction } from "@solana/web3.js";
import {
  completePayShReceiptTransaction,
  type PayShReceiptEvidence,
} from "./pay-sh-finality.js";
import { boundedSolanaRpc } from "./bounded-rpc.js";

export const DIRECT_PAY_ATTEMPT_HEADER = "x-openshelf-pay-attempt";
export const PAY_SH_FRONT_TOKEN_HEADER = "x-openshelf-pay-front-token";
export const DIRECT_PAY_SH_TOKEN_PROGRAM = String(TOKEN_PROGRAM_ADDRESS);
const DEVNET_USDC = "4zMMC9srt5Ri5X14GAgXhaHii3GnPAEERYPJgZJDncDU";
const COMPUTE_BUDGET_PROGRAM = "ComputeBudget111111111111111111111111111111";
const MAX_FEE_SPONSORED_COMPUTE_UNITS = 200_000;
const MAX_FEE_SPONSORED_MICROLAMPORTS_PER_UNIT = 10_000n;
const MEMO_PROGRAM = "MemoSq4gqABAXKb96qnH8TysNcWxMyWCqXgDLGmfcHr";

export type DirectPayShQuote = {
  id: string;
  queryId: string;
  documentHandle: string;
  payTo: string;
  network: string;
  asset: string;
  amountAtomic: string;
  priceKrw: number;
  expiresAt: number;
  status: string;
};

export type PreparedMppCredential = {
  quoteId: string;
  payer: string;
  platformRecipientWallet: string;
  challengeId: string;
  externalId: string;
  signedTransactionBase64: string;
  recentBlockhash: string;
  challengeExpiresAt: number;
};

export type PayShChallengeBinding = {
  challengeId: string;
  externalId: string;
  challengeExpiresAt: number;
};

export type BindPayShChallengesRequest = {
  quoteId: string;
  queryId: string;
  documentHandle: string;
  pathPriceKrw: number;
  ownerWallet: string;
  researchJobId?: string;
  paymentAttemptId?: string;
  challenges: PayShChallengeBinding[];
};

export type DirectPayShProxyDependencies = {
  privatePayShBase: string;
  frontToken: string;
  operatorWallet?: string;
  feePayerKey?: string;
  researchAuthorizationToken?: string;
  fetchImpl?: typeof globalThis.fetch;
  now?: () => number;
  loadQuote(quoteId: string): Promise<DirectPayShQuote>;
  recipientAssetAccountReady(quote: DirectPayShQuote): Promise<boolean>;
  bindChallenges(
    queryToken: string | undefined,
    request: BindPayShChallengesRequest,
  ): Promise<unknown>;
  prepareDirect(
    attemptId: string,
    queryToken: string,
    request: PreparedMppCredential & {
      queryId: string;
      documentHandle: string;
      pathPriceKrw: number;
      ownerWallet: string;
    },
  ): Promise<unknown>;
  prepareResearch(
    jobId: string,
    attemptId: string,
    request: PreparedMppCredential,
  ): Promise<unknown>;
  recordDirectReceipt(attemptId: string, transactionSignature: string): Promise<unknown>;
  recordResearchReceipt(
    jobId: string,
    attemptId: string,
    transactionSignature: string,
  ): Promise<unknown>;
  receiptFinalized(evidence: PayShReceiptEvidence): Promise<boolean>;
  afterDirectPrepare?(attemptId: string): Promise<void>;
  afterDirectReceipt?(attemptId: string): Promise<void>;
};

type SolanaTransactionPayload = {
  type: "transaction";
  transaction: string;
};

type PaidRoute = {
  priceKrw: number;
  queryId: string;
  handle: string;
  quoteId: string;
  ownerWallet: string;
  researchJobId?: string;
  paymentAttemptId?: string;
};

type ReceiptBinding = {
  externalId: string;
  signedTransactionBase64: string;
} & (
  | { kind: "direct"; attemptId: string }
  | { kind: "research"; jobId: string; attemptId: string }
);

/**
 * Public application boundary in front of the official Pay.sh gate.
 *
 * An unpaid probe is forwarded unchanged. A paid MPP request cannot reach the
 * gate until its exact payer-signed transaction is durable in Rust. The proxy
 * strips caller-supplied internal headers and injects its own attempt identity,
 * so the post-charge Rust callback is bound to the same pre-charge record.
 */
export async function proxyPayShRequest(
  request: {
    method: string;
    pathAndQuery: string;
    headers: Headers;
    body?: Uint8Array;
  },
  dependencies: DirectPayShProxyDependencies,
): Promise<Response> {
  assertOriginFormTarget(request.pathAndQuery);
  const fetchImpl = dependencies.fetchImpl ?? globalThis.fetch;
  const headers = forwardedHeaders(request.headers);
  headers.set(PAY_SH_FRONT_TOKEN_HEADER, dependencies.frontToken);

  const authorization = request.headers.get("authorization");
  const paidRoute = parsePaidRoute(request.pathAndQuery);
  // Only a recognized v2 paid route has the durable pre-charge fence below.
  // Never let an accidental future meter on discovery or retired routes turn a
  // caller-supplied credential into an unfenced charge.
  if (!paidRoute) headers.delete("authorization");
  let receiptBinding: ReceiptBinding | undefined;
  if (paidRoute && authorization && !Credential.extractPaymentScheme(authorization)) {
    throw new PayShProxyError(
      400,
      "unrecognized_payment_credential",
      "The paid resource received an authorization header that is not a valid MPP credential.",
    );
  }
  const queryToken = request.headers.get("x-openshelf-query-token")?.trim();
  let quote: DirectPayShQuote | undefined;
  if (paidRoute) {
    if (
      paidRoute.researchJobId
      && !sameSecret(
        request.headers.get("x-openshelf-internal-token"),
        dependencies.researchAuthorizationToken,
      )
    ) {
      throw new PayShProxyError(
        401,
        "research_proxy_unauthorized",
        "The funded research payment did not come from the authorized orchestrator.",
      );
    }
    if (!paidRoute.researchJobId && !queryToken) {
      throw new PayShProxyError(
        401,
        "missing_query_token",
        "A query-scoped access token is required before a direct paid request can start.",
      );
    }
    if (
      paidRoute.researchJobId
      && (!paidRoute.paymentAttemptId || !/^[0-9a-f]{64}$/.test(paidRoute.paymentAttemptId))
    ) {
      throw new PayShProxyError(
        409,
        "research_attempt_mismatch",
        "The funded research URL has no valid durable payment attempt.",
      );
    }
    quote = await dependencies.loadQuote(paidRoute.quoteId);
    validateRouteQuote(paidRoute, quote);
    if (!await dependencies.recipientAssetAccountReady(quote)) {
      throw new PayShProxyError(
        409,
        "recipient_asset_account_missing",
        "The document owner has no initialized USDC token account on the quoted network.",
      );
    }
  }
  if (paidRoute && authorization) {
    const prepared = await inspectMppCredential(
      authorization,
      quote!,
      dependencies.now?.() ?? Date.now(),
      dependencies.operatorWallet,
      dependencies.feePayerKey,
    );
    const attemptId = createHash("sha256")
      .update(Buffer.from(prepared.signedTransactionBase64, "base64"))
      .digest("hex");

    if (paidRoute.researchJobId) {
      await dependencies.prepareResearch(
        paidRoute.researchJobId,
        paidRoute.paymentAttemptId!,
        prepared,
      );
      receiptBinding = {
        kind: "research",
        jobId: paidRoute.researchJobId,
        attemptId: paidRoute.paymentAttemptId!,
        externalId: prepared.externalId,
        signedTransactionBase64: prepared.signedTransactionBase64,
      };
    } else {
      await dependencies.prepareDirect(attemptId, queryToken!, {
        ...prepared,
        queryId: paidRoute.queryId,
        documentHandle: paidRoute.handle,
        pathPriceKrw: paidRoute.priceKrw,
        ownerWallet: paidRoute.ownerWallet,
      });
      receiptBinding = {
        kind: "direct",
        attemptId,
        externalId: prepared.externalId,
        signedTransactionBase64: prepared.signedTransactionBase64,
      };
      headers.set(DIRECT_PAY_ATTEMPT_HEADER, attemptId);
      await dependencies.afterDirectPrepare?.(attemptId);
    }
  }

  const upstreamUrl = new URL(request.pathAndQuery, `${dependencies.privatePayShBase}/`);
  const upstream = await fetchImpl(upstreamUrl, {
    method: request.method,
    headers,
    body: request.body ? Buffer.from(request.body) : undefined,
    redirect: "manual",
    signal: AbortSignal.timeout(60_000),
  });
  if (paidRoute && quote && !authorization && upstream.status === 402) {
    try {
      const challenges = inspectPayShChallenges(
        upstream,
        quote,
        dependencies.now?.() ?? Date.now(),
        dependencies.operatorWallet,
        dependencies.feePayerKey,
      );
      await dependencies.bindChallenges(queryToken, {
        quoteId: paidRoute.quoteId,
        queryId: paidRoute.queryId,
        documentHandle: paidRoute.handle,
        pathPriceKrw: paidRoute.priceKrw,
        ownerWallet: paidRoute.ownerWallet,
        researchJobId: paidRoute.researchJobId,
        paymentAttemptId: paidRoute.paymentAttemptId,
        challenges,
      });
    } catch (error) {
      await upstream.body?.cancel().catch(() => undefined);
      throw error;
    }
  }
  if (receiptBinding && upstream.ok) {
    try {
      const receiptHeader = upstream.headers.get("payment-receipt");
      if (!receiptHeader) {
        throw new PayShProxyError(
          502,
          "missing_payment_receipt",
          "Pay.sh delivered the resource without a recoverable transaction receipt.",
        );
      }
      let receipt;
      try {
        receipt = Receipt.deserialize(receiptHeader);
      } catch {
        throw new PayShProxyError(
          502,
          "invalid_payment_receipt",
          "Pay.sh returned a malformed transaction receipt.",
        );
      }
      if (
        receipt.method !== "solana"
        || receipt.status !== "success"
        || (receipt.externalId !== undefined && receipt.externalId !== receiptBinding.externalId)
        || !/^[1-9A-HJ-NP-Za-km-z]{64,128}$/.test(receipt.reference)
        || !await receiptSignsPreparedTransaction(
          receiptBinding.signedTransactionBase64,
          receipt.reference,
        )
      ) {
        throw new PayShProxyError(
          502,
          "invalid_payment_receipt",
          "Pay.sh returned a receipt for a different payment.",
        );
      }
      const receiptEvidence = completePayShReceiptTransaction(
        receiptBinding.signedTransactionBase64,
        receipt.reference,
      );
      if (!receiptEvidence) {
        throw new PayShProxyError(
          502,
          "invalid_payment_receipt",
          "Pay.sh returned a receipt that cannot complete the prepared transaction.",
        );
      }
      if (receiptBinding.kind === "direct") {
        await dependencies.afterDirectReceipt?.(receiptBinding.attemptId);
      }
      if (!await dependencies.receiptFinalized(receiptEvidence)) {
        throw new PayShProxyError(
          503,
          "payment_finality_pending",
          "Pay.sh payment is not finalized on every independent RPC view yet.",
        );
      }
      if (receiptBinding.kind === "direct") {
        await dependencies.recordDirectReceipt(receiptBinding.attemptId, receipt.reference);
      } else {
        await dependencies.recordResearchReceipt(
          receiptBinding.jobId,
          receiptBinding.attemptId,
          receipt.reference,
        );
      }
    } catch (error) {
      await upstream.body?.cancel().catch(() => undefined);
      throw error;
    }
  }
  return upstream;
}

function inspectPayShChallenges(
  response: Response,
  quote: DirectPayShQuote,
  now: number,
  operatorWallet?: string,
  feePayerKey?: string,
): PayShChallengeBinding[] {
  const header = response.headers.get("www-authenticate");
  if (!header) {
    throw new PayShProxyError(
      502,
      "missing_payment_challenge",
      "Pay.sh returned 402 without a bindable payment challenge.",
    );
  }
  let parsed;
  try {
    parsed = Challenge.deserializeList(header);
  } catch {
    throw new PayShProxyError(
      502,
      "invalid_payment_challenge",
      "Pay.sh returned a malformed payment challenge.",
    );
  }
  const challenges = parsed.filter(
    (challenge) => challenge.method === "solana" && challenge.intent === "charge",
  );
  if (challenges.length === 0 || challenges.length > 8) {
    throw new PayShProxyError(
      502,
      "invalid_payment_challenge",
      "Pay.sh returned an unsupported number of Solana charge challenges.",
    );
  }
  const expectedExternalId = `human-document-krw-${quote.priceKrw}#`;
  const ownerAmount = (BigInt(quote.amountAtomic) - 1n).toString();
  const expectedDevnet = quote.network.includes("EtWTRAB") || quote.network === "devnet";
  const seen = new Set<string>();
  return challenges.map((challenge) => {
    const request = challenge.request as Record<string, unknown>;
    const details = request.methodDetails as Record<string, unknown> | undefined;
    const splits = Array.isArray(details?.splits) ? details.splits : [];
    const split = splits[0] as Record<string, unknown> | undefined;
    const externalId = request.externalId;
    const expiresAt = challenge.expires ? Date.parse(challenge.expires) : Number.NaN;
    const network = String(details?.network ?? "mainnet");
    if (
      typeof challenge.id !== "string"
      || challenge.id.length === 0
      || challenge.id.length > 256
      || seen.has(challenge.id)
      || request.amount !== quote.amountAtomic
      || request.currency !== quote.asset
      || typeof externalId !== "string"
      || !externalId.startsWith(expectedExternalId)
      || externalId.length <= expectedExternalId.length
      || externalId.length > expectedExternalId.length + 32
      || !Number.isSafeInteger(expiresAt)
      || expiresAt <= now
      || expiresAt > now + 15 * 60_000
      || (expectedDevnet && network !== "devnet")
      || (!expectedDevnet && network === "devnet")
      || (operatorWallet !== undefined && request.recipient !== operatorWallet)
      || details?.feePayer !== true
      || typeof details.feePayerKey !== "string"
      || (feePayerKey !== undefined && details.feePayerKey !== feePayerKey)
      || splits.length !== 1
      || split?.recipient !== quote.payTo
      || String(split.amount) !== ownerAmount
    ) {
      throw new PayShProxyError(
        502,
        "invalid_payment_challenge",
        "Pay.sh returned a challenge that does not match the immutable quote.",
      );
    }
    seen.add(challenge.id);
    return {
      challengeId: challenge.id,
      externalId,
      challengeExpiresAt: expiresAt,
    };
  });
}

function assertOriginFormTarget(pathAndQuery: string): void {
  // HTTP proxy-style absolute targets and network-path references override the
  // base passed to `new URL`. Reject them before injecting the private front
  // token or forwarding a payment credential. Backslashes are rejected too:
  // WHATWG URL parsing normalizes them as path separators for special schemes.
  if (
    !pathAndQuery.startsWith("/")
    || pathAndQuery.startsWith("//")
    || pathAndQuery.includes("\\")
    || pathAndQuery.includes("#")
  ) {
    throw new PayShProxyError(
      400,
      "invalid_proxy_target",
      "The Pay.sh proxy accepts only an origin-form path and query.",
    );
  }
}

async function receiptSignsPreparedTransaction(
  transactionBase64: string,
  receiptReference: string,
): Promise<boolean> {
  try {
    const transaction = getTransactionDecoder().decode(
      Buffer.from(transactionBase64, "base64"),
    );
    const signatures = Object.entries(transaction.signatures);
    if (signatures.length === 0) return false;
    const receiptSignature = base58.decode(receiptReference);
    if (receiptSignature.length !== 64) return false;
    for (let index = 0; index < signatures.length; index += 1) {
      const [signer, preparedSignature] = signatures[index];
      const signature = index === 0 ? receiptSignature : preparedSignature;
      if (!signature || isZero(signature)) return false;
      if (
        preparedSignature
        && !isZero(preparedSignature)
        && !preparedSignature.every((byte, offset) => byte === signature[offset])
      ) {
        return false;
      }
      if (!await verifySignature(
        await getPublicKeyFromAddress(address(signer)),
        signatureBytes(signature),
        transaction.messageBytes,
      )) {
        return false;
      }
    }
    return true;
  } catch {
    return false;
  }
}

export async function directPayShRecipientTokenAccount(
  asset: string,
  owner: string,
): Promise<string> {
  return String((await findAssociatedTokenPda({
    mint: address(asset),
    owner: address(owner),
    tokenProgram: TOKEN_PROGRAM_ADDRESS,
  }))[0]);
}

/**
 * Creates the public Pay.sh recipient preflight. It intentionally makes one
 * bounded RPC request: retrying one provider cannot add trust and lets an
 * unauthenticated 402 probe amplify provider stalls or throttling.
 */
export function createDirectPayShRecipientAccountProbe(
  endpoint: string,
  timeoutMs: number,
  fetchImpl: typeof fetch = fetch,
): (quote: DirectPayShQuote) => Promise<boolean> {
  const rpc = boundedSolanaRpc(endpoint, timeoutMs, fetchImpl);
  return async (quote) => {
    const tokenAccount = await directPayShRecipientTokenAccount(quote.asset, quote.payTo);
    const result = await rpc("getAccountInfo", [
      tokenAccount,
      { commitment: "confirmed", encoding: "base64" },
    ]) as { value?: { owner?: unknown } | null };
    return result?.value?.owner === DIRECT_PAY_SH_TOKEN_PROGRAM;
  };
}

export class PayShProxyError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
    message: string,
  ) {
    super(message);
  }
}

function parsePaidRoute(pathAndQuery: string): PaidRoute | null {
  const url = new URL(pathAndQuery, "https://openshelf.invalid");
  const match = /^\/api\/v2\/pay-sh\/documents\/(\d+)\/([^/]+)\/([^/]+)$/.exec(
    url.pathname,
  );
  if (!match) return null;
  const priceKrw = Number.parseInt(match[1], 10);
  const quoteId = singleQueryParameter(url, "quote_id")?.trim();
  const ownerWallet = singleQueryParameter(url, "owner_wallet")?.trim();
  if (
    !Number.isSafeInteger(priceKrw)
    || priceKrw <= 0
    || match[1] !== String(priceKrw)
    || !quoteId
    || !ownerWallet
  ) {
    throw new PayShProxyError(400, "invalid_pay_sh_url", "The paid URL is incomplete.");
  }
  return {
    priceKrw,
    queryId: decodePathSegment(match[2]),
    handle: decodePathSegment(match[3]),
    quoteId,
    ownerWallet,
    researchJobId: singleQueryParameter(url, "research_job_id")?.trim() || undefined,
    paymentAttemptId: singleQueryParameter(url, "payment_attempt_id")?.trim() || undefined,
  };
}

function singleQueryParameter(url: URL, name: string): string | undefined {
  const values = url.searchParams.getAll(name);
  if (values.length > 1) {
    throw new PayShProxyError(
      400,
      "invalid_pay_sh_url",
      `The paid URL contains more than one ${name} value.`,
    );
  }
  return values[0];
}

function decodePathSegment(value: string): string {
  try {
    return decodeURIComponent(value);
  } catch {
    throw new PayShProxyError(400, "invalid_pay_sh_url", "The paid URL path is malformed.");
  }
}

function validateRouteQuote(route: PaidRoute, quote: DirectPayShQuote): void {
  if (
    quote.id !== route.quoteId
    || quote.queryId !== route.queryId
    || quote.documentHandle !== route.handle
    || quote.priceKrw !== route.priceKrw
    || quote.payTo !== route.ownerWallet
  ) {
    throw new PayShProxyError(
      409,
      "quote_mismatch",
      "The paid URL no longer matches its immutable server quote.",
    );
  }
  if (quote.status !== "quoted") {
    throw new PayShProxyError(
      409,
      "quote_not_payable",
      "The paid URL no longer refers to a payable quote.",
    );
  }
}

async function inspectMppCredential(
  authorization: string,
  quote: DirectPayShQuote,
  now: number,
  operatorWallet?: string,
  feePayerKey?: string,
): Promise<PreparedMppCredential> {
  let credential;
  try {
    credential = Credential.deserialize<SolanaTransactionPayload>(authorization);
  } catch (error) {
    throw new PayShProxyError(
      400,
      "malformed_credential",
      `The MPP credential cannot be decoded: ${safeError(error)}`,
    );
  }
  const challenge = credential.challenge;
  const request = challenge.request as Record<string, unknown>;
  const details = request.methodDetails as Record<string, unknown> | undefined;
  const payload = credential.payload;
  if (challenge.method !== "solana" || challenge.intent !== "charge") {
    throw new PayShProxyError(400, "invalid_challenge", "Pay.sh did not offer a Solana charge.");
  }
  if (payload?.type !== "transaction" || typeof payload.transaction !== "string") {
    throw new PayShProxyError(
      400,
      "invalid_credential_payload",
      "The MPP credential has no signed Solana transaction.",
    );
  }
  const transactionBytes = Buffer.from(payload.transaction, "base64");
  if (transactionBytes.length < 100 || transactionBytes.length > 2_048) {
    throw new PayShProxyError(
      400,
      "invalid_credential_payload",
      "The MPP transaction envelope has an invalid size.",
    );
  }
  const transaction = parsePreparedPayShTransaction(transactionBytes);
  const challengeExpiresAt = challenge.expires ? Date.parse(challenge.expires) : Number.NaN;
  const externalId = request.externalId;
  const recentBlockhash = details?.recentBlockhash;
  const challengeNetwork = String(details?.network ?? "mainnet");
  const expectedDevnet = quote.network.includes("EtWTRAB") || quote.network === "devnet";
  if (request.amount !== quote.amountAtomic) {
    throw new PayShProxyError(
      409,
      "amount_mismatch",
      "The MPP amount does not match the immutable quote.",
    );
  }
  // The official Solana MPP challenge resolves `USDC` to the network's mint
  // address. Bind that exact mint to the backend quote instead of trusting the
  // human-readable currency alias from paywall.yml.
  if (request.currency !== quote.asset) {
    throw new PayShProxyError(
      409,
      "currency_mismatch",
      "The MPP settlement mint does not match the immutable quote.",
    );
  }
  if (expectedDevnet && quote.asset !== DEVNET_USDC) {
    throw new PayShProxyError(
      409,
      "asset_mismatch",
      "The quote asset is not the configured Devnet USDC mint.",
    );
  }
  if (typeof externalId !== "string") {
    throw new PayShProxyError(409, "resource_mismatch", "The MPP resource id is missing.");
  }
  if (typeof recentBlockhash !== "string") {
    throw new PayShProxyError(
      409,
      "missing_recent_blockhash",
      "The MPP transaction has no recent blockhash.",
    );
  }
  if (recentBlockhash !== transaction.recentBlockhash) {
    throw new PayShProxyError(
      409,
      "recent_blockhash_mismatch",
      "The MPP challenge blockhash does not match its signed transaction.",
    );
  }
  if (!Number.isSafeInteger(challengeExpiresAt) || challengeExpiresAt <= now) {
    throw new PayShProxyError(409, "expired_challenge", "The MPP challenge has expired.");
  }
  if (quote.expiresAt <= now) {
    throw new PayShProxyError(409, "expired_quote", "The immutable quote has expired.");
  }
  if ((expectedDevnet && challengeNetwork !== "devnet") || (!expectedDevnet && challengeNetwork === "devnet")) {
    throw new PayShProxyError(409, "network_mismatch", "The MPP network does not match the quote.");
  }
  if (typeof request.recipient !== "string") {
    throw new PayShProxyError(
      409,
      "recipient_mismatch",
      "The Pay.sh primary recipient is missing.",
    );
  }
  if (operatorWallet && request.recipient !== operatorWallet) {
    throw new PayShProxyError(
      409,
      "recipient_mismatch",
      "The Pay.sh primary recipient does not match the configured operator.",
    );
  }
  if (
    details?.feePayer !== true
    || typeof details.feePayerKey !== "string"
    || (feePayerKey && details.feePayerKey !== feePayerKey)
  ) {
    throw new PayShProxyError(
      409,
      "fee_payer_mismatch",
      "The Pay.sh fee payer does not match the configured service key.",
    );
  }
  const expectedExternalId = `human-document-krw-${quote.priceKrw}#`;
  if (
    !externalId.startsWith(expectedExternalId)
    || externalId.length <= expectedExternalId.length
    || externalId.length > expectedExternalId.length + 32
  ) {
    throw new PayShProxyError(
      409,
      "resource_mismatch",
      "The MPP external id does not match the quoted document resource.",
    );
  }
  const splits = Array.isArray(details?.splits) ? details.splits : [];
  if (splits.length !== 1) {
    throw new PayShProxyError(409, "split_mismatch", "The MPP challenge has unexpected splits.");
  }
  const split = splits[0] as Record<string, unknown> | undefined;
  const ownerAmount = (BigInt(quote.amountAtomic) - 1n).toString();
  if (split?.recipient !== quote.payTo || String(split.amount) !== ownerAmount) {
    throw new PayShProxyError(
      409,
      "split_mismatch",
      "The MPP owner split does not match the verified contributor.",
    );
  }
  const payer = await validatePreparedPayShTransaction({
    transaction,
    feePayer: details.feePayerKey,
    asset: quote.asset,
    primaryRecipient: request.recipient,
    ownerRecipient: quote.payTo,
    totalAmountAtomic: quote.amountAtomic,
    ownerAmountAtomic: ownerAmount,
    externalId,
  });
  return {
    quoteId: quote.id,
    payer,
    platformRecipientWallet: request.recipient,
    challengeId: challenge.id,
    externalId,
    signedTransactionBase64: payload.transaction,
    recentBlockhash,
    challengeExpiresAt,
  };
}

type PreparedTransactionInstruction = {
  program: string;
  accounts: string[];
  data: Uint8Array;
};

type PreparedPayShTransaction = {
  recentBlockhash: string;
  signerAddresses: string[];
  signatures: Uint8Array[];
  messageBytes: Uint8Array;
  instructions: PreparedTransactionInstruction[];
};

function parsePreparedPayShTransaction(bytes: Uint8Array): PreparedPayShTransaction {
  let messageBytes: Uint8Array;
  try {
    messageBytes = new Uint8Array(getTransactionDecoder().decode(bytes).messageBytes);
  } catch {
    throw invalidPayShTransaction("The MPP transaction envelope cannot be decoded.");
  }
  try {
    const transaction = Transaction.from(bytes);
    if (!transaction.recentBlockhash || !transaction.feePayer) {
      throw new Error("legacy transaction is missing its lifetime or fee payer");
    }
    return {
      recentBlockhash: transaction.recentBlockhash,
      signerAddresses: transaction.signatures.map((item) => item.publicKey.toBase58()),
      signatures: transaction.signatures.map((item) =>
        item.signature ? new Uint8Array(item.signature) : new Uint8Array(64)
      ),
      messageBytes,
      instructions: transaction.instructions.map((instruction) => ({
        program: instruction.programId.toBase58(),
        accounts: instruction.keys.map((key) => key.pubkey.toBase58()),
        data: new Uint8Array(instruction.data),
      })),
    };
  } catch {
    // Fall through to versioned transaction parsing.
  }
  try {
    const transaction = VersionedTransaction.deserialize(bytes);
    if (transaction.message.addressTableLookups.length !== 0) {
      throw new Error("address-table transactions cannot be verified before collection");
    }
    const keys = transaction.message.staticAccountKeys;
    const signerCount = transaction.message.header.numRequiredSignatures;
    const instructions = transaction.message.compiledInstructions.map((instruction) => {
      const program = keys[instruction.programIdIndex];
      const accounts = [...instruction.accountKeyIndexes].map((index) => keys[index]);
      if (!program || accounts.some((account) => !account)) {
        throw new Error("versioned transaction references an unresolved account");
      }
      return {
        program: program.toBase58(),
        accounts: accounts.map((account) => account.toBase58()),
        data: new Uint8Array(instruction.data),
      };
    });
    return {
      recentBlockhash: transaction.message.recentBlockhash,
      signerAddresses: keys.slice(0, signerCount).map((key) => key.toBase58()),
      signatures: transaction.signatures.map((signature) => new Uint8Array(signature)),
      messageBytes,
      instructions,
    };
  } catch {
    throw invalidPayShTransaction(
      "The MPP transaction cannot be resolved without external address-table state.",
    );
  }
}

async function validatePreparedPayShTransaction(input: {
  transaction: PreparedPayShTransaction;
  feePayer: string;
  asset: string;
  primaryRecipient: string;
  ownerRecipient: string;
  totalAmountAtomic: string;
  ownerAmountAtomic: string;
  externalId: string;
}): Promise<string> {
  const { transaction } = input;
  if (
    transaction.signerAddresses.length !== 2
    || transaction.signatures.length !== 2
    || transaction.signerAddresses[0] !== input.feePayer
    || !isZero(transaction.signatures[0])
    || isZero(transaction.signatures[1])
  ) {
    throw invalidPayShTransaction(
      "The MPP transaction must contain one unsigned service fee payer and one signed buyer.",
    );
  }
  const payer = transaction.signerAddresses[1];
  try {
    if (!await verifySignature(
      await getPublicKeyFromAddress(address(payer)),
      signatureBytes(transaction.signatures[1]),
      transaction.messageBytes,
    )) {
      throw new Error("buyer signature verification failed");
    }
  } catch {
    throw invalidPayShTransaction("The MPP buyer signature is not authentic.");
  }

  let source: string;
  let primaryDestination: string;
  let ownerDestination: string;
  try {
    [source, primaryDestination, ownerDestination] = await Promise.all([
      directPayShRecipientTokenAccount(input.asset, payer),
      directPayShRecipientTokenAccount(input.asset, input.primaryRecipient),
      directPayShRecipientTokenAccount(input.asset, input.ownerRecipient),
    ]);
  } catch {
    throw invalidPayShTransaction("The MPP transfer accounts are not valid Solana addresses.");
  }

  const total = BigInt(input.totalAmountAtomic);
  const ownerAmount = BigInt(input.ownerAmountAtomic);
  const platformAmount = total - ownerAmount;
  if (ownerAmount <= 0n || platformAmount <= 0n) {
    throw invalidPayShTransaction("The MPP transfer split is not positive.");
  }
  const actualTransfers: string[] = [];
  let exactResourceMemo = false;
  for (const instruction of transaction.instructions) {
    if (instruction.program === DIRECT_PAY_SH_TOKEN_PROGRAM) {
      if (
        instruction.accounts.length !== 4
        || instruction.accounts[0] !== source
        || instruction.accounts[1] !== input.asset
        || instruction.accounts[3] !== payer
        || instruction.data.length !== 10
        || instruction.data[0] !== 12
        || instruction.data[9] !== 6
      ) {
        throw invalidPayShTransaction("The MPP token instruction is not the quoted USDC transfer.");
      }
      const amount = Buffer.from(instruction.data).readBigUInt64LE(1);
      actualTransfers.push(`${instruction.accounts[2]}\u0000${amount}`);
      continue;
    }
    if (instruction.program === MEMO_PROGRAM) {
      if (Buffer.from(instruction.data).toString("utf8") === input.externalId) {
        exactResourceMemo = true;
      }
      continue;
    }
    if (instruction.program === COMPUTE_BUDGET_PROGRAM) {
      if (!validFeeSponsoredComputeBudget(instruction)) {
        throw invalidPayShTransaction(
          "The MPP transaction requests an unsupported or excessive service-paid priority fee.",
        );
      }
      continue;
    }
    if (instruction.program !== COMPUTE_BUDGET_PROGRAM) {
      throw invalidPayShTransaction(
        "The MPP transaction contains an instruction outside the pinned payment template.",
      );
    }
  }
  const expectedTransfers = [
    `${primaryDestination}\u0000${platformAmount}`,
    `${ownerDestination}\u0000${ownerAmount}`,
  ].sort();
  if (
    !exactResourceMemo
    || actualTransfers.length !== expectedTransfers.length
    || actualTransfers.sort().some((transfer, index) => transfer !== expectedTransfers[index])
  ) {
    throw invalidPayShTransaction(
      "The MPP transaction does not pay the exact quoted amount and recipients.",
    );
  }
  return payer;
}

function validFeeSponsoredComputeBudget(
  instruction: PreparedTransactionInstruction,
): boolean {
  if (instruction.accounts.length !== 0) return false;
  if (instruction.data.length === 5 && instruction.data[0] === 2) {
    return Buffer.from(instruction.data).readUInt32LE(1)
      <= MAX_FEE_SPONSORED_COMPUTE_UNITS;
  }
  if (instruction.data.length === 9 && instruction.data[0] === 3) {
    return Buffer.from(instruction.data).readBigUInt64LE(1)
      <= MAX_FEE_SPONSORED_MICROLAMPORTS_PER_UNIT;
  }
  return false;
}

function invalidPayShTransaction(message: string): PayShProxyError {
  return new PayShProxyError(409, "invalid_payment_transaction", message);
}

function forwardedHeaders(source: Headers): Headers {
  const headers = new Headers(source);
  for (const name of [
    "host",
    "connection",
    "keep-alive",
    "content-length",
    "transfer-encoding",
    "upgrade",
    "proxy-authenticate",
    "proxy-authorization",
    "te",
    "trailer",
    "accept-encoding",
    "cookie",
    "payment-signature",
    "payment-required",
    "payment-response",
    "x-payment",
    "x-payment-response",
    DIRECT_PAY_ATTEMPT_HEADER,
    PAY_SH_FRONT_TOKEN_HEADER,
    "x-openshelf-internal-token",
  ]) {
    headers.delete(name);
  }
  for (const name of [...headers.keys()]) {
    if (name.startsWith("x-forwarded-")) headers.delete(name);
  }
  return headers;
}

function isZero(bytes: Uint8Array): boolean {
  return bytes.every((byte) => byte === 0);
}

function safeError(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function sameSecret(candidate: string | null, expected: string | undefined): boolean {
  if (!candidate || !expected) return false;
  const left = Buffer.from(candidate);
  const right = Buffer.from(expected);
  return left.length === right.length && timingSafeEqual(left, right);
}
