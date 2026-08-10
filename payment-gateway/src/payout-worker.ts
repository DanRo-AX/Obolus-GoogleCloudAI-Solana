import { readFile, stat } from "node:fs/promises";
import { hostname } from "node:os";
import { isAbsolute, resolve } from "node:path";
import { performance } from "node:perf_hooks";
import {
  fetchMint,
  findAssociatedTokenPda,
  getCreateAssociatedTokenIdempotentInstruction,
  getTransferCheckedInstruction,
  TOKEN_PROGRAM_ADDRESS,
} from "@solana-program/token";
import {
  address,
  appendTransactionMessageInstructions,
  createKeyPairSignerFromBytes,
  createKeyPairSignerFromPrivateKeyBytes,
  createSolanaRpc,
  createTransactionMessage,
  devnet,
  getBase64EncodedWireTransaction,
  getSignatureFromTransaction,
  pipe,
  setTransactionMessageFeePayerSigner,
  setTransactionMessageLifetimeUsingBlockhash,
  signTransactionMessageWithSigners,
  type Base64EncodedWireTransaction,
  type Instruction,
  type KeyPairSigner,
} from "@solana/kit";
import { repositoryRoot } from "./root-env.js";
import { independentRpcUrls } from "./rpc-policy.js";
import {
  ledgerBlockHeight,
  observePreparedPayout,
  validateLocalPayoutClaim,
} from "./payout-reconciliation.js";
import { payoutLedgerJson } from "./payout-ledger-client.js";
import { secureServiceOrigin } from "./url-policy.js";
import { integerEnv } from "./runtime-config.js";

const DEVNET_NETWORK = "solana:EtWTRABZaYq6iMfeYKouRu166VU2xqa1";
const MEMO_PROGRAM = address("MemoSq4gqABAXKb96qnH8TysNcWxMyWCqXgDLGmfcHr");
const rustApiUrl = secureServiceOrigin(
  "RUST_API_URL",
  env("RUST_API_URL", "http://127.0.0.1:8787"),
);
const internalToken = env("OPENSHELF_INTERNAL_TOKEN", "openshelf-local-internal");
const rpcUrl = env("X402_RPC_URL", "https://api.devnet.solana.com");
const reconciliationRpcUrls = independentRpcUrls([
  rpcUrl,
  ...(process.env.X402_RECONCILIATION_RPC_URLS ?? "")
    .split(",")
    .map((value) => value.trim())
    .filter(Boolean),
]);
if (reconciliationRpcUrls.length < 2) {
  throw new Error("X402_RECONCILIATION_RPC_URLS must include a second payout RPC origin");
}
const configuredKeypairPath = requiredEnv("OPENSHELF_ESCROW_KEYPAIR_PATH");
const keypairPath = isAbsolute(configuredKeypairPath)
  ? configuredKeypairPath
  : resolve(repositoryRoot, configuredKeypairPath);
const workerId = env("OPENSHELF_PAYOUT_WORKER_ID", `${hostname()}-${process.pid}`);
const watch = process.argv.includes("--watch");
const pollMs = integerEnv("OPENSHELF_PAYOUT_POLL_MS", 5_000, 1_000, 300_000);

type PayoutClaim = {
  id: string;
  earningEventId?: string;
  openCallId?: string;
  beneficiaryUserId: string;
  kind: string;
  escrowWallet: string;
  recipientWallet: string;
  asset: string;
  network: string;
  amountAtomic: string;
  amountKrw: number;
  status: "leased" | "prepared" | "confirmed" | "failed" | string;
  transactionSignature?: string;
  signedTransactionBase64?: string;
  recentBlockhash?: string;
  lastValidBlockHeight?: number;
  attemptCount: number;
};

const escrow = await loadKeypair(keypairPath);
const rpc = createSolanaRpc(devnet(rpcUrl));

do {
  const claims = await internalJson<PayoutClaim[]>("/internal/v1/payout-claims/lease", {
    method: "POST",
    body: JSON.stringify({
      workerId,
      escrowWallet: escrow.address,
      network: DEVNET_NETWORK,
      limit: 1,
      leaseMs: 600_000,
    }),
  });
  for (const claim of claims) {
    try {
      await processClaim(claim);
    } catch (error) {
      const message = safeError(error);
      console.error(`payout ${claim.id} failed`, message);
      await internalJson<PayoutClaim>(
        `/internal/v1/payout-claims/${encodeURIComponent(claim.id)}/fail`,
        {
          method: "POST",
          body: JSON.stringify({ workerId, error: message, abandonPreparedTransaction: false }),
        },
      ).catch((recordError) => {
        console.error(`could not persist payout ${claim.id} failure`, safeError(recordError));
      });
    }
  }
  if (watch) await delay(pollMs);
} while (watch);

async function processClaim(claim: PayoutClaim): Promise<void> {
  validateLocalPayoutClaim(claim, escrow.address);
  if (claim.network !== DEVNET_NETWORK) {
    throw new Error(`payout worker is Devnet-only; rejected network ${claim.network}`);
  }
  if (claim.escrowWallet !== escrow.address) {
    throw new Error(
      `claim escrow ${claim.escrowWallet} does not match worker ${escrow.address}`,
    );
  }

  if (
    claim.status === "prepared" &&
    claim.transactionSignature &&
    claim.signedTransactionBase64 &&
    claim.recentBlockhash &&
    claim.lastValidBlockHeight
  ) {
    await resumePreparedClaim(claim);
    return;
  }

  const mint = address(claim.asset);
  const recipient = address(claim.recipientWallet);
  const [source] = await findAssociatedTokenPda({
    owner: escrow.address,
    tokenProgram: TOKEN_PROGRAM_ADDRESS,
    mint,
  });
  const [destination] = await findAssociatedTokenPda({
    owner: recipient,
    tokenProgram: TOKEN_PROGRAM_ADDRESS,
    mint,
  });
  const mintInfo = await fetchMint(rpc, mint, {
    commitment: "confirmed",
    abortSignal: AbortSignal.timeout(10_000),
  });
  const amount = BigInt(claim.amountAtomic);
  if (amount <= 0n) throw new Error("payout amount must be positive");

  const latest = (await rpc
    .getLatestBlockhash({ commitment: "confirmed" })
    .send({ abortSignal: AbortSignal.timeout(10_000) })).value;
  const lastValidBlockHeight = ledgerBlockHeight(latest.lastValidBlockHeight);
  const memoInstruction: Instruction = {
    programAddress: MEMO_PROGRAM,
    accounts: [],
    data: new TextEncoder().encode(`openshelf:payout:${claim.id}`),
  };
  const message = pipe(
    createTransactionMessage({ version: 0 }),
    (value) => setTransactionMessageFeePayerSigner(escrow, value),
    (value) => setTransactionMessageLifetimeUsingBlockhash(latest, value),
    (value) =>
      appendTransactionMessageInstructions(
        [
          getCreateAssociatedTokenIdempotentInstruction({
            payer: escrow,
            ata: destination,
            owner: recipient,
            mint,
          }),
          getTransferCheckedInstruction({
            source,
            mint,
            destination,
            authority: escrow,
            amount,
            decimals: mintInfo.data.decimals,
          }),
          memoInstruction,
        ],
        value,
      ),
  );
  const transaction = await signTransactionMessageWithSigners(message);
  const raw = getBase64EncodedWireTransaction(transaction);
  const preparedSignature = getSignatureFromTransaction(transaction);

  const prepared = await internalJson<PayoutClaim>(
    `/internal/v1/payout-claims/${encodeURIComponent(claim.id)}/prepare`,
    {
      method: "POST",
      body: JSON.stringify({
        workerId,
        transactionSignature: preparedSignature,
        signedTransactionBase64: raw,
        recentBlockhash: latest.blockhash,
        lastValidBlockHeight,
      }),
    },
  );
  await broadcastAndConfirm(prepared);
}

async function resumePreparedClaim(claim: PayoutClaim): Promise<void> {
  const preparedSignature = claim.transactionSignature as string;
  const observation = await observePreparedPayout({
    transactionSignature: preparedSignature,
    lastValidBlockHeight: claim.lastValidBlockHeight,
    rpcUrls: reconciliationRpcUrls,
  });
  if (observation === "finalized") {
    await markComplete(claim, preparedSignature);
    return;
  }
  if (observation === "absent_or_failed") {
    await markPreparedAbsent(claim);
    return;
  }
  await broadcastAndConfirm(claim);
}

async function broadcastAndConfirm(claim: PayoutClaim): Promise<void> {
  if (
    !claim.transactionSignature ||
    !claim.signedTransactionBase64 ||
    !claim.recentBlockhash ||
    !claim.lastValidBlockHeight
  ) {
    throw new Error("prepared payout is missing its durable signed transaction");
  }
  const sentSignature = await rpc
    .sendTransaction(claim.signedTransactionBase64 as Base64EncodedWireTransaction, {
      encoding: "base64",
      skipPreflight: false,
      preflightCommitment: "confirmed",
      maxRetries: 3n,
    })
    .send({ abortSignal: AbortSignal.timeout(10_000) });
  if (sentSignature !== claim.transactionSignature) {
    throw new Error("RPC returned a signature different from the prepared payout");
  }
  const outcome = await waitForFinalizedOutcome(claim);
  if (outcome === "absent_or_failed") {
    await markPreparedAbsent(claim);
    return;
  }
  await markComplete(claim, sentSignature);
  console.log(
    `paid ${claim.amountAtomic} atomic units to ${claim.recipientWallet} for ${claim.id}: ${sentSignature}`,
  );
}

async function markComplete(claim: PayoutClaim, signature: string): Promise<void> {
  await internalJson<PayoutClaim>(
    `/internal/v1/payout-claims/${encodeURIComponent(claim.id)}/complete`,
    {
      method: "POST",
      body: JSON.stringify({ workerId, transactionSignature: signature }),
    },
  );
}

async function waitForFinalizedOutcome(
  claim: PayoutClaim,
): Promise<"finalized" | "absent_or_failed"> {
  const deadline = performance.now() + 45_000;
  while (performance.now() < deadline) {
    const observation = await observePreparedPayout({
      transactionSignature: claim.transactionSignature,
      lastValidBlockHeight: claim.lastValidBlockHeight,
      rpcUrls: reconciliationRpcUrls,
    });
    if (observation !== "inconclusive") return observation;
    const remaining = deadline - performance.now();
    if (remaining > 0) await delay(Math.min(1_000, remaining));
  }
  throw new Error("payout finalization timed out with inconclusive independent RPC views");
}

async function markPreparedAbsent(claim: PayoutClaim): Promise<void> {
  await internalJson<PayoutClaim>(
    `/internal/v1/payout-claims/${encodeURIComponent(claim.id)}/fail`,
    {
      method: "POST",
      body: JSON.stringify({
        workerId,
        error: "two independent finalized RPC views found no successful prepared payout",
        abandonPreparedTransaction: true,
      }),
    },
  );
}

async function loadKeypair(path: string): Promise<KeyPairSigner> {
  const metadata = await stat(path);
  if ((metadata.mode & 0o077) !== 0) {
    throw new Error("escrow keypair file must not be readable by group or other users (chmod 600)");
  }
  const parsed = JSON.parse(await readFile(path, "utf8")) as unknown;
  const bytes = Array.isArray(parsed)
    ? parsed
    : parsed && typeof parsed === "object" && Array.isArray((parsed as { secretKey?: unknown }).secretKey)
      ? (parsed as { secretKey: unknown[] }).secretKey
      : null;
  if (
    !bytes ||
    ![32, 64].includes(bytes.length) ||
    bytes.some((value) => !Number.isInteger(value) || (value as number) < 0 || (value as number) > 255)
  ) {
    throw new Error("escrow keypair must be a 32-byte seed or Solana CLI 64-byte JSON secret key");
  }
  const secret = Uint8Array.from(bytes as number[]);
  return secret.length === 64
    ? createKeyPairSignerFromBytes(secret)
    : createKeyPairSignerFromPrivateKeyBytes(secret);
}

async function internalJson<T>(path: string, init: RequestInit): Promise<T> {
  return payoutLedgerJson<T>({
    baseUrl: rustApiUrl,
    internalToken,
    path,
    init,
  });
}

function env(name: string, fallback: string): string {
  return process.env[name]?.trim() || fallback;
}

function requiredEnv(name: string): string {
  const value = process.env[name]?.trim();
  if (!value) throw new Error(`${name} is required`);
  return value;
}

function safeError(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
