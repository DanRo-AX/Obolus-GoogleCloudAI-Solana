import { createHash } from "node:crypto";
import { base58 } from "@scure/base";
import { findAssociatedTokenPda, TOKEN_PROGRAM_ADDRESS } from "@solana-program/token";
import { TOKEN_2022_PROGRAM_ADDRESS } from "@solana-program/token-2022";
import {
  address,
  getPublicKeyFromAddress,
  getTransactionDecoder,
  signatureBytes,
  verifySignature,
} from "@solana/kit";
import { Transaction, VersionedTransaction } from "@solana/web3.js";
import { paymentMemo } from "./payment-routing.js";
import type { DurableSettlement } from "./durable-outbox.js";

const MEMO_PROGRAM_ADDRESS = "MemoSq4gqABAXKb96qnH8TysNcWxMyWCqXgDLGmfcHr";
const COMPUTE_BUDGET_PROGRAM_ADDRESS = "ComputeBudget111111111111111111111111111111";
const MAX_FEE_SPONSORED_COMPUTE_UNITS = 200_000;
const MAX_FEE_SPONSORED_MICROLAMPORTS_PER_UNIT = 10_000n;
const TOKEN_PROGRAM = String(TOKEN_PROGRAM_ADDRESS);
const SIGNATURE_PAGE_SIZE = 1_000;
const RECOVERY_CLOCK_SKEW_MS = 60_000;

export type ReconciliationAttempt = {
  settlementKind: "document" | "bundle" | "open_call";
  quoteId: string;
  attemptId: string;
  reconcileAfter: number;
  createdAt: number;
  payTo: string;
  network: string;
  asset: string;
  amountAtomic: string;
  payer?: string | null;
  signedTransactionBase64?: string | null;
  recentBlockhash?: string | null;
  absenceObservedAt?: number | null;
};

export type ExactChainScanResult =
  | { kind: "settled"; signature: string }
  | { kind: "failed"; signature: string }
  | { kind: "absent" }
  | { kind: "inconclusive" };

export function exactAbsenceDecision(
  scans: ExactChainScanResult[],
  blockhashViews: Array<boolean | null>,
  absenceObservedAt?: number | null,
): "defer" | "observe" | "release" {
  if (
    scans.length < 2
    || scans.some((scan) => scan.kind === "settled" || scan.kind === "inconclusive")
    || blockhashViews.length !== scans.length
    || blockhashViews.some((view) => view === null || view)
  ) {
    return "defer";
  }
  return absenceObservedAt == null ? "observe" : "release";
}

export function exactSettlementSignature(scans: ExactChainScanResult[]): string | null {
  if (scans.length < 2 || scans.some((scan) => scan.kind !== "settled")) return null;
  const signature = scans[0].kind === "settled" ? scans[0].signature : null;
  return signature && scans.every(
    (scan) => scan.kind === "settled" && scan.signature === signature,
  )
    ? signature
    : null;
}

export type SolanaRpc = (method: string, params: unknown[]) => Promise<unknown>;

type SignatureInfo = {
  signature: string;
  blockTime: number | null;
  err: unknown;
  memo: string | null;
};

type ParsedTransfer = {
  payer: string;
  destination: string;
  mint: string;
  amountAtomic: string;
};

type ParsedTransactionEvidence = {
  slot: number;
  blockTime: number | null;
  memo: string;
  transfer: ParsedTransfer;
};

/**
 * The x402 client submits a transaction signed by the token owner but leaves
 * the first (fee-payer) signature empty. The facilitator fills only that slot.
 * Re-zeroing it therefore reconstructs the exact payload hashed before
 * settlement, which is stronger than matching a public memo alone.
 */
export function paymentAttemptIdFromSettledTransaction(transactionBase64: string): string {
  const bytes = Buffer.from(transactionBase64, "base64");
  const { value: signatureCount, length: prefixLength } = decodeShortVec(bytes);
  if (signatureCount < 1 || prefixLength + signatureCount * 64 >= bytes.length) {
    throw new Error("finalized transaction has an invalid signature section");
  }
  const reconstructed = Buffer.from(bytes);
  reconstructed.fill(0, prefixLength, prefixLength + 64);
  return createHash("sha256").update(reconstructed.toString("base64")).digest("hex");
}

export async function findFinalizedChainSettlement(
  attempt: ReconciliationAttempt,
  rpc: SolanaRpc,
  expectedNetwork: string,
  maxSignaturePages = 5,
): Promise<DurableSettlement | null> {
  validateAttempt(attempt, expectedNetwork, maxSignaturePages);
  const expectedMemo = paymentMemo(
    reconciliationIdentity(attempt.settlementKind, attempt.quoteId),
    attempt.quoteId,
  );
  const destinations = await associatedTokenAddresses(attempt.asset, attempt.payTo);
  const visitedSignatures = new Set<string>();

  for (const destination of destinations) {
    let before: string | undefined;
    for (let page = 0; page < Math.max(1, maxSignaturePages); page += 1) {
      const signatures = parseSignatureInfos(
        await rpc("getSignaturesForAddress", [
          destination,
          {
            commitment: "finalized",
            limit: SIGNATURE_PAGE_SIZE,
            ...(before ? { before } : {}),
          },
        ]),
      );
      if (signatures.length === 0) break;

      for (const candidate of signatures) {
        if (
          candidate.err !== null ||
          candidate.memo !== expectedMemo ||
          visitedSignatures.has(candidate.signature)
        ) {
          continue;
        }
        visitedSignatures.add(candidate.signature);
        let parsed: ParsedTransactionEvidence | null;
        let transactionBase64: string | null;
        try {
          parsed = parseMatchingTransaction(
            await rpc("getTransaction", [
              candidate.signature,
              {
                commitment: "finalized",
                encoding: "jsonParsed",
                maxSupportedTransactionVersion: 0,
              },
            ]),
            expectedMemo,
            attempt,
            destinations,
          );
          if (!parsed) continue;
          transactionBase64 = parseBase64Transaction(
            await rpc("getTransaction", [
              candidate.signature,
              {
                commitment: "finalized",
                encoding: "base64",
                maxSupportedTransactionVersion: 0,
              },
            ]),
            candidate.signature,
          );
        } catch {
          continue;
        }
        if (!transactionBase64) continue;
        let reconstructedAttemptId: string;
        try {
          reconstructedAttemptId = paymentAttemptIdFromSettledTransaction(transactionBase64);
        } catch {
          continue;
        }
        if (reconstructedAttemptId !== attempt.attemptId) continue;

        return {
          settlementKind: attempt.settlementKind,
          quoteId: attempt.quoteId,
          attemptId: attempt.attemptId,
          transactionSignature: candidate.signature,
          payer: parsed.transfer.payer,
          payTo: attempt.payTo,
          amountAtomic: attempt.amountAtomic,
          network: attempt.network,
          rawResponse: {
            success: true,
            transaction: candidate.signature,
            payer: parsed.transfer.payer,
            network: attempt.network,
            amount: attempt.amountAtomic,
            recovery: {
              method: "finalized_chain_scan",
              attemptId: attempt.attemptId,
              memo: parsed.memo,
              slot: parsed.slot,
              blockTime: parsed.blockTime,
            },
          },
        };
      }

      const oldest = signatures.at(-1);
      // Validator blockTime is advisory wall-clock data, not proof that a
      // transaction predates this process's durable attempt. NTP jumps and
      // lagging validator clocks must not turn an exact payment into absence.
      if (signatures.length < SIGNATURE_PAGE_SIZE) break;
      if (!oldest) break;
      before = oldest.signature;
    }
  }
  return null;
}

export async function findUnanimousFinalizedChainSettlement(
  attempt: ReconciliationAttempt,
  rpcs: SolanaRpc[],
  expectedNetwork: string,
  maxSignaturePages = 5,
): Promise<DurableSettlement | null> {
  if (rpcs.length < 2) return null;
  const settlements = await Promise.all(rpcs.map(async (rpc) => {
    try {
      return await findFinalizedChainSettlement(
        attempt,
        rpc,
        expectedNetwork,
        maxSignaturePages,
      );
    } catch {
      return null;
    }
  }));
  const first = settlements[0];
  if (
    !first
    || settlements.some((settlement) =>
      !settlement
      || settlement.transactionSignature !== first.transactionSignature
      || settlement.attemptId !== first.attemptId
    )
  ) return null;
  return first;
}

export async function scanExactFinalizedChainAttempt(
  attempt: ReconciliationAttempt,
  rpc: SolanaRpc,
  maxSignaturePages = 5,
): Promise<ExactChainScanResult> {
  if (!attempt.payer || !attempt.signedTransactionBase64 || !attempt.recentBlockhash) {
    return { kind: "inconclusive" };
  }
  if (!Number.isSafeInteger(maxSignaturePages) || maxSignaturePages < 1 || maxSignaturePages > 20) {
    throw new Error("exact chain scan pages must be between 1 and 20");
  }
  const prepared = Buffer.from(attempt.signedTransactionBase64, "base64");
  if (!hasValidTransactionEnvelope(prepared)) return { kind: "inconclusive" };
  const evidence = preparedTransactionEvidence(prepared);
  if (
    !evidence
    || evidence.recentBlockhash !== attempt.recentBlockhash
    || !evidence.signedAddresses.includes(attempt.payer)
    || (
      evidence.missingSignatureIndexes.length !== 0
      && !(
        evidence.missingSignatureIndexes.length === 1
        && evidence.missingSignatureIndexes[0] === 0
      )
    )
  ) {
    return { kind: "inconclusive" };
  }
  if (!await hasExactPreparedPaymentSemantics(attempt, prepared)) {
    return { kind: "inconclusive" };
  }
  const knownSignature = evidence.missingSignatureIndexes.length === 0
    ? fullySignedTransactionSignature(prepared)
    : null;
  if (knownSignature) {
    const transaction = parseExactBase64Transaction(await rpc("getTransaction", [
      knownSignature,
      { commitment: "finalized", encoding: "base64", maxSupportedTransactionVersion: 0 },
    ]));
    if (!transaction) return { kind: "absent" };
    if (!equalPreparedTransaction(prepared, transaction.bytes, knownSignature)) {
      return { kind: "inconclusive" };
    }
    return transaction.err === null
      ? { kind: "settled", signature: knownSignature }
      : { kind: "failed", signature: knownSignature };
  }

  let before: string | undefined;
  for (let page = 0; page < maxSignaturePages; page += 1) {
    const signatures = parseSignatureInfos(await rpc("getSignaturesForAddress", [
      attempt.payer,
      { commitment: "finalized", limit: SIGNATURE_PAGE_SIZE, ...(before ? { before } : {}) },
    ]));
    if (signatures.length === 0) return { kind: "absent" };
    for (const candidate of signatures) {
      const transaction = parseExactBase64Transaction(await rpc("getTransaction", [
        candidate.signature,
        { commitment: "finalized", encoding: "base64", maxSupportedTransactionVersion: 0 },
      ]));
      if (!transaction) return { kind: "inconclusive" };
      if (equalPreparedTransaction(prepared, transaction.bytes, candidate.signature)) {
        return transaction.err === null
          ? { kind: "settled", signature: candidate.signature }
          : { kind: "failed", signature: candidate.signature };
      }
    }
    // Bound work by page count. Do not infer absence from blockTime: the
    // prepared bytes and signatures are the evidence, while chain wall-clock
    // timestamps may legitimately lag the application clock.
    if (signatures.length < SIGNATURE_PAGE_SIZE) {
      return { kind: "absent" };
    }
    before = signatures.at(-1)?.signature;
    if (!before) return { kind: "inconclusive" };
  }
  return { kind: "inconclusive" };
}

/**
 * Verifies one facilitator-declared signature against the exact durable
 * pre-settlement payload. This is the synchronous response-release gate: it
 * avoids an address-history scan because the facilitator already supplied the
 * candidate signature, but still requires finalized transaction bytes from an
 * independently selected RPC.
 */
export async function verifyExactFinalizedSettlementSignature(
  attempt: ReconciliationAttempt,
  candidateSignature: string,
  rpc: SolanaRpc,
  expectedNetwork: string,
): Promise<ExactChainScanResult> {
  try {
    validateAttempt(attempt, expectedNetwork, 1);
    if (!attempt.payer || !attempt.signedTransactionBase64 || !attempt.recentBlockhash) {
      return { kind: "inconclusive" };
    }
    const decodedSignature = base58.decode(candidateSignature);
    if (decodedSignature.length !== 64) return { kind: "inconclusive" };

    const prepared = Buffer.from(attempt.signedTransactionBase64, "base64");
    if (!hasValidTransactionEnvelope(prepared)) return { kind: "inconclusive" };
    const evidence = preparedTransactionEvidence(prepared);
    if (
      !evidence
      || evidence.recentBlockhash !== attempt.recentBlockhash
      || !evidence.signedAddresses.includes(attempt.payer)
      || evidence.missingSignatureIndexes.length !== 1
      || evidence.missingSignatureIndexes[0] !== 0
      || !await hasExactPreparedPaymentSemantics(attempt, prepared)
    ) {
      return { kind: "inconclusive" };
    }

    const transaction = parseExactBase64Transaction(await rpc("getTransaction", [
      candidateSignature,
      { commitment: "finalized", encoding: "base64", maxSupportedTransactionVersion: 0 },
    ]));
    if (!transaction) return { kind: "absent" };
    if (!equalPreparedTransaction(prepared, transaction.bytes, candidateSignature)) {
      return { kind: "inconclusive" };
    }
    return transaction.err === null
      ? { kind: "settled", signature: candidateSignature }
      : { kind: "failed", signature: candidateSignature };
  } catch {
    return { kind: "inconclusive" };
  }
}

type ExactPreparedInstruction = {
  program: string;
  accounts: string[];
  data: Uint8Array;
};

export async function hasExactPreparedPaymentSemantics(
  attempt: ReconciliationAttempt,
  prepared: Uint8Array,
): Promise<boolean> {
  try {
    const messageBytes = new Uint8Array(getTransactionDecoder().decode(prepared).messageBytes);
    let signerAddresses: string[];
    let signatures: Uint8Array[];
    let instructions: ExactPreparedInstruction[];
    try {
      const transaction = Transaction.from(prepared);
      signerAddresses = transaction.signatures.map((item) => item.publicKey.toBase58());
      signatures = transaction.signatures.map((item) =>
        item.signature ? new Uint8Array(item.signature) : new Uint8Array(64)
      );
      instructions = transaction.instructions.map((instruction) => ({
        program: instruction.programId.toBase58(),
        accounts: instruction.keys.map((key) => key.pubkey.toBase58()),
        data: new Uint8Array(instruction.data),
      }));
    } catch {
      const transaction = VersionedTransaction.deserialize(prepared);
      if (transaction.message.addressTableLookups.length !== 0) return false;
      const keys = transaction.message.staticAccountKeys;
      const signerCount = transaction.message.header.numRequiredSignatures;
      signerAddresses = keys.slice(0, signerCount).map((key) => key.toBase58());
      signatures = transaction.signatures.map((signature) => new Uint8Array(signature));
      instructions = transaction.message.compiledInstructions.map((instruction) => {
        const program = keys[instruction.programIdIndex];
        const accounts = [...instruction.accountKeyIndexes].map((index) => keys[index]);
        if (!program || accounts.some((account) => !account)) {
          throw new Error("x402 transaction references an unresolved account");
        }
        return {
          program: program.toBase58(),
          accounts: accounts.map((account) => account.toBase58()),
          data: new Uint8Array(instruction.data),
        };
      });
    }
    const payerIndex = signerAddresses.indexOf(attempt.payer ?? "");
    if (payerIndex < 0 || isZeroSignature(signatures[payerIndex])) return false;
    for (let index = 0; index < signerAddresses.length; index += 1) {
      if (isZeroSignature(signatures[index])) continue;
      if (!await verifySignature(
        await getPublicKeyFromAddress(address(signerAddresses[index])),
        signatureBytes(signatures[index]),
        messageBytes,
      )) return false;
    }
    const [source, destination] = await Promise.all([
      associatedTokenAddress(attempt.asset, attempt.payer ?? ""),
      associatedTokenAddress(attempt.asset, attempt.payTo),
    ]);
    const expectedMemo = paymentMemo(
      reconciliationIdentity(attempt.settlementKind, attempt.quoteId),
      attempt.quoteId,
    );
    let exactMemoCount = 0;
    let exactTransferCount = 0;
    for (const instruction of instructions) {
      if (instruction.program === TOKEN_PROGRAM) {
        if (
          instruction.accounts.length !== 4
          || instruction.accounts[0] !== source
          || instruction.accounts[1] !== attempt.asset
          || instruction.accounts[2] !== destination
          || instruction.accounts[3] !== attempt.payer
          || instruction.data.length !== 10
          || instruction.data[0] !== 12
          || instruction.data[9] !== 6
          || Buffer.from(instruction.data).readBigUInt64LE(1).toString()
            !== attempt.amountAtomic
        ) return false;
        exactTransferCount += 1;
      } else if (instruction.program === MEMO_PROGRAM_ADDRESS) {
        if (Buffer.from(instruction.data).toString("utf8") !== expectedMemo) return false;
        exactMemoCount += 1;
      } else if (instruction.program === COMPUTE_BUDGET_PROGRAM_ADDRESS) {
        if (!validFeeSponsoredComputeBudget(instruction)) return false;
      } else if (instruction.program !== COMPUTE_BUDGET_PROGRAM_ADDRESS) {
        return false;
      }
    }
    return exactTransferCount === 1 && exactMemoCount === 1;
  } catch {
    return false;
  }
}

function validFeeSponsoredComputeBudget(instruction: ExactPreparedInstruction): boolean {
  if (instruction.accounts.length !== 0) return false;
  if (instruction.data.length === 5 && instruction.data[0] === 2) {
    return Buffer.from(instruction.data).readUInt32LE(1) <= MAX_FEE_SPONSORED_COMPUTE_UNITS;
  }
  if (instruction.data.length === 9 && instruction.data[0] === 3) {
    return Buffer.from(instruction.data).readBigUInt64LE(1)
      <= MAX_FEE_SPONSORED_MICROLAMPORTS_PER_UNIT;
  }
  return false;
}

async function associatedTokenAddress(asset: string, owner: string): Promise<string> {
  return String((await findAssociatedTokenPda({
    mint: address(asset),
    owner: address(owner),
    tokenProgram: TOKEN_PROGRAM_ADDRESS,
  }))[0]);
}

function isZeroSignature(signature: Uint8Array | undefined): boolean {
  return !signature || signature.every((byte) => byte === 0);
}

function parseExactBase64Transaction(value: unknown): { bytes: Buffer; err: unknown } | null {
  if (value === null) return null;
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error("Solana RPC returned malformed exact transaction evidence");
  }
  const record = value as { transaction?: unknown; meta?: { err?: unknown } | null };
  if (
    !Array.isArray(record.transaction)
    || typeof record.transaction[0] !== "string"
    || record.transaction[1] !== "base64"
    || !record.meta
    || !("err" in record.meta)
  ) {
    throw new Error("Solana RPC omitted exact transaction bytes or status");
  }
  const bytes = Buffer.from(record.transaction[0], "base64");
  if (!hasValidTransactionEnvelope(bytes)) {
    throw new Error("Solana RPC returned an invalid exact transaction envelope");
  }
  return { bytes, err: record.meta.err };
}

function fullySignedTransactionSignature(transaction: Uint8Array): string | null {
  const header = decodeShortVec(transaction);
  for (let index = 0; index < header.value; index += 1) {
    const start = header.length + index * 64;
    if (transaction.subarray(start, start + 64).every((byte) => byte === 0)) return null;
  }
  return base58.encode(transaction.subarray(header.length, header.length + 64));
}

function preparedTransactionEvidence(transaction: Uint8Array): {
  recentBlockhash: string;
  signedAddresses: string[];
  missingSignatureIndexes: number[];
} | null {
  try {
    const legacy = Transaction.from(transaction);
    if (!legacy.recentBlockhash) return null;
    return {
      recentBlockhash: legacy.recentBlockhash,
      signedAddresses: legacy.signatures.flatMap((item) =>
        item.signature && !item.signature.every((byte) => byte === 0)
          ? [item.publicKey.toBase58()]
          : []
      ),
      missingSignatureIndexes: legacy.signatures.flatMap((item, index) =>
        !item.signature || item.signature.every((byte) => byte === 0) ? [index] : []
      ),
    };
  } catch {
    try {
      const versioned = VersionedTransaction.deserialize(transaction);
      const signerAddresses = versioned.message.staticAccountKeys
        .slice(0, versioned.message.header.numRequiredSignatures)
        .map((key) => key.toBase58());
      return {
        recentBlockhash: versioned.message.recentBlockhash,
        signedAddresses: signerAddresses.filter((_, index) =>
          !versioned.signatures[index].every((byte) => byte === 0)
        ),
        missingSignatureIndexes: versioned.signatures.flatMap((signature, index) =>
          signature.every((byte) => byte === 0) ? [index] : []
        ),
      };
    } catch {
      return null;
    }
  }
}

function hasValidTransactionEnvelope(transaction: Uint8Array): boolean {
  try {
    const header = decodeShortVec(transaction);
    return header.value >= 1
      && header.value <= 64
      && header.length + header.value * 64 < transaction.length;
  } catch {
    return false;
  }
}

function equalPreparedTransaction(
  prepared: Uint8Array,
  candidate: Uint8Array,
  rpcSignature: string,
): boolean {
  try {
    const left = decodeShortVec(prepared);
    const right = decodeShortVec(candidate);
    if (left.value !== right.value || left.length !== right.length || prepared.length !== candidate.length) {
      return false;
    }
    const messageOffset = left.length + left.value * 64;
    if (!prepared.subarray(messageOffset).every((byte, index) => byte === candidate[messageOffset + index])) {
      return false;
    }
    for (let index = 0; index < left.value; index += 1) {
      const start = left.length + index * 64;
      const preparedSignature = prepared.subarray(start, start + 64);
      const candidateSignature = candidate.subarray(start, start + 64);
      if (preparedSignature.every((byte) => byte === 0)) {
        if (candidateSignature.every((byte) => byte === 0)) return false;
      } else if (!preparedSignature.every((byte, offset) => byte === candidateSignature[offset])) {
        return false;
      }
    }
    return base58.encode(candidate.subarray(right.length, right.length + 64)) === rpcSignature;
  } catch {
    return false;
  }
}

async function associatedTokenAddresses(asset: string, payTo: string): Promise<string[]> {
  const mint = address(asset);
  const owner = address(payTo);
  const programs = [TOKEN_PROGRAM_ADDRESS, TOKEN_2022_PROGRAM_ADDRESS];
  const destinations = await Promise.all(
    programs.map(async (tokenProgram) =>
      String((await findAssociatedTokenPda({ mint, owner, tokenProgram }))[0]),
    ),
  );
  return [...new Set(destinations)];
}

function reconciliationIdentity(
  settlementKind: ReconciliationAttempt["settlementKind"],
  quoteId: string,
) {
  if (settlementKind === "document") {
    return { kind: settlementKind, queryId: "reconciliation", handle: quoteId, key: quoteId } as const;
  }
  return { kind: settlementKind, quoteId, key: quoteId } as const;
}

function validateAttempt(
  attempt: ReconciliationAttempt,
  expectedNetwork: string,
  maxSignaturePages: number,
): void {
  const now = Date.now();
  if (!(["document", "bundle", "open_call"] as const).includes(attempt.settlementKind)) {
    throw new Error("reconciliation settlement kind is invalid");
  }
  if (
    attempt.quoteId !== attempt.quoteId.trim() ||
    attempt.quoteId.length < 1 ||
    attempt.quoteId.length > 160
  ) {
    throw new Error("reconciliation quote id is invalid");
  }
  if (!/^[0-9a-f]{64}$/.test(attempt.attemptId)) {
    throw new Error("reconciliation attempt id must be a SHA-256 digest");
  }
  if (!/^[1-9]\d*$/.test(attempt.amountAtomic)) {
    throw new Error("reconciliation amount must be a positive integer");
  }
  if (attempt.network !== expectedNetwork) {
    throw new Error("reconciliation attempt does not match the gateway network");
  }
  if (
    !Number.isSafeInteger(attempt.createdAt) ||
    attempt.createdAt <= 0 ||
    attempt.createdAt > now + RECOVERY_CLOCK_SKEW_MS ||
    !Number.isSafeInteger(attempt.reconcileAfter) ||
    attempt.reconcileAfter <= 0 ||
    attempt.reconcileAfter > now + RECOVERY_CLOCK_SKEW_MS ||
    (attempt.absenceObservedAt != null && (
      !Number.isSafeInteger(attempt.absenceObservedAt) ||
      attempt.absenceObservedAt < attempt.createdAt ||
      attempt.absenceObservedAt > now + RECOVERY_CLOCK_SKEW_MS
    ))
  ) {
    throw new Error("reconciliation timestamps must be positive safe integers");
  }
  if (!Number.isSafeInteger(maxSignaturePages) || maxSignaturePages < 1 || maxSignaturePages > 100) {
    throw new Error("reconciliation signature pages must be between 1 and 100");
  }
  address(attempt.asset);
  address(attempt.payTo);
}

function parseSignatureInfos(value: unknown): SignatureInfo[] {
  if (!Array.isArray(value)) throw new Error("Solana RPC returned invalid signature history");
  return value.map((item) => {
    if (!item || typeof item !== "object" || Array.isArray(item)) {
      throw new Error("Solana RPC returned a malformed signature entry");
    }
    const entry = item as Record<string, unknown>;
    if (typeof entry.signature !== "string") {
      throw new Error("Solana RPC returned a signature entry without a signature");
    }
    let decodedSignature: Uint8Array;
    try {
      decodedSignature = base58.decode(entry.signature);
    } catch {
      throw new Error("Solana RPC returned a malformed transaction signature");
    }
    if (decodedSignature.length !== 64) {
      throw new Error("Solana RPC returned a malformed transaction signature");
    }
    if (
      entry.blockTime !== null &&
      (!Number.isSafeInteger(entry.blockTime) || Number(entry.blockTime) <= 0)
    ) {
      throw new Error("Solana RPC returned a malformed signature block time");
    }
    if (!("err" in entry)) {
      throw new Error("Solana RPC returned a signature entry without status");
    }
    return {
      signature: entry.signature,
      blockTime: entry.blockTime as number | null,
      err: entry.err,
      memo: normalizeSignatureMemo(entry.memo),
    };
  });
}

function normalizeSignatureMemo(value: unknown): string | null {
  if (typeof value !== "string") return null;
  return value.replace(/^\[\d+\]\s*/, "");
}

function parseMatchingTransaction(
  value: unknown,
  expectedMemo: string,
  attempt: ReconciliationAttempt,
  destinations: string[],
): ParsedTransactionEvidence | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const result = value as Record<string, unknown>;
  if (!Number.isSafeInteger(result.slot) || Number(result.slot) <= 0) return null;
  if (
    result.blockTime !== null &&
    (!Number.isSafeInteger(result.blockTime) || Number(result.blockTime) <= 0)
  ) {
    return null;
  }
  const meta = objectValue(result.meta);
  if (!meta || meta.err !== null) return null;
  const transaction = objectValue(result.transaction);
  const message = objectValue(transaction?.message);
  const topLevel = Array.isArray(message?.instructions) ? message.instructions : [];
  const innerGroups = Array.isArray(meta.innerInstructions) ? meta.innerInstructions : [];
  const inner = innerGroups.flatMap((group) => {
    const record = objectValue(group);
    return Array.isArray(record?.instructions) ? record.instructions : [];
  });
  const instructions = [...topLevel, ...inner];
  const memo = instructions.map(parsedMemo).find((item) => item === expectedMemo);
  if (!memo) return null;
  const transfer = instructions
    .map(parsedTransfer)
    .find((candidate) =>
      candidate !== null &&
      destinations.includes(candidate.destination) &&
      candidate.mint === attempt.asset &&
      candidate.amountAtomic === attempt.amountAtomic,
    );
  if (!transfer) return null;
  return {
    slot: result.slot as number,
    blockTime: result.blockTime as number | null,
    memo,
    transfer,
  };
}

function parsedMemo(value: unknown): string | null {
  const instruction = objectValue(value);
  if (!instruction) return null;
  const isMemo = instruction.program === "spl-memo" || instruction.programId === MEMO_PROGRAM_ADDRESS;
  return isMemo && typeof instruction.parsed === "string" ? instruction.parsed : null;
}

function parsedTransfer(value: unknown): ParsedTransfer | null {
  const instruction = objectValue(value);
  const parsed = objectValue(instruction?.parsed);
  if (!instruction || !parsed || !["spl-token", "spl-token-2022"].includes(String(instruction.program))) {
    return null;
  }
  if (parsed.type !== "transferChecked") return null;
  const info = objectValue(parsed.info);
  const tokenAmount = objectValue(info?.tokenAmount);
  const amount = tokenAmount?.amount ?? info?.amount;
  if (
    typeof info?.authority !== "string" ||
    typeof info.destination !== "string" ||
    typeof info.mint !== "string" ||
    typeof amount !== "string"
  ) {
    return null;
  }
  try {
    address(info.authority);
  } catch {
    return null;
  }
  return {
    payer: info.authority,
    destination: info.destination,
    mint: info.mint,
    amountAtomic: amount,
  };
}

function parseBase64Transaction(value: unknown, expectedSignature: string): string | null {
  const result = objectValue(value);
  if (!result || objectValue(result.meta)?.err !== null || !Array.isArray(result.transaction)) {
    return null;
  }
  const [encoded, encoding] = result.transaction;
  if (typeof encoded !== "string" || encoding !== "base64") return null;
  const bytes = Buffer.from(encoded, "base64");
  const { value: signatureCount, length: prefixLength } = decodeShortVec(bytes);
  if (signatureCount < 1 || prefixLength + 64 > bytes.length) return null;
  const firstSignature = bytes.subarray(prefixLength, prefixLength + 64);
  return base58.encode(firstSignature) === expectedSignature ? encoded : null;
}

function decodeShortVec(bytes: Uint8Array): { value: number; length: number } {
  let value = 0;
  let shift = 0;
  for (let index = 0; index < Math.min(bytes.length, 3); index += 1) {
    const byte = bytes[index];
    value |= (byte & 0x7f) << shift;
    if ((byte & 0x80) === 0) return { value, length: index + 1 };
    shift += 7;
  }
  throw new Error("transaction signature count is not a valid short vector");
}

function objectValue(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown>
    : null;
}
