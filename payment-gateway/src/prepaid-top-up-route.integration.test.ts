import assert from "node:assert/strict";
import { spawn, type ChildProcess } from "node:child_process";
import { once } from "node:events";
import { createServer } from "node:http";
import test from "node:test";
import { fileURLToPath } from "node:url";

const DEVNET_NETWORK = "solana:EtWTRABZaYq6iMfeYKouRu166VU2xqa1";
const DEVNET_USDC = "4zMMC9srt5Ri5X14GAgXhaHii3GnPAEERYPJgZJDncDU";
const RECEIVER = "11111111111111111111111111111111";
const gatewayRoot = fileURLToPath(new URL("..", import.meta.url));

test("the real gateway issues a 402 for a standalone prepaid top-up and rejects bad amounts", {
  timeout: 20_000,
}, async (context) => {
  const upstream = createServer((request, response) => {
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
      OPENSHELF_BUNDLE_RECEIVER: RECEIVER,
      OPENSHELF_X402_ASSET: DEVNET_USDC,
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

  // A valid whole-USDC top-up mints an exact, payable x402 resource.
  const prepared = await fetch(`${gatewayOrigin}/api/v1/prepaid/top-ups`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ amountUsdc: 5 }),
  });
  const preparedText = await prepared.text();
  assert.equal(prepared.status, 201, preparedText);
  const preparedBody = JSON.parse(preparedText) as {
    quote: {
      id: string;
      payTo: string;
      network: string;
      asset: string;
      amountAtomic: string;
      resourcePath: string;
      status: string;
    };
    resourceUrl: string;
  };
  assert.equal(preparedBody.quote.amountAtomic, "5000000");
  assert.equal(preparedBody.quote.payTo, RECEIVER);
  assert.equal(preparedBody.quote.asset, DEVNET_USDC);
  assert.equal(preparedBody.quote.network, DEVNET_NETWORK);
  assert.equal(preparedBody.quote.status, "quoted");
  assert.equal(preparedBody.quote.resourcePath, `/api/v1/paid-top-ups/${preparedBody.quote.id}`);

  // Fetching the resource without a payment returns a 402 challenge that quotes
  // exactly the same USDC amount and receiver — the public standalone top-up.
  const challenge = await fetch(`${gatewayOrigin}${preparedBody.quote.resourcePath}`, {
    headers: { accept: "application/json" },
  });
  const challengeText = await challenge.text();
  assert.equal(challenge.status, 402, challengeText);
  assert.ok(
    challenge.headers.get("payment-required") || challenge.headers.get("PAYMENT-REQUIRED"),
    "the 402 must carry an x402 payment-required header",
  );
  const challengeBody = JSON.parse(challengeText) as {
    error?: { code?: string };
    quote?: { amountAtomic?: string; payTo?: string; asset?: string };
  };
  assert.equal(challengeBody.error?.code, "payment_required");
  assert.equal(challengeBody.quote?.amountAtomic, "5000000");
  assert.equal(challengeBody.quote?.payTo, RECEIVER);
  assert.equal(challengeBody.quote?.asset, DEVNET_USDC);

  // An over-cap amount is refused at the public boundary, before any wallet.
  const overCap = await fetch(`${gatewayOrigin}/api/v1/prepaid/top-ups`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ amountUsdc: 5_000 }),
  });
  assert.equal(overCap.status, 400);
  assert.equal((await overCap.json() as { error?: { code?: string } }).error?.code, "top_up_exceeds_cap");

  // A fractional amount is refused too — top-ups are whole USDC only.
  const fractional = await fetch(`${gatewayOrigin}/api/v1/prepaid/top-ups`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ amountUsdc: 1.5 }),
  });
  assert.equal(fractional.status, 400);
  assert.equal(
    (await fractional.json() as { error?: { code?: string } }).error?.code,
    "invalid_top_up_amount",
  );

  // An unknown or already-consumed quote id is not payable: a fresh top-up must
  // be prepared instead of paying a stale resource twice.
  const unknown = await fetch(`${gatewayOrigin}/api/v1/paid-top-ups/topup_does_not_exist`, {
    headers: { accept: "application/json" },
  });
  const unknownText = await unknown.text();
  assert.equal(unknown.status, 409, unknownText);
  assert.equal(
    (JSON.parse(unknownText) as { error?: { code?: string } }).error?.code,
    "payment_not_payable",
  );
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
