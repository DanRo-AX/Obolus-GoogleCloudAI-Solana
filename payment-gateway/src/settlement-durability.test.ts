import assert from "node:assert/strict";
import test from "node:test";
import { persistSettlementDurably } from "./settlement-durability.js";

test("a queue-owned payment is evicted even while the ledger is blackholed", async () => {
  const pending = new Map([["paid-signature", { quoteId: "quote-1" }]]);
  let enqueueCalls = 0;
  let ledgerCalls = 0;

  const result = await persistSettlementDurably({
    enqueue: async () => {
      enqueueCalls += 1;
    },
    record: async () => {
      ledgerCalls += 1;
      throw new Error("ledger connection timed out");
    },
    releaseVolatileCopy: () => {
      pending.delete("paid-signature");
    },
  });

  assert.deepEqual(
    { queued: result.queued, ledgered: result.ledgered },
    { queued: true, ledgered: false },
  );
  assert.equal(enqueueCalls, 1);
  assert.equal(ledgerCalls, 1);
  assert.equal(pending.size, 0);
  assert.match(String(result.ledgerError), /timed out/);
});

test("a payment stays in memory when every durable sink rejects it", async () => {
  const pending = new Map([["paid-signature", { quoteId: "quote-1" }]]);

  await assert.rejects(
    persistSettlementDurably({
      enqueue: async () => {
        throw new Error("queue unavailable");
      },
      record: async () => {
        throw new Error("ledger unavailable");
      },
      releaseVolatileCopy: () => {
        pending.delete("paid-signature");
      },
    }),
    (error: unknown) => {
      assert.ok(error instanceof AggregateError);
      assert.match(error.message, /not yet durable/);
      assert.deepEqual(
        error.errors.map(String),
        ["Error: queue unavailable", "Error: ledger unavailable"],
      );
      return true;
    },
  );

  assert.equal(pending.size, 1);
});

test("a direct ledger commit releases the payment exactly once without a queue", async () => {
  let releases = 0;

  const result = await persistSettlementDurably({
    record: async () => undefined,
    releaseVolatileCopy: () => {
      releases += 1;
    },
  });

  assert.deepEqual(
    { queued: result.queued, ledgered: result.ledgered },
    { queued: false, ledgered: true },
  );
  assert.equal(releases, 1);
});
