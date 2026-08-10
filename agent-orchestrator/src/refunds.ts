import {
  fetchMint,
  findAssociatedTokenPda,
  getCreateAssociatedTokenIdempotentInstruction,
  getTransferCheckedInstruction,
  TOKEN_PROGRAM_ADDRESS,
} from '@solana-program/token'
import {
  address,
  appendTransactionMessageInstructions,
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
  type Address,
  type Base64EncodedWireTransaction,
  type Instruction,
  type KeyPairSigner,
} from '@solana/kit'
import { performance } from 'node:perf_hooks'
import { boundedResponseText } from './bounded-response.js'

export type PayoutClaim = {
  id: string
  kind: string
  escrowWallet: string
  recipientWallet: string
  asset: string
  network: string
  amountAtomic: string
  status: string
  transactionSignature?: string | null
  signedTransactionBase64?: string | null
  recentBlockhash?: string | null
  lastValidBlockHeight?: number | null
  absenceObservedAt?: number | null
}

export type RefundApi = {
  lease(workerId: string, escrowWallet: string, network: string): Promise<PayoutClaim[]>
  prepare(claimId: string, body: object): Promise<PayoutClaim>
  complete(claimId: string, body: object): Promise<PayoutClaim>
  fail(claimId: string, body: object): Promise<PayoutClaim>
}

const DEVNET_NETWORK = 'solana:EtWTRABZaYq6iMfeYKouRu166VU2xqa1'
const DEVNET_USDC = '4zMMC9srt5Ri5X14GAgXhaHii3GnPAEERYPJgZJDncDU'
const MEMO_PROGRAM = address('MemoSq4gqABAXKb96qnH8TysNcWxMyWCqXgDLGmfcHr')
const MAX_PAYOUT_ATOMIC = 9_223_372_036_854_775_807n
const DEFAULT_RPC_TIMEOUT_MS = 10_000
const PAYOUT_CONFIRMATION_BUDGET_MS = 45_000

export function ledgerBlockHeight(value: number | bigint): number {
  if (typeof value === 'bigint') {
    if (value <= 0n || value > BigInt(Number.MAX_SAFE_INTEGER)) {
      throw new Error('payout block height is outside the JSON safe-integer range')
    }
    return Number(value)
  }
  if (!Number.isSafeInteger(value) || value <= 0) {
    throw new Error('payout block height is not a positive safe integer')
  }
  return value
}

/** Processes durable contributor and refund claims from the KMS escrow wallet. */
export async function processRefundClaims(options: {
  api: RefundApi
  signer: KeyPairSigner
  rpcUrl?: string
  rpcUrls?: string[]
  fetchImpl?: typeof globalThis.fetch
  workerId: string
}): Promise<void> {
  const rpcUrls = independentRpcUrls(options.rpcUrls ?? (options.rpcUrl ? [options.rpcUrl] : []))
  if (rpcUrls.length === 0) throw new Error('at least one payout RPC is required')
  const fetchImpl = options.fetchImpl ?? globalThis.fetch
  const rpc = createSolanaRpc(devnet(rpcUrls[0]))
  const claims = await options.api.lease(
    options.workerId,
    options.signer.address,
    DEVNET_NETWORK,
  )
  for (const claim of claims) {
    try {
      validatePayoutClaim(claim, options.signer.address)
      if (
        claim.status === 'prepared' &&
        claim.transactionSignature &&
        claim.signedTransactionBase64 &&
        claim.lastValidBlockHeight
      ) {
        const observation = await observePreparedPayout({ claim, rpcUrls, fetchImpl })
        if (observation === 'confirmed') {
          await options.api.complete(claim.id, {
            workerId: options.workerId,
            transactionSignature: claim.transactionSignature,
          })
          continue
        }
        if (observation === 'absent_or_failed') {
          await options.api.fail(claim.id, {
            workerId: options.workerId,
            error: 'two independent finalized RPC views found no successful prepared payout',
            abandonPreparedTransaction: true,
          })
          continue
        }
        await broadcastAndConfirm(
          options.api,
          rpc,
          options.workerId,
          claim,
          rpcUrls,
          fetchImpl,
        )
        continue
      }

      const mint = claim.asset as Address
      const recipient = claim.recipientWallet as Address
      const [source] = await findAssociatedTokenPda({
        owner: options.signer.address,
        tokenProgram: TOKEN_PROGRAM_ADDRESS,
        mint,
      })
      const [destination] = await findAssociatedTokenPda({
        owner: recipient,
        tokenProgram: TOKEN_PROGRAM_ADDRESS,
        mint,
      })
      const mintInfo = await fetchMint(rpc, mint, {
        commitment: 'confirmed',
        abortSignal: AbortSignal.timeout(DEFAULT_RPC_TIMEOUT_MS),
      })
      const amount = BigInt(claim.amountAtomic)
      const latest = (await rpc.getLatestBlockhash({ commitment: 'confirmed' }).send({
        abortSignal: AbortSignal.timeout(DEFAULT_RPC_TIMEOUT_MS),
      })).value
      const memoInstruction: Instruction = {
        programAddress: MEMO_PROGRAM,
        accounts: [],
        data: new TextEncoder().encode(`openshelf:payout:${claim.id}`),
      }
      const message = pipe(
        createTransactionMessage({ version: 0 }),
        (value) => setTransactionMessageFeePayerSigner(options.signer, value),
        (value) => setTransactionMessageLifetimeUsingBlockhash(latest, value),
        (value) => appendTransactionMessageInstructions([
          getCreateAssociatedTokenIdempotentInstruction({
            payer: options.signer,
            ata: destination,
            owner: recipient,
            mint,
          }),
          getTransferCheckedInstruction({
            source,
            mint,
            destination,
            authority: options.signer,
            amount,
            decimals: mintInfo.data.decimals,
          }),
          memoInstruction,
        ], value),
      )
      const transaction = await signTransactionMessageWithSigners(message)
      const prepared = await options.api.prepare(claim.id, {
        workerId: options.workerId,
        transactionSignature: getSignatureFromTransaction(transaction),
        signedTransactionBase64: getBase64EncodedWireTransaction(transaction),
        recentBlockhash: latest.blockhash,
        lastValidBlockHeight: ledgerBlockHeight(latest.lastValidBlockHeight),
      })
      await broadcastAndConfirm(
        options.api,
        rpc,
        options.workerId,
        prepared,
        rpcUrls,
        fetchImpl,
      )
    } catch (error) {
      await options.api.fail(claim.id, {
        workerId: options.workerId,
        error: safeError(error).slice(0, 1_000),
        abandonPreparedTransaction: false,
      }).catch(() => undefined)
    }
  }
}

/** Fail closed before KMS or RPC can act on a version-skewed backend row. */
export function validatePayoutClaim(claim: PayoutClaim, signerAddress: string): void {
  if (!/^[A-Za-z0-9:_-]{3,128}$/.test(claim.id)) {
    throw new Error('payout claim id is not safe for the on-chain memo')
  }
  if (claim.escrowWallet !== signerAddress) {
    throw new Error('payout claim belongs to another escrow signer')
  }
  if (claim.network !== DEVNET_NETWORK) {
    throw new Error(`payout worker rejected network ${claim.network}`)
  }
  if (claim.asset !== DEVNET_USDC) {
    throw new Error(`payout worker rejected asset ${claim.asset}`)
  }
  address(claim.escrowWallet)
  address(claim.recipientWallet)
  if (!/^[1-9][0-9]*$/.test(claim.amountAtomic)) {
    throw new Error('payout amount must be a canonical positive integer')
  }
  const amount = BigInt(claim.amountAtomic)
  if (amount > MAX_PAYOUT_ATOMIC) throw new Error('payout amount exceeds the ledger range')
  if (claim.status !== 'leased' && claim.status !== 'prepared') {
    throw new Error(`payout worker rejected status ${claim.status}`)
  }
  const evidence = [
    claim.transactionSignature,
    claim.signedTransactionBase64,
    claim.recentBlockhash,
    claim.lastValidBlockHeight,
  ]
  if (claim.status === 'leased') {
    if (evidence.some((value) => value != null)) {
      throw new Error('unprepared payout contains partial transaction evidence')
    }
    return
  }
  if (evidence.some((value) => value == null)) {
    throw new Error('prepared payout is missing exact transaction evidence')
  }
  signature(claim.transactionSignature as string)
  address(claim.recentBlockhash as string)
  const encoded = claim.signedTransactionBase64 as string
  if (
    encoded.length < 32
    || encoded.length > 32_768
    || !/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/.test(encoded)
    || Buffer.from(encoded, 'base64').toString('base64') !== encoded
  ) {
    throw new Error('prepared payout has non-canonical transaction bytes')
  }
  if (!Number.isSafeInteger(claim.lastValidBlockHeight) || (claim.lastValidBlockHeight ?? 0) <= 0) {
    throw new Error('prepared payout has an invalid last valid block height')
  }
}

async function broadcastAndConfirm(
  api: RefundApi,
  rpc: ReturnType<typeof createSolanaRpc>,
  workerId: string,
  claim: PayoutClaim,
  rpcUrls: string[],
  fetchImpl: typeof globalThis.fetch,
): Promise<void> {
  if (!claim.transactionSignature || !claim.signedTransactionBase64) {
    throw new Error('prepared refund is incomplete')
  }
  const sent = await rpc.sendTransaction(
    claim.signedTransactionBase64 as Base64EncodedWireTransaction,
    { encoding: 'base64', skipPreflight: false, preflightCommitment: 'confirmed', maxRetries: 3n },
  ).send({ abortSignal: AbortSignal.timeout(DEFAULT_RPC_TIMEOUT_MS) })
  if (sent !== claim.transactionSignature) throw new Error('refund signature mismatch')
  const deadline = performance.now() + PAYOUT_CONFIRMATION_BUDGET_MS
  while (performance.now() < deadline) {
    const observation = await observePreparedPayout({ claim, rpcUrls, fetchImpl })
    if (observation === 'confirmed') {
      await api.complete(claim.id, { workerId, transactionSignature: sent })
      return
    }
    if (observation === 'absent_or_failed') {
      await api.fail(claim.id, {
        workerId,
        error: 'two independent finalized RPC views found no successful prepared payout',
        abandonPreparedTransaction: true,
      })
      return
    }
    const remaining = deadline - performance.now()
    if (remaining > 0) {
      await new Promise((resolve) => setTimeout(resolve, Math.min(1_000, remaining)))
    }
  }
  throw new Error('refund confirmation timed out')
}

type PreparedPayoutObservation = 'confirmed' | 'absent_or_failed' | 'inconclusive'

type SignatureStatus = {
  err: unknown
  confirmationStatus?: unknown
}

/**
 * A prepared payout is released only when at least two distinct RPC origins
 * agree. One provider claiming success cannot mark the ledger paid, and one
 * provider omitting a landed signature cannot authorize a second transfer.
 */
export async function observePreparedPayout(options: {
  claim: PayoutClaim
  rpcUrls: string[]
  fetchImpl?: typeof globalThis.fetch
  rpcTimeoutMs?: number
}): Promise<PreparedPayoutObservation> {
  if (!options.claim.transactionSignature || !options.claim.lastValidBlockHeight) {
    return 'inconclusive'
  }
  const rpcUrls = independentRpcUrls(options.rpcUrls)
  if (rpcUrls.length < 2) return 'inconclusive'
  const fetchImpl = options.fetchImpl ?? globalThis.fetch
  const rpcTimeoutMs = safeTimeout(options.rpcTimeoutMs)
  const views = await Promise.all(rpcUrls.map(async (rpcUrl) => {
    try {
      const statusResult = await rpcCall<{ value: Array<SignatureStatus | null> }>(
        fetchImpl,
        rpcUrl,
        'getSignatureStatuses',
        [[options.claim.transactionSignature], { searchTransactionHistory: true }],
        rpcTimeoutMs,
      )
      if (!Array.isArray(statusResult.value) || statusResult.value.length !== 1) return null
      const status = statusResult.value[0]
      if (status !== null && (typeof status !== 'object' || !Object.hasOwn(status, 'err'))) {
        return null
      }
      const blockHeight = await rpcCall<number>(
        fetchImpl,
        rpcUrl,
        'getBlockHeight',
        [{ commitment: 'finalized' }],
        rpcTimeoutMs,
      )
      if (!Number.isSafeInteger(blockHeight) || blockHeight < 0) return null
      return { status, blockHeight }
    } catch {
      return null
    }
  }))
  if (views.some((view) => view == null)) return 'inconclusive'
  const complete = views as Array<{ status: SignatureStatus | null; blockHeight: number }>
  if (complete.every(({ status }) =>
    status?.err === null
      && status.confirmationStatus === 'finalized'
  )) return 'confirmed'
  if (complete.some(({ status }) =>
    status?.err === null
      && (status.confirmationStatus === 'confirmed' || status.confirmationStatus === 'finalized')
  )) return 'inconclusive'
  if (complete.some(({ status }) => status !== null && status.err === null)) {
    return 'inconclusive'
  }
  return complete.every(({ blockHeight }) =>
    blockHeight > (options.claim.lastValidBlockHeight ?? Number.MAX_SAFE_INTEGER)
  )
    ? 'absent_or_failed'
    : 'inconclusive'
}

function independentRpcUrls(values: string[]): string[] {
  const byOrigin = new Map<string, string>()
  for (const value of values) {
    try {
      const url = new URL(value)
      if (!byOrigin.has(url.origin)) byOrigin.set(url.origin, url.toString())
    } catch {
      // Invalid endpoints are absence of evidence, never extra votes.
    }
  }
  return [...byOrigin.values()]
}

let rpcId = 0
const MAX_RPC_RESPONSE_BYTES = 1024 * 1024
async function rpcCall<T>(
  fetchImpl: typeof globalThis.fetch,
  rpcUrl: string,
  method: string,
  params: unknown[],
  timeoutMs: number,
): Promise<T> {
  rpcId += 1
  const response = await fetchImpl(rpcUrl, {
    method: 'POST',
    redirect: 'error',
    signal: AbortSignal.timeout(timeoutMs),
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ jsonrpc: '2.0', id: rpcId, method, params }),
  })
  const text = await boundedResponseText(
    response,
    MAX_RPC_RESPONSE_BYTES,
    `Solana RPC ${method} response`,
  )
  if (!response.ok) throw new Error(`Solana RPC ${response.status} during ${method}`)
  const body = JSON.parse(text) as { result?: T; error?: { message?: string } }
  if (body.error || !Object.hasOwn(body, 'result')) {
    throw new Error(`Solana RPC ${method} failed: ${body.error?.message ?? 'missing result'}`)
  }
  return body.result as T
}

function safeTimeout(value: number | undefined): number {
  return Number.isSafeInteger(value) && (value ?? 0) > 0 && (value ?? 0) <= 60_000
    ? value as number
    : DEFAULT_RPC_TIMEOUT_MS
}

function safeError(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}
