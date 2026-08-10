import { spawn } from "node:child_process";
import { createServer } from "node:http";

const gatewayBase = (process.env.OPENSHELF_PAY_URL ?? "http://127.0.0.1:1402").replace(/\/$/, "");
const proxyPort = Number.parseInt(process.env.PAY_REPLAY_PROXY_PORT ?? "1403", 10);
const supported = new Set([5, 10, 15, 25, 100, 300, 500, 700, 800, 1000]);
const requestTimeoutMs = 10_000;
const clientTimeoutMs = 60_000;
const maxClientOutputBytes = 1024 * 1024;

function boundedFetch(input: string, init: RequestInit = {}): Promise<Response> {
  return fetch(input, { ...init, signal: AbortSignal.timeout(requestTimeoutMs) });
}

async function runPayClient(args: string[]): Promise<{
  status: number | null;
  stdout: string;
  stderr: string;
}> {
  const child = spawn("npx", args, { stdio: ["ignore", "pipe", "pipe"] });
  let stdout = "";
  let stderr = "";
  const appendBounded = (current: string, chunk: Buffer): string => {
    if (Buffer.byteLength(current) >= maxClientOutputBytes) return current;
    const remaining = maxClientOutputBytes - Buffer.byteLength(current);
    return current + chunk.subarray(0, remaining).toString("utf8");
  };
  child.stdout.on("data", (chunk: Buffer) => {
    stdout = appendBounded(stdout, chunk);
  });
  child.stderr.on("data", (chunk: Buffer) => {
    stderr = appendBounded(stderr, chunk);
  });

  return await new Promise((resolve, reject) => {
    const timeout = setTimeout(() => {
      child.kill("SIGKILL");
      reject(new Error(`The real Pay client exceeded ${clientTimeoutMs}ms`));
    }, clientTimeoutMs);
    child.once("error", (error) => {
      clearTimeout(timeout);
      reject(error);
    });
    child.once("close", (status) => {
      clearTimeout(timeout);
      resolve({ status, stdout, stderr });
    });
  });
}

async function json(response: Response): Promise<Record<string, any>> {
  const body = await response.text();
  if (!response.ok) throw new Error(`${response.status} ${response.statusText}: ${body}`);
  return JSON.parse(body) as Record<string, any>;
}

const resolution = await json(await boundedFetch(`${gatewayBase}/api/v1/questions/resolve`, {
  method: "POST",
  headers: { "content-type": "application/json" },
  body: JSON.stringify({
    question: "Where do people who live in Seongsu eat lunch on weekdays?",
    requestedDocuments: 5,
  }),
}));
const matches = Array.isArray(resolution.matches) ? resolution.matches : [];
const pair = matches.flatMap((left: any, index: number) =>
  matches.slice(index + 1).flatMap((right: any) =>
    left.priceKrw === right.priceKrw && supported.has(left.priceKrw)
      ? [[left, right]]
      : []
  )
)[0];
if (!pair || typeof resolution.paymentAccessToken !== "string") {
  throw new Error("The real seed did not return two same-price documents in one query");
}

const queryToken = resolution.paymentAccessToken;
const queryId = String(resolution.queryId);
const prepare = async (handle: string) => json(await boundedFetch(
  `${gatewayBase}/api/v1/questions/${encodeURIComponent(queryId)}`
    + `/pay-sh-resources/${encodeURIComponent(handle)}`,
  { headers: { "x-openshelf-query-token": queryToken } },
));
const [first, second] = await Promise.all([
  prepare(String(pair[0].handle)),
  prepare(String(pair[1].handle)),
]);
if (
  first.quoteId === second.quoteId
  || typeof first.resourcePath !== "string"
  || typeof second.resourcePath !== "string"
) {
  throw new Error("The replay drill did not obtain two independent quote-bound resources");
}

let unpaidProbes = 0;
let paidRewrites = 0;
const proxy = createServer(async (request, response) => {
  try {
    const paid = typeof request.headers.authorization === "string";
    const targetPath = paid ? second.resourcePath : first.resourcePath;
    if (paid) paidRewrites += 1;
    else unpaidProbes += 1;
    const headers = new Headers();
    for (const [name, value] of Object.entries(request.headers)) {
      if (value === undefined || name === "host" || name === "content-length") continue;
      headers.set(name, Array.isArray(value) ? value.join(", ") : value);
    }
    const upstream = await boundedFetch(`${gatewayBase}${targetPath}`, {
      method: request.method,
      headers,
      redirect: "manual",
    });
    response.statusCode = upstream.status;
    for (const [name, value] of upstream.headers) response.setHeader(name, value);
    response.end(Buffer.from(await upstream.arrayBuffer()));
  } catch (error) {
    response.statusCode = 502;
    response.end(String(error));
  }
});
await new Promise<void>((resolve, reject) => {
  proxy.once("error", reject);
  proxy.listen(proxyPort, "127.0.0.1", resolve);
});

try {
  const paid = await runPayClient([
      "--yes",
      "@solana/pay@1.0.26",
      "--sandbox",
      "curl",
      "--fail-with-body",
      "-s",
      "-H",
      `x-openshelf-query-token: ${queryToken}`,
      `http://127.0.0.1:${proxyPort}${first.resourcePath}`,
    ]);
  if (unpaidProbes !== 1 || paidRewrites !== 1) {
    throw new Error(
      `The real client did not exercise one challenge and one rewritten credential `
        + `(unpaid=${unpaidProbes}, paid=${paidRewrites})`,
    );
  }
  if (paid.status === 0) {
    throw new Error(
      `A credential signed for ${first.quoteId} opened ${second.quoteId}: `
        + paid.stdout.slice(0, 500),
    );
  }
  console.log(JSON.stringify({
    status: "cross-route-credential-blocked",
    firstQuoteId: first.quoteId,
    secondQuoteId: second.quoteId,
  }, null, 2));
} finally {
  await new Promise<void>((resolve, reject) => {
    proxy.close((error) => error ? reject(error) : resolve());
    proxy.closeAllConnections();
  });
}
