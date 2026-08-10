import assert from "node:assert/strict";
import test from "node:test";
import { independentRpcUrls } from "./rpc-policy.js";

test("RPC independence is counted by normalized secure origin", () => {
  assert.deepEqual(independentRpcUrls([
    "https://RPC-A.example/path-one",
    "https://rpc-a.example:443/path-two",
    "https://rpc-b.example/",
  ]), [
    "https://rpc-a.example/path-one",
    "https://rpc-b.example/",
  ]);
});

test("remote RPC aliases cannot use plaintext, embedded credentials, or fragments", () => {
  for (const endpoint of [
    "http://rpc-a.example",
    "https://token@rpc-a.example",
    "https://rpc-a.example/#alternate",
  ]) {
    assert.throws(() => independentRpcUrls([endpoint]));
  }
  assert.deepEqual(independentRpcUrls(["http://127.0.0.1:8899"]), [
    "http://127.0.0.1:8899/",
  ]);
});
