import assert from "node:assert/strict";
import test from "node:test";
import { assertExactTokenTransfer } from "./chain-verification.js";

const mint = "USDC-mint";

test("confirmed token balance deltas must exactly match payer, recipient, mint and amount", () => {
  const meta = {
    err: null,
    preTokenBalances: [
      { owner: "payer", mint, uiTokenAmount: { amount: "1000" } },
      { owner: "recipient", mint, uiTokenAmount: { amount: "25" } },
    ],
    postTokenBalances: [
      { owner: "payer", mint, uiTokenAmount: { amount: "700" } },
      { owner: "recipient", mint, uiTokenAmount: { amount: "325" } },
    ],
  };
  assert.doesNotThrow(() =>
    assertExactTokenTransfer(meta, {
      payer: "payer",
      recipient: "recipient",
      mint,
      amountAtomic: "300",
    }),
  );
  assert.throws(
    () =>
      assertExactTokenTransfer(meta, {
        payer: "payer",
        recipient: "recipient",
        mint: "substituted-mint",
        amountAtomic: "300",
      }),
    /does not match/,
  );
  assert.throws(
    () =>
      assertExactTokenTransfer(meta, {
        payer: "payer",
        recipient: "recipient",
        mint,
        amountAtomic: "301",
      }),
    /does not match/,
  );
});
