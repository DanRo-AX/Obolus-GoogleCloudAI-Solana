import type {
  PaymentPayload,
  PaymentRequirements,
  SettleResponse,
} from "@x402/core/types";

const MAX_FACILITATOR_RESPONSE_BYTES = 64 * 1_024;

type BoundedSettlementOptions = {
  url: string;
  paymentPayload: PaymentPayload;
  paymentRequirements: PaymentRequirements;
  timeoutMs: number;
  fetchImpl?: typeof fetch;
};

/**
 * A cancellable, size-bounded equivalent of HTTPFacilitatorClient.settle.
 * Verification/capability discovery still use the SDK client; only the single
 * money-moving request needs this stricter transport boundary.
 */
export async function boundedFacilitatorSettlement(
  options: BoundedSettlementOptions,
): Promise<SettleResponse> {
  if (
    !Number.isSafeInteger(options.timeoutMs)
    || options.timeoutMs < 100
    || options.timeoutMs > 30_000
  ) {
    throw new Error("facilitator settlement timeout must be between 100 and 30000 ms");
  }
  const response = await (options.fetchImpl ?? fetch)(`${options.url.replace(/\/+$/, "")}/settle`, {
    method: "POST",
    redirect: "error",
    signal: AbortSignal.timeout(options.timeoutMs),
    headers: { "content-type": "application/json" },
    body: JSON.stringify(
      {
        x402Version: options.paymentPayload.x402Version,
        paymentPayload: options.paymentPayload,
        paymentRequirements: options.paymentRequirements,
      },
      (_key, value: unknown) => typeof value === "bigint" ? value.toString() : value,
    ),
  });
  const text = await boundedResponseText(response, MAX_FACILITATOR_RESPONSE_BYTES);
  if (!response.ok) {
    throw new Error(`facilitator settlement returned HTTP ${response.status}`);
  }
  return parseSettlementResponse(text);
}

async function boundedResponseText(response: Response, limit: number): Promise<string> {
  const declared = response.headers.get("content-length");
  if (declared && (!/^\d+$/.test(declared) || Number(declared) > limit)) {
    await response.body?.cancel().catch(() => undefined);
    throw new Error("facilitator settlement response exceeded the size limit");
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
        throw new Error("facilitator settlement response exceeded the size limit");
      }
      chunks.push(value);
    }
  } finally {
    reader.releaseLock();
  }
  return Buffer.concat(chunks.map((chunk) => Buffer.from(chunk))).toString("utf8");
}

function parseSettlementResponse(text: string): SettleResponse {
  let value: unknown;
  try {
    value = JSON.parse(text);
  } catch {
    throw new Error("facilitator settlement returned invalid JSON");
  }
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error("facilitator settlement returned an invalid response");
  }
  const record = value as Record<string, unknown>;
  if (
    typeof record.success !== "boolean"
    || typeof record.transaction !== "string"
    || record.transaction.length > 128
    || typeof record.network !== "string"
    || record.network.length < 3
    || record.network.length > 128
    || !optionalBoundedString(record.payer, 128)
    || !optionalBoundedString(record.amount, 64)
    || (typeof record.amount === "string" && !/^[1-9]\d*$/.test(record.amount))
    || !optionalBoundedString(record.errorReason, 256)
    || !optionalBoundedString(record.errorMessage, 1_024)
    || (record.success && (record.transaction.length === 0 || typeof record.payer !== "string"))
  ) {
    throw new Error("facilitator settlement returned malformed fields");
  }
  return value as SettleResponse;
}

function optionalBoundedString(value: unknown, limit: number): boolean {
  return value === undefined || (typeof value === "string" && value.length <= limit);
}
