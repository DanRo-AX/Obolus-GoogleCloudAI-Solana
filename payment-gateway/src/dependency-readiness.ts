export async function requireReadyDependency(options: {
  name: string;
  origin: string;
  fetchImpl?: typeof globalThis.fetch;
  timeoutMs?: number;
}): Promise<void> {
  const fetchImpl = options.fetchImpl ?? globalThis.fetch;
  const timeoutMs = options.timeoutMs ?? 5_000;
  const response = await fetchImpl(`${options.origin}/readyz`, {
    redirect: "error",
    signal: AbortSignal.timeout(timeoutMs),
    headers: { accept: "application/json" },
  });
  await response.body?.cancel().catch(() => undefined);
  if (!response.ok) {
    throw new Error(`${options.name} is not ready (HTTP ${response.status})`);
  }
}

export function createReadyDependencyGuard(options: {
  name: string;
  origin: string;
  fetchImpl?: typeof globalThis.fetch;
  timeoutMs?: number;
  successTtlMs?: number;
  failureTtlMs?: number;
  now?: () => number;
}): () => Promise<void> {
  const successTtlMs = options.successTtlMs ?? 1_000;
  const failureTtlMs = options.failureTtlMs ?? 250;
  if (
    !Number.isSafeInteger(successTtlMs)
    || successTtlMs < 0
    || successTtlMs > 5_000
    || !Number.isSafeInteger(failureTtlMs)
    || failureTtlMs < 0
    || failureTtlMs > 5_000
  ) {
    throw new Error("dependency readiness cache TTLs must be between 0 and 5000ms");
  }
  const now = options.now ?? (() => performance.now());
  let readyUntil = Number.NEGATIVE_INFINITY;
  let failedUntil = Number.NEGATIVE_INFINITY;
  let lastFailure: unknown;
  let inFlight: Promise<void> | null = null;

  return async () => {
    const current = now();
    if (current < readyUntil) return;
    if (current < failedUntil) throw lastFailure;
    if (inFlight) return inFlight;
    inFlight = requireReadyDependency(options)
      .then(() => {
        readyUntil = now() + successTtlMs;
        failedUntil = Number.NEGATIVE_INFINITY;
        lastFailure = undefined;
      })
      .catch((error: unknown) => {
        failedUntil = now() + failureTtlMs;
        lastFailure = error;
        throw error;
      })
      .finally(() => {
        inFlight = null;
      });
    return inFlight;
  };
}
