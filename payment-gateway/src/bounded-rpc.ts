import type { SolanaRpc } from "./chain-reconciler.js";

const MAX_FINALITY_RPC_RESPONSE_BYTES = 128 * 1_024;

export function boundedSolanaRpc(
  endpoint: string,
  timeoutMs: number,
  fetchImpl: typeof fetch = fetch,
): SolanaRpc {
  if (!Number.isSafeInteger(timeoutMs) || timeoutMs < 100 || timeoutMs > 10_000) {
    throw new Error("finality RPC timeout must be between 100 and 10000 ms");
  }
  return async (method, params) => {
    const response = await fetchImpl(endpoint, {
      method: "POST",
      redirect: "error",
      signal: AbortSignal.timeout(timeoutMs),
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        jsonrpc: "2.0",
        id: `openshelf-finality-${Date.now()}`,
        method,
        params,
      }),
    });
    const text = await boundedResponseText(
      response,
      MAX_FINALITY_RPC_RESPONSE_BYTES,
      "Solana finality RPC response",
    );
    if (!response.ok) throw new Error(`Solana finality RPC returned HTTP ${response.status}`);
    let value: unknown;
    try {
      value = JSON.parse(text);
    } catch {
      throw new Error("Solana finality RPC returned invalid JSON");
    }
    if (!value || typeof value !== "object" || Array.isArray(value)) {
      throw new Error("Solana finality RPC returned a malformed envelope");
    }
    const payload = value as { result?: unknown; error?: unknown };
    if (payload.error !== undefined || !("result" in payload)) {
      throw new Error("Solana finality RPC did not return a result");
    }
    return payload.result;
  };
}

export async function boundedResponseText(
  response: Response,
  limit: number,
  description = "HTTP response",
): Promise<string> {
  if (!Number.isSafeInteger(limit) || limit < 1) {
    throw new Error("HTTP response size limit must be a positive safe integer");
  }
  const declared = response.headers.get("content-length");
  if (declared && (!/^\d+$/.test(declared) || Number(declared) > limit)) {
    await response.body?.cancel().catch(() => undefined);
    throw new Error(`${description} exceeded the size limit`);
  }
  if (!response.body) return "";
  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let size = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      size += value.byteLength;
      if (size > limit) {
        await reader.cancel();
        throw new Error(`${description} exceeded the size limit`);
      }
      chunks.push(value);
    }
  } finally {
    reader.releaseLock();
  }
  return Buffer.concat(chunks.map((chunk) => Buffer.from(chunk))).toString("utf8");
}
