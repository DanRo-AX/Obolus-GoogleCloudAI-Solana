import assert from "node:assert/strict";
import { createServer } from "node:http";
import type { AddressInfo } from "node:net";
import test from "node:test";
import { payoutLedgerJson } from "./payout-ledger-client.js";

test("a Rust ledger that stalls halfway through JSON cannot freeze payout processing", async () => {
  let requests = 0;
  const sockets = new Set<import("node:net").Socket>();
  const server = createServer((_request, response) => {
    requests += 1;
    response.writeHead(200, { "content-type": "application/json" });
    response.write('{"claims":');
    // Reproduce a proxy/process that emitted headers and half a body, then
    // remained connected forever. The client's deadline must cover body read.
  });
  server.on("connection", (socket) => {
    sockets.add(socket);
    socket.on("close", () => sockets.delete(socket));
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const port = (server.address() as AddressInfo).port;
  const startedAt = Date.now();
  try {
    await assert.rejects(
      payoutLedgerJson({
        baseUrl: `http://127.0.0.1:${port}`,
        internalToken: "test-internal-token",
        path: "/internal/v1/payout-claims/lease",
        init: { method: "POST", body: "{}" },
        timeoutMs: 50,
      }),
      /abort|timeout/i,
    );
    assert.equal(requests, 1);
    assert.ok(Date.now() - startedAt < 1_000, "half-open response exceeded the payout deadline");
  } finally {
    for (const socket of sockets) socket.destroy();
    await new Promise<void>((resolve, reject) => {
      server.close((error) => error ? reject(error) : resolve());
    });
  }
});
