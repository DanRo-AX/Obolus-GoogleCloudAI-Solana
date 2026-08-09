export type BackgroundCycleState = {
  lastCompletedMonotonicMs: number | null;
  lastError: string | null;
};

export function newBackgroundCycleState(): BackgroundCycleState {
  return { lastCompletedMonotonicMs: null, lastError: null };
}

export function completeBackgroundCycle(
  state: BackgroundCycleState,
  nowMonotonicMs: number,
): void {
  state.lastCompletedMonotonicMs = nowMonotonicMs;
  state.lastError = null;
}

export function failBackgroundCycle(state: BackgroundCycleState, error: unknown): void {
  state.lastError = error instanceof Error ? error.message : String(error);
}

export function backgroundCycleIssue(options: {
  name: string;
  state: BackgroundCycleState;
  nowMonotonicMs: number;
  intervalMs: number;
}): string | null {
  if (options.state.lastError) return `${options.name} failed: ${options.state.lastError}`;
  const completed = options.state.lastCompletedMonotonicMs;
  if (completed === null) return `${options.name} has not completed its initial cycle`;
  if (
    !Number.isFinite(options.nowMonotonicMs)
    || !Number.isFinite(completed)
    || completed < 0
    || completed > options.nowMonotonicMs
  ) return `${options.name} has an invalid monotonic timestamp`;
  const intervalMs = Number.isSafeInteger(options.intervalMs) && options.intervalMs > 0
    ? Math.min(options.intervalMs, 5 * 60_000)
    : 30_000;
  if (options.nowMonotonicMs - completed > Math.max(3 * intervalMs, 60_000)) {
    return `${options.name} has not completed a recent cycle`;
  }
  return null;
}
