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
  createWalletAuthChallenge,
  getOpenCallFundingQuote,
  getPaymentBundleQuote,
  getPrepaidBalance,
  listOpenCalls,
  prepareOpenCallFundingQuote,
  type CreateOpenCallInput,
  type OpenCallFundingQuote,
  type SettlementPreviewEnvelope,
} from '@/lib/api'
import { getPhantom } from '@/state/wallet'
import {
  exactQuotePaymentPolicy,
  exactResearchBundleQuote,
  exactTopUpQuote,
} from '@/lib/exactPaymentPolicy'
import { prepaidTopUpAtomic } from '@/lib/browserPaymentConfig'
import { withSufficientSvmComputeBudget } from '@/lib/svmComputeBudget'

export type OpenRequest = {
  queryId: string
  docs: { handle: string; shelf: string; price: number }[]
  question: string
  payer?: string | null
  accessToken: string
  invoice: SettlementPreviewEnvelope
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
    invoice?: SettlementPreviewEnvelope
  }
}

const API_BASE = import.meta.env.VITE_API_BASE ?? ''
const BACKEND_ENABLED = import.meta.env.VITE_BACKEND_ENABLED !== 'false'
export const X402_ENABLED = import.meta.env.VITE_X402_ENABLED !== 'false'
const X402_GATEWAY_BASE = (
  import.meta.env.VITE_X402_GATEWAY_BASE ??
  (import.meta.env.PROD ? '/x402' : 'http://127.0.0.1:1402')
).replace(/\/$/, '')
const RESOURCE = '/api/flash-research'
const DEVNET_NETWORK = 'solana:EtWTRABZaYq6iMfeYKouRu166VU2xqa1'
const DEVNET_RPC_BACKOFF_MS = [1_500, 3_000, 6_000]
const PENDING_OPEN_CALL_KEY = 'openshelf:pending-funded-open-call:v1'
const PENDING_RESEARCH_KEY = 'openshelf:pending-research-job:v1'
const DEFAULT_TOP_UP_ATOMIC = prepaidTopUpAtomic(import.meta.env.VITE_PREPAID_TOPUP_USDC)

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

/**
 * Standalone prepaid top-up.
 *
 * Prepares a whole-USDC top-up on the public payment-gateway endpoint, pays it
 * with Phantom over the same x402 exact scheme the pay-flow uses, and returns
 * the refreshed prepaid balance. The gateway credits the balance through the
 * internal deposit route only after it independently confirms the finalized
 * on-chain transfer to the bundle receiver, so the browser never touches the
 * internal route and cannot self-credit.
 */
export async function topUpPrepaid(amountUsdc: number): Promise<{ availableAtomic: string }> {
  if (!BACKEND_ENABLED || !X402_ENABLED) {
    throw new PaymentError('Standalone top-up requires the backend and x402 gateway.')
  }
  if (!Number.isInteger(amountUsdc) || amountUsdc < 1 || amountUsdc > 1_000) {
    throw new PaymentError('Choose a whole USDC amount between 1 and 1000.')
  }
  const provider = getPhantom()
  if (!provider?.publicKey) {
    throw new PaymentError('Connect a Solana browser wallet before topping up.')
  }

  let prepared: Response
  try {
    prepared = await fetch(`${X402_GATEWAY_BASE}/api/v1/prepaid/top-ups`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ amountUsdc }),
    })
  } catch {
    throw new PaymentError('Top-up service is temporarily unavailable.')
  }
  if (!prepared.ok) {
    const payload = (await prepared.json().catch(() => null)) as
      | { error?: { message?: string } }
      | null
    throw new PaymentError(
      payload?.error?.message ?? `Could not prepare the top-up (${prepared.status}).`,
    )
  }
  const body = (await prepared.json()) as { quote?: unknown }
  const quote = exactTopUpQuote(body.quote)

  try {
    const [{ x402Client }, { wrapFetchWithPayment }, svm, { phantomSvmSigner }] =
      await Promise.all([
        import('@x402/core/client'),
        import('@x402/fetch'),
        import('@x402/svm/exact/client'),
        import('@/lib/phantomSigner'),
      ])
    const client = new x402Client()
    client.registerPolicy(exactQuotePaymentPolicy('topup', quote))
    const signer = withSufficientSvmComputeBudget(phantomSvmSigner(provider))
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
    // The gateway applies the credit in its post-settlement hook before the paid
    // response resolves; read the durable balance back from the Rust ledger.
    const balance = await getPrepaidBalance()
    return { availableAtomic: balance.availableAtomic }
  } catch (error) {
    if (error instanceof PaymentError) throw error
    const message = error instanceof Error ? error.message : String(error)
    if (/reject|declin|cancel/i.test(message)) {
      throw new PaymentError('Payment approval was cancelled in the wallet.', 'cancelled')
    }
    if (isNetworkFailure(message)) {
      throw new PaymentError(
        'Top-up service is temporarily unavailable. Retry; anything already paid credits your balance without paying twice.',
      )
    }
    if (isPayloadRpcRateLimit(message)) {
      throw new PaymentError(
        'Solana Devnet is rate-limiting payment creation. Wait 15 seconds and retry this same top-up.',
      )
    }
    throw new PaymentError(`x402 top-up failed: ${message}`)
  }
}

export async function openDocuments(req: OpenRequest): Promise<OpenResult> {
  if (!BACKEND_ENABLED) {
    throw new PaymentError(
      'Paid persona passages cannot be opened without the backend settlement service.',
    )
  }
  if (X402_ENABLED) return openOverX402(req)

  const url = new URL(`${API_BASE}${RESOURCE}`, window.location.origin)
  url.searchParams.set('queryId', req.queryId)
  url.searchParams.set('docs', req.docs.map((document) => document.handle).join(','))
  if (req.payer) url.searchParams.set('payer', req.payer)

  let response: Response
  try {
    response = await fetch(url)
  } catch {
    throw new PaymentError('Obolus settlement service is not reachable.')
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
      if (quote.status === 'funded') return await recoverFundedOpenCall(quote)
      if (quote.status === 'settling') return await recoverSettlingOpenCall(quote)
      if (quote.status !== 'quoted' || quote.expiresAt <= Date.now()) quote = undefined
    } catch (error) {
      if (error instanceof PaymentError) throw error
      quote = undefined
      // A stale local recovery pointer is harmless; prepare is idempotent for
      // an identical quote, including one that already funded its call.
    }
  }
  quote ??= await prepareOpenCallFundingQuote(input)
  if (quote.status === 'funded') return await recoverFundedOpenCall(quote)
  if (quote.status === 'settling') return await recoverSettlingOpenCall(quote)
  if (quote.status !== 'quoted') {
    window.localStorage.removeItem(PENDING_OPEN_CALL_KEY)
    throw new PaymentError('This open-call funding quote is no longer payable. Prepare a new call.')
  }
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
    client.registerPolicy(exactQuotePaymentPolicy('open_call', quote))
    const signer = withSufficientSvmComputeBudget(phantomSvmSigner(provider))
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
    if (isNetworkFailure(message)) {
      throw new PaymentError(
        'Payment service is temporarily unavailable. Retry this same call; a settled transfer will be recovered instead of paid twice.',
      )
    }
    throw new PaymentError(`x402 open-call funding failed: ${message}`)
  }
}

async function findOpenCall(openCallId: string): Promise<Order | undefined> {
  return (await listOpenCalls()).find((call) => call.id === openCallId)
}

async function recoverFundedOpenCall(quote: OpenCallFundingQuote): Promise<Order> {
  if (quote.openCallId) {
    const recovered = await findOpenCall(quote.openCallId)
    if (recovered) {
      window.localStorage.removeItem(PENDING_OPEN_CALL_KEY)
      return recovered
    }
  }
  throw new PaymentError(
    'Payment already settled and the call ledger is still reconciling. Retry this same call to recover it without another payment.',
  )
}

async function recoverSettlingOpenCall(quote: OpenCallFundingQuote): Promise<Order> {
  for (let attempt = 0; attempt < 20; attempt += 1) {
    const reconciled = await getOpenCallFundingQuote(quote.id)
    if (reconciled.status === 'funded') return recoverFundedOpenCall(reconciled)
    await delay(750)
  }
  throw new PaymentError(
    'Payment is already settling. Retry this same call to recover it without another wallet approval.',
  )
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
    | 'payment_in_progress'
    | 'payment_reconciliation'
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

/**
 * Tab-scoped, memory-only holder for the prepaid wallet session token.
 *
 * The Rust API also sets an HttpOnly cookie for this token (see
 * backend/src/api.rs's create_prepaid_session), which is the preferred
 * channel and the only one used for direct browser-to-Rust calls. This
 * in-memory value exists only because a request that must reach the
 * payment-gateway service (a different origin from the Rust API in local
 * dev, and outside this fix's Rust + frontend scope) still needs the raw
 * token to attach as the `x-openshelf-wallet-session` header explicitly —
 * the browser will not forward an HttpOnly cookie as a custom header, and
 * the gateway does not (yet) read the cookie itself. Unlike the old
 * `localStorage` persistence, this value never survives a reload, a new
 * tab, or a script that merely reads storage — it exists only in this
 * module's memory for the lifetime of the current page. See GitHub issue
 * #46.
 */
let tabPrepaidWalletSession: StoredPrepaidSession | null = null

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
        return researchResult(recovered, req.invoice)
      }
    }
    let walletSession = await ensurePrepaidWalletSession(provider, connectedPayer)

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
          expectedInvoiceHash: req.invoice.invoiceHash,
        }),
      })
    let prepared = await prepare(walletSession.token)
    if (prepared.status === 401) {
      tabPrepaidWalletSession = null
      walletSession = await ensurePrepaidWalletSession(provider, connectedPayer)
      prepared = await prepare(walletSession.token)
    }
    if (!prepared.ok) {
      const payload = (await prepared.json().catch(() => null)) as
        | { error?: { message?: string } }
        | null
      throw new Error(payload?.error?.message ?? `Could not prepare research job (${prepared.status}).`)
    }
    const bundle = (await prepared.json()) as { quote?: unknown }
    const gatewayQuoteId = (bundle.quote as { id?: unknown } | null)?.id
    if (typeof gatewayQuoteId !== 'string' || !gatewayQuoteId) {
      throw new Error('The payment gateway returned a malformed research quote.')
    }
    const canonicalQuote = await getPaymentBundleQuote(
      gatewayQuoteId,
      req.accessToken,
      walletSession.token,
    )
    const quote = exactResearchBundleQuote({
      gatewayQuote: bundle.quote,
      canonicalQuote,
      queryId: req.queryId,
      documentHandles: handles,
      preferredTopUpAtomic: DEFAULT_TOP_UP_ATOMIC.toString(),
    })
    writePendingResearchJob({
      jobId: quote.id,
      queryId: req.queryId,
      handles,
      payer: connectedPayer,
    })
    if (!quote.requiresPayment) {
      const recovered = await pollResearchJob(quote.id, req.accessToken, 120)
      if (!recovered) {
        throw new Error('The existing Pay.sh research job is still working. Retry to check it again without paying.')
      }
      return researchResult(recovered, req.invoice)
    }
    const [
      { x402Client },
      { wrapFetchWithPayment, decodePaymentResponseHeader },
      { decodePaymentRequiredHeader },
      svm,
      { phantomSvmSigner },
    ] = await Promise.all([
      import('@x402/core/client'),
      import('@x402/fetch'),
      import('@x402/core/http'),
      import('@x402/svm/exact/client'),
      import('@/lib/phantomSigner'),
    ])
    const client = new x402Client()
    client.registerPolicy(exactQuotePaymentPolicy('bundle', quote))
    const signer = withSufficientSvmComputeBudget(phantomSvmSigner(provider))
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
    const result = await pollResearchJob(quote.id, req.accessToken, 120)
    if (!result) {
      throw new Error('The deposit settled and the Pay.sh agent is still working. Retry to recover this same job without paying again.')
    }
    return researchResult(result, req.invoice)
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    const cancelled = /reject|declin|cancel/i.test(message)
    if (error instanceof PaymentError) throw error
    if (cancelled) {
      throw new PaymentError('Payment approval was cancelled in the wallet.', 'cancelled')
    }
    if (isNetworkFailure(message)) {
      throw new PaymentError(
        'Payment service is temporarily unavailable. Retry this same job; anything already settled will be recovered instead of paid twice.',
      )
    }
    if (isPayloadRpcRateLimit(message)) {
      throw new PaymentError(
        'Solana Devnet is rate-limiting payment creation. Wait 15 seconds and retry this same job; nothing was signed or paid twice.',
      )
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
        job.status === 'payment_reconciliation' ||
        job.status === 'refund_pending' ||
        job.status === 'balance_refunded'
      ) return job
    }
    if (attempt + 1 < attempts) await delay(1_000)
  }
  return null
}

function researchResult(
  job: ResearchJobStatus,
  invoice?: SettlementPreviewEnvelope,
): OpenResult {
  if (job.status === 'payment_reconciliation') {
    throw new PaymentError(
      `Pay.sh payment outcome is being reconciled. Do not retry or approve another payment; the reserved balance has not been refunded.${job.failureReason ? ` ${job.failureReason}` : ''}`,
    )
  }
  if (job.status === 'balance_refunded' && job.citations.length === 0) {
    window.localStorage.removeItem(PENDING_RESEARCH_KEY)
    throw new PaymentError(
      `Pay.sh could not complete the job. ${Number(job.refundableAtomic) / 1_000_000} USDC was restored to your Obolus prepaid balance.${job.failureReason ? ` ${job.failureReason}` : ''}`,
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
      invoice,
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
  const challenge = await createWalletAuthChallenge(wallet, 'prepaid_spend_v1')
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
  // No localStorage/sessionStorage: the server already set the HttpOnly
  // cookie that is this token's durable copy. This module-level variable is
  // only the tab-scoped fallback documented above tabPrepaidWalletSession.
  tabPrepaidWalletSession = stored
  return stored
}

function readPrepaidWalletSession(): StoredPrepaidSession | null {
  return tabPrepaidWalletSession
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

function isNetworkFailure(message: string): boolean {
  return /failed to fetch|fetch failed|networkerror|network request failed|load failed/i.test(
    message,
  )
}

function delay(milliseconds: number): Promise<void> {
  return new Promise((resolve) => window.setTimeout(resolve, milliseconds))
}
