import { boundedResponseText } from "./bounded-rpc.js";

const MAX_LEDGER_RESPONSE_BYTES = 1024 * 1024;

export type PayoutLedgerRequest = {
  baseUrl: string;
  internalToken: string;
  path: string;
  init: RequestInit;
  fetchImpl?: typeof globalThis.fetch;
  timeoutMs?: number;
};

/**
 * Calls the durable payout ledger with one deadline that covers connecting,
 * response headers, and the complete JSON body. A half-open internal service
 * must not monopolize the only process capable of releasing escrow payouts.
 */
export async function payoutLedgerJson<T>(request: PayoutLedgerRequest): Promise<T> {
  const timeoutMs = safeTimeout(request.timeoutMs);
  const response = await (request.fetchImpl ?? globalThis.fetch)(
    `${request.baseUrl}${request.path}`,
    {
      ...request.init,
      signal: request.init.signal ?? AbortSignal.timeout(timeoutMs),
      headers: {
        "content-type": "application/json",
        "x-openshelf-internal-token": request.internalToken,
        "x-openshelf-payout-protocol": "exact-payout-v1",
        ...request.init.headers,
      },
    },
  );
  const text = await boundedResponseText(
    response,
    MAX_LEDGER_RESPONSE_BYTES,
    "Rust payout-ledger response",
  );
  if (!response.ok) {
    throw new Error(`Rust API ${response.status}: ${text.slice(0, 500)}`);
  }
  return JSON.parse(text) as T;
}

function safeTimeout(value: number | undefined): number {
  return Number.isSafeInteger(value) && (value ?? 0) > 0 && (value ?? 0) <= 60_000
    ? value as number
    : 20_000;
}
