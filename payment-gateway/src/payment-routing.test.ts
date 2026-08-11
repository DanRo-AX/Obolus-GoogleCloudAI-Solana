import assert from "node:assert/strict";
import test from "node:test";
import {
  assertPaymentQuotePayable,
  assertPaymentQuoteUsable,
  paymentAttemptId,
  paymentIdentityFromPath,
  paymentMemo,
  PaymentQuoteError,
  SettlementReplayGuard,
  VerifiedPaymentAttemptTracker,
} from "./payment-routing.js";

test("document, bundle, and open-call paths resolve to disjoint quote identities", () => {
  assert.deepEqual(paymentIdentityFromPath("/api/v1/paid-documents/query%201/MD_7"), {
    kind: "document",
    selector: "query",
    queryId: "query 1",
    handle: "MD_7",
    key: "document\u0000query 1\u0000MD_7",
  });
  assert.deepEqual(paymentIdentityFromPath("/api/v1/paid-quotes/quote%2042"), {
    kind: "document",
    selector: "quote",
    quoteId: "quote 42",
    key: "document_quote\u0000quote 42",
  });
  assert.deepEqual(
    paymentIdentityFromPath("https://pay.example/api/v1/paid-bundles/bundle_42?ignored=1"),
    {
      kind: "bundle",
      quoteId: "bundle_42",
      key: "bundle\u0000bundle_42",
    },
  );
  assert.deepEqual(paymentIdentityFromPath("/api/v1/funded-open-calls/call_quote_7"), {
    kind: "open_call",
    quoteId: "call_quote_7",
    key: "open_call\u0000call_quote_7",
  });
  assert.throws(
    () => paymentIdentityFromPath("/api/v1/paid-bundles/bundle_42/extra"),
    /invalid paid resource path/,
  );
});

test("an expired bundle is rejected before the wallet can sign it", () => {
  assert.doesNotThrow(() => assertPaymentQuoteUsable(1_001, 1_000));
  assert.throws(() => assertPaymentQuoteUsable(1_000, 1_000), /has expired/);
  assert.throws(() => assertPaymentQuoteUsable(Number.NaN, 1_000), /has expired/);
});

test("only a live quote that still requires payment can reach the wallet", () => {
  assert.doesNotThrow(() =>
    assertPaymentQuotePayable({ expiresAt: 1_001, status: "quoted", requiresPayment: true }, 1_000),
  );
  for (const quote of [
    { expiresAt: 1_001, status: "funded", requiresPayment: true },
    { expiresAt: 1_001, status: "delivered", requiresPayment: true },
    { expiresAt: 1_001, status: "quoted", requiresPayment: false },
  ]) {
    assert.throws(
      () => assertPaymentQuotePayable(quote, 1_000),
      (error) => error instanceof PaymentQuoteError && error.code === "payment_not_payable",
    );
  }
  assert.throws(
    () =>
      assertPaymentQuotePayable(
        { expiresAt: 999, status: "funded", requiresPayment: true },
        1_000,
      ),
    (error) => error instanceof PaymentQuoteError && error.code === "payment_not_payable",
  );
});

test("the verified transaction keeps its exact quote across facilitator delay", () => {
  const tracker = new VerifiedPaymentAttemptTracker<{
    id: string;
    expiresAt: number;
    status: string;
  }>();
  const identity = paymentIdentityFromPath("/api/v1/paid-bundles/bundle-1");
  const quote = { id: "bundle-1", expiresAt: 1_001, status: "quoted" };
  const attemptId = paymentAttemptId({ payload: { transaction: "signed-transaction" } });

  tracker.remember(attemptId, identity, quote, 1_000);
  assert.equal(tracker.forAttempt(attemptId)?.quote, quote);
  assert.equal(tracker.forIdentity(identity.key)?.quote, quote);
  // Retrieval deliberately does not re-run quote expiry after funds move.
  assert.equal(tracker.forAttempt(attemptId)?.quote.expiresAt, 1_001);
  assert.throws(
    () => tracker.remember("another-attempt", identity, quote, 1_002),
    (error) => error instanceof PaymentQuoteError && error.code === "payment_not_payable",
  );
  tracker.forget(attemptId);
  assert.equal(tracker.forAttempt(attemptId), undefined);
});

test("every signed transfer carries a deterministic quote reconciliation memo", () => {
  const identity = paymentIdentityFromPath("/api/v1/funded-open-calls/call-quote-7");
  assert.equal(
    paymentMemo(identity, "call-quote-7"),
    "openshelf:v1:open_call:call-quote-7",
  );
  assert.throws(() => paymentMemo(identity, "q".repeat(300)), /cannot be encoded/);
});

test("a successful settlement fences the same resource until durable recovery is visible", () => {
  const guard = new SettlementReplayGuard();
  guard.assertNotSettled("bundle\u0000quote-1", 1_000);
  guard.markSettled("bundle\u0000quote-1", 1_100, 1_000);
  assert.throws(
    () => guard.assertNotSettled("bundle\u0000quote-1", 1_001),
    (error) => error instanceof PaymentQuoteError && error.code === "payment_not_payable",
  );
  guard.prune(1_000 + 24 * 60 * 60 * 1_000 + 1);
  guard.assertNotSettled("bundle\u0000quote-1", 1_000 + 24 * 60 * 60 * 1_000 + 1);
});
