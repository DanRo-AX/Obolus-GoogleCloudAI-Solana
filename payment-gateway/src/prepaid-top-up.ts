import { randomUUID } from "node:crypto";

/**
 * Public, browser-triggered prepaid USDC top-up.
 *
 * The backend `POST /api/v1/prepaid/deposits` route is `require_internal`, so a
 * browser cannot credit its own prepaid balance directly. This module holds the
 * gateway-side orchestration for the public standalone rail: the browser asks
 * for a whole-USDC top-up quote, pays it with Phantom over the same x402 exact
 * scheme the pay-flow uses, and — only after the gateway independently confirms
 * the finalized on-chain transfer to `OPENSHELF_BUNDLE_RECEIVER` — the gateway
 * posts the verified transfer to the internal deposit route with the internal
 * token. The deposit route is idempotent by transaction signature and capped by
 * `MAX_PREPAID_TOP_UP_ATOMIC`, so this rail stays idempotent and amount-bounded.
 *
 * Only the pure, deterministic pieces live here so they can be unit tested
 * without a browser, a wallet, or a facilitator. The express/x402 wiring stays
 * in main.ts alongside the pay-flow it mirrors.
 */

/** USDC has six decimals; a whole-USDC amount scales by this to atomic units. */
const USDC_ATOMIC_MULTIPLIER = 1_000_000n;

/**
 * Hard cap on a single standalone top-up, in whole USDC. Mirrors the backend's
 * `MAX_PREPAID_TOP_UP_ATOMIC` (1,000 USDC) so an over-cap request is rejected at
 * the public boundary before any wallet approval, not only at the ledger.
 */
export const MAX_TOP_UP_USDC = 1_000;

/** Default lifetime of a prepared top-up quote before it must be re-prepared. */
export const DEFAULT_TOP_UP_TTL_MS = 5 * 60_000;

export class TopUpRequestError extends Error {
  constructor(
    readonly status: 400 | 409 | 503,
    readonly code: string,
    message: string,
  ) {
    super(message);
  }
}

export type TopUpQuote = {
  id: string;
  payTo: string;
  network: string;
  asset: string;
  amountUsdc: number;
  amountAtomic: string;
  expiresAt: number;
  status: "quoted";
  requiresPayment: true;
  resourcePath: string;
};

export type PrepaidDepositRequest = {
  transactionSignature: string;
  payer: string;
  payTo: string;
  network: string;
  asset: string;
  amountAtomic: string;
};

/**
 * Validates a requested whole-USDC top-up amount. Accepts a JSON number or a
 * canonical decimal string; rejects zero, negatives, fractional amounts, and
 * anything above {@link MAX_TOP_UP_USDC}. Returns the whole-USDC integer.
 */
export function parseTopUpAmountUsdc(value: unknown): number {
  const amount =
    typeof value === "number"
      ? value
      : typeof value === "string" && /^[0-9]+$/.test(value.trim())
        ? Number(value.trim())
        : Number.NaN;
  if (!Number.isInteger(amount) || amount < 1) {
    throw new TopUpRequestError(
      400,
      "invalid_top_up_amount",
      "amountUsdc must be a whole number of USDC of at least 1.",
    );
  }
  if (amount > MAX_TOP_UP_USDC) {
    throw new TopUpRequestError(
      400,
      "top_up_exceeds_cap",
      `amountUsdc must not exceed ${MAX_TOP_UP_USDC} USDC per top-up.`,
    );
  }
  return amount;
}

/** Scales a validated whole-USDC amount to its atomic-unit string. */
export function topUpAmountAtomic(amountUsdc: number): string {
  const amount = parseTopUpAmountUsdc(amountUsdc);
  return (BigInt(amount) * USDC_ATOMIC_MULTIPLIER).toString();
}

/**
 * In-memory registry of prepared, not-yet-settled top-up quotes. A quote is
 * single use: once its payment settles the caller deletes it, and the gateway's
 * settlement replay guard blocks a second settlement of the same id. Durable
 * cross-instance idempotency is provided by the backend deposit route's
 * signature dedupe, so this store deliberately holds only volatile state.
 */
export class TopUpQuoteStore {
  private readonly quotes = new Map<string, TopUpQuote>();

  create(input: {
    amountUsdc: number;
    payTo: string;
    network: string;
    asset: string;
    ttlMs?: number;
    now?: number;
    id?: string;
  }): TopUpQuote {
    const amountUsdc = parseTopUpAmountUsdc(input.amountUsdc);
    const payTo = input.payTo.trim();
    const network = input.network.trim();
    const asset = input.asset.trim();
    if (!payTo || !network || !asset) {
      throw new TopUpRequestError(
        503,
        "top_up_unavailable",
        "The prepaid top-up recipient is not configured.",
      );
    }
    const now = input.now ?? Date.now();
    const ttlMs = input.ttlMs ?? DEFAULT_TOP_UP_TTL_MS;
    const id = input.id ?? `topup_${randomUUID()}`;
    const quote: TopUpQuote = {
      id,
      payTo,
      network,
      asset,
      amountUsdc,
      amountAtomic: topUpAmountAtomic(amountUsdc),
      expiresAt: now + ttlMs,
      status: "quoted",
      requiresPayment: true,
      resourcePath: `/api/v1/paid-top-ups/${id}`,
    };
    this.quotes.set(id, quote);
    return quote;
  }

  get(id: string): TopUpQuote | undefined {
    return this.quotes.get(id);
  }

  delete(id: string): void {
    this.quotes.delete(id);
  }

  prune(now = Date.now()): void {
    for (const [id, quote] of this.quotes) {
      if (quote.expiresAt <= now) this.quotes.delete(id);
    }
  }
}

/**
 * Maps an independently verified, finalized settlement onto the exact internal
 * deposit request, refusing any result that drifts from the quote it settles.
 * The gateway has already proven the transfer on-chain; this is the last check
 * that the proven transfer is the one the browser was quoted before the credit
 * is recorded (defense in depth over the backend's own policy validation).
 */
export function topUpDepositFromSettlement(
  quote: TopUpQuote,
  settlement: {
    success?: boolean;
    transaction?: string | null;
    payer?: string | null;
    network?: string | null;
    amount?: string | null;
  },
): PrepaidDepositRequest {
  if (settlement.success === false) {
    throw new TopUpRequestError(409, "top_up_not_settled", "The top-up did not settle.");
  }
  const transactionSignature = (settlement.transaction ?? "").trim();
  const payer = (settlement.payer ?? "").trim();
  if (!transactionSignature) {
    throw new TopUpRequestError(
      409,
      "top_up_missing_signature",
      "The settled top-up has no transaction signature.",
    );
  }
  if (!payer) {
    throw new TopUpRequestError(
      409,
      "top_up_missing_payer",
      "The settled top-up did not identify its payer.",
    );
  }
  if (payer === quote.payTo) {
    throw new TopUpRequestError(
      409,
      "top_up_self_payment",
      "The top-up payer and recipient must be different wallets.",
    );
  }
  if (settlement.network && settlement.network !== quote.network) {
    throw new TopUpRequestError(
      409,
      "top_up_network_drift",
      "The settled top-up network does not match its quote.",
    );
  }
  const settledAmount = (settlement.amount ?? quote.amountAtomic).trim();
  if (settledAmount !== quote.amountAtomic) {
    throw new TopUpRequestError(
      409,
      "top_up_amount_drift",
      "The settled top-up amount does not match its quote.",
    );
  }
  return {
    transactionSignature,
    payer,
    payTo: quote.payTo,
    network: quote.network,
    asset: quote.asset,
    amountAtomic: quote.amountAtomic,
  };
}
