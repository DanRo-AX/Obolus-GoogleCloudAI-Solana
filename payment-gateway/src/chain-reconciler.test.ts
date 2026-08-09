import assert from "node:assert/strict";
import test from "node:test";
import { createHash } from "node:crypto";
import { base58 } from "@scure/base";
import { findAssociatedTokenPda, TOKEN_PROGRAM_ADDRESS } from "@solana-program/token";
import { address } from "@solana/kit";
import {
  ComputeBudgetProgram,
  Keypair,
  PublicKey,
  TransactionInstruction,
  TransactionMessage,
  VersionedTransaction,
} from "@solana/web3.js";
import {
  findFinalizedChainSettlement,
  findUnanimousFinalizedChainSettlement,
  exactAbsenceDecision,
  exactSettlementSignature,
  paymentAttemptIdFromSettledTransaction,
  scanExactFinalizedChainAttempt,
  verifyExactFinalizedSettlementSignature,
  type ReconciliationAttempt,
  type SolanaRpc,
} from "./chain-reconciler.js";

const asset = "4zMMC9srt5Ri5X14GAgXhaHii3GnPAEERYPJgZJDncDU";
const payTo = base58.encode(Uint8Array.from({ length: 32 }, (_, index) => index + 1));
const payerKeypair = Keypair.fromSeed(Uint8Array.from({ length: 32 }, (_, index) => 200 - index));
const payer = payerKeypair.publicKey.toBase58();
const mint = new PublicKey(asset);
const tokenProgram = new PublicKey("TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA");
const associatedTokenProgram = new PublicKey("ATokenGPvbdGVxr1b2hvZbsiqW5xWH25efTNsLJA8knL");
const memoProgram = new PublicKey("MemoSq4gqABAXKb96qnH8TysNcWxMyWCqXgDLGmfcHr");
const redirectedRecipient = Keypair.fromSeed(
  Uint8Array.from({ length: 32 }, (_, index) => index + 80),
).publicKey;

function transactionPair(
  quoteId = "quote_exact_recovery",
  destinationOwner = new PublicKey(payTo),
  priorityFeeMicroLamports?: bigint,
) {
  const facilitator = Keypair.fromSeed(Uint8Array.from({ length: 32 }, (_, index) => index + 1));
  const message = new TransactionMessage({
    payerKey: facilitator.publicKey,
    recentBlockhash: payTo,
    instructions: [
      ...(priorityFeeMicroLamports === undefined
        ? []
        : [ComputeBudgetProgram.setComputeUnitPrice({ microLamports: priorityFeeMicroLamports })]),
      transferChecked(payerKeypair.publicKey, destinationOwner, 7_408n),
      new TransactionInstruction({
        programId: memoProgram,
        keys: [],
        data: Buffer.from(`openshelf:v1:document:${quoteId}`),
      }),
    ],
  }).compileToV0Message();
  const partialTransaction = new VersionedTransaction(message);
  partialTransaction.sign([payerKeypair]);
  const partial = Buffer.from(partialTransaction.serialize());
  const settledTransaction = VersionedTransaction.deserialize(partial);
  settledTransaction.sign([facilitator]);
  const settled = Buffer.from(settledTransaction.serialize());
  return {
    partialBase64: partial.toString("base64"),
    settledBase64: settled.toString("base64"),
    signature: base58.encode(settledTransaction.signatures[0]),
  };
}

function transferChecked(
  authority: PublicKey,
  recipient: PublicKey,
  amount: bigint,
): TransactionInstruction {
  const data = Buffer.alloc(10);
  data[0] = 12;
  data.writeBigUInt64LE(amount, 1);
  data[9] = 6;
  return new TransactionInstruction({
    programId: tokenProgram,
    keys: [
      { pubkey: associatedTokenAddress(authority), isSigner: false, isWritable: true },
      { pubkey: mint, isSigner: false, isWritable: false },
      { pubkey: associatedTokenAddress(recipient), isSigner: false, isWritable: true },
      { pubkey: authority, isSigner: true, isWritable: false },
    ],
    data,
  });
}

function associatedTokenAddress(owner: PublicKey): PublicKey {
  return PublicKey.findProgramAddressSync(
    [owner.toBuffer(), tokenProgram.toBuffer(), mint.toBuffer()],
    associatedTokenProgram,
  )[0];
}

test("a finalized transaction reconstructs the exact pre-settlement attempt id", () => {
  const pair = transactionPair();
  const expected = createHash("sha256").update(pair.partialBase64).digest("hex");
  assert.equal(paymentAttemptIdFromSettledTransaction(pair.settledBase64), expected);

  const changed = Buffer.from(pair.settledBase64, "base64");
  changed[70] ^= 1;
  assert.notEqual(paymentAttemptIdFromSettledTransaction(changed.toString("base64")), expected);
});

test("exact x402 recovery survives a validator clock that is one hour behind", async () => {
  const pair = transactionPair();
  const attempt: ReconciliationAttempt = {
    settlementKind: "document",
    quoteId: "quote_exact_recovery",
    attemptId: createHash("sha256").update(pair.partialBase64).digest("hex"),
    reconcileAfter: Date.now() - 1,
    createdAt: Date.now() - 60_000,
    payTo,
    payer,
    network: "solana:EtWTRABZaYq6iMfeYKouRu166VU2xqa1",
    asset,
    amountAtomic: "7408",
    signedTransactionBase64: pair.partialBase64,
    recentBlockhash: payTo,
  };
  const settledRpc: SolanaRpc = async (method) => method === "getSignaturesForAddress"
    ? [{
        signature: pair.signature,
        blockTime: Math.floor(Date.now() / 1_000) - 3_600,
        err: null,
        memo: null,
      }]
    : { meta: { err: null }, transaction: [pair.settledBase64, "base64"] };
  assert.deepEqual(
    await scanExactFinalizedChainAttempt(attempt, settledRpc, 1),
    { kind: "settled", signature: pair.signature },
  );

  const incompleteRpc: SolanaRpc = async (method) => method === "getSignaturesForAddress"
    ? [{ signature: pair.signature, blockTime: Math.floor(Date.now() / 1_000), err: null, memo: null }]
    : null;
  assert.deepEqual(
    await scanExactFinalizedChainAttempt(attempt, incompleteRpc, 1),
    { kind: "inconclusive" },
  );
});

test("response release verifies the facilitator signature against exact finalized bytes", async () => {
  const pair = transactionPair("quote_response_release");
  const attempt: ReconciliationAttempt = {
    settlementKind: "document",
    quoteId: "quote_response_release",
    attemptId: createHash("sha256").update(pair.partialBase64).digest("hex"),
    reconcileAfter: Date.now() + 30_000,
    createdAt: Date.now() - 1_000,
    payTo,
    payer,
    network: "solana:EtWTRABZaYq6iMfeYKouRu166VU2xqa1",
    asset,
    amountAtomic: "7408",
    signedTransactionBase64: pair.partialBase64,
    recentBlockhash: payTo,
  };
  const finalizedRpc: SolanaRpc = async () => ({
    meta: { err: null },
    transaction: [pair.settledBase64, "base64"],
  });
  assert.deepEqual(
    await verifyExactFinalizedSettlementSignature(
      attempt,
      pair.signature,
      finalizedRpc,
      attempt.network,
    ),
    { kind: "settled", signature: pair.signature },
  );

  const missingRpc: SolanaRpc = async () => null;
  assert.deepEqual(
    await verifyExactFinalizedSettlementSignature(
      attempt,
      pair.signature,
      missingRpc,
      attempt.network,
    ),
    { kind: "absent" },
  );

  const different = transactionPair("quote_response_release_different");
  const lyingRpc: SolanaRpc = async () => ({
    meta: { err: null },
    transaction: [different.settledBase64, "base64"],
  });
  assert.deepEqual(
    await verifyExactFinalizedSettlementSignature(
      attempt,
      pair.signature,
      lyingRpc,
      attempt.network,
    ),
    { kind: "inconclusive" },
  );
});

test("x402 release needs two complete expired-blockhash views and a later second pass", () => {
  assert.equal(exactAbsenceDecision([{ kind: "absent" }], [false]), "defer");
  assert.equal(
    exactAbsenceDecision([{ kind: "absent" }, { kind: "inconclusive" }], [false, false]),
    "defer",
  );
  const absent = [{ kind: "absent" }, { kind: "failed", signature: "1".repeat(64) }] as const;
  assert.equal(exactAbsenceDecision([...absent], [false, true]), "defer");
  assert.equal(exactAbsenceDecision([...absent], [false, false]), "observe");
  assert.equal(exactAbsenceDecision([...absent], [false, false], Date.now() - 1), "release");
});

test("one lying or stale RPC cannot fabricate an x402 settlement", () => {
  const first = "1".repeat(64);
  const second = "2".repeat(64);
  assert.equal(exactSettlementSignature([{ kind: "settled", signature: first }]), null);
  assert.equal(
    exactSettlementSignature([{ kind: "settled", signature: first }, { kind: "absent" }]),
    null,
  );
  assert.equal(
    exactSettlementSignature([
      { kind: "settled", signature: first },
      { kind: "settled", signature: second },
    ]),
    null,
  );
  assert.equal(
    exactSettlementSignature([
      { kind: "settled", signature: first },
      { kind: "settled", signature: first },
    ]),
    first,
  );
});

test("a partial x402 payload with an unexpected missing signer is never auto-released", async () => {
  const pair = transactionPair("quote_missing_signer");
  const malformed = VersionedTransaction.deserialize(Buffer.from(pair.partialBase64, "base64"));
  malformed.signatures[1].fill(0);
  const malformedBase64 = Buffer.from(malformed.serialize()).toString("base64");
  const attempt: ReconciliationAttempt = {
    settlementKind: "document",
    quoteId: "quote_missing_signer",
    attemptId: createHash("sha256").update(malformedBase64).digest("hex"),
    reconcileAfter: Date.now() - 1,
    createdAt: Date.now() - 60_000,
    payTo,
    payer,
    network: "solana:EtWTRABZaYq6iMfeYKouRu166VU2xqa1",
    asset,
    amountAtomic: "7408",
    signedTransactionBase64: malformedBase64,
    recentBlockhash: payTo,
  };
  let rpcCalls = 0;
  const rpc: SolanaRpc = async () => {
    rpcCalls += 1;
    return [];
  };
  assert.deepEqual(await scanExactFinalizedChainAttempt(attempt, rpc, 1), {
    kind: "inconclusive",
  });
  assert.equal(rpcCalls, 0);
});

test("a signed x402 USDC transfer redirected from the quote recipient is never recovered", async () => {
  const pair = transactionPair("quote_redirected", redirectedRecipient);
  const attempt: ReconciliationAttempt = {
    settlementKind: "document",
    quoteId: "quote_redirected",
    attemptId: createHash("sha256").update(pair.partialBase64).digest("hex"),
    reconcileAfter: Date.now() - 1,
    createdAt: Date.now() - 60_000,
    payTo,
    payer,
    network: "solana:EtWTRABZaYq6iMfeYKouRu166VU2xqa1",
    asset,
    amountAtomic: "7408",
    signedTransactionBase64: pair.partialBase64,
    recentBlockhash: payTo,
  };
  let rpcCalls = 0;
  const rpc: SolanaRpc = async () => {
    rpcCalls += 1;
    throw new Error("misdirected transfer must fail before RPC");
  };
  assert.deepEqual(await scanExactFinalizedChainAttempt(attempt, rpc, 1), {
    kind: "inconclusive",
  });
  assert.equal(rpcCalls, 0);
});

test("an x402 buyer cannot plant an excessive facilitator-paid priority fee", async () => {
  const pair = transactionPair("quote_excessive_fee", new PublicKey(payTo), 10_001n);
  const attempt: ReconciliationAttempt = {
    settlementKind: "document",
    quoteId: "quote_excessive_fee",
    attemptId: createHash("sha256").update(pair.partialBase64).digest("hex"),
    reconcileAfter: Date.now() - 1,
    createdAt: Date.now() - 60_000,
    payTo,
    payer,
    network: "solana:EtWTRABZaYq6iMfeYKouRu166VU2xqa1",
    asset,
    amountAtomic: "7408",
    signedTransactionBase64: pair.partialBase64,
    recentBlockhash: payTo,
  };
  let rpcCalls = 0;
  const rpc: SolanaRpc = async () => {
    rpcCalls += 1;
    throw new Error("excessive service fee must fail before RPC");
  };
  assert.deepEqual(await scanExactFinalizedChainAttempt(attempt, rpc, 1), {
    kind: "inconclusive",
  });
  assert.equal(rpcCalls, 0);
});

test("legacy recovery verifies exact evidence despite a validator clock one hour behind", async () => {
  const pair = transactionPair();
  const attempt: ReconciliationAttempt = {
    settlementKind: "document",
    quoteId: "quote_recovery_1",
    attemptId: createHash("sha256").update(pair.partialBase64).digest("hex"),
    reconcileAfter: Date.now() - 1,
    createdAt: Date.now() - 60_000,
    payTo,
    network: "solana:EtWTRABZaYq6iMfeYKouRu166VU2xqa1",
    asset,
    amountAtomic: "7408",
  };
  const [destination] = await findAssociatedTokenPda({
    mint: address(asset),
    owner: address(payTo),
    tokenProgram: TOKEN_PROGRAM_ADDRESS,
  });
  const rpc: SolanaRpc = async (method, params) => {
    if (method === "getSignaturesForAddress") {
      return params[0] === String(destination)
        ? [{
            signature: pair.signature,
            blockTime: Math.floor(Date.now() / 1_000) - 3_600,
            err: null,
            memo: `[43] openshelf:v1:document:${attempt.quoteId}`,
          }]
        : [];
    }
    if (method === "getTransaction") {
      const config = params[1] as { encoding: string };
      if (config.encoding === "base64") {
        return { meta: { err: null }, transaction: [pair.settledBase64, "base64"] };
      }
      return {
        slot: 42,
        blockTime: 1_700_000_000,
        meta: { err: null, innerInstructions: [] },
        transaction: {
          message: {
            instructions: [
              {
                program: "spl-token",
                parsed: {
                  type: "transferChecked",
                  info: {
                    authority: payer,
                    destination: String(destination),
                    mint: asset,
                    tokenAmount: { amount: attempt.amountAtomic },
                  },
                },
              },
              {
                program: "spl-memo",
                programId: "MemoSq4gqABAXKb96qnH8TysNcWxMyWCqXgDLGmfcHr",
                parsed: `openshelf:v1:document:${attempt.quoteId}`,
              },
            ],
          },
        },
      };
    }
    throw new Error(`unexpected RPC method ${method}`);
  };

  const settlement = await findFinalizedChainSettlement(attempt, rpc, attempt.network, 1);
  assert.ok(settlement);
  assert.equal(settlement.transactionSignature, pair.signature);
  assert.equal(settlement.payer, payer);
  assert.equal(settlement.attemptId, attempt.attemptId);
  assert.equal(settlement.amountAtomic, attempt.amountAtomic);
  assert.equal(
    (
      await findUnanimousFinalizedChainSettlement(
        attempt,
        [rpc, rpc],
        attempt.network,
        1,
      )
    )?.transactionSignature,
    pair.signature,
  );
  const omittedRpc: SolanaRpc = async (method) =>
    method === "getSignaturesForAddress" ? [] : null;
  assert.equal(
    await findUnanimousFinalizedChainSettlement(
      attempt,
      [rpc, omittedRpc],
      attempt.network,
      1,
    ),
    null,
  );
});

test("a matching memo cannot recover a different payment attempt", async () => {
  const pair = transactionPair();
  const attempt: ReconciliationAttempt = {
    settlementKind: "open_call",
    quoteId: "quote_recovery_2",
    attemptId: "f".repeat(64),
    reconcileAfter: Date.now() - 1,
    createdAt: Date.now() - 600_000,
    payTo,
    network: "solana:EtWTRABZaYq6iMfeYKouRu166VU2xqa1",
    asset,
    amountAtomic: "10000",
  };
  const [destination] = await findAssociatedTokenPda({
    mint: address(asset),
    owner: address(payTo),
    tokenProgram: TOKEN_PROGRAM_ADDRESS,
  });
  const rpc: SolanaRpc = async (method, params) => {
    if (method === "getSignaturesForAddress") {
      return params[0] === String(destination)
        ? [{
            signature: pair.signature,
            blockTime: Math.floor(Date.now() / 1_000),
            err: null,
            memo: `[44] openshelf:v1:open_call:${attempt.quoteId}`,
          }]
        : [];
    }
    const config = params[1] as { encoding: string };
    if (config.encoding === "base64") {
      return { meta: { err: null }, transaction: [pair.settledBase64, "base64"] };
    }
    return {
      slot: 43,
      blockTime: 1_700_000_001,
      meta: { err: null, innerInstructions: [] },
      transaction: {
        message: {
          instructions: [
            {
              program: "spl-token",
              parsed: {
                type: "transferChecked",
                info: {
                  authority: payer,
                  destination: String(destination),
                  mint: asset,
                  tokenAmount: { amount: attempt.amountAtomic },
                },
              },
            },
            {
              program: "spl-memo",
              parsed: `openshelf:v1:open_call:${attempt.quoteId}`,
            },
          ],
        },
      },
    };
  };

  assert.equal(await findFinalizedChainSettlement(attempt, rpc, attempt.network, 1), null);
});

test("malformed durable attempts fail closed before any RPC scan", async () => {
  const base: ReconciliationAttempt = {
    settlementKind: "document",
    quoteId: "quote_validation",
    attemptId: "a".repeat(64),
    reconcileAfter: Date.now() - 1,
    createdAt: Date.now() - 60_000,
    payTo,
    network: "solana:EtWTRABZaYq6iMfeYKouRu166VU2xqa1",
    asset,
    amountAtomic: "1",
  };
  let rpcCalls = 0;
  const rpc: SolanaRpc = async () => {
    rpcCalls += 1;
    return [];
  };
  const invalid = [
    { ...base, settlementKind: "unknown" as ReconciliationAttempt["settlementKind"] },
    { ...base, quoteId: " quote_validation" },
    { ...base, attemptId: "A".repeat(64) },
    { ...base, amountAtomic: "01" },
    { ...base, network: "solana:wrong-network" },
    { ...base, createdAt: Number.NaN },
    { ...base, createdAt: Date.now() + 24 * 60 * 60_000 },
    { ...base, absenceObservedAt: base.createdAt - 1 },
  ];
  for (const attempt of invalid) {
    await assert.rejects(
      findFinalizedChainSettlement(attempt, rpc, base.network, 1),
    );
  }
  await assert.rejects(findFinalizedChainSettlement(base, rpc, base.network, 0));
  assert.equal(rpcCalls, 0);
});
