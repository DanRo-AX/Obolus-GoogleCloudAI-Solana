/**
 * Paid-content boundary.
 *
 * The default browser flow reserves a verified prepaid balance. Only when that
 * balance is low does the x402 gateway return 402, ask Phantom for a USDC
 * refill, and retry with the facilitator's settlement proof.
 */

import type { Citation, Order } from '@/state/ui'
import { getBase58Decoder } from '@solana/kit'
import {
  createPrepaidWalletSession,
  createWalletChallenge,
  getOpenCallFundingQuote,
  listOpenCalls,
  prepareOpenCallFundingQuote,
  type CreateOpenCallInput,
  type OpenCallFundingQuote,
} from '@/lib/api'
import { getPhantom } from '@/state/wallet'

export type OpenRequest = {
  queryId: string
  docs: { handle: string; shelf: string; price: number }[]
  question: string
  payer?: string | null
  accessToken: string
}

export type OpenResult = {
  citations: Citation[]
  settlement: {
    count: number
    total: number
    txSig?: string
    txSigs?: string[]
    network?: string
    partial?: boolean
    mode?: 'direct' | 'bundle_escrow' | 'pay_sh_direct' | 'pay_sh_orchestrated'
  }
}

const API_BASE = import.meta.env.VITE_API_BASE ?? ''
const BACKEND_ENABLED = import.meta.env.VITE_BACKEND_ENABLED !== 'false'
export const X402_ENABLED = import.meta.env.VITE_X402_ENABLED !== 'false'
const X402_GATEWAY_BASE = (
  import.meta.env.VITE_X402_GATEWAY_BASE ?? 'http://127.0.0.1:1402'
).replace(/\/$/, '')
const RESOURCE = '/api/flash-research'
const DEVNET_NETWORK = 'solana:EtWTRABZaYq6iMfeYKouRu166VU2xqa1'
const DEVNET_RPC_BACKOFF_MS = [1_500, 3_000, 6_000]
const PENDING_OPEN_CALL_KEY = 'openshelf:pending-funded-open-call:v1'
const PENDING_RESEARCH_KEY = 'openshelf:pending-research-job:v1'
const PREPAID_SESSION_KEY = 'openshelf:prepaid-wallet-session:v1'
const DEFAULT_TOP_UP_ATOMIC = Math.round(
  Math.min(1_000, Math.max(0.1, Number(import.meta.env.VITE_PREPAID_TOPUP_USDC ?? 5))) *
    1_000_000,
)

export class PaymentError extends Error {
  code: 'cancelled' | 'identity_mismatch' | 'failed'

  constructor(
    message: string,
    code: PaymentError['code'] = 'failed',
  ) {
    super(message)
    this.code = code
  }
}

export function explorerUrl(sig: string, network = 'devnet') {
  const cluster = network.includes('mainnet') ? '' : '?cluster=devnet'
  return `https://explorer.solana.com/tx/${sig}${cluster}`
}

export async function openDocuments(req: OpenRequest): Promise<OpenResult> {
  if (!BACKEND_ENABLED) return openLocally(req)
  if (X402_ENABLED) return openOverX402(req)

  const url = new URL(`${API_BASE}${RESOURCE}`, window.location.origin)
  url.searchParams.set('queryId', req.queryId)
  url.searchParams.set('docs', req.docs.map((document) => document.handle).join(','))
  if (req.payer) url.searchParams.set('payer', req.payer)

  let response: Response
  try {
    response = await fetch(url)
  } catch {
    throw new PaymentError('OPENSHELF settlement service is not reachable.')
  }
  if (response.status === 402) {
    throw new PaymentError(
      'This URL is protected by the Pay gateway. Use a Pay-enabled agent client to satisfy its 402 challenge.',
    )
  }
  if (!response.ok) {
    const payload = (await response.json().catch(() => null)) as
      | { error?: { message?: string } }
      | null
    throw new PaymentError(
      payload?.error?.message ?? `Settlement service returned ${response.status}.`,
    )
  }
  return (await response.json()) as OpenResult
}

/**
 * Funds one open call with one exact Devnet USDC approval. The quote id is
 * persisted before Phantom opens so a settled transfer can be reconciled after
 * a refresh without asking the buyer to pay twice.
 */
export async function fundOpenCall(input: CreateOpenCallInput): Promise<Order> {
  if (!BACKEND_ENABLED || !X402_ENABLED) {
    throw new PaymentError('Devnet-funded calls require the backend and x402 gateway.')
  }
  const provider = getPhantom()
  if (!provider?.publicKey) {
    throw new PaymentError('Connect a Solana browser wallet before funding an open call.')
  }

  let quote: OpenCallFundingQuote | undefined
  const pending = readPendingOpenCall()
  if (pending && JSON.stringify(pending.input) === JSON.stringify(input)) {
    try {
      quote = await getOpenCallFundingQuote(pending.quoteId)
      if (quote.status === 'funded' && quote.openCallId) {
        const recovered = await findOpenCall(quote.openCallId)
        if (recovered) {
          window.localStorage.removeItem(PENDING_OPEN_CALL_KEY)
          return recovered
        }
      }
      if (quote.expiresAt <= Date.now()) quote = undefined
    } catch {
      // A stale local recovery pointer is harmless; prepare is idempotent for
      // an identical, still-live quote.
    }
  }
  quote ??= await prepareOpenCallFundingQuote(input)
  window.localStorage.setItem(
    PENDING_OPEN_CALL_KEY,
    JSON.stringify({ quoteId: quote.id, input }),
  )

  try {
    const [{ x402Client }, { wrapFetchWithPayment }, svm, { phantomSvmSigner }] =
      await Promise.all([
        import('@x402/core/client'),
        import('@x402/fetch'),
        import('@x402/svm/exact/client'),
        import('@/lib/phantomSigner'),
      ])
    const client = new x402Client()
    const signer = phantomSvmSigner(provider)
    svm.registerExactSvmScheme(client, { signer, networks: [DEVNET_NETWORK] })
    client.register(
      DEVNET_NETWORK,
      new svm.ExactSvmScheme(signer, { rpcUrl: `${X402_GATEWAY_BASE}/rpc` }),
    )
    const paidFetch = wrapFetchWithPayment(window.fetch.bind(window), client)
    const response = await paidFetchWithRpcBackoff(
      paidFetch,
      `${X402_GATEWAY_BASE}${quote.resourcePath}`,
    )
    if (!response.ok) {
      const payload = (await response.json().catch(() => null)) as
        | { error?: { message?: string } }
        | null
      throw new Error(payload?.error?.message ?? `x402 gateway returned ${response.status}.`)
    }

    for (let attempt = 0; attempt < 20; attempt += 1) {
      const reconciled = await getOpenCallFundingQuote(quote.id)
      if (reconciled.status === 'funded' && reconciled.openCallId) {
        const call = await findOpenCall(reconciled.openCallId)
        if (call) {
          window.localStorage.removeItem(PENDING_OPEN_CALL_KEY)
          return call
        }
      }
      await delay(750)
    }
    throw new Error(
      'Payment settled, but the call ledger is still reconciling. Retry posting the same call to recover it without another payment.',
    )
  } catch (error) {
    if (error instanceof PaymentError) throw error
    const message = error instanceof Error ? error.message : String(error)
    if (/reject|declin|cancel/i.test(message)) {
      throw new PaymentError('Payment approval was cancelled in the wallet.', 'cancelled')
    }
    throw new PaymentError(`x402 open-call funding failed: ${message}`)
  }
}

async function findOpenCall(openCallId: string): Promise<Order | undefined> {
  return (await listOpenCalls()).find((call) => call.id === openCallId)
}

function readPendingOpenCall(): { quoteId: string; input: CreateOpenCallInput } | null {
  try {
    const value = JSON.parse(window.localStorage.getItem(PENDING_OPEN_CALL_KEY) ?? 'null') as {
      quoteId?: unknown
      input?: unknown
    } | null
    return value && typeof value.quoteId === 'string' && value.input
      ? { quoteId: value.quoteId, input: value.input as CreateOpenCallInput }
      : null
  } catch {
    return null
  }
}

type ResearchJobStatus = {
  id: string
  queryId: string
  payer?: string | null
  network: string
  amountAtomic: string
  spentAtomic: string
  refundableAtomic: string
  status:
    | 'quoted'
    | 'funded'
    | 'processing'
    | 'completed'
    | 'refund_pending'
    | 'balance_refunded'
  transactionSignature?: string | null
  failureReason?: string | null
  citations: Citation[]
  pendingHandles: string[]
}

type PendingResearchJob = {
  jobId: string
  queryId: string
  handles: string[]
  payer: string
}

type StoredPrepaidSession = {
  wallet: string
  token: string
  expiresAt: number
}

async function openOverX402(req: OpenRequest): Promise<OpenResult> {
  const provider = getPhantom()
  if (!provider?.publicKey) {
    throw new PaymentError('Connect a Solana browser wallet before opening paid documents.')
  }
  const connectedPayer = provider.publicKey.toString()
  if (req.payer && req.payer !== connectedPayer) {
    throw new PaymentError(
      `This payment session belongs to ${req.payer}. The connected wallet is ${connectedPayer}. Switch back to recover it without duplicate charges.`,
      'identity_mismatch',
    )
  }
  if (!req.accessToken) {
    throw new PaymentError('The payment recovery token is missing. Start a new query.')
  }

  try {
    const handles = req.docs.map((document) => document.handle)
    const pending = readPendingResearchJob()
    if (
      pending &&
      pending.queryId === req.queryId &&
      pending.payer === connectedPayer &&
      JSON.stringify(pending.handles) === JSON.stringify(handles)
    ) {
      const recovered = await pollResearchJob(pending.jobId, req.accessToken, 1)
      if (recovered && recovered.status !== 'quoted') {
        return researchResult(recovered)
      }
    }
    let walletSession = await ensurePrepaidWalletSession(provider, connectedPayer)

    const [
      { x402Client },
      { wrapFetchWithPayment, decodePaymentResponseHeader },
      { decodePaymentRequiredHeader },
      svm,
      { phantomSvmSigner },
    ] =
      await Promise.all([
        import('@x402/core/client'),
        import('@x402/fetch'),
        import('@x402/core/http'),
        import('@x402/svm/exact/client'),
        import('@/lib/phantomSigner'),
      ])
    const client = new x402Client()
    const signer = phantomSvmSigner(provider)
    svm.registerExactSvmScheme(client, { signer, networks: [DEVNET_NETWORK] })
    client.register(
      DEVNET_NETWORK,
      new svm.ExactSvmScheme(signer, { rpcUrl: `${X402_GATEWAY_BASE}/rpc` }),
    )
    const paidFetch = wrapFetchWithPayment(window.fetch.bind(window), client)
    const prepare = (token: string) =>
      fetch(`${X402_GATEWAY_BASE}/api/v1/payment-bundles`, {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          'x-openshelf-query-token': req.accessToken,
          'x-openshelf-wallet-session': token,
        },
        body: JSON.stringify({
          queryId: req.queryId,
          handles,
          topUpAtomic: DEFAULT_TOP_UP_ATOMIC.toString(),
        }),
      })
    let prepared = await prepare(walletSession.token)
    if (prepared.status === 401) {
      window.localStorage.removeItem(PREPAID_SESSION_KEY)
      walletSession = await ensurePrepaidWalletSession(provider, connectedPayer)
      prepared = await prepare(walletSession.token)
    }
    if (!prepared.ok) {
      const payload = (await prepared.json().catch(() => null)) as
        | { error?: { message?: string } }
        | null
      throw new Error(payload?.error?.message ?? `Could not prepare research job (${prepared.status}).`)
    }
    const bundle = (await prepared.json()) as {
      quote: {
        id: string
        resourcePath: string
        status: string
        requiresPayment: boolean
        amountAtomic: string
        availableBalanceAtomic: string
      }
    }
    writePendingResearchJob({
      jobId: bundle.quote.id,
      queryId: req.queryId,
      handles,
      payer: connectedPayer,
    })
    if (!bundle.quote.requiresPayment) {
      const recovered = await pollResearchJob(bundle.quote.id, req.accessToken, 120)
      if (!recovered) {
        throw new Error('The existing Pay.sh research job is still working. Retry to check it again without paying.')
      }
      return researchResult(recovered)
    }
    const response = await paidFetchWithRpcBackoff(
      paidFetch,
      `${X402_GATEWAY_BASE}${bundle.quote.resourcePath}`,
    )
    if (!response.ok) {
      const payload = (await response.json().catch(() => null)) as
        | { error?: { message?: string } }
        | null
      const settlementHeader = response.headers.get('PAYMENT-RESPONSE')
      const requirementHeader = response.headers.get('PAYMENT-REQUIRED')
      const protocolMessage = settlementHeader
        ? settlementFailureMessage(settlementHeader, decodePaymentResponseHeader)
        : requirementHeader
          ? verificationFailureMessage(requirementHeader, decodePaymentRequiredHeader)
          : null
      throw new Error(
        payload?.error?.message ?? protocolMessage ?? `x402 gateway returned ${response.status}.`,
      )
    }
    const result = await pollResearchJob(bundle.quote.id, req.accessToken, 120)
    if (!result) {
      throw new Error('The deposit settled and the Pay.sh agent is still working. Retry to recover this same job without paying again.')
    }
    return researchResult(result)
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    const cancelled = /reject|declin|cancel/i.test(message)
    if (error instanceof PaymentError) throw error
    if (cancelled) {
      throw new PaymentError('Payment approval was cancelled in the wallet.', 'cancelled')
    }
    throw new PaymentError(`x402 payment failed: ${message}`)
  }
}

async function pollResearchJob(
  jobId: string,
  accessToken: string,
  attempts: number,
): Promise<ResearchJobStatus | null> {
  for (let attempt = 0; attempt < attempts; attempt += 1) {
    const response = await fetch(
      `${X402_GATEWAY_BASE}/api/v1/research-jobs/${encodeURIComponent(jobId)}`,
      { headers: { 'x-openshelf-query-token': accessToken } },
    )
    if (!response.ok) {
      if (attempt + 1 === attempts) throw new Error(`Research job recovery returned ${response.status}.`)
    } else {
      const job = (await response.json()) as ResearchJobStatus
      if (
        job.status === 'completed' ||
        job.status === 'refund_pending' ||
        job.status === 'balance_refunded'
      ) return job
    }
    if (attempt + 1 < attempts) await delay(1_000)
  }
  return null
}

function researchResult(job: ResearchJobStatus): OpenResult {
  if (job.status === 'balance_refunded' && job.citations.length === 0) {
    window.localStorage.removeItem(PENDING_RESEARCH_KEY)
    throw new PaymentError(
      `Pay.sh could not complete the job. ${Number(job.refundableAtomic) / 1_000_000} USDC was restored to your OPENSHELF prepaid balance.${job.failureReason ? ` ${job.failureReason}` : ''}`,
    )
  }
  if (job.status === 'refund_pending' && job.citations.length === 0) {
    window.localStorage.removeItem(PENDING_RESEARCH_KEY)
    throw new PaymentError(
      `Pay.sh could not complete the job. ${Number(job.refundableAtomic) / 1_000_000} USDC was queued for refund.${job.failureReason ? ` ${job.failureReason}` : ''}`,
    )
  }
  window.localStorage.removeItem(PENDING_RESEARCH_KEY)
  return {
    citations: job.citations,
    settlement: {
      count: job.citations.length,
      total: job.citations.reduce((sum, citation) => sum + citation.price, 0),
      txSig: job.transactionSignature ?? undefined,
      txSigs: job.transactionSignature ? [job.transactionSignature] : [],
      network: job.network,
      partial: job.status === 'refund_pending' || job.status === 'balance_refunded',
      mode: 'pay_sh_orchestrated',
    },
  }
}

async function ensurePrepaidWalletSession(
  provider: NonNullable<ReturnType<typeof getPhantom>>,
  wallet: string,
): Promise<StoredPrepaidSession> {
  const existing = readPrepaidWalletSession()
  if (existing?.wallet === wallet && existing.expiresAt > Date.now() + 60_000) {
    return existing
  }
  if (!provider.signMessage) {
    throw new PaymentError(
      'This wallet cannot sign the one-time prepaid spending authorization message.',
    )
  }
  const challenge = await createWalletChallenge(wallet)
  const signed = await provider.signMessage(
    new TextEncoder().encode(challenge.message),
    'utf8',
  )
  const bytes = signed instanceof Uint8Array ? signed : signed.signature
  const session = await createPrepaidWalletSession(
    wallet,
    challenge.id,
    getBase58Decoder().decode(bytes),
  )
  const stored = { wallet: session.wallet, token: session.token, expiresAt: session.expiresAt }
  window.localStorage.setItem(PREPAID_SESSION_KEY, JSON.stringify(stored))
  return stored
}

function readPrepaidWalletSession(): StoredPrepaidSession | null {
  try {
    return JSON.parse(
      window.localStorage.getItem(PREPAID_SESSION_KEY) ?? 'null',
    ) as StoredPrepaidSession | null
  } catch {
    return null
  }
}

function readPendingResearchJob(): PendingResearchJob | null {
  try {
    return JSON.parse(window.localStorage.getItem(PENDING_RESEARCH_KEY) ?? 'null') as PendingResearchJob | null
  } catch {
    return null
  }
}

function writePendingResearchJob(job: PendingResearchJob): void {
  window.localStorage.setItem(PENDING_RESEARCH_KEY, JSON.stringify(job))
}

async function paidFetchWithRpcBackoff(
  paidFetch: typeof window.fetch,
  resource: string,
): Promise<Response> {
  for (let attempt = 0; ; attempt += 1) {
    try {
      return await paidFetch(resource, {
        method: 'GET',
        headers: { accept: 'application/json' },
      })
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      const retryDelay = DEVNET_RPC_BACKOFF_MS[attempt]
      // x402 constructs the payload before Phantom is asked to sign. Retrying
      // this exact failure cannot duplicate a transfer because no signed
      // transaction exists yet.
      if (retryDelay === undefined || !isPayloadRpcRateLimit(message)) throw error
      await delay(retryDelay)
    }
  }
}

function settlementFailureMessage(
  header: string,
  decode: (value: string) => { errorReason?: string; errorMessage?: string },
): string | null {
  try {
    const result = decode(header)
    return result.errorMessage ?? result.errorReason ?? null
  } catch {
    return null
  }
}

function verificationFailureMessage(
  header: string,
  decode: (value: string) => { error?: string },
): string | null {
  try {
    return decode(header).error ?? null
  } catch {
    return null
  }
}

function isPayloadRpcRateLimit(message: string): boolean {
  return (
    message.includes('Failed to create payment payload') &&
    message.includes('HTTP error (429)')
  )
}

function delay(milliseconds: number): Promise<void> {
  return new Promise((resolve) => window.setTimeout(resolve, milliseconds))
}

/** Offline-only fallback used when VITE_BACKEND_ENABLED=false. */
async function openLocally(req: OpenRequest): Promise<OpenResult> {
  const { SHELVES } = await import('@/data/shelf')
  const citations: Citation[] = req.docs.map((document, index) => {
    const shelf = SHELVES.find((candidate) => candidate.name === document.shelf)
    return {
      handle: document.handle,
      shelf: document.shelf,
      excerpt: shelf?.excerpts[index] ?? '',
      price: document.price,
    }
  })
  return {
    citations,
    settlement: {
      count: citations.length,
      total: citations.reduce((sum, citation) => sum + citation.price, 0),
      network: 'offline',
    },
  }
}
