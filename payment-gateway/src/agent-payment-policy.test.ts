import assert from "node:assert/strict";
import test from "node:test";
import {
  evaluateAgentPayment,
  type AgentPaymentCapability,
  type AgentPaymentIntent,
  type AgentPolicyState,
} from "./agent-payment-policy.js";

const capability: AgentPaymentCapability = {
  version: "openshelf.agent-payment.v1",
  delegationId: "delegation_1234567890",
  nonce: "nonce_123456789012",
  delegatedPublicKey: "Delegate1111111111111111111111111111111",
  parentWallet: "Parent111111111111111111111111111111111",
  network: "solana:devnet",
  asset: "Mint11111111111111111111111111111111111",
  gatewayOrigin: "https://pay.openshelf.test",
  rustApiOrigin: "https://api.openshelf.test",
  maxAtomicPerDocument: "100",
  maxAtomicPerQuery: "250",
  maxAtomicPerDay: "1000",
  queryId: "query_1",
  recipientRule: "rust_quote_exact",
  issuedAt: 1_000,
  expiresAt: 2_000,
};

const intent: AgentPaymentIntent = {
  delegatedPublicKey: capability.delegatedPublicKey,
  network: capability.network,
  asset: capability.asset,
  gatewayOrigin: capability.gatewayOrigin,
  rustApiOrigin: capability.rustApiOrigin,
  queryId: capability.queryId,
  documentAmountsAtomic: ["100", "100"],
  totalAtomic: "200",
  recipientMatchesRustQuote: true,
  signatureVerified: true,
  settlementState: "unpaid",
};

const state: AgentPolicyState = {
  now: 1_500,
  spentAtomicToday: "700",
  revokedDelegationIds: new Set(),
  consumedNonces: new Set(),
};

test("valid scoped intent can sign and advances the daily counter", () => {
  assert.deepEqual(evaluateAgentPayment(capability, intent, state), {
    action: "sign",
    nextSpentAtomicToday: "900",
  });
});

test("network, mint, recipient, delegate, origin, and query substitution fail closed", () => {
  const cases: [Partial<AgentPaymentIntent>, string][] = [
    [{ network: "solana:mainnet" }, "network_mismatch"],
    [{ asset: "OtherMint11111111111111111111111111111" }, "asset_mismatch"],
    [{ recipientMatchesRustQuote: false }, "recipient_mismatch"],
    [{ delegatedPublicKey: "OtherDelegate11111111111111111111111111" }, "delegate_mismatch"],
    [{ gatewayOrigin: "https://pay.openshelf.test.evil.example" }, "gateway_origin_mismatch"],
    [{ rustApiOrigin: "https://api.openshelf.test.evil.example" }, "api_origin_mismatch"],
    [{ queryId: "query_2" }, "query_mismatch"],
  ];
  for (const [patch, reason] of cases) {
    assert.deepEqual(evaluateAgentPayment(capability, { ...intent, ...patch }, state), {
      action: "deny",
      reason,
    });
  }
});

test("amount limits reject a one-unit overflow and mismatched sums", () => {
  assert.equal(
    evaluateAgentPayment(capability, { ...intent, documentAmountsAtomic: ["101"], totalAtomic: "101" }, state).action,
    "deny",
  );
  assert.deepEqual(
    evaluateAgentPayment(capability, { ...intent, documentAmountsAtomic: ["100", "100", "51"], totalAtomic: "251" }, state),
    { action: "deny", reason: "query_limit" },
  );
  assert.deepEqual(
    evaluateAgentPayment(capability, intent, { ...state, spentAtomicToday: "801" }),
    { action: "deny", reason: "daily_limit" },
  );
  assert.deepEqual(
    evaluateAgentPayment(capability, { ...intent, totalAtomic: "199" }, state),
    { action: "deny", reason: "amount_mismatch" },
  );
});

test("signature, expiry, revocation, and nonce replay are mandatory", () => {
  assert.deepEqual(evaluateAgentPayment(capability, { ...intent, signatureVerified: false }, state), {
    action: "deny",
    reason: "invalid_signature",
  });
  assert.deepEqual(evaluateAgentPayment(capability, intent, { ...state, now: 2_000 }), {
    action: "deny",
    reason: "expired",
  });
  assert.deepEqual(
    evaluateAgentPayment(capability, intent, {
      ...state,
      revokedDelegationIds: new Set([capability.delegationId]),
    }),
    { action: "deny", reason: "revoked" },
  );
  assert.deepEqual(
    evaluateAgentPayment(capability, intent, {
      ...state,
      consumedNonces: new Set([capability.nonce]),
    }),
    { action: "deny", reason: "replayed_nonce" },
  );
});

test("response loss reconciles instead of authorizing a duplicate transfer", () => {
  assert.deepEqual(
    evaluateAgentPayment(capability, { ...intent, settlementState: "settled" }, state),
    { action: "recover", reason: "already_settled" },
  );
  assert.deepEqual(
    evaluateAgentPayment(capability, { ...intent, settlementState: "pending" }, state),
    { action: "wait", reason: "settlement_pending" },
  );
});
