import { base58 } from "@scure/base";
import { getTransactionDecoder } from "@solana/kit";
import type { SolanaRpc } from "./chain-reconciler.js";

export type PayShReceiptEvidence = {
  transactionSignature: string;
  finalizedTransactionBase64: string;
};

type PayShFinalityOptions = {
  evidence: PayShReceiptEvidence;
  rpcs: SolanaRpc[];
  minimumViews: number;
  timeoutMs: number;
  pollIntervalMs: number;
  nowMs?: () => number;
  sleep?: (delayMs: number) => Promise<void>;
};

/**
 * Fills only the Pay.sh fee-payer signature slot in the exact durable partial
 * transaction. Signature authenticity is checked by the proxy before this
 * function is called; this function fixes the byte string that independent
 * finalized RPC responses must reproduce.
 */
export function completePayShReceiptTransaction(
  preparedTransactionBase64: string,
  receiptReference: string,
): PayShReceiptEvidence | null {
  try {
    const preparedBytes = decodeCanonicalBase64(preparedTransactionBase64);
    const decoded = getTransactionDecoder().decode(preparedBytes);
    const preparedSignatures = Object.values(decoded.signatures);
    const receiptSignature = base58.decode(receiptReference);
    if (preparedSignatures.length === 0 || receiptSignature.length !== 64) return null;

    const completedSignatures = preparedSignatures.map((prepared, index) => {
      const candidate = index === 0 ? receiptSignature : prepared;
      if (!candidate || candidate.length !== 64 || isZero(candidate)) {
        throw new Error("Pay.sh transaction still has a missing signature");
      }
      if (
        prepared
        && !isZero(prepared)
        && !prepared.every((byte, offset) => byte === candidate[offset])
      ) {
        throw new Error("Pay.sh receipt replaced an existing signature");
      }
      return candidate;
    });
    const finalizedBytes = Buffer.concat([
      encodeCompactU16(completedSignatures.length),
      ...completedSignatures.map((signature) => Buffer.from(signature)),
      Buffer.from(decoded.messageBytes),
    ]);
    // Reject an ordering or wire-encoding assumption that does not round-trip
    // through the pinned Solana decoder.
    const roundTrip = getTransactionDecoder().decode(finalizedBytes);
    if (
      Object.keys(roundTrip.signatures).length !== completedSignatures.length
      || !Buffer.from(roundTrip.messageBytes).equals(Buffer.from(decoded.messageBytes))
    ) {
      return null;
    }
    return {
      transactionSignature: receiptReference,
      finalizedTransactionBase64: finalizedBytes.toString("base64"),
    };
  } catch {
    return null;
  }
}

export async function waitForIndependentPayShFinality(
  options: PayShFinalityOptions,
): Promise<boolean> {
  if (
    !Number.isSafeInteger(options.minimumViews)
    || options.minimumViews < 1
    || options.rpcs.length < options.minimumViews
    || !Number.isSafeInteger(options.timeoutMs)
    || options.timeoutMs < 1
    || options.timeoutMs > 45_000
    || !Number.isSafeInteger(options.pollIntervalMs)
    || options.pollIntervalMs < 50
    || options.pollIntervalMs > 5_000
  ) {
    return false;
  }
  const nowMs = options.nowMs ?? Date.now;
  const sleep = options.sleep ?? ((delayMs: number) =>
    new Promise<void>((resolve) => setTimeout(resolve, delayMs)));
  const deadline = nowMs() + options.timeoutMs;
  const maxPolls = Math.ceil(options.timeoutMs / options.pollIntervalMs) + 1;
  for (let poll = 0; poll < maxPolls; poll += 1) {
    const views = await Promise.all(options.rpcs.map(async (rpc) => {
      try {
        return await rpcReportsExactFinalizedReceipt(options.evidence, rpc);
      } catch {
        return false;
      }
    }));
    if (views.length >= options.minimumViews && views.every(Boolean)) {
      return true;
    }
    if (nowMs() >= deadline) break;
    await sleep(Math.min(options.pollIntervalMs, Math.max(0, deadline - nowMs())));
  }
  return false;
}

async function rpcReportsExactFinalizedReceipt(
  evidence: PayShReceiptEvidence,
  rpc: SolanaRpc,
): Promise<boolean> {
  const result = await rpc("getTransaction", [
    evidence.transactionSignature,
    { commitment: "finalized", encoding: "base64", maxSupportedTransactionVersion: 0 },
  ]);
  if (!result || typeof result !== "object" || Array.isArray(result)) return false;
  const record = result as { transaction?: unknown; meta?: unknown };
  if (!record.meta || typeof record.meta !== "object" || Array.isArray(record.meta)) return false;
  if ((record.meta as { err?: unknown }).err !== null) return false;
  if (
    !Array.isArray(record.transaction)
    || record.transaction.length !== 2
    || record.transaction[1] !== "base64"
    || typeof record.transaction[0] !== "string"
  ) {
    return false;
  }
  const actual = decodeCanonicalBase64(record.transaction[0]);
  const expected = decodeCanonicalBase64(evidence.finalizedTransactionBase64);
  return Buffer.from(actual).equals(Buffer.from(expected));
}

function decodeCanonicalBase64(value: string): Uint8Array {
  if (!/^[A-Za-z0-9+/]+={0,2}$/.test(value) || value.length % 4 !== 0) {
    throw new Error("transaction is not canonical base64");
  }
  const decoded = Buffer.from(value, "base64");
  if (decoded.length === 0 || decoded.toString("base64") !== value) {
    throw new Error("transaction is not canonical base64");
  }
  return decoded;
}

function encodeCompactU16(value: number): Uint8Array {
  if (!Number.isSafeInteger(value) || value < 0 || value > 0xffff) {
    throw new Error("signature count is out of range");
  }
  const bytes: number[] = [];
  let remaining = value;
  do {
    const low = remaining & 0x7f;
    remaining >>>= 7;
    bytes.push(remaining === 0 ? low : low | 0x80);
  } while (remaining !== 0);
  return Uint8Array.from(bytes);
}

function isZero(value: Uint8Array): boolean {
  return value.every((byte) => byte === 0);
}
