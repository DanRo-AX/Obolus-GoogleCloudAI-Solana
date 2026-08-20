import { createHash } from "node:crypto";

export type PaymentRouteIdentity =
  | {
      kind: "document";
      selector: "query";
      queryId: string;
      handle: string;
      key: string;
    }
  | {
      kind: "document";
      selector: "quote";
      quoteId: string;
      key: string;
    }
  | { kind: "bundle"; quoteId: string; key: string }
  | { kind: "open_call"; quoteId: string; key: string }
  | { kind: "topup"; quoteId: string; key: string };

export type PaymentQuoteState = {
  expiresAt: number;
  status: string;
  requiresPayment?: boolean;
};

export class PaymentQuoteError extends Error {
  constructor(
    readonly status: 409 | 410,
    readonly code: "payment_not_payable" | "payment_quote_expired",
    message: string,
  ) {
    super(message);
  }
}

const SETTLEMENT_REPLAY_RETENTION_MS = 24 * 60 * 60 * 1_000;
const VERIFIED_ATTEMPT_RETENTION_MS = 24 * 60 * 60 * 1_000;

export type VerifiedPaymentAttempt<Quote extends PaymentQuoteState> = {
  attemptId: string;
  identity: PaymentRouteIdentity;
  quote: Quote;
};

/**
 * Keeps the exact quote that passed the pre-settlement ledger claim. The
 * facilitator may return after its quote expiry, but that must not replace the
 * already-paid quote with a fresh one while constructing the durable receipt.
 */
export class VerifiedPaymentAttemptTracker<Quote extends PaymentQuoteState> {
  private readonly byAttempt = new Map<
    string,
    VerifiedPaymentAttempt<Quote> & { retainedUntil: number }
  >();
  private readonly attemptByIdentity = new Map<string, string>();

  remember(
    attemptId: string,
    identity: PaymentRouteIdentity,
    quote: Quote,
    now = Date.now(),
  ): void {
    if (this.byAttempt.has(attemptId) || this.attemptByIdentity.has(identity.key)) {
      throw new PaymentQuoteError(
        409,
        "payment_not_payable",
        "This payment resource already has a verified payment in progress.",
      );
    }
    this.byAttempt.set(attemptId, {
      attemptId,
      identity,
      quote,
      retainedUntil: now + VERIFIED_ATTEMPT_RETENTION_MS,
    });
    this.attemptByIdentity.set(identity.key, attemptId);
  }

  forAttempt(attemptId: string): VerifiedPaymentAttempt<Quote> | undefined {
    return this.byAttempt.get(attemptId);
  }

  forIdentity(identityKey: string): VerifiedPaymentAttempt<Quote> | undefined {
    const attemptId = this.attemptByIdentity.get(identityKey);
    return attemptId ? this.byAttempt.get(attemptId) : undefined;
  }

  forget(attemptId: string): void {
    const attempt = this.byAttempt.get(attemptId);
    if (!attempt) return;
    this.byAttempt.delete(attemptId);
    if (this.attemptByIdentity.get(attempt.identity.key) === attemptId) {
      this.attemptByIdentity.delete(attempt.identity.key);
    }
  }

  prune(now = Date.now()): void {
    for (const [attemptId, attempt] of this.byAttempt) {
      if (attempt.retainedUntil <= now) this.forget(attemptId);
    }
  }
}

export function paymentAttemptId(paymentPayload: {
  payload: Readonly<Record<string, unknown>>;
}): string {
  const transaction = paymentPayload.payload.transaction;
  if (typeof transaction !== "string" || transaction.length === 0) {
    throw new Error("verified SVM payment payload has no transaction");
  }
  return createHash("sha256").update(transaction).digest("hex");
}

export function paymentMemo(identity: PaymentRouteIdentity, quoteId: string): string {
  const memo = `openshelf:v1:${identity.kind}:${quoteId}`;
  if (!quoteId || new TextEncoder().encode(memo).byteLength > 256) {
    throw new Error("payment quote id cannot be encoded in the Solana memo");
  }
  return memo;
}

/**
 * Holds an in-process fence from the moment the facilitator reports success
 * until every normal retry has had time to observe the durable Rust ledger.
 * The Rust quote status remains the cross-instance source of truth.
 */
export class SettlementReplayGuard {
  private readonly settledUntil = new Map<string, number>();

  assertNotSettled(key: string, now = Date.now()): void {
    const retainedUntil = this.settledUntil.get(key);
    if (retainedUntil === undefined) return;
    if (retainedUntil <= now) {
      this.settledUntil.delete(key);
      return;
    }
    throw new PaymentQuoteError(
      409,
      "payment_not_payable",
      "This payment resource already settled. Recover its existing result instead of paying again.",
    );
  }

  markSettled(key: string, quoteExpiresAt: number, now = Date.now()): void {
    this.settledUntil.set(
      key,
      Math.max(quoteExpiresAt, now + SETTLEMENT_REPLAY_RETENTION_MS),
    );
  }

  prune(now = Date.now()): void {
    for (const [key, retainedUntil] of this.settledUntil) {
      if (retainedUntil <= now) this.settledUntil.delete(key);
    }
  }
}

/** Canonicalize the only public paths allowed to select a payment quote. */
export function paymentIdentityFromPath(path: string): PaymentRouteIdentity {
  const pathname = path.startsWith("http") ? new URL(path).pathname : path.split("?")[0];
  const documentMatch = pathname.match(/^\/api\/v1\/paid-documents\/([^/]+)\/([^/]+)$/);
  if (documentMatch) {
    const queryId = decodeURIComponent(documentMatch[1]);
    const handle = decodeURIComponent(documentMatch[2]);
    if (!queryId || !handle) throw new Error("query id and document handle are required");
    return {
      kind: "document",
      selector: "query",
      queryId,
      handle,
      key: `document\u0000${queryId}\u0000${handle}`,
    };
  }
  const documentQuoteMatch = pathname.match(/^\/api\/v1\/paid-quotes\/([^/]+)$/);
  if (documentQuoteMatch) {
    const quoteId = decodeURIComponent(documentQuoteMatch[1]);
    if (!quoteId) throw new Error("document payment quote id is required");
    return {
      kind: "document",
      selector: "quote",
      quoteId,
      key: `document_quote\u0000${quoteId}`,
    };
  }
  const bundleMatch = pathname.match(/^\/api\/v1\/paid-bundles\/([^/]+)$/);
  if (bundleMatch) {
    const quoteId = decodeURIComponent(bundleMatch[1]);
    if (!quoteId) throw new Error("payment bundle quote id is required");
    return { kind: "bundle", quoteId, key: `bundle\u0000${quoteId}` };
  }
  const openCallMatch = pathname.match(/^\/api\/v1\/funded-open-calls\/([^/]+)$/);
  if (openCallMatch) {
    const quoteId = decodeURIComponent(openCallMatch[1]);
    if (!quoteId) throw new Error("open-call funding quote id is required");
    return { kind: "open_call", quoteId, key: `open_call\u0000${quoteId}` };
  }
  throw new Error("invalid paid resource path");
}

export function assertPaymentQuoteUsable(expiresAt: number, now = Date.now()): void {
  if (!Number.isSafeInteger(expiresAt) || expiresAt <= now) {
    throw new PaymentQuoteError(
      410,
      "payment_quote_expired",
      "Payment quote has expired; prepare a new resource.",
    );
  }
}

/** Reject every state that must be recovered rather than paid again. */
export function assertPaymentQuotePayable(quote: PaymentQuoteState, now = Date.now()): void {
  if (quote.status !== "quoted" || quote.requiresPayment === false) {
    throw new PaymentQuoteError(
      409,
      "payment_not_payable",
      "This payment resource is no longer payable. Recover its existing result instead.",
    );
  }
  assertPaymentQuoteUsable(quote.expiresAt, now);
}
