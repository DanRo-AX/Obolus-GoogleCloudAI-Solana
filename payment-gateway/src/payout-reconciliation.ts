import { independentRpcUrls } from "./rpc-policy.js";
import { address, signature } from "@solana/kit";
import { boundedResponseText } from "./bounded-rpc.js";

const DEVNET_NETWORK = "solana:EtWTRABZaYq6iMfeYKouRu166VU2xqa1";
const DEVNET_USDC = "4zMMC9srt5Ri5X14GAgXhaHii3GnPAEERYPJgZJDncDU";
const MAX_PAYOUT_ATOMIC = 9_223_372_036_854_775_807n;

export type PreparedPayoutObservation = "finalized" | "absent_or_failed" | "inconclusive";

type SignatureStatus = {
  err: unknown;
  confirmationStatus?: unknown;
};

export type LocalPayoutClaimView = {
  id: string;
  escrowWallet: string;
  recipientWallet: string;
  asset: string;
  network: string;
  amountAtomic: string;
  status: string;
  transactionSignature?: string;
  signedTransactionBase64?: string;
  recentBlockhash?: string;
  lastValidBlockHeight?: number;
};

export function ledgerBlockHeight(value: number | bigint): number {
  if (typeof value === "bigint") {
    if (value <= 0n || value > BigInt(Number.MAX_SAFE_INTEGER)) {
      throw new Error("payout block height is outside the JSON safe-integer range");
    }
    return Number(value);
  }
  if (!Number.isSafeInteger(value) || value <= 0) {
    throw new Error("payout block height is not a positive safe integer");
  }
  return value;
}

export function validateLocalPayoutClaim(
  claim: LocalPayoutClaimView,
  signerAddress: string,
): void {
  if (!/^[A-Za-z0-9:_-]{3,128}$/.test(claim.id)) throw new Error("unsafe payout memo id");
  if (claim.escrowWallet !== signerAddress) throw new Error("payout escrow signer mismatch");
  if (claim.network !== DEVNET_NETWORK) throw new Error("payout network mismatch");
  if (claim.asset !== DEVNET_USDC) throw new Error("payout asset mismatch");
  address(claim.escrowWallet);
  address(claim.recipientWallet);
  if (!/^[1-9][0-9]*$/.test(claim.amountAtomic)) {
    throw new Error("payout amount is not a canonical positive integer");
  }
  if (BigInt(claim.amountAtomic) > MAX_PAYOUT_ATOMIC) {
    throw new Error("payout amount exceeds the ledger range");
  }
  if (claim.status !== "leased" && claim.status !== "prepared") {
    throw new Error("payout status is not worker-owned");
  }
  const evidence = [
    claim.transactionSignature,
    claim.signedTransactionBase64,
    claim.recentBlockhash,
    claim.lastValidBlockHeight,
  ];
  if (claim.status === "leased") {
    if (evidence.some((value) => value != null)) throw new Error("leased payout has partial evidence");
    return;
  }
  if (evidence.some((value) => value == null)) throw new Error("prepared payout evidence is incomplete");
  signature(claim.transactionSignature as string);
  address(claim.recentBlockhash as string);
  const encoded = claim.signedTransactionBase64 as string;
  if (
    encoded.length < 32
    || encoded.length > 32_768
    || !/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/.test(encoded)
    || Buffer.from(encoded, "base64").toString("base64") !== encoded
  ) throw new Error("prepared payout bytes are not canonical base64");
  if (!Number.isSafeInteger(claim.lastValidBlockHeight) || (claim.lastValidBlockHeight ?? 0) <= 0) {
    throw new Error("prepared payout block height is invalid");
  }
}

/** Requires unanimous finalized evidence from distinct RPC origins. */
export async function observePreparedPayout(options: {
  transactionSignature?: string;
  lastValidBlockHeight?: number;
  rpcUrls: string[];
  fetchImpl?: typeof globalThis.fetch;
  rpcTimeoutMs?: number;
}): Promise<PreparedPayoutObservation> {
  if (!options.transactionSignature || !options.lastValidBlockHeight) return "inconclusive";
  const rpcUrls = independentRpcUrls(options.rpcUrls);
  if (rpcUrls.length < 2) return "inconclusive";
  const fetchImpl = options.fetchImpl ?? globalThis.fetch;
  const rpcTimeoutMs = safeTimeout(options.rpcTimeoutMs);
  const views = await Promise.all(rpcUrls.map(async (rpcUrl) => {
    try {
      const statuses = await rpcCall<{ value: Array<SignatureStatus | null> }>(
        fetchImpl,
        rpcUrl,
        "getSignatureStatuses",
        [[options.transactionSignature], { searchTransactionHistory: true }],
        rpcTimeoutMs,
      );
      if (!Array.isArray(statuses.value) || statuses.value.length !== 1) return null;
      const status = statuses.value[0];
      if (status !== null && (typeof status !== "object" || !Object.hasOwn(status, "err"))) {
        return null;
      }
      const blockHeight = await rpcCall<number>(
        fetchImpl,
        rpcUrl,
        "getBlockHeight",
        [{ commitment: "finalized" }],
        rpcTimeoutMs,
      );
      if (!Number.isSafeInteger(blockHeight) || blockHeight < 0) return null;
      return { status, blockHeight };
    } catch {
      return null;
    }
  }));
  if (views.some((view) => view === null)) return "inconclusive";
  const complete = views as Array<{ status: SignatureStatus | null; blockHeight: number }>;
  if (complete.every(({ status }) =>
    status?.err === null && status.confirmationStatus === "finalized"
  )) return "finalized";
  if (complete.some(({ status }) =>
    status?.err === null
      && (status.confirmationStatus === "confirmed" || status.confirmationStatus === "finalized")
  )) return "inconclusive";
  return complete.every(({ blockHeight }) =>
    blockHeight > (options.lastValidBlockHeight ?? Number.MAX_SAFE_INTEGER)
  )
    ? "absent_or_failed"
    : "inconclusive";
}

let rpcId = 0;
const MAX_RPC_RESPONSE_BYTES = 1024 * 1024;

async function rpcCall<T>(
  fetchImpl: typeof globalThis.fetch,
  rpcUrl: string,
  method: string,
  params: unknown[],
  timeoutMs: number,
): Promise<T> {
  rpcId += 1;
  const response = await fetchImpl(rpcUrl, {
    method: "POST",
    redirect: "error",
    signal: AbortSignal.timeout(timeoutMs),
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ jsonrpc: "2.0", id: rpcId, method, params }),
  });
  const text = await boundedResponseText(
    response,
    MAX_RPC_RESPONSE_BYTES,
    `Solana RPC ${method} response`,
  );
  if (!response.ok) throw new Error(`Solana RPC ${response.status} during ${method}`);
  const body = JSON.parse(text) as { result?: T; error?: { message?: string } };
  if (body.error || !Object.hasOwn(body, "result")) {
    throw new Error(`Solana RPC ${method} failed: ${body.error?.message ?? "missing result"}`);
  }
  return body.result as T;
}

function safeTimeout(value: number | undefined): number {
  return Number.isSafeInteger(value) && (value ?? 0) > 0 && (value ?? 0) <= 60_000
    ? value as number
    : 10_000;
}
