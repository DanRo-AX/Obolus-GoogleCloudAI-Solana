/**
 * Paid-content boundary.
 *
 * The default browser flow uses the local x402 gateway. It receives the 402,
 * asks Phantom to sign the exact Solana USDC transfer, retries the URL with a
 * PAYMENT-SIGNATURE header, and reads the facilitator's settlement receipt.
 */

import type { Citation } from '@/state/ui'
import { getPhantom } from '@/state/wallet'

export type OpenRequest = {
  queryId: string
  docs: { handle: string; shelf: string; price: number }[]
  question: string
  payer?: string | null
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

export class PaymentError extends Error {}

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
    throw new PaymentError('Connect Phantom before opening paid documents.')
  }

  const citations: Citation[] = []
  const transactions: string[] = []
  let settledNetwork = DEVNET_NETWORK
  try {
    const [
      { x402Client },
      { wrapFetchWithPayment, decodePaymentResponseHeader },
      svm,
      { phantomSvmSigner },
    ] =
      await Promise.all([
        import('@x402/core/client'),
        import('@x402/fetch'),
        import('@x402/svm/exact/client'),
        import('@/lib/phantomSigner'),
      ])
    const client = new x402Client()
    svm.registerExactSvmScheme(client, {
      signer: phantomSvmSigner(provider),
      networks: [DEVNET_NETWORK],
    })
    const paidFetch = wrapFetchWithPayment(window.fetch.bind(window), client)
    // Each document is its own author payment and therefore its own x402 resource.
    for (const document of req.docs) {
      const resource = `${X402_GATEWAY_BASE}/api/v1/paid-documents/${encodeURIComponent(
        req.queryId,
      )}/${encodeURIComponent(document.handle)}`
      const response = await paidFetch(resource, {
        method: 'GET',
        headers: { accept: 'application/json' },
      })
      if (!response.ok) {
        const payload = (await response.json().catch(() => null)) as
          | { error?: { message?: string } }
          | null
        throw new Error(payload?.error?.message ?? `x402 gateway returned ${response.status}.`)
      }
      const payload = (await response.json()) as OpenResult
      citations.push(...payload.citations)
      const paymentResponse = response.headers.get('PAYMENT-RESPONSE')
      if (paymentResponse) {
        const settlement = decodePaymentResponseHeader(paymentResponse)
        transactions.push(settlement.transaction)
        settledNetwork = settlement.network
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
      },
    }
  } catch (error) {
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
        },
      }
    }
    if (error instanceof PaymentError) throw error
    const message = error instanceof Error ? error.message : String(error)
    if (/reject|declin|cancel/i.test(message)) {
      throw new PaymentError('Payment approval was cancelled in Phantom.')
    }
    throw new PaymentError(`x402 payment failed: ${message}`)
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
