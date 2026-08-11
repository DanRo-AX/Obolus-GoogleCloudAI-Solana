import assert from "node:assert/strict";
import test from "node:test";
import { reconcilerReadiness } from "./reconciler-readiness.js";

test("readiness refuses a missing, failed, stale, or impossible reconciliation cycle", () => {
  assert.deepEqual(reconcilerReadiness({
    nowMonotonicMs: 10_000,
    lastCompletedMonotonicMs: null,
    lastError: null,
    intervalMs: 30_000,
  }), {
    ready: false,
    reason: "chain reconciler has not completed its initial scan",
  });
  assert.equal(reconcilerReadiness({
    nowMonotonicMs: 10_000,
    lastCompletedMonotonicMs: 9_000,
    lastError: "ledger protocol mismatch",
    intervalMs: 30_000,
  }).ready, false);
  assert.equal(reconcilerReadiness({
    nowMonotonicMs: 200_000,
    lastCompletedMonotonicMs: 100_000,
    lastError: null,
    intervalMs: 30_000,
  }).ready, false);
  assert.equal(reconcilerReadiness({
    nowMonotonicMs: 10_000,
    lastCompletedMonotonicMs: 11_000,
    lastError: null,
    intervalMs: 30_000,
  }).ready, false);
  assert.deepEqual(reconcilerReadiness({
    nowMonotonicMs: 10_000,
    lastCompletedMonotonicMs: 9_000,
    lastError: null,
    intervalMs: 30_000,
  }), { ready: true });
});

test("readiness rejects every non-finite or negative monotonic timestamp", () => {
  for (const [nowMonotonicMs, lastCompletedMonotonicMs] of [
    [Number.NaN, 9_000],
    [Number.POSITIVE_INFINITY, 9_000],
    [10_000, Number.NaN],
    [10_000, Number.POSITIVE_INFINITY],
    [10_000, -1],
  ]) {
    assert.deepEqual(reconcilerReadiness({
      nowMonotonicMs,
      lastCompletedMonotonicMs,
      lastError: null,
      intervalMs: 30_000,
    }), {
      ready: false,
      reason: "chain reconciler monotonic timestamp is invalid",
    });
  }
});

test("readiness freshness uses a positive integer interval and its exact boundary", () => {
  assert.deepEqual(reconcilerReadiness({
    nowMonotonicMs: 60_000,
    lastCompletedMonotonicMs: 0,
    lastError: null,
    intervalMs: 30_000,
  }), { ready: true });

  assert.deepEqual(reconcilerReadiness({
    nowMonotonicMs: 100_000,
    lastCompletedMonotonicMs: 100_000,
    lastError: null,
    intervalMs: 40_000,
  }), { ready: true });

  assert.deepEqual(reconcilerReadiness({
    nowMonotonicMs: 220_000,
    lastCompletedMonotonicMs: 100_000,
    lastError: null,
    intervalMs: 40_000,
  }), { ready: true });

  assert.deepEqual(reconcilerReadiness({
    nowMonotonicMs: 200_000,
    lastCompletedMonotonicMs: 100_000,
    lastError: null,
    intervalMs: 40_000,
  }), { ready: true });

  assert.deepEqual(reconcilerReadiness({
    nowMonotonicMs: 170_000,
    lastCompletedMonotonicMs: 100_000,
    lastError: null,
    intervalMs: 0,
  }), { ready: true });

  assert.equal(reconcilerReadiness({
    nowMonotonicMs: 200_000,
    lastCompletedMonotonicMs: 100_000,
    lastError: null,
    intervalMs: 200_000.5,
  }).ready, false);
});
