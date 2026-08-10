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
