import assert from "node:assert/strict";
import test from "node:test";
import type { Network, PaymentRequirements } from "@x402/core/types";
import { createStableExactSvmServerScheme } from "./x402-svm.js";

const network = "solana:EtWTRABZaYq6iMfeYKouRu166VU2xqa1" as Network;
const feePayer = "CKPKJWNdJEqa81x7CkZ14BVPiY6y16Sxs7owznqtWYp5";

test("signed retries see stable SVM payment requirements", async () => {
  const scheme = createStableExactSvmServerScheme();
  const requirements: PaymentRequirements = {
    scheme: "exact",
    network,
    amount: "7408",
    asset: "4zMMC9srt5Ri5X14GAgXhaHii3GnPAEERYPJgZJDncDU",
    payTo: "FhRsUMzQieS8TXacCaGhLZrFNEQrUwqGkYBVzLeiUP8H",
    maxTimeoutSeconds: 60,
    extra: {},
  };
  const supportedKind = {
    x402Version: 2,
    scheme: "exact",
    network,
    extra: { feePayer },
  };

  const first = await scheme.enhancePaymentRequirements(requirements, supportedKind, []);
  const signedRetry = await scheme.enhancePaymentRequirements(requirements, supportedKind, []);

  assert.deepEqual(signedRetry, first);
  assert.equal(first.extra?.feePayer, feePayer);
  assert.equal(first.extra?.recentBlockhash, undefined);
  assert.equal(first.extra?.lastValidBlockHeight, undefined);
});
