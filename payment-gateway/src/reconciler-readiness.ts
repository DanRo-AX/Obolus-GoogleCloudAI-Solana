export type ReconcilerReadiness = {
  ready: boolean;
  reason?: string;
};

/**
 * A gateway is not safe to receive new payments unless its lost-response
 * recovery loop has completed recently. Inputs are monotonic milliseconds;
 * wall-clock changes must not make a dead reconciler appear fresh forever.
 */
export function reconcilerReadiness(options: {
  nowMonotonicMs: number;
  lastCompletedMonotonicMs: number | null;
  lastError: string | null;
  intervalMs: number;
}): ReconcilerReadiness {
  if (options.lastError) {
    return { ready: false, reason: `chain reconciler failed: ${options.lastError}` };
  }
  if (options.lastCompletedMonotonicMs === null) {
    return { ready: false, reason: "chain reconciler has not completed its initial scan" };
  }
  if (
    !Number.isFinite(options.nowMonotonicMs)
    || !Number.isFinite(options.lastCompletedMonotonicMs)
    || options.lastCompletedMonotonicMs < 0
    || options.lastCompletedMonotonicMs > options.nowMonotonicMs
  ) {
    return { ready: false, reason: "chain reconciler monotonic timestamp is invalid" };
  }
  const intervalMs = Number.isSafeInteger(options.intervalMs) && options.intervalMs > 0
    ? Math.min(options.intervalMs, 5 * 60_000)
    : 30_000;
  const maximumAgeMs = Math.max(3 * intervalMs, 60_000);
  if (options.nowMonotonicMs - options.lastCompletedMonotonicMs > maximumAgeMs) {
    return { ready: false, reason: "chain reconciler has not completed a recent scan" };
  }
  return { ready: true };
}
