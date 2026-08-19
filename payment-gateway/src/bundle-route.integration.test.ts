import assert from "node:assert/strict";
import { spawn, type ChildProcess } from "node:child_process";
import { once } from "node:events";
import { createServer } from "node:http";
import test from "node:test";
import { fileURLToPath } from "node:url";

const DEVNET_NETWORK = "solana:EtWTRABZaYq6iMfeYKouRu166VU2xqa1";
const DEVNET_USDC = "4zMMC9srt5Ri5X14GAgXhaHii3GnPAEERYPJgZJDncDU";
const gatewayRoot = fileURLToPath(new URL("..", import.meta.url));

test("the real gateway process routes an explicit agent bundle without a browser session", {
  timeout: 15_000,
}, async (context) => {
  let internalRequest: {
    path: string;
    queryToken?: string;
    walletSession?: string;
    protocol?: string;
    body: unknown;
  } | null = null;
  const upstream = createServer(async (request, response) => {
    if (request.url === "/supported") {
      response.writeHead(200, { "content-type": "application/json" });
      response.end(JSON.stringify({
        kinds: [{ x402Version: 2, scheme: "exact", network: DEVNET_NETWORK }],
        extensions: [],
        signers: {},
      }));
      return;
    }
    if (request.url === "/readyz") {
      response.writeHead(200, { "content-type": "application/json" });
      response.end('{"status":"ready"}');
      return;
    }
    if (request.url === "/internal/v1/agent-payment-bundles" && request.method === "POST") {
      const chunks: Buffer[] = [];
      for await (const chunk of request) chunks.push(Buffer.from(chunk));
      internalRequest = {
        path: request.url,
        queryToken: request.headers["x-openshelf-query-token"] as string | undefined,
        walletSession: request.headers["x-openshelf-wallet-session"] as string | undefined,
        protocol: request.headers["x-openshelf-payment-protocol"] as string | undefined,
        body: JSON.parse(Buffer.concat(chunks).toString("utf8")),
      };
      response.writeHead(200, { "content-type": "application/json" });
      response.end(JSON.stringify({
        id: "bundle_process_contract",
        queryId: "query_process_contract",
        documentHandles: ["HUMAN_A", "HUMAN_B"],
        payTo: "11111111111111111111111111111111",
        network: DEVNET_NETWORK,
        asset: DEVNET_USDC,
        amountAtomic: "300",
        budgetAtomic: "300",
        minimumDepositAtomic: "300",
        requiresPayment: true,
        availableBalanceAtomic: "0",
        totalPriceKrw: 300,
        krwPerUsdc: 1_350,
        expiresAt: Date.now() + 300_000,
        resourcePath: "/api/v1/paid-bundles/bundle_process_contract",
        bundleHash: "a".repeat(64),
        status: "quoted",
      }));
      return;
    }
    if (request.url?.startsWith("/internal/v1/payment-attempts/reconciliation")) {
      response.writeHead(200, { "content-type": "application/json" });
      response.end("[]");
      return;
    }
    response.writeHead(404, { "content-type": "application/json" });
    response.end('{"error":{"message":"fixture route not found"}}');
  });
  upstream.listen(0, "127.0.0.1");
  await once(upstream, "listening");
  context.after(() => upstream.close());
  const upstreamAddress = upstream.address();
  assert.ok(upstreamAddress && typeof upstreamAddress === "object");
  const upstreamOrigin = `http://127.0.0.1:${upstreamAddress.port}`;
  const gatewayPort = await reservePort();
  const gateway = spawn(process.execPath, ["--import", "tsx", "src/main.ts"], {
    cwd: gatewayRoot,
    env: {
      ...process.env,
      NODE_ENV: "test",
      OPENSHELF_ENV: "test",
      PORT: String(gatewayPort),
      RUST_API_URL: upstreamOrigin,
      RESEARCH_ORCHESTRATOR_URL: upstreamOrigin,
      PAY_SH_PRIVATE_URL: upstreamOrigin,
      X402_FACILITATOR_URL: upstreamOrigin,
      X402_RPC_URL: upstreamOrigin,
      PAY_SH_RPC_URL: upstreamOrigin,
      FRONTEND_ORIGIN: upstreamOrigin,
      OPENSHELF_INTERNAL_TOKEN: "integration-internal-token".repeat(3),
      OPENSHELF_PAY_FRONT_TOKEN: "integration-front-token".repeat(3),
      OPENSHELF_SETTLEMENT_QUEUE: "",
      OPENSHELF_TEST_FAILPOINT: "",
    },
    stdio: ["ignore", "pipe", "pipe"],
  });
  let gatewayDiagnostics = "";
  gateway.stdout?.on("data", (chunk) => {
    gatewayDiagnostics += chunk.toString();
  });
  gateway.stderr?.on("data", (chunk) => {
    gatewayDiagnostics += chunk.toString();
  });
  context.after(async () => stopProcess(gateway));
  await waitForGateway(gateway, gatewayPort, () => gatewayDiagnostics);

  const gatewayOrigin = `http://127.0.0.1:${gatewayPort}`;
  const response = await fetch(`${gatewayOrigin}/api/v1/payment-bundles`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "x-openshelf-query-token": "query-secret",
        "x-openshelf-agent-payment-mode": "exact-agent-bundle-v1",
      },
      body: JSON.stringify({
        queryId: "query_process_contract",
        handles: ["HUMAN_A", "HUMAN_B"],
        expectedInvoiceHash: "b".repeat(64),
      }),
    }).catch((error: unknown) => {
      throw new Error(`gateway request failed: ${String(error)}\n${gatewayDiagnostics}`);
    });
  assert.equal(response.status, 201, await response.text());
  assert.deepEqual(internalRequest, {
    path: "/internal/v1/agent-payment-bundles",
    queryToken: "query-secret",
    walletSession: undefined,
    protocol: "exact-chain-v1",
    body: {
      queryId: "query_process_contract",
      handles: ["HUMAN_A", "HUMAN_B"],
      expectedInvoiceHash: "b".repeat(64),
    },
  });

  internalRequest = null;
  const downgrade = await fetch(`${gatewayOrigin}/api/v1/payment-bundles`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "x-openshelf-query-token": "query-secret",
    },
    body: JSON.stringify({
      queryId: "query_process_contract",
      handles: ["HUMAN_A", "HUMAN_B"],
    }),
  });
  assert.equal(downgrade.status, 401);
  assert.equal(internalRequest, null, "a missing mode must fail before the Rust money boundary");
});

async function reservePort(): Promise<number> {
  const reservation = createServer();
  reservation.listen(0, "127.0.0.1");
  await once(reservation, "listening");
  const address = reservation.address();
  assert.ok(address && typeof address === "object");
  const port = address.port;
  await new Promise<void>((resolveClose, reject) => {
    reservation.close((error) => error ? reject(error) : resolveClose());
  });
  return port;
}

async function waitForGateway(
  process: ChildProcess,
  port: number,
  diagnostics: () => string,
): Promise<void> {
  for (let attempt = 0; attempt < 100; attempt += 1) {
    if (process.exitCode !== null) {
      throw new Error(`gateway exited before listening: ${diagnostics()}`);
    }
    try {
      const response = await fetch(`http://127.0.0.1:${port}/healthz`, {
        signal: AbortSignal.timeout(100),
      });
      if (response.ok) return;
    } catch {
      // The actual child process, rather than a mocked handler, must become ready.
    }
    await new Promise((resolveDelay) => setTimeout(resolveDelay, 25));
  }
  throw new Error(`gateway did not listen in time: ${diagnostics()}`);
}

async function stopProcess(process: ChildProcess): Promise<void> {
  if (process.exitCode !== null || process.signalCode !== null) return;
  const exited = once(process, "exit");
  process.kill("SIGTERM");
  let timeout: NodeJS.Timeout | undefined;
  try {
    await Promise.race([
      exited,
      new Promise((resolveTimeout) => {
        timeout = setTimeout(resolveTimeout, 2_000);
      }),
    ]);
  } finally {
    if (timeout) clearTimeout(timeout);
  }
}
