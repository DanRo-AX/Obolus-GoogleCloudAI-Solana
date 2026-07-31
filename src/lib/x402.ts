/**
 * The x402 leg, client-pays.
 *
 * The visitor's Phantom wallet is the transfer authority: the gateway answers
 * 402 with an unsigned transaction, Phantom signs it, and the signed payload
 * goes back up as PAYMENT-SIGNATURE. The gateway's sponsor keypair adds the
 * feePayer signature and submits — the spec forbids the fee payer from also
 * being the authority, so those are two different keys by construction.
 *
 * Header names are x402 **v2**: PAYMENT-REQUIRED / PAYMENT-SIGNATURE /
 * PAYMENT-RESPONSE. v1's X-PAYMENT names are not interchangeable — mixing them
 * produces a silent 402 loop that reads like a signature bug.
 *
 * Without VITE_API_BASE this resolves locally so the UI still demonstrates the
 * shape with no gateway, no wallet, and no transaction.
 */

import { getPhantom } from '@/state/wallet'
import type { Citation } from '@/state/ui'

export type OpenRequest = {
  docs: { handle: string; shelf: string; price: number }[]
  question: string
  /** Transfer authority. Required in server mode. */
  payer?: string | null
}

export type OpenResult = {
  citations: Citation[]
  settlement: {
    count: number
    total: number
    txSig?: string
    network?: string
  }
}

/** Base64 in the PAYMENT-REQUIRED header of the 402. */
export type PaymentRequired = {
  scheme: 'exact'
  /** CAIP-2, e.g. solana:EtWTRABZaYq6iMfeYKouRu166VU2xqa1 */
  network: string
  /** Author wallet owner, not the ATA. */
  payTo: string
  /** micro-USDC, 6 decimals. */
  maxAmountRequired: string
  asset: string
  resource: string
  /** Base64 v0 transaction the gateway pre-built for the wallet to sign. */
  transaction: string
  extra?: { memo?: string }
}

/** Base64 in the PAYMENT-RESPONSE header of the 200. */
export type SettlementResponse = {
  success: boolean
  /** base58 Solana transaction signature. */
  transaction?: string
  network?: string
  errorReason?: string
}

const API_BASE = import.meta.env.VITE_API_BASE ?? ''
export const HAS_GATEWAY = Boolean(API_BASE)

/** The gateway route the demo hits. */
const RESOURCE = '/api/flash-research'

export type PaymentFailure =
  | 'no-wallet'
  | 'not-connected'
  | 'rejected'
  | 'insufficient-funds'
  | 'gateway'
  | 'malformed'

export class PaymentError extends Error {
  reason: PaymentFailure
  constructor(message: string, reason: PaymentFailure) {
    super(message)
    this.reason = reason
  }
}

export function explorerUrl(sig: string, network = 'devnet') {
  const cluster = network.includes('mainnet') ? '' : '?cluster=devnet'
  return `https://explorer.solana.com/tx/${sig}${cluster}`
}

function decodeHeader<T>(raw: string | null, what: string): T {
  if (!raw) throw new PaymentError(`missing ${what} header`, 'malformed')
  try {
    return JSON.parse(atob(raw)) as T
  } catch {
    throw new PaymentError(`unreadable ${what} header`, 'malformed')
  }
}

/**
 * Open documents and settle for them.
 *
 *   GET  {resource}                          → 402 + PAYMENT-REQUIRED
 *   (Phantom signs the transaction it carries)
 *   GET  {resource} + PAYMENT-SIGNATURE      → 200 + PAYMENT-RESPONSE + body
 */
export async function openDocuments(req: OpenRequest): Promise<OpenResult> {
  if (!HAS_GATEWAY) return openLocally(req)

  const url = new URL(`${API_BASE}${RESOURCE}`, window.location.origin)
  url.searchParams.set('docs', req.docs.map((d) => d.handle).join(','))
  if (req.payer) url.searchParams.set('payer', req.payer)

  const challenge = await fetch(url, { method: 'GET' })

  // Free, or already paid inside the reuse window.
  if (challenge.ok) return (await challenge.json()) as OpenResult
  if (challenge.status !== 402) {
    throw new PaymentError(`gateway returned ${challenge.status}`, 'gateway')
  }

  const required = decodeHeader<PaymentRequired>(
    challenge.headers.get('PAYMENT-REQUIRED'),
    'PAYMENT-REQUIRED',
  )

  const phantom = getPhantom()
  if (!phantom) throw new PaymentError('Phantom not installed', 'no-wallet')
  if (!phantom.publicKey) throw new PaymentError('Wallet not connected', 'not-connected')

  // Phantom signs the gateway's transaction as the transfer authority. The
  // gateway still owes the feePayer signature before it can submit.
  let signedB64: string
  try {
    const { VersionedTransaction } = await import('@solana/web3.js')
    const tx = VersionedTransaction.deserialize(base64ToBytes(required.transaction))
    const signed = (await phantom.signTransaction(tx)) as InstanceType<
      typeof VersionedTransaction
    >
    signedB64 = bytesToBase64(signed.serialize())
  } catch (e) {
    const msg = e instanceof Error ? e.message : ''
    throw new PaymentError(
      msg || 'Signature rejected',
      /reject|denied|cancel/i.test(msg) ? 'rejected' : 'malformed',
    )
  }

  const settled = await fetch(url, {
    method: 'GET',
    headers: {
      'PAYMENT-SIGNATURE': btoa(JSON.stringify({ transaction: signedB64 })),
    },
  })

  if (!settled.ok) {
    throw new PaymentError(`settle failed (${settled.status})`, 'gateway')
  }

  const receipt = decodeHeader<SettlementResponse>(
    settled.headers.get('PAYMENT-RESPONSE'),
    'PAYMENT-RESPONSE',
  )
  if (!receipt.success) {
    throw new PaymentError(receipt.errorReason ?? 'settlement failed', 'gateway')
  }

  const payload = (await settled.json()) as OpenResult
  return {
    citations: payload.citations,
    settlement: {
      ...payload.settlement,
      txSig: receipt.transaction,
      network: receipt.network ?? required.network,
    },
  }
}

function base64ToBytes(b64: string) {
  const bin = atob(b64)
  const out = new Uint8Array(bin.length)
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i)
  return out
}

function bytesToBase64(bytes: Uint8Array) {
  let bin = ''
  for (const b of bytes) bin += String.fromCharCode(b)
  return btoa(bin)
}

/** No gateway: resolve from local data so the flow is demonstrable offline. */
async function openLocally(req: OpenRequest): Promise<OpenResult> {
  const { SHELVES } = await import('@/data/shelf')
  const citations: Citation[] = req.docs.map((d, i) => {
    const shelf = SHELVES.find((s) => s.name === d.shelf)
    return {
      handle: d.handle,
      shelf: d.shelf,
      excerpt: shelf?.excerpts[i] ?? '',
      price: d.price,
    }
  })
  return {
    citations,
    settlement: {
      count: citations.length,
      total: citations.reduce((s, c) => s + c.price, 0),
    },
  }
}
