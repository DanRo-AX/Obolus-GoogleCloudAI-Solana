import { spawnSync } from "node:child_process";

const baseUrl = (process.env.OPENSHELF_PAY_URL ?? "http://127.0.0.1:3402").replace(/\/$/, "");
const supported = new Set([5, 10, 15, 25, 100, 300, 500, 700, 800, 1000]);

async function json(response: Response) {
  const body = await response.text();
  if (!response.ok) throw new Error(`${response.status} ${response.statusText}: ${body}`);
  return JSON.parse(body);
}

const health = await fetch(`${baseUrl}/healthz`);
if (!health.ok) throw new Error(`Pay.sh gateway is not healthy: HTTP ${health.status}`);

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

if (prepared.status === "delivered") {
  const recovered = await json(await fetch(`${baseUrl}${prepared.recoveryPath}`, { headers }));
  if (recovered.citations?.length !== 1) throw new Error("Pay.sh recovery did not return one citation");
  console.log(JSON.stringify({ status: "already-delivered", quoteId: prepared.quoteId }, null, 2));
  process.exit(0);
}

const unpaid = await fetch(`${baseUrl}${prepared.resourcePath}`, { headers });
if (unpaid.status !== 402) throw new Error(`Expected HTTP 402 before payment, received ${unpaid.status}`);

const paid = spawnSync(
  "npx",
  ["--yes", "@solana/pay@1.0.26", "--sandbox", "curl", "-s", "-H", `x-openshelf-query-token: ${queryToken}`, `${baseUrl}${prepared.resourcePath}`],
  { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] },
);
if (paid.status !== 0) throw new Error(`pay curl failed: ${paid.stderr || paid.stdout}`);
const delivered = JSON.parse(paid.stdout);
if (delivered.citations?.length !== 1) throw new Error("Paid response did not return one citation");
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
