import assert from "node:assert/strict";
import test from "node:test";
import { base58 } from "@scure/base";
import {
  Keypair,
  SystemProgram,
  Transaction,
  TransactionMessage,
  VersionedTransaction,
} from "@solana/web3.js";
import {
  completePayShReceiptTransaction,
  waitForIndependentPayShFinality,
} from "./pay-sh-finality.js";

function receiptFixture() {
  const feePayer = Keypair.generate();
  const payer = Keypair.generate();
  const recipient = Keypair.generate();
  const transaction = new Transaction({
    feePayer: feePayer.publicKey,
    recentBlockhash: Keypair.generate().publicKey.toBase58(),
  }).add(SystemProgram.transfer({
    fromPubkey: payer.publicKey,
    toPubkey: recipient.publicKey,
    lamports: 1,
  }));
  transaction.partialSign(payer);
  const prepared = transaction.serialize({
    requireAllSignatures: false,
    verifySignatures: false,
  }).toString("base64");
  transaction.partialSign(feePayer);
  const signature = transaction.signatures[0]?.signature;
  assert.ok(signature);
  const reference = base58.encode(signature);
  const evidence = completePayShReceiptTransaction(prepared, reference);
  assert.ok(evidence);
  return { evidence, reference };
}

test("Pay.sh finality reconstructs the exact fee-payer-completed transaction", () => {
  const { evidence, reference } = receiptFixture();
  assert.equal(evidence.transactionSignature, reference);
  const decoded = Transaction.from(Buffer.from(evidence.finalizedTransactionBase64, "base64"));
  assert.equal(base58.encode(decoded.signatures[0]!.signature!), reference);
  assert.equal(decoded.verifySignatures(), true);
});

test("Pay.sh finality reconstructs the exact versioned transaction bytes", () => {
  const feePayer = Keypair.generate();
  const payer = Keypair.generate();
  const recipient = Keypair.generate();
  const transaction = new VersionedTransaction(new TransactionMessage({
    payerKey: feePayer.publicKey,
    recentBlockhash: Keypair.generate().publicKey.toBase58(),
    instructions: [SystemProgram.transfer({
      fromPubkey: payer.publicKey,
      toPubkey: recipient.publicKey,
      lamports: 1,
    })],
  }).compileToV0Message());
  transaction.sign([payer]);
  const prepared = Buffer.from(transaction.serialize()).toString("base64");
  transaction.sign([feePayer]);
  const reference = base58.encode(transaction.signatures[0]!);

  const evidence = completePayShReceiptTransaction(prepared, reference);
  assert.ok(evidence);
  assert.equal(
    evidence.finalizedTransactionBase64,
    Buffer.from(transaction.serialize()).toString("base64"),
  );
});

test("every configured Pay.sh RPC must reproduce the exact finalized bytes", async () => {
  const { evidence } = receiptFixture();
  let calls = 0;
  const exact = async () => {
    calls += 1;
    return {
      transaction: [evidence.finalizedTransactionBase64, "base64"],
      meta: { err: null },
    };
  };
  assert.equal(await waitForIndependentPayShFinality({
    evidence,
    rpcs: [exact, exact],
    minimumViews: 2,
    timeoutMs: 100,
    pollIntervalMs: 50,
  }), true);
  assert.equal(calls, 2);
});

test("a missing, failed, or byte-different Pay.sh view keeps content buffered", async () => {
  const { evidence } = receiptFixture();
  const exact = async () => ({
    transaction: [evidence.finalizedTransactionBase64, "base64"],
    meta: { err: null },
  });
  const unsafeViews = [
    async () => null,
    async () => ({
      transaction: [evidence.finalizedTransactionBase64, "base64"],
      meta: { err: { InstructionError: [0, "Custom"] } },
    }),
    async () => ({
      transaction: [Buffer.from("different transaction").toString("base64"), "base64"],
      meta: { err: null },
    }),
  ];
  for (const unsafe of unsafeViews) {
    let clock = 0;
    assert.equal(await waitForIndependentPayShFinality({
      evidence,
      rpcs: [exact, unsafe],
      minimumViews: 2,
      timeoutMs: 100,
      pollIntervalMs: 50,
      nowMs: () => clock,
      sleep: async (delay) => { clock += delay; },
    }), false);
  }
});

test("a success-shaped receipt cannot lower the required independent view count", async () => {
  const { evidence } = receiptFixture();
  const exact = async () => ({
    transaction: [evidence.finalizedTransactionBase64, "base64"],
    meta: { err: null },
  });
  assert.equal(await waitForIndependentPayShFinality({
    evidence,
    rpcs: [exact],
    minimumViews: 2,
    timeoutMs: 100,
    pollIntervalMs: 50,
  }), false);
});
