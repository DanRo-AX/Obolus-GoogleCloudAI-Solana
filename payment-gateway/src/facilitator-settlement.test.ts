import assert from "node:assert/strict";
import test from "node:test";
import type { Network, PaymentPayload, PaymentRequirements } from "@x402/core/types";
import { boundedFacilitatorSettlement } from "./facilitator-settlement.js";

const network = "solana:EtWTRABZaYq6iMfeYKouRu166VU2xqa1" as Network;
const paymentPayload = {
  x402Version: 2,
  accepted: { scheme: "exact", network, amount: "7408", asset: "asset", payTo: "recipient" },
  payload: { transaction: "prepared" },
} as unknown as PaymentPayload;
const paymentRequirements = {
  scheme: "exact",
  network,
  amount: "7408",
  asset: "asset",
  payTo: "recipient",
  maxTimeoutSeconds: 60,
} as PaymentRequirements;

test("the bounded transport accepts one well-formed settlement response", async () => {
  let requests = 0;
  const result = await boundedFacilitatorSettlement({
    url: "https://facilitator.example/base/",
    paymentPayload,
    paymentRequirements,
    timeoutMs: 1_000,
    fetchImpl: (async (input, init) => {
      requests += 1;
      assert.equal(String(input), "https://facilitator.example/base/settle");
      assert.equal(init?.redirect, "error");
      return Response.json({
        success: true,
        transaction: "signature",
        network,
        payer: "payer",
        amount: "7408",
      });
    }) as typeof fetch,
  });
  assert.equal(result.transaction, "signature");
  assert.equal(requests, 1);
});

test("a facilitator that never returns is actively aborted and remains ambiguous", async () => {
  let aborted = false;
  const started = performance.now();
  await assert.rejects(
    boundedFacilitatorSettlement({
      url: "https://facilitator.example",
      paymentPayload,
      paymentRequirements,
      timeoutMs: 100,
      fetchImpl: ((_input, init) => new Promise<Response>((_resolve, reject) => {
        const signal = init?.signal;
        if (!signal) return reject(new Error("missing abort signal"));
        signal.addEventListener("abort", () => {
          aborted = true;
          reject(signal.reason);
        }, { once: true });
      })) as typeof fetch,
    }),
  );
  assert.equal(aborted, true);
  assert.ok(performance.now() - started < 1_000);
});

test("oversized or success-shaped-but-incomplete responses cannot release content", async () => {
  await assert.rejects(
    boundedFacilitatorSettlement({
      url: "https://facilitator.example",
      paymentPayload,
      paymentRequirements,
      timeoutMs: 1_000,
      fetchImpl: (async () => new Response("{}", {
        headers: { "content-length": String(64 * 1_024 + 1) },
      })) as typeof fetch,
    }),
    /size limit/,
  );
  await assert.rejects(
    boundedFacilitatorSettlement({
      url: "https://facilitator.example",
      paymentPayload,
      paymentRequirements,
      timeoutMs: 1_000,
      fetchImpl: (async () => Response.json({
        success: true,
        transaction: "signature",
        network,
      })) as typeof fetch,
    }),
    /malformed fields/,
  );
});
