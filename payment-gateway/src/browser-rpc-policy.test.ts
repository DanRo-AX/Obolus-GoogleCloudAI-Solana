import assert from "node:assert/strict";
import test from "node:test";
import { isAllowedBrowserRpcRequest } from "./browser-rpc-policy.js";

const mint = "4zMMC9srt5Ri5X14GAgXhaHii3GnPAEERYPJgZJDncDU";
const owner = "G74HByZuBEZ8BqqdixX3LoXjE96Ey7pqSofNFJRK8AAY";

test("the browser may read the connected owner's configured USDC balance", () => {
  assert.equal(isAllowedBrowserRpcRequest({
    jsonrpc: "2.0",
    id: 1,
    method: "getTokenAccountsByOwner",
    params: [owner, { mint }, { encoding: "jsonParsed", commitment: "confirmed" }],
  }, mint), true);
});

test("the balance read cannot scan arbitrary mints, owners, or encodings", () => {
  for (const params of [
    [owner, { mint: "11111111111111111111111111111111" }, { encoding: "jsonParsed" }],
    ["not-a-wallet", { mint }, { encoding: "jsonParsed" }],
    [owner, { programId: mint }, { encoding: "jsonParsed" }],
    [owner, { mint }, { encoding: "base64" }],
    [owner, { mint }, { encoding: "jsonParsed", dataSlice: { offset: 0, length: 1 } }],
  ]) {
    assert.equal(isAllowedBrowserRpcRequest({
      jsonrpc: "2.0",
      method: "getTokenAccountsByOwner",
      params,
    }, mint), false);
  }
});

test("write and broad chain RPC methods remain unavailable", () => {
  for (const method of ["sendTransaction", "simulateTransaction", "getProgramAccounts", "getSignaturesForAddress"]) {
    assert.equal(isAllowedBrowserRpcRequest({ jsonrpc: "2.0", method, params: [] }, mint), false);
  }
});
