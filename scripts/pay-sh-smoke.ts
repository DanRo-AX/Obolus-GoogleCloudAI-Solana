import { spawnSync } from "node:child_process";
import { readFile, writeFile } from "node:fs/promises";

const baseUrl = (process.env.OPENSHELF_PAY_URL ?? "http://127.0.0.1:3402").replace(/\/$/, "");
const supported = new Set([5, 10, 15, 25, 100, 300, 500, 700, 800, 1000]);
const stateFile = process.env.PAY_SMOKE_STATE_FILE?.trim();
const recoverOnly = process.env.PAY_SMOKE_RECOVER_ONLY === "true";
const retryOnly = process.env.PAY_SMOKE_RETRY_ONLY === "true";

type SmokeState = {
  queryToken: string;
  quoteId: string;
  resourcePath: string;
  recoveryPath: string;
};

async function json(response: Response) {
  const body = await response.text();
  if (!response.ok) throw new Error(`${response.status} ${response.statusText}: ${body}`);
  return JSON.parse(body);
}

const health = await fetch(`${baseUrl}/healthz`);
if (!health.ok) throw new Error(`Pay.sh gateway is not healthy: HTTP ${health.status}`);

if (recoverOnly || retryOnly) {
  if (!stateFile) throw new Error("PAY_SMOKE_STATE_FILE is required for crash recovery");
  const state = JSON.parse(await readFile(stateFile, "utf8")) as SmokeState;
  const headers = { "x-openshelf-query-token": state.queryToken };
  if (recoverOnly) {
    const recovered = await json(await fetch(`${baseUrl}${state.recoveryPath}`, { headers }));
    if (recovered.citations?.length !== 1) {
      throw new Error("Crash recovery did not return one citation");
    }
    console.log(JSON.stringify({
      status: "recovered-after-crash",
      quoteId: state.quoteId,
      settlementId: recovered.settlement?.id,
    }, null, 2));
    process.exit(0);
  }
  const retried = spawnSync(
    "npx",
    [
      "--yes",
      "@solana/pay@1.0.26",
      "--sandbox",
      "curl",
      "--fail-with-body",
      "-s",
      "-H",
      `x-openshelf-query-token: ${state.queryToken}`,
      `${baseUrl}${state.resourcePath}`,
    ],
    { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] },
  );
  if (retried.status === 0) {
    throw new Error("A new signed payment escaped the durable crash fence");
  }
  console.log(JSON.stringify({ status: "retry-blocked", quoteId: state.quoteId }, null, 2));
  process.exit(0);
}

const resolution = await json(await fetch(`${baseUrl}/api/v1/questions/resolve`, {
  method: "POST",
  headers: { "content-type": "application/json" },
  body: JSON.stringify({
    question: "Where do people who live in Seongsu eat lunch on weekdays?",
    requestedDocuments: 5,
  }),
}));
const match = resolution.matches.find((candidate: { priceKrw: number }) => supported.has(candidate.priceKrw));
if (!match || !resolution.paymentAccessToken) throw new Error("No Pay.sh-compatible match or query token");
const queryToken = resolution.paymentAccessToken as string;
const headers = { "x-openshelf-query-token": queryToken };
const prepared = await json(await fetch(
  `${baseUrl}/api/v1/questions/${encodeURIComponent(resolution.queryId)}/pay-sh-resources/${encodeURIComponent(match.handle)}`,
  { headers },
));

if (stateFile) {
  await writeFile(stateFile, JSON.stringify({
    queryToken,
    quoteId: prepared.quoteId,
    resourcePath: prepared.resourcePath,
    recoveryPath: prepared.recoveryPath,
  } satisfies SmokeState), { mode: 0o600 });
}

if (prepared.status === "delivered") {
  const recovered = await json(await fetch(`${baseUrl}${prepared.recoveryPath}`, { headers }));
  if (recovered.citations?.length !== 1) throw new Error("Pay.sh recovery did not return one citation");
  console.log(JSON.stringify({ status: "already-delivered", quoteId: prepared.quoteId }, null, 2));
  process.exit(0);
}

const unpaid = await fetch(`${baseUrl}${prepared.resourcePath}`, { headers });
if (unpaid.status !== 402) {
  throw new Error(
    `Expected HTTP 402 before payment, received ${unpaid.status}: ${await unpaid.text()}`,
  );
}

const paid = spawnSync(
  "npx",
  ["--yes", "@solana/pay@1.0.26", "--sandbox", "curl", "--fail-with-body", "-s", "-H", `x-openshelf-query-token: ${queryToken}`, `${baseUrl}${prepared.resourcePath}`],
  { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] },
);
if (paid.status !== 0) throw new Error(`pay curl failed: ${paid.stderr || paid.stdout}`);
const delivered = JSON.parse(paid.stdout);
if (delivered.citations?.length !== 1) {
  throw new Error(
    `Paid response did not return one citation: ${JSON.stringify(delivered).slice(0, 1_000)}`,
  );
}
const recovered = await json(await fetch(`${baseUrl}${prepared.recoveryPath}`, { headers }));
if (recovered.settlement?.id !== delivered.settlement?.id) {
  throw new Error("Free recovery did not return the paid settlement");
}
console.log(JSON.stringify({
  status: "paid-and-recovered",
  quoteId: prepared.quoteId,
  settlementId: delivered.settlement.id,
  recipient: prepared.recipientWallet,
  ownerAmountAtomic: prepared.ownerAmountAtomic,
}, null, 2));
