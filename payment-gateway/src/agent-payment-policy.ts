export type AgentPaymentCapability = {
  version: "openshelf.agent-payment.v1";
  delegationId: string;
  nonce: string;
  delegatedPublicKey: string;
  parentWallet: string;
  network: string;
  asset: string;
  gatewayOrigin: string;
  rustApiOrigin: string;
  maxAtomicPerDocument: string;
  maxAtomicPerQuery: string;
  maxAtomicPerDay: string;
  queryId: string;
  recipientRule: "rust_quote_exact";
  issuedAt: number;
  expiresAt: number;
};

export type AgentPaymentIntent = {
  delegatedPublicKey: string;
  network: string;
  asset: string;
  gatewayOrigin: string;
  rustApiOrigin: string;
  queryId: string;
  documentAmountsAtomic: string[];
  totalAtomic: string;
  recipientMatchesRustQuote: boolean;
  signatureVerified: boolean;
  settlementState: "unpaid" | "pending" | "settled";
};

export type AgentPolicyState = {
  now: number;
  spentAtomicToday: string;
  revokedDelegationIds: ReadonlySet<string>;
  consumedNonces: ReadonlySet<string>;
};

export type AgentPolicyDecision =
  | { action: "sign"; nextSpentAtomicToday: string }
  | { action: "recover"; reason: "already_settled" }
  | { action: "wait"; reason: "settlement_pending" }
  | { action: "deny"; reason: AgentPolicyDenial };

export type AgentPolicyDenial =
  | "invalid_capability"
  | "invalid_signature"
  | "revoked"
  | "replayed_nonce"
  | "not_yet_valid"
  | "expired"
  | "delegate_mismatch"
  | "network_mismatch"
  | "asset_mismatch"
  | "gateway_origin_mismatch"
  | "api_origin_mismatch"
  | "query_mismatch"
  | "recipient_mismatch"
  | "per_document_limit"
  | "query_limit"
  | "daily_limit"
  | "amount_mismatch";

/**
 * Pure, fail-closed policy gate for a future non-custodial Solana delegation.
 * It deliberately does not hold or create a signing key. Callers may sign only
 * when this returns `sign`, then atomically persist the nonce and daily total.
 */
export function evaluateAgentPayment(
  capability: AgentPaymentCapability,
  intent: AgentPaymentIntent,
  state: AgentPolicyState,
): AgentPolicyDecision {
  if (!validCapability(capability)) return deny("invalid_capability");
  if (!intent.signatureVerified) return deny("invalid_signature");
  if (state.revokedDelegationIds.has(capability.delegationId)) return deny("revoked");
  if (state.consumedNonces.has(capability.nonce)) return deny("replayed_nonce");
  if (state.now < capability.issuedAt) return deny("not_yet_valid");
  if (state.now >= capability.expiresAt) return deny("expired");
  if (intent.settlementState === "settled") {
    return { action: "recover", reason: "already_settled" };
  }
  if (intent.settlementState === "pending") {
    return { action: "wait", reason: "settlement_pending" };
  }
  if (intent.delegatedPublicKey !== capability.delegatedPublicKey) {
    return deny("delegate_mismatch");
  }
  if (intent.network !== capability.network) return deny("network_mismatch");
  if (intent.asset !== capability.asset) return deny("asset_mismatch");
  if (canonicalOrigin(intent.gatewayOrigin) !== canonicalOrigin(capability.gatewayOrigin)) {
    return deny("gateway_origin_mismatch");
  }
  if (canonicalOrigin(intent.rustApiOrigin) !== canonicalOrigin(capability.rustApiOrigin)) {
    return deny("api_origin_mismatch");
  }
  if (intent.queryId !== capability.queryId) return deny("query_mismatch");
  if (capability.recipientRule !== "rust_quote_exact" || !intent.recipientMatchesRustQuote) {
    return deny("recipient_mismatch");
  }

  const amounts = intent.documentAmountsAtomic.map(parseAtomic);
  const total = parseAtomic(intent.totalAtomic);
  const perDocument = parseAtomic(capability.maxAtomicPerDocument);
  const perQuery = parseAtomic(capability.maxAtomicPerQuery);
  const perDay = parseAtomic(capability.maxAtomicPerDay);
  const spentToday = parseAtomic(state.spentAtomicToday);
  if ([...amounts, total, perDocument, perQuery, perDay, spentToday].some((value) => value === null)) {
    return deny("invalid_capability");
  }
  const safeAmounts = amounts as bigint[];
  const safeTotal = total as bigint;
  if (safeAmounts.length < 1 || safeAmounts.reduce((sum, amount) => sum + amount, 0n) !== safeTotal) {
    return deny("amount_mismatch");
  }
  if (safeAmounts.some((amount) => amount > (perDocument as bigint))) {
    return deny("per_document_limit");
  }
  if (safeTotal > (perQuery as bigint)) return deny("query_limit");
  const nextDaily = (spentToday as bigint) + safeTotal;
  if (nextDaily > (perDay as bigint)) return deny("daily_limit");
  return { action: "sign", nextSpentAtomicToday: nextDaily.toString() };
}

function validCapability(capability: AgentPaymentCapability): boolean {
  return (
    capability.version === "openshelf.agent-payment.v1" &&
    capability.delegationId.length >= 16 &&
    capability.nonce.length >= 16 &&
    capability.delegatedPublicKey.length >= 32 &&
    capability.parentWallet.length >= 32 &&
    capability.network.length > 0 &&
    capability.asset.length >= 32 &&
    capability.queryId.length > 0 &&
    capability.issuedAt > 0 &&
    capability.expiresAt > capability.issuedAt &&
    isAllowedOrigin(capability.gatewayOrigin) &&
    isAllowedOrigin(capability.rustApiOrigin) &&
    parseAtomic(capability.maxAtomicPerDocument) !== null &&
    parseAtomic(capability.maxAtomicPerQuery) !== null &&
    parseAtomic(capability.maxAtomicPerDay) !== null
  );
}

function isAllowedOrigin(value: string): boolean {
  try {
    const url = new URL(value);
    return url.origin === value.replace(/\/$/, "") &&
      (url.protocol === "https:" || ["localhost", "127.0.0.1"].includes(url.hostname));
  } catch {
    return false;
  }
}

function canonicalOrigin(value: string): string | null {
  try {
    return new URL(value).origin;
  } catch {
    return null;
  }
}

function parseAtomic(value: string): bigint | null {
  if (!/^(0|[1-9]\d*)$/.test(value)) return null;
  try {
    return BigInt(value);
  } catch {
    return null;
  }
}

function deny(reason: AgentPolicyDenial): AgentPolicyDecision {
  return { action: "deny", reason };
}
