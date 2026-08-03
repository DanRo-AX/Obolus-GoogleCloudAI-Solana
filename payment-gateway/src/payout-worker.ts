import { open, readFile } from "node:fs/promises";
import {
  findAssociatedTokenPda,
  getCreateAssociatedTokenIdempotentInstruction,
  getTransferCheckedInstruction,
  TOKEN_PROGRAM_ADDRESS,
} from "@solana-program/token";
import {
  address,
  appendTransactionMessageInstructions,
  createKeyPairSignerFromBytes,
  createSolanaRpc,
  createTransactionMessage,
  getBase64EncodedWireTransaction,
  getSignatureFromTransaction,
  pipe,
  setTransactionMessageFeePayerSigner,
  setTransactionMessageLifetimeUsingBlockhash,
  signTransactionMessageWithSigners,
  type Base64EncodedWireTransaction,
  type Signature,
} from "@solana/kit";

type Claim = {
  earningEventId: string;
  recipientWallet: string;
  amountAtomic: string;
  network: string;
  asset: string;
};

const DEVNET_NETWORK = "solana:EtWTRABZaYq6iMfeYKouRu166VU2xqa1";
const enabled = process.env.OPENSHELF_ENABLE_BUNDLE_PAYOUTS === "true";
if (!enabled) throw new Error("set OPENSHELF_ENABLE_BUNDLE_PAYOUTS=true to run payouts");

const network = required("X402_NETWORK", DEVNET_NETWORK);
if (network !== DEVNET_NETWORK && process.env.OPENSHELF_ALLOW_MAINNET_PAYOUTS !== "true") {
  throw new Error("mainnet bundle payouts require OPENSHELF_ALLOW_MAINNET_PAYOUTS=true");
}
const rustApiUrl = required("RUST_API_URL", "http://127.0.0.1:8787").replace(/\/$/, "");
const internalToken = required("OPENSHELF_INTERNAL_TOKEN");
const rpcUrl = required("X402_RPC_URL", "https://api.devnet.solana.com");
const secretPath = required("OPENSHELF_BUNDLE_ESCROW_KEYPAIR_PATH");
const secret = JSON.parse(await readFile(secretPath, "utf8")) as number[];
if (!Array.isArray(secret) || secret.length !== 64) throw new Error("escrow keypair must contain 64 bytes");

const escrow = await createKeyPairSignerFromBytes(Uint8Array.from(secret));
const rpc = createSolanaRpc(rpcUrl);
const intervalMs = positiveInteger("OPENSHELF_PAYOUT_INTERVAL_MS", 15_000);
const outboxPath = required("OPENSHELF_PAYOUT_OUTBOX_PATH", "bundle-payout-outbox.ndjson");
const pending = await restoreOutbox(outboxPath);

for (;;) {
  const claims = await internalJson<Claim[]>("/internal/v1/bundle-payouts?limit=25");
  for (const claim of claims) {
    try {
      await payClaim(claim);
    } catch (error) {
      console.error("bundle payout failed", {
        earningEventId: claim.earningEventId,
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }
  if (process.env.OPENSHELF_PAYOUT_ONCE === "true") break;
  await new Promise((resolve) => setTimeout(resolve, intervalMs));
}

async function payClaim(claim: Claim): Promise<void> {
  if (claim.network !== network) throw new Error(`claim network ${claim.network} is not ${network}`);
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
  let prepared = pending.get(claim.earningEventId);
  if (!prepared) {
    // Idempotent ATA creation lets the exact same transaction safely survive
    // a crash whether or not the recipient account already existed.
    const instructions = [
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
        amount: BigInt(claim.amountAtomic),
        decimals: 6,
      }),
    ] as const;
    const { value: lifetime } = await rpc.getLatestBlockhash({ commitment: "confirmed" }).send();
    const message = pipe(
      createTransactionMessage({ version: 0 }),
      (value) => setTransactionMessageFeePayerSigner(escrow, value),
      (value) => setTransactionMessageLifetimeUsingBlockhash(lifetime, value),
      (value) => appendTransactionMessageInstructions(instructions, value),
    );
    const transaction = await signTransactionMessageWithSigners(message);
    const rawBase64 = getBase64EncodedWireTransaction(transaction);
    const signature = getSignatureFromTransaction(transaction);
    prepared = {
      claim,
      signature,
      rawBase64,
    };
    await appendOutbox(outboxPath, { kind: "pending", prepared });
    pending.set(claim.earningEventId, prepared);
  }
  const submitted = await rpc.sendTransaction(prepared.rawBase64 as Base64EncodedWireTransaction, {
    encoding: "base64",
    maxRetries: 5n,
    skipPreflight: false,
    preflightCommitment: "confirmed",
  }).send();
  if (submitted !== prepared.signature) throw new Error("RPC returned a different payout signature");
  await waitForConfirmation(prepared.signature);
  const signature = prepared.signature;
  await internalJson("/internal/v1/bundle-payouts", {
    method: "POST",
    body: JSON.stringify({ ...claim, transactionSignature: signature }),
  });
  await appendOutbox(outboxPath, {
    kind: "completed",
    earningEventId: claim.earningEventId,
  });
  pending.delete(claim.earningEventId);
  console.log(JSON.stringify({ event: "bundle_payout_recorded", ...claim, signature }));
}

async function waitForConfirmation(signature: string): Promise<void> {
  const deadline = Date.now() + 60_000;
  while (Date.now() < deadline) {
    const response = await rpc.getSignatureStatuses([signature as Signature], {
      searchTransactionHistory: true,
    }).send();
    const status = response.value[0];
    if (status?.err) throw new Error(`payout failed: ${JSON.stringify(status.err)}`);
    if (status?.confirmationStatus === "confirmed" || status?.confirmationStatus === "finalized") {
      return;
    }
    await new Promise((resolve) => setTimeout(resolve, 1_000));
  }
  throw new Error(`payout confirmation timed out for ${signature}`);
}

type PreparedPayout = { claim: Claim; signature: string; rawBase64: string };
type PayoutOutboxRecord =
  | { kind: "pending"; prepared: PreparedPayout }
  | { kind: "completed"; earningEventId: string };

async function restoreOutbox(path: string): Promise<Map<string, PreparedPayout>> {
  const restored = new Map<string, PreparedPayout>();
  let contents = "";
  try {
    contents = await readFile(path, "utf8");
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
  }
  for (const line of contents.split("\n")) {
    if (!line.trim()) continue;
    const record = JSON.parse(line) as PayoutOutboxRecord;
    if (record.kind === "pending") {
      restored.set(record.prepared.claim.earningEventId, record.prepared);
    } else {
      restored.delete(record.earningEventId);
    }
  }
  return restored;
}

async function appendOutbox(path: string, record: PayoutOutboxRecord): Promise<void> {
  const file = await open(path, "a", 0o600);
  try {
    await file.writeFile(`${JSON.stringify(record)}\n`, "utf8");
    await file.sync();
  } finally {
    await file.close();
  }
}

async function internalJson<T>(path: string, init: RequestInit = {}): Promise<T> {
  const response = await fetch(`${rustApiUrl}${path}`, {
    ...init,
    headers: {
      "content-type": "application/json",
      "x-openshelf-internal-token": internalToken,
      ...init.headers,
    },
  });
  if (!response.ok) throw new Error(`Rust API ${response.status}: ${(await response.text()).slice(0, 500)}`);
  return await response.json() as T;
}

function required(name: string, fallback?: string): string {
  const value = process.env[name]?.trim() || fallback;
  if (!value) throw new Error(`${name} is required`);
  return value;
}

function positiveInteger(name: string, fallback: number): number {
  const parsed = Number.parseInt(process.env[name] ?? "", 10);
  return Number.isSafeInteger(parsed) && parsed > 0 ? parsed : fallback;
}
