import { readFile, stat } from "node:fs/promises";
import { hostname } from "node:os";
import { isAbsolute, resolve } from "node:path";
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
  signature,
  type Base64EncodedWireTransaction,
  type Instruction,
  type KeyPairSigner,
} from "@solana/kit";
import { repositoryRoot } from "./root-env.js";

const DEVNET_NETWORK = "solana:EtWTRABZaYq6iMfeYKouRu166VU2xqa1";
const MEMO_PROGRAM = address("MemoSq4gqABAXKb96qnH8TysNcWxMyWCqXgDLGmfcHr");
const rustApiUrl = env("RUST_API_URL", "http://127.0.0.1:8787").replace(/\/$/, "");
const internalToken = env("OPENSHELF_INTERNAL_TOKEN", "openshelf-local-internal");
const rpcUrl = env("X402_RPC_URL", "https://api.devnet.solana.com");
const configuredKeypairPath = requiredEnv("OPENSHELF_ESCROW_KEYPAIR_PATH");
const keypairPath = isAbsolute(configuredKeypairPath)
  ? configuredKeypairPath
  : resolve(repositoryRoot, configuredKeypairPath);
const workerId = env("OPENSHELF_PAYOUT_WORKER_ID", `${hostname()}-${process.pid}`);
const watch = process.argv.includes("--watch");
const pollMs = integerEnv("OPENSHELF_PAYOUT_POLL_MS", 5_000);

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
      limit: 20,
      leaseMs: 60_000,
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
  const mintInfo = await fetchMint(rpc, mint, { commitment: "confirmed" });
  const amount = BigInt(claim.amountAtomic);
  if (amount <= 0n) throw new Error("payout amount must be positive");

  const latest = (await rpc.getLatestBlockhash({ commitment: "confirmed" }).send()).value;
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
        lastValidBlockHeight: latest.lastValidBlockHeight,
      }),
    },
  );
  await broadcastAndConfirm(prepared);
}

async function resumePreparedClaim(claim: PayoutClaim): Promise<void> {
  const preparedSignature = claim.transactionSignature as string;
  const status = (
    await rpc
      .getSignatureStatuses([signature(preparedSignature)], {
        searchTransactionHistory: true,
      })
      .send()
  ).value[0];
  if (status?.err) {
    await abandonPrepared(claim, `prepared transaction failed on-chain: ${JSON.stringify(status.err)}`);
    return;
  }
  if (status?.confirmationStatus === "confirmed" || status?.confirmationStatus === "finalized") {
    await markComplete(claim, preparedSignature);
    return;
  }
  const currentHeight = await rpc.getBlockHeight({ commitment: "confirmed" }).send();
  if (currentHeight > BigInt(claim.lastValidBlockHeight as number)) {
    await abandonPrepared(claim, "prepared transaction blockhash expired without landing");
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
    .send();
  if (sentSignature !== claim.transactionSignature) {
    throw new Error("RPC returned a signature different from the prepared payout");
  }
  await waitForConfirmation(claim);
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

async function abandonPrepared(claim: PayoutClaim, error: string): Promise<void> {
  await internalJson<PayoutClaim>(
    `/internal/v1/payout-claims/${encodeURIComponent(claim.id)}/fail`,
    {
      method: "POST",
      body: JSON.stringify({ workerId, error, abandonPreparedTransaction: true }),
    },
  );
}

async function waitForConfirmation(claim: PayoutClaim): Promise<void> {
  const preparedSignature = signature(claim.transactionSignature as string);
  for (;;) {
    const status = (
      await rpc
        .getSignatureStatuses([preparedSignature], { searchTransactionHistory: true })
        .send()
    ).value[0];
    if (status?.err) {
      throw new Error(`payout transaction failed: ${JSON.stringify(status.err)}`);
    }
    if (status?.confirmationStatus === "confirmed" || status?.confirmationStatus === "finalized") {
      return;
    }
    const height = await rpc.getBlockHeight({ commitment: "confirmed" }).send();
    if (height > BigInt(claim.lastValidBlockHeight as number)) {
      throw new Error("payout transaction blockhash expired before confirmation");
    }
    await delay(1_000);
  }
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
  const response = await fetch(`${rustApiUrl}${path}`, {
    ...init,
    headers: {
      "content-type": "application/json",
      "x-openshelf-internal-token": internalToken,
      ...init.headers,
    },
  });
  if (!response.ok) {
    throw new Error(`Rust API ${response.status}: ${(await response.text()).slice(0, 500)}`);
  }
  return (await response.json()) as T;
}

function env(name: string, fallback: string): string {
  return process.env[name]?.trim() || fallback;
}

function requiredEnv(name: string): string {
  const value = process.env[name]?.trim();
  if (!value) throw new Error(`${name} is required`);
  return value;
}

function integerEnv(name: string, fallback: number): number {
  const value = Number.parseInt(process.env[name] ?? "", 10);
  return Number.isInteger(value) && value > 0 ? value : fallback;
}

function safeError(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
