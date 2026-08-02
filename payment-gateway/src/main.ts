import express, { type NextFunction, type Request, type Response } from "express";
import { appendFile, readFile } from "node:fs/promises";
import { HTTPFacilitatorClient, type HTTPRequestContext } from "@x402/core/server";
import type { Network } from "@x402/core/types";
import { paymentMiddleware, x402ResourceServer } from "@x402/express";
import { registerExactSvmScheme } from "@x402/svm/exact/server";

const DEVNET_NETWORK = "solana:EtWTRABZaYq6iMfeYKouRu166VU2xqa1" as Network;
const rustApiUrl = env("RUST_API_URL", "http://127.0.0.1:8787").replace(/\/$/, "");
const internalToken = env("OPENSHELF_INTERNAL_TOKEN", "openshelf-local-internal");
const facilitatorUrl = env("X402_FACILITATOR_URL", "https://x402.org/facilitator");
const network = env("X402_NETWORK", DEVNET_NETWORK) as Network;
const rpcUrl = process.env.X402_RPC_URL?.trim() || undefined;
const allowedOrigin = env("FRONTEND_ORIGIN", "http://localhost:4319");
const port = integerEnv("PORT", 1402);
const outboxPath = env("X402_OUTBOX_PATH", "x402-outbox.ndjson");

type PaymentQuote = {
  id: string;
  queryId: string;
  documentHandle: string;
  payTo: string;
  network: Network;
  asset: string;
  amountAtomic: string;
  priceKrw: number;
  krwPerUsdc: number;
  expiresAt: number;
  resourcePath: string;
};

type PaidDocument = {
  quoteId: string;
  citation: {
    handle: string;
    shelf: string;
    excerpt: string;
    price: number;
  };
};

type RouteIdentity = { queryId: string; handle: string; key: string };
type QuoteCacheEntry = { quote: Promise<PaymentQuote>; expiresAt: number };
type PendingSettlement = {
  quoteId: string;
  transactionSignature: string;
  payer: string;
  payTo: string;
  amountAtomic: string;
  network: string;
  rawResponse: unknown;
};
type OutboxRecord =
  | { kind: "pending"; settlement: PendingSettlement }
  | { kind: "completed"; transactionSignature: string };

const quotes = new Map<string, QuoteCacheEntry>();
const pendingSettlements = new Map<string, PendingSettlement>();

async function internalJson<T>(path: string, init: RequestInit = {}): Promise<T> {
  const response = await fetch(`${rustApiUrl}${path}`, {
    ...init,
    headers: {
      "content-type": "application/json",
      "x-openshelf-internal-token": internalToken,
      ...init.headers,
    },
  });
  if (!response.ok) {
    const body = await response.text();
    throw new Error(`Rust API ${response.status}: ${body.slice(0, 500)}`);
  }
  return (await response.json()) as T;
}

function identityFromPath(path: string): RouteIdentity {
  const pathname = path.startsWith("http") ? new URL(path).pathname : path.split("?")[0];
  const match = pathname.match(/^\/api\/v1\/paid-documents\/([^/]+)\/([^/]+)$/);
  if (!match) throw new Error("invalid paid document path");
  const queryId = decodeURIComponent(match[1]);
  const handle = decodeURIComponent(match[2]);
  if (!queryId || !handle) throw new Error("query id and document handle are required");
  return { queryId, handle, key: `${queryId}\u0000${handle}` };
}

function identityFromContext(context: HTTPRequestContext): RouteIdentity {
  return identityFromPath(context.path);
}

async function getQuote(identity: RouteIdentity): Promise<PaymentQuote> {
  const now = Date.now();
  const cached = quotes.get(identity.key);
  if (cached && cached.expiresAt > now + 5_000) return cached.quote;

  const quotePromise = internalJson<PaymentQuote>(
    `/internal/v1/payment-quotes/${encodeURIComponent(identity.queryId)}/${encodeURIComponent(identity.handle)}`,
  );
  const entry: QuoteCacheEntry = { quote: quotePromise, expiresAt: now + 30_000 };
  quotes.set(identity.key, entry);
  try {
    const quote = await quotePromise;
    if (quote.network !== network) {
      throw new Error(`quote network ${quote.network} does not match gateway network ${network}`);
    }
    entry.expiresAt = quote.expiresAt;
    return quote;
  } catch (error) {
    quotes.delete(identity.key);
    throw error;
  }
}

async function quoteForContext(context: HTTPRequestContext): Promise<PaymentQuote> {
  return getQuote(identityFromContext(context));
}

async function recordSettlement(settlement: PendingSettlement): Promise<void> {
  await internalJson("/internal/v1/chain-settlements", {
    method: "POST",
    body: JSON.stringify(settlement),
  });
  pendingSettlements.delete(settlement.transactionSignature);
  try {
    await appendOutbox({
      kind: "completed",
      transactionSignature: settlement.transactionSignature,
    });
  } catch (error) {
    // Replaying this entry is safe because the Rust endpoint is idempotent.
    console.error("could not mark x402 outbox entry complete", safeError(error));
  }
}

async function appendOutbox(record: OutboxRecord): Promise<void> {
  await appendFile(outboxPath, `${JSON.stringify(record)}\n`, { encoding: "utf8", mode: 0o600 });
}

async function restoreOutbox(): Promise<void> {
  let contents: string;
  try {
    contents = await readFile(outboxPath, "utf8");
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return;
    throw error;
  }
  for (const line of contents.split("\n")) {
    if (!line.trim()) continue;
    try {
      const record = JSON.parse(line) as OutboxRecord;
      if (record.kind === "pending") {
        pendingSettlements.set(
          record.settlement.transactionSignature,
          record.settlement,
        );
      } else if (record.kind === "completed") {
        pendingSettlements.delete(record.transactionSignature);
      }
    } catch (error) {
      console.error("ignoring malformed x402 outbox line", safeError(error));
    }
  }
}

async function retryPendingSettlements(): Promise<void> {
  for (const settlement of pendingSettlements.values()) {
    try {
      await recordSettlement(settlement);
    } catch (error) {
      console.error("x402 reconciliation retry failed", safeError(error));
    }
  }
}

const facilitator = new HTTPFacilitatorClient({ url: facilitatorUrl });
const resourceServer = new x402ResourceServer(facilitator);
registerExactSvmScheme(resourceServer, { networks: [network], rpcUrl });

resourceServer.onAfterVerify(async (context) => {
  if (context.result.payer && context.result.payer === context.requirements.payTo) {
    return {
      abort: true,
      reason: "self_payment_not_allowed",
      message: "payer and document recipient must be different wallets",
    };
  }
});

resourceServer.onAfterSettle(async (context) => {
  if (!context.result.success || !context.result.payer) return;
  const requestPath = (
    context.transportContext as { request?: { path?: string } } | undefined
  )?.request?.path;
  const resourceUrl = context.paymentPayload.resource?.url;
  const identity = identityFromPath(requestPath ?? resourceUrl ?? "");
  const quote = await getQuote(identity);
  const settlement: PendingSettlement = {
    quoteId: quote.id,
    transactionSignature: context.result.transaction,
    payer: context.result.payer,
    payTo: context.requirements.payTo,
    amountAtomic: context.result.amount ?? context.requirements.amount,
    network: context.result.network,
    rawResponse: context.result,
  };
  pendingSettlements.set(settlement.transactionSignature, settlement);
  try {
    await appendOutbox({ kind: "pending", settlement });
    await recordSettlement(settlement);
  } catch (error) {
    console.error("x402 settled on-chain; Rust ledger reconciliation queued", safeError(error));
  }
});

const app = express();
app.disable("x-powered-by");
app.use(express.json({ limit: "32kb" }));
app.use((request, response, next) => {
  const origin = request.headers.origin;
  if (origin === allowedOrigin) response.setHeader("access-control-allow-origin", origin);
  response.setHeader("vary", "Origin");
  response.setHeader("access-control-allow-methods", "GET,OPTIONS");
  response.setHeader(
    "access-control-allow-headers",
    // @x402/fetch adds Access-Control-Expose-Headers to its paid retry.
    // It is unusual as a request header, but must be allowed or the browser
    // blocks the signed retry during CORS preflight with `Failed to fetch`.
    "Content-Type,Payment-Signature,X-Payment,Access-Control-Expose-Headers",
  );
  response.setHeader(
    "access-control-expose-headers",
    "Payment-Required,Payment-Response,X-Payment-Response",
  );
  if (request.method === "OPTIONS") {
    response.sendStatus(204);
    return;
  }
  next();
});

app.get("/healthz", (_request, response) => {
  response.json({
    status: "ok",
    network,
    facilitator: facilitatorUrl,
    pendingReconciliations: pendingSettlements.size,
  });
});

app.use(
  paymentMiddleware(
    {
      "GET /api/v1/paid-documents/*": {
        accepts: {
          scheme: "exact",
          network,
          payTo: async (context) => (await quoteForContext(context)).payTo,
          price: async (context) => {
            const quote = await quoteForContext(context);
            return { asset: quote.asset, amount: quote.amountAtomic };
          },
          maxTimeoutSeconds: 60,
        },
        description: "Open one matched OPENSHELF document",
        mimeType: "application/json",
        serviceName: "OPENSHELF",
        unpaidResponseBody: async (context) => {
          const quote = await quoteForContext(context);
          return {
            contentType: "application/json",
            body: {
              error: { code: "payment_required", message: "USDC payment is required" },
              quote,
            },
          };
        },
      },
    },
    resourceServer,
    { appName: "OPENSHELF", testnet: network === DEVNET_NETWORK },
  ),
);

app.get("/api/v1/paid-documents/:queryId/:handle", async (request, response, next) => {
  try {
    const identity: RouteIdentity = {
      queryId: request.params.queryId,
      handle: request.params.handle,
      key: `${request.params.queryId}\u0000${request.params.handle}`,
    };
    const quote = await getQuote(identity);
    const document = await internalJson<PaidDocument>(
      `/internal/v1/payment-quotes/${encodeURIComponent(quote.id)}/document`,
    );
    response.json({
      citations: [document.citation],
      settlement: {
        id: quote.id,
        count: 1,
        total: quote.priceKrw,
        network: quote.network,
      },
    });
  } catch (error) {
    next(error);
  }
});

app.use((error: unknown, _request: Request, response: Response, _next: NextFunction) => {
  console.error("gateway request failed", safeError(error));
  response.status(502).json({
    error: { code: "gateway_error", message: safeError(error) },
  });
});

await restoreOutbox();
setInterval(() => void retryPendingSettlements(), 5_000).unref();
app.listen(port, "0.0.0.0", () => {
  console.log(`OPENSHELF x402 gateway listening on http://0.0.0.0:${port}`);
});

function env(name: string, fallback: string): string {
  return process.env[name]?.trim() || fallback;
}

function integerEnv(name: string, fallback: number): number {
  const parsed = Number.parseInt(process.env[name] ?? "", 10);
  return Number.isInteger(parsed) && parsed > 0 ? parsed : fallback;
}

function safeError(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
