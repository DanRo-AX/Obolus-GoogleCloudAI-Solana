import assert from "node:assert/strict";
import test from "node:test";
import { assertPaymentQuoteUsable, paymentIdentityFromPath } from "./payment-routing.js";

test("direct and bundle payment paths resolve to disjoint quote identities", () => {
  assert.deepEqual(paymentIdentityFromPath("/api/v1/paid-documents/query%201/MD_7"), {
    kind: "document",
    queryId: "query 1",
    handle: "MD_7",
    key: "document\u0000query 1\u0000MD_7",
  });
  assert.deepEqual(
    paymentIdentityFromPath("https://pay.example/api/v1/paid-bundles/bundle_42?ignored=1"),
    {
      kind: "bundle",
      quoteId: "bundle_42",
      key: "bundle\u0000bundle_42",
    },
  );
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
