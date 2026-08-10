export type SettlementDurabilityResult = {
  queued: boolean;
  ledgered: boolean;
  queueError?: unknown;
  ledgerError?: unknown;
};

type SettlementDurabilityOptions = {
  enqueue?: () => Promise<void>;
  record: () => Promise<void>;
  releaseVolatileCopy: () => void;
};

/**
 * Give a settlement to every configured durable sink, while retaining the
 * process-local copy only until the first sink has accepted responsibility.
 *
 * The queue and ledger deliberately race at the system level and are both
 * idempotent by transaction signature. A queue acknowledgement is therefore
 * enough to stop retaining the same paid settlement in an unbounded Map while
 * the ledger is unavailable.
 */
export async function persistSettlementDurably(
  options: SettlementDurabilityOptions,
): Promise<SettlementDurabilityResult> {
  let released = false;
  const releaseOnce = () => {
    if (released) return;
    released = true;
    options.releaseVolatileCopy();
  };

  let queued = false;
  let ledgered = false;
  let queueError: unknown;
  let ledgerError: unknown;

  if (options.enqueue) {
    try {
      await options.enqueue();
      queued = true;
      releaseOnce();
    } catch (error) {
      queueError = error;
    }
  }

  try {
    await options.record();
    ledgered = true;
    releaseOnce();
  } catch (error) {
    ledgerError = error;
  }

  if (!queued && !ledgered) {
    throw new AggregateError(
      [queueError, ledgerError].filter((error) => error !== undefined),
      "x402 settlement is not yet durable",
    );
  }

  return { queued, ledgered, queueError, ledgerError };
}
