import assert from "node:assert/strict";
import test from "node:test";
import {
  MAX_TOP_UP_USDC,
  TopUpQuoteStore,
  TopUpRequestError,
  parseTopUpAmountUsdc,
  topUpAmountAtomic,
  topUpDepositFromSettlement,
  type TopUpQuote,
} from "./prepaid-top-up.js";

const DEVNET_NETWORK = "solana:EtWTRABZaYq6iMfeYKouRu166VU2xqa1";
const DEVNET_USDC = "4zMMC9srt5Ri5X14GAgXhaHii3GnPAEERYPJgZJDncDU";
const RECEIVER = "11111111111111111111111111111111";
const PAYER = "So11111111111111111111111111111111111111112";

function receiverQuote(amountUsdc: number): TopUpQuote {
  return new TopUpQuoteStore().create({
    amountUsdc,
    payTo: RECEIVER,
    network: DEVNET_NETWORK,
    asset: DEVNET_USDC,
    now: 1_000,
    ttlMs: 60_000,
    id: `topup_${amountUsdc}`,
  });
}

test("parseTopUpAmountUsdc accepts whole USDC amounts through the cap", () => {
  assert.equal(parseTopUpAmountUsdc(1), 1);
  assert.equal(parseTopUpAmountUsdc(5), 5);
  assert.equal(parseTopUpAmountUsdc(25), 25);
  assert.equal(parseTopUpAmountUsdc(MAX_TOP_UP_USDC), MAX_TOP_UP_USDC);
  // A canonical integer string is accepted (JSON bodies can carry either).
  assert.equal(parseTopUpAmountUsdc("10"), 10);
});

test("parseTopUpAmountUsdc rejects non-whole, non-positive, and over-cap amounts", () => {
  for (const bad of [0, -1, 1.5, Number.NaN, Number.POSITIVE_INFINITY, "abc", "1.5", "", null, undefined, {}]) {
    assert.throws(() => parseTopUpAmountUsdc(bad), TopUpRequestError, `expected ${String(bad)} to be rejected`);
  }
  assert.throws(
    () => parseTopUpAmountUsdc(MAX_TOP_UP_USDC + 1),
    (error: unknown) =>
      error instanceof TopUpRequestError
      && error.status === 400
      && error.code === "top_up_exceeds_cap",
  );
});

test("topUpAmountAtomic scales whole USDC to six-decimal atomic units", () => {
  assert.equal(topUpAmountAtomic(1), "1000000");
  assert.equal(topUpAmountAtomic(5), "5000000");
  assert.equal(topUpAmountAtomic(25), "25000000");
  assert.equal(topUpAmountAtomic(MAX_TOP_UP_USDC), "1000000000");
});

test("TopUpQuoteStore mints a payable exact quote and is single use", () => {
  const store = new TopUpQuoteStore();
  const quote = store.create({
    amountUsdc: 5,
    payTo: RECEIVER,
    network: DEVNET_NETWORK,
    asset: DEVNET_USDC,
    now: 1_000,
    ttlMs: 60_000,
  });
  assert.equal(quote.amountAtomic, "5000000");
  assert.equal(quote.amountUsdc, 5);
  assert.equal(quote.payTo, RECEIVER);
  assert.equal(quote.network, DEVNET_NETWORK);
  assert.equal(quote.asset, DEVNET_USDC);
  assert.equal(quote.status, "quoted");
  assert.equal(quote.requiresPayment, true);
  assert.equal(quote.expiresAt, 61_000);
  assert.equal(quote.resourcePath, `/api/v1/paid-top-ups/${quote.id}`);
  assert.deepEqual(store.get(quote.id), quote);
  store.delete(quote.id);
  assert.equal(store.get(quote.id), undefined);
});

test("TopUpQuoteStore.create refuses an over-cap amount before any wallet approval", () => {
  const store = new TopUpQuoteStore();
  assert.throws(
    () => store.create({
      amountUsdc: MAX_TOP_UP_USDC + 1,
      payTo: RECEIVER,
      network: DEVNET_NETWORK,
      asset: DEVNET_USDC,
    }),
    (error: unknown) =>
      error instanceof TopUpRequestError && error.code === "top_up_exceeds_cap",
  );
});

test("TopUpQuoteStore.create refuses an unconfigured receiver", () => {
  const store = new TopUpQuoteStore();
  assert.throws(
    () => store.create({ amountUsdc: 5, payTo: "  ", network: DEVNET_NETWORK, asset: DEVNET_USDC }),
    (error: unknown) =>
      error instanceof TopUpRequestError
      && error.status === 503
      && error.code === "top_up_unavailable",
  );
});

test("TopUpQuoteStore.prune drops only expired quotes", () => {
  const store = new TopUpQuoteStore();
  const quote = store.create({
    amountUsdc: 5,
    payTo: RECEIVER,
    network: DEVNET_NETWORK,
    asset: DEVNET_USDC,
    now: 1_000,
    ttlMs: 60_000,
  });
  store.prune(30_000);
  assert.deepEqual(store.get(quote.id), quote);
  store.prune(61_001);
  assert.equal(store.get(quote.id), undefined);
});

test("topUpDepositFromSettlement credits the exact quoted transfer", () => {
  const quote = receiverQuote(5);
  const deposit = topUpDepositFromSettlement(quote, {
    success: true,
    transaction: "5".repeat(64),
    payer: PAYER,
    network: DEVNET_NETWORK,
    amount: "5000000",
  });
  assert.deepEqual(deposit, {
    transactionSignature: "5".repeat(64),
    payer: PAYER,
    payTo: RECEIVER,
    network: DEVNET_NETWORK,
    asset: DEVNET_USDC,
    amountAtomic: "5000000",
  });
});

test("topUpDepositFromSettlement is deterministic so a replay dedupes on signature", () => {
  const quote = receiverQuote(5);
  const settlement = { success: true, transaction: "ab".repeat(32), payer: PAYER, network: DEVNET_NETWORK };
  const first = topUpDepositFromSettlement(quote, settlement);
  const second = topUpDepositFromSettlement(quote, settlement);
  // The gateway posts an identical deposit on replay; the internal deposit
  // route dedupes on transactionSignature, so the balance is credited once.
  assert.deepEqual(first, second);
  assert.equal(first.transactionSignature, "ab".repeat(32));
});

test("topUpDepositFromSettlement rejects a settlement that drifts from its quote", () => {
  const quote = receiverQuote(5);
  const base = { success: true, transaction: "c".repeat(64), payer: PAYER, network: DEVNET_NETWORK };
  assert.throws(
    () => topUpDepositFromSettlement(quote, { ...base, amount: "4000000" }),
    (error: unknown) => error instanceof TopUpRequestError && error.code === "top_up_amount_drift",
  );
  assert.throws(
    () => topUpDepositFromSettlement(quote, { ...base, network: "solana:other" }),
    (error: unknown) => error instanceof TopUpRequestError && error.code === "top_up_network_drift",
  );
  assert.throws(
    () => topUpDepositFromSettlement(quote, { ...base, payer: RECEIVER }),
    (error: unknown) => error instanceof TopUpRequestError && error.code === "top_up_self_payment",
  );
  assert.throws(
    () => topUpDepositFromSettlement(quote, { ...base, transaction: "" }),
    (error: unknown) => error instanceof TopUpRequestError && error.code === "top_up_missing_signature",
  );
  assert.throws(
    () => topUpDepositFromSettlement(quote, { ...base, payer: "" }),
    (error: unknown) => error instanceof TopUpRequestError && error.code === "top_up_missing_payer",
  );
  assert.throws(
    () => topUpDepositFromSettlement(quote, { ...base, success: false }),
    (error: unknown) => error instanceof TopUpRequestError && error.code === "top_up_not_settled",
  );
});
