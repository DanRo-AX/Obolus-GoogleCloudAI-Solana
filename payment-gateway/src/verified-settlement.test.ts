import assert from "node:assert/strict";
import test from "node:test";
import {
  x402ResourceServer,
  type FacilitatorClient,
} from "@x402/core/server";
import type {
  Network,
  PaymentPayload,
  PaymentRequirements,
  SettleResponse,
} from "@x402/core/types";
import {
  settleWithIndependentFinality,
  type SettlementGateDirective,
} from "./verified-settlement.js";
import type { ExactChainScanResult, ReconciliationAttempt } from "./chain-reconciler.js";

const network = "solana:EtWTRABZaYq6iMfeYKouRu166VU2xqa1" as Network;
const signature = "settlement-signature";
const attempt: ReconciliationAttempt = {
  settlementKind: "document",
  quoteId: "quote-1",
  attemptId: "a".repeat(64),
  reconcileAfter: Date.now() + 30_000,
  createdAt: Date.now() - 1_000,
  payTo: "recipient",
  network,
  asset: "asset",
  amountAtomic: "7408",
  payer: "payer",
  signedTransactionBase64: "prepared",
  recentBlockhash: "blockhash",
};
const successful: SettleResponse = {
  success: true,
  transaction: signature,
  network,
  payer: "payer",
  amount: "7408",
};
const rpcs = [async () => null, async () => null];
const requirements = {
  network,
  payTo: attempt.payTo,
  asset: attempt.asset,
  amount: attempt.amountAtomic,
};

test("two independent exact finalized views are required before response release", async () => {
  let verificationCalls = 0;
  const directive = await settleWithIndependentFinality({
    settle: async () => successful,
    loadAttempt: async () => attempt,
    requirements,
    rpcs,
    expectedNetwork: network,
    timeoutMs: 1_000,
    pollIntervalMs: 50,
    verifySignature: async (): Promise<ExactChainScanResult> => {
      verificationCalls += 1;
      return { kind: "settled", signature };
    },
  });
  assert.deepEqual(directive, { skip: true, result: successful });
  assert.equal(verificationCalls, 2);
});

test("one lying or lagging RPC holds the response instead of trusting the facilitator", async () => {
  let clock = 0;
  let index = 0;
  const views: ExactChainScanResult[] = [
    { kind: "settled", signature },
    { kind: "absent" },
  ];
  const directive = await settleWithIndependentFinality({
    settle: async () => successful,
    loadAttempt: async () => attempt,
    requirements,
    rpcs,
    expectedNetwork: network,
    timeoutMs: 100,
    pollIntervalMs: 50,
    nowMs: () => clock,
    sleep: async (delay) => {
      clock += delay;
    },
    verifySignature: async () => views[index++ % views.length],
  });
  assertPending(directive);
});

test("an ambiguous facilitator call is never retried by falling through the x402 hook", async () => {
  let calls = 0;
  const directive = await settleWithIndependentFinality({
    settle: async () => {
      calls += 1;
      throw new Error("connection reset after submit");
    },
    loadAttempt: async () => attempt,
    requirements,
    rpcs,
    expectedNetwork: network,
    timeoutMs: 100,
    pollIntervalMs: 50,
  });
  assertPending(directive);
  assert.equal(calls, 1);
});

test("facilitator economics must match the durable attempt before any RPC can approve it", async () => {
  let verificationCalls = 0;
  const directive = await settleWithIndependentFinality({
    settle: async () => ({ ...successful, payer: "different-payer" }),
    loadAttempt: async () => attempt,
    requirements,
    rpcs,
    expectedNetwork: network,
    timeoutMs: 100,
    pollIntervalMs: 50,
    verifySignature: async () => {
      verificationCalls += 1;
      return { kind: "settled", signature };
    },
  });
  assertPending(directive);
  assert.equal(verificationCalls, 0);
});

test("middleware requirement drift is stopped before the money-moving call", async () => {
  let settlementCalls = 0;
  const directive = await settleWithIndependentFinality({
    settle: async () => {
      settlementCalls += 1;
      return successful;
    },
    loadAttempt: async () => attempt,
    requirements: { ...requirements, amount: "7409" },
    rpcs,
    expectedNetwork: network,
    timeoutMs: 100,
    pollIntervalMs: 50,
  });
  assertPending(directive);
  assert.equal(settlementCalls, 0);
});

test("a definitive facilitator failure is returned once without a second settlement call", async () => {
  const failed: SettleResponse = {
    success: false,
    transaction: "",
    network,
    errorReason: "invalid_transaction",
  };
  let calls = 0;
  const directive = await settleWithIndependentFinality({
    settle: async () => {
      calls += 1;
      return failed;
    },
    loadAttempt: async () => attempt,
    requirements,
    rpcs,
    expectedNetwork: network,
    timeoutMs: 100,
    pollIntervalMs: 50,
  });
  assert.deepEqual(directive, { skip: true, result: failed });
  assert.equal(calls, 1);
});

test("the installed x402 hook owns settlement and the SDK does not call its facilitator again", async () => {
  let hookSettlementCalls = 0;
  let sdkSettlementCalls = 0;
  let afterSettlementCalls = 0;
  const server = new x402ResourceServer(
    fakeFacilitator(() => {
      sdkSettlementCalls += 1;
      throw new Error("the SDK facilitator must be unreachable after a skip directive");
    }),
  );
  server.onBeforeSettle((context) => settleWithIndependentFinality({
    settle: async () => {
      hookSettlementCalls += 1;
      return successful;
    },
    loadAttempt: async () => attempt,
    requirements: context.requirements,
    rpcs,
    expectedNetwork: network,
    timeoutMs: 100,
    pollIntervalMs: 50,
    verifySignature: async () => ({ kind: "settled", signature }),
  }));
  server.onAfterSettle(async () => {
    afterSettlementCalls += 1;
  });

  const result = await server.settlePayment(paymentPayload(), paymentRequirements());

  assert.deepEqual(result, successful);
  assert.equal(hookSettlementCalls, 1);
  assert.equal(sdkSettlementCalls, 0);
  assert.equal(afterSettlementCalls, 1);
});

test("an installed x402 abort directive cannot fall through to a second charge", async () => {
  let hookSettlementCalls = 0;
  let sdkSettlementCalls = 0;
  const server = new x402ResourceServer(
    fakeFacilitator(async () => {
      sdkSettlementCalls += 1;
      return successful;
    }),
  );
  server.onBeforeSettle((context) => settleWithIndependentFinality({
    settle: async () => {
      hookSettlementCalls += 1;
      throw new Error("connection reset after the facilitator submitted the transaction");
    },
    loadAttempt: async () => attempt,
    requirements: context.requirements,
    rpcs,
    expectedNetwork: network,
    timeoutMs: 100,
    pollIntervalMs: 50,
  }));

  await assert.rejects(
    server.settlePayment(paymentPayload(), paymentRequirements()),
    (error: unknown) => {
      assert.equal(
        (error as { errorReason?: string }).errorReason,
        "settlement_reconciliation_pending",
      );
      return true;
    },
  );
  assert.equal(hookSettlementCalls, 1);
  assert.equal(sdkSettlementCalls, 0);
});

function assertPending(directive: SettlementGateDirective): void {
  assert.equal("abort" in directive && directive.abort, true);
  if ("abort" in directive) {
    assert.equal(directive.reason, "settlement_reconciliation_pending");
  }
}

function paymentRequirements(): PaymentRequirements {
  return {
    scheme: "exact",
    network,
    asset: attempt.asset,
    amount: attempt.amountAtomic,
    payTo: attempt.payTo,
    maxTimeoutSeconds: 60,
    extra: {},
  };
}

function paymentPayload(): PaymentPayload {
  const accepted = paymentRequirements();
  return {
    x402Version: 2,
    accepted,
    payload: { transaction: attempt.signedTransactionBase64 },
  };
}

function fakeFacilitator(
  settle: FacilitatorClient["settle"],
): FacilitatorClient {
  return {
    settle,
    verify: async () => ({ isValid: true, payer: attempt.payer ?? undefined }),
    getSupported: async () => ({ kinds: [], extensions: [], signers: {} }),
  };
}
