import type { SettleResponse } from "@x402/core/types";
import {
  exactSettlementSignature,
  verifyExactFinalizedSettlementSignature,
  type ExactChainScanResult,
  type ReconciliationAttempt,
  type SolanaRpc,
} from "./chain-reconciler.js";

export type SettlementGateDirective =
  | { skip: true; result: SettleResponse }
  | { abort: true; reason: string; message: string };

type SettlementGateDependencies = {
  settle: () => Promise<SettleResponse>;
  loadAttempt: () => Promise<ReconciliationAttempt>;
  requirements: {
    network: string;
    payTo: string;
    asset: string;
    amount: string;
  };
  rpcs: SolanaRpc[];
  expectedNetwork: string;
  timeoutMs: number;
  pollIntervalMs: number;
  nowMs?: () => number;
  sleep?: (delayMs: number) => Promise<void>;
  verifySignature?: (
    attempt: ReconciliationAttempt,
    signature: string,
    rpc: SolanaRpc,
    expectedNetwork: string,
  ) => Promise<ExactChainScanResult>;
};

/**
 * Calls the facilitator exactly once and releases the paid HTTP response only
 * after two independent finalized RPC views reproduce the exact durable
 * pre-settlement transaction. Every uncertainty returns an abort directive;
 * this function deliberately never throws because x402 treats ordinary hook
 * exceptions as advisory and would otherwise call the facilitator again.
 */
export async function settleWithIndependentFinality(
  dependencies: SettlementGateDependencies,
): Promise<SettlementGateDirective> {
  const nowMs = dependencies.nowMs ?? Date.now;
  const sleep = dependencies.sleep ?? ((delayMs: number) =>
    new Promise<void>((resolve) => setTimeout(resolve, delayMs)));
  const verify = dependencies.verifySignature ?? verifyExactFinalizedSettlementSignature;
  try {
    if (
      dependencies.rpcs.length < 2
      || !Number.isSafeInteger(dependencies.timeoutMs)
      || dependencies.timeoutMs < 1
      || dependencies.timeoutMs > 45_000
      || !Number.isSafeInteger(dependencies.pollIntervalMs)
      || dependencies.pollIntervalMs < 50
      || dependencies.pollIntervalMs > 5_000
    ) {
      return pending("independent settlement verification is not safely configured");
    }

    // Loading first proves the immutable fence and its exact signed bytes are
    // durable before the one money-moving call can begin.
    const attempt = await dependencies.loadAttempt();
    if (
      dependencies.requirements.network !== attempt.network
      || dependencies.requirements.payTo !== attempt.payTo
      || dependencies.requirements.asset !== attempt.asset
      || dependencies.requirements.amount !== attempt.amountAtomic
    ) {
      return pending("settlement requirements drifted from the durable payment attempt");
    }
    const result = await dependencies.settle();
    if (!result.success) return { skip: true, result };
    if (
      !result.transaction
      || result.network !== dependencies.expectedNetwork
      || result.network !== attempt.network
      || !result.payer
      || result.payer !== attempt.payer
      || (result.amount ?? attempt.amountAtomic) !== attempt.amountAtomic
    ) {
      return pending("facilitator response does not match the durable payment attempt");
    }

    const deadline = nowMs() + dependencies.timeoutMs;
    const maxPolls = Math.ceil(dependencies.timeoutMs / dependencies.pollIntervalMs) + 1;
    for (let poll = 0; poll < maxPolls; poll += 1) {
      const scans = await Promise.all(dependencies.rpcs.map((rpc) =>
        verify(attempt, result.transaction, rpc, dependencies.expectedNetwork)
      ));
      if (exactSettlementSignature(scans) === result.transaction) {
        return { skip: true, result };
      }
      if (nowMs() >= deadline) break;
      await sleep(Math.min(dependencies.pollIntervalMs, Math.max(0, deadline - nowMs())));
    }
    return pending("independent finalized RPC views did not agree before the response deadline");
  } catch {
    return pending("settlement outcome is ambiguous and requires durable reconciliation");
  }
}

function pending(detail: string): SettlementGateDirective {
  return {
    abort: true,
    reason: "settlement_reconciliation_pending",
    message: `Payment response is held: ${detail}. Retry this same resource without signing again.`,
  };
}
