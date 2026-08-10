import assert from "node:assert/strict";
import test from "node:test";
import { boundedSolanaRpc } from "./bounded-rpc.js";

test("the immediate-finality RPC has no hidden retry and actively aborts a hung provider", async () => {
  let calls = 0;
  let aborted = false;
  const rpc = boundedSolanaRpc(
    "https://rpc.example",
    100,
    ((_input, init) => {
      calls += 1;
      return new Promise<Response>((_resolve, reject) => {
        const signal = init?.signal;
        if (!signal) return reject(new Error("missing abort signal"));
        signal.addEventListener("abort", () => {
          aborted = true;
          reject(signal.reason);
        }, { once: true });
      });
    }) as typeof fetch,
  );
  await assert.rejects(rpc("getTransaction", ["signature"]));
  assert.equal(calls, 1);
  assert.equal(aborted, true);
});

test("the immediate-finality RPC accepts one bounded result and rejects oversized bodies", async () => {
  const rpc = boundedSolanaRpc(
    "https://rpc.example",
    1_000,
    (async () => Response.json({ jsonrpc: "2.0", id: 1, result: { slot: 7 } })) as typeof fetch,
  );
  assert.deepEqual(await rpc("getTransaction", ["signature"]), { slot: 7 });

  const oversized = boundedSolanaRpc(
    "https://rpc.example",
    1_000,
    (async () => new Response("{}", {
      headers: { "content-length": String(128 * 1_024 + 1) },
    })) as typeof fetch,
  );
  await assert.rejects(oversized("getTransaction", ["signature"]), /size limit/);
});

test("a chunked RPC body cannot omit content-length to bypass the byte limit", async () => {
  let cancelled = false;
  const rpc = boundedSolanaRpc(
    "https://rpc.example",
    1_000,
    (async () => new Response(new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(new Uint8Array(64 * 1_024));
        controller.enqueue(new Uint8Array(64 * 1_024 + 1));
      },
      cancel() {
        cancelled = true;
      },
    }))) as typeof fetch,
  );

  await assert.rejects(rpc("getTransaction", ["signature"]), /size limit/);
  assert.equal(cancelled, true);
});
