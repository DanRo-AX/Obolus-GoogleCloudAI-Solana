/**
 * Paid-content boundary.
 *
 * The default browser flow uses the local x402 gateway. It receives the 402,
 * asks Phantom to sign the exact Solana USDC transfer, retries the URL with a
 * PAYMENT-SIGNATURE header, and reads the facilitator's settlement receipt.
 */

import type { Citation } from '@/state/ui'
import { getPaymentProgress, recoverPaidDocument } from '@/lib/api'
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
    mode?: 'direct' | 'bundle_escrow'
  }
}

const API_BASE = import.meta.env.VITE_API_BASE ?? ''
const BACKEND_ENABLED = import.meta.env.VITE_BACKEND_ENABLED !== 'false'
const X402_ENABLED = import.meta.env.VITE_X402_ENABLED !== 'false'
const X402_GATEWAY_BASE = (
  import.meta.env.VITE_X402_GATEWAY_BASE ?? 'http://127.0.0.1:1402'
).replace(/\/$/, '')
const RESOURCE = '/api/flash-research'
const DEVNET_NETWORK = 'solana:EtWTRABZaYq6iMfeYKouRu166VU2xqa1'
const DEVNET_RPC_BACKOFF_MS = [1_500, 3_000, 6_000]

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

  const citations: Citation[] = []
  const transactions: string[] = []
  let settledNetwork = DEVNET_NETWORK
  const requestedHandles = new Set(req.docs.map((document) => document.handle))
  const openedHandles = new Set<string>()

  const recoverSettled = async () => {
    const progress = await getPaymentProgress(
      req.queryId,
      connectedPayer,
      req.accessToken,
    )
    const newlySettled = progress.documents.filter(
      (document) =>
        document.status === 'settled' &&
        requestedHandles.has(document.handle) &&
        !openedHandles.has(document.handle),
    )
    const recovered = await Promise.all(
      newlySettled.map((document) =>
        recoverPaidDocument(
          req.queryId,
          document.handle,
          connectedPayer,
          req.accessToken,
        ),
      ),
    )
    for (const document of recovered) {
      openedHandles.add(document.citation.handle)
      citations.push(document.citation)
      if (!transactions.includes(document.settlement.transactionSignature)) {
        transactions.push(document.settlement.transactionSignature)
      }
      settledNetwork = document.settlement.network
    }
    return progress
  }

  try {
    // A prior transfer may have settled even if the browser lost its response.
    // Recover those passages before requesting any new wallet approval.
    await recoverSettled()
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
    svm.registerExactSvmScheme(client, {
      signer,
      networks: [DEVNET_NETWORK],
    })
    // Override the V2 scheme with the gateway's restricted RPC proxy. The
    // registration helper remains above to preserve its V1 compatibility.
    client.register(
      DEVNET_NETWORK,
      new svm.ExactSvmScheme(signer, { rpcUrl: `${X402_GATEWAY_BASE}/rpc` }),
    )
    const paidFetch = wrapFetchWithPayment(window.fetch.bind(window), client)
    const unpaidDocuments = req.docs.filter(
      (document) => !openedHandles.has(document.handle),
    )
    if (unpaidDocuments.length > 0) {
      // Preserve direct-to-author settlement for a single document. Two or
      // more documents use one exact bundle quote, one Phantom approval, and
      // contributor claim records against the configured escrow receiver.
      let resource: string
      let mode: OpenResult['settlement']['mode'] = 'direct'
      if (unpaidDocuments.length === 1) {
        const document = unpaidDocuments[0]
        resource = `${X402_GATEWAY_BASE}/api/v1/paid-documents/${encodeURIComponent(
          req.queryId,
        )}/${encodeURIComponent(document.handle)}`
      } else {
        const prepared = await fetch(`${X402_GATEWAY_BASE}/api/v1/payment-bundles`, {
          method: 'POST',
          headers: {
            'content-type': 'application/json',
            'x-openshelf-query-token': req.accessToken,
          },
          body: JSON.stringify({
            queryId: req.queryId,
            handles: unpaidDocuments.map((document) => document.handle),
          }),
        })
        if (!prepared.ok) {
          const payload = (await prepared.json().catch(() => null)) as
            | { error?: { message?: string } }
            | null
          throw new Error(
            payload?.error?.message ?? `Could not prepare aggregate payment (${prepared.status}).`,
          )
        }
        const bundle = (await prepared.json()) as {
          quote: { resourcePath: string }
        }
        resource = `${X402_GATEWAY_BASE}${bundle.quote.resourcePath}`
        mode = 'bundle_escrow'
      }

      const response = await paidFetchWithRpcBackoff(paidFetch, resource)
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
      const payload = (await response.json()) as OpenResult
      for (const citation of payload.citations) {
        if (openedHandles.has(citation.handle)) continue
        openedHandles.add(citation.handle)
        citations.push(citation)
      }
      const paymentResponse = response.headers.get('PAYMENT-RESPONSE')
      if (paymentResponse) {
        const settlement = decodePaymentResponseHeader(paymentResponse)
        if (!transactions.includes(settlement.transaction)) {
          transactions.push(settlement.transaction)
        }
        settledNetwork = settlement.network
      }
      return {
        citations,
        settlement: {
          count: citations.length,
          total: citations.reduce((sum, citation) => sum + citation.price, 0),
          txSig: transactions[0],
          txSigs: transactions,
          network: settledNetwork,
          mode,
        },
      }
    }

    return {
      citations,
      settlement: {
        count: citations.length,
        total: citations.reduce((sum, citation) => sum + citation.price, 0),
        txSig: transactions[0],
        txSigs: transactions,
        network: settledNetwork,
        mode: citations.length > 1 && transactions.length === 1 ? 'bundle_escrow' : 'direct',
      },
    }
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    const cancelled = /reject|declin|cancel/i.test(message)

    // Settlement confirmation can lag behind a lost gateway response. Poll a
    // bounded number of times, then return only what the Rust ledger proves.
    const attempts = cancelled ? 1 : 4
    for (let attempt = 0; attempt < attempts; attempt += 1) {
      try {
        await recoverSettled()
      } catch {
        // Preserve the original payment error; Retry can reconcile again.
      }
      if (openedHandles.size === requestedHandles.size) {
        return paymentResult(citations, transactions, settledNetwork, false)
      }
      if (attempt + 1 < attempts) {
        await new Promise((resolve) => window.setTimeout(resolve, 750))
      }
    }

    if (citations.length > 0) {
      return {
        citations,
        settlement: {
          count: citations.length,
          total: citations.reduce((sum, citation) => sum + citation.price, 0),
          txSig: transactions[0],
          txSigs: transactions,
          network: settledNetwork,
          partial: true,
          mode: citations.length > 1 && transactions.length === 1 ? 'bundle_escrow' : 'direct',
        },
      }
    }
    if (error instanceof PaymentError) throw error
    if (cancelled) {
      throw new PaymentError('Payment approval was cancelled in the wallet.', 'cancelled')
    }
    throw new PaymentError(`x402 payment failed: ${message}`)
  }
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

function paymentResult(
  citations: Citation[],
  transactions: string[],
  network: string,
  partial: boolean,
): OpenResult {
  return {
    citations,
    settlement: {
      count: citations.length,
      total: citations.reduce((sum, citation) => sum + citation.price, 0),
      txSig: transactions[0],
      txSigs: transactions,
      network,
      partial,
      mode: citations.length > 1 && transactions.length === 1 ? 'bundle_escrow' : 'direct',
    },
  }
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
