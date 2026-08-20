import type { PaymentRequirements } from '@x402/core/types'

export type BrowserPaymentRequirement = PaymentRequirements

export type ExactBrowserQuote = {
  id: string
  network: string
  asset: string
  amountAtomic: string
  payTo: string
}

export type ExactResearchBundleQuote = ExactBrowserQuote & {
  queryId: string
  documentHandles: string[]
  budgetAtomic: string
  minimumDepositAtomic: string
  requiresPayment: boolean
  availableBalanceAtomic: string
  totalPriceKrw: number
  krwPerUsdc: number
  expiresAt: number
  resourcePath: string
  bundleHash: string
  status: string
}

const BUNDLE_SCALAR_FIELDS = [
  'id',
  'queryId',
  'payTo',
  'network',
  'asset',
  'amountAtomic',
  'budgetAtomic',
  'minimumDepositAtomic',
  'totalPriceKrw',
  'krwPerUsdc',
  'expiresAt',
  'resourcePath',
  'bundleHash',
] as const

function canonicalAtomic(value: unknown, positive: boolean): bigint | null {
  if (typeof value !== 'string' || !/^(0|[1-9][0-9]*)$/.test(value)) return null
  const atomic = BigInt(value)
  return positive && atomic === 0n ? null : atomic
}

/**
 * Compare the gateway response to an independently fetched Rust quote and to
 * the browser's original purchase intent. This catches a gateway that changes
 * both its create request and later 402 response consistently.
 */
export function exactResearchBundleQuote(options: {
  gatewayQuote: unknown
  canonicalQuote: unknown
  queryId: string
  documentHandles: string[]
  preferredTopUpAtomic: string
  nowMs?: number
}): ExactResearchBundleQuote {
  const gateway = options.gatewayQuote as Record<string, unknown> | null
  const canonical = options.canonicalQuote as Record<string, unknown> | null
  const preferredTopUp = canonicalAtomic(options.preferredTopUpAtomic, true)
  if (!gateway || !canonical || !preferredTopUp) {
    throw new Error('The research payment quote is malformed.')
  }
  for (const field of BUNDLE_SCALAR_FIELDS) {
    if (gateway[field] !== canonical[field]) {
      throw new Error('The payment gateway quote does not match the canonical ledger quote.')
    }
  }
  if (
    !Array.isArray(gateway.documentHandles)
    || !Array.isArray(canonical.documentHandles)
    || gateway.documentHandles.some((handle) => typeof handle !== 'string')
    || canonical.documentHandles.some((handle) => typeof handle !== 'string')
    || JSON.stringify(gateway.documentHandles) !== JSON.stringify(canonical.documentHandles)
    || canonical.queryId !== options.queryId
    || JSON.stringify(canonical.documentHandles) !== JSON.stringify(options.documentHandles)
  ) {
    throw new Error('The research payment quote does not match the requested documents.')
  }
  const amount = canonicalAtomic(canonical.amountAtomic, false)
  const budget = canonicalAtomic(canonical.budgetAtomic, true)
  const minimumDeposit = canonicalAtomic(canonical.minimumDepositAtomic, false)
  const available = canonicalAtomic(canonical.availableBalanceAtomic, false)
  if (
    amount === null
    || budget === null
    || minimumDeposit === null
    || available === null
    || typeof canonical.id !== 'string'
    || !canonical.id
    || typeof canonical.payTo !== 'string'
    || !canonical.payTo
    || typeof canonical.network !== 'string'
    || !canonical.network
    || typeof canonical.asset !== 'string'
    || !canonical.asset
    || typeof canonical.bundleHash !== 'string'
    || !canonical.bundleHash
    || !Number.isSafeInteger(canonical.totalPriceKrw)
    || (canonical.totalPriceKrw as number) < 0
    || !Number.isSafeInteger(canonical.krwPerUsdc)
    || (canonical.krwPerUsdc as number) <= 0
    || !Number.isSafeInteger(canonical.expiresAt)
    || canonical.resourcePath !== `/api/v1/paid-bundles/${canonical.id}`
  ) {
    throw new Error('The canonical research payment quote is malformed.')
  }
  if (canonical.requiresPayment === true) {
    const permittedTopUp = preferredTopUp > minimumDeposit ? preferredTopUp : minimumDeposit
    if (
      canonical.status !== 'quoted'
      || amount === 0n
      || minimumDeposit === 0n
      || amount !== permittedTopUp
      || (canonical.expiresAt as number) <= (options.nowMs ?? Date.now())
    ) {
      throw new Error('The canonical research refill exceeds the requested funding contract.')
    }
  } else if (![
    'settling',
    'funded',
    'processing',
    'payment_in_progress',
    'payment_reconciliation',
    'completed',
    'refund_pending',
    'balance_refunded',
  ].includes(String(canonical.status))) {
    throw new Error('A non-payable research quote has inconsistent funding state.')
  }
  return canonical as unknown as ExactResearchBundleQuote
}

export type ExactTopUpQuote = ExactBrowserQuote & {
  expiresAt: number
  status: string
  resourcePath: string
}

/**
 * Validate the gateway's standalone top-up quote before it is used to pin a
 * wallet approval. A standalone top-up has no research context, so unlike the
 * bundle quote there is no canonical Rust quote to cross-check; the gateway is
 * the source of truth for the amount and receiver, and the browser only accepts
 * a well-formed, unexpired, exact-payable quote whose resource path matches its
 * id (so the paid GET cannot be redirected to another resource).
 */
export function exactTopUpQuote(gatewayQuote: unknown): ExactTopUpQuote {
  const quote = gatewayQuote as Record<string, unknown> | null
  if (
    !quote
    || typeof quote.id !== 'string'
    || !quote.id
    || typeof quote.payTo !== 'string'
    || !quote.payTo
    || typeof quote.network !== 'string'
    || !quote.network
    || typeof quote.asset !== 'string'
    || !quote.asset
    || typeof quote.amountAtomic !== 'string'
    || !/^[1-9][0-9]*$/.test(quote.amountAtomic)
    || typeof quote.resourcePath !== 'string'
    || quote.resourcePath !== `/api/v1/paid-top-ups/${quote.id}`
    || quote.status !== 'quoted'
    || !Number.isSafeInteger(quote.expiresAt)
    || (quote.expiresAt as number) <= Date.now()
  ) {
    throw new Error('The prepaid top-up quote is malformed.')
  }
  return {
    id: quote.id,
    network: quote.network,
    asset: quote.asset,
    amountAtomic: quote.amountAtomic,
    payTo: quote.payTo,
    expiresAt: quote.expiresAt as number,
    status: quote.status,
    resourcePath: quote.resourcePath,
  }
}

/**
 * Pin the wallet approval to the quote already committed by the Rust ledger.
 * A compromised gateway response must not be able to raise the amount, swap
 * the mint, redirect the recipient, or detach recovery from the quote memo.
 */
export function exactQuotePaymentPolicy(
  kind: 'bundle' | 'open_call' | 'topup',
  quote: ExactBrowserQuote,
): (_version: number, requirements: BrowserPaymentRequirement[]) => BrowserPaymentRequirement[] {
  if (
    !quote.id
    || !/^[1-9][0-9]*$/.test(quote.amountAtomic)
    || !quote.network
    || !quote.asset
    || !quote.payTo
  ) {
    throw new Error('The durable quote is not safe for wallet approval.')
  }
  const memo = `openshelf:v1:${kind}:${quote.id}`
  return (_version, requirements) => requirements.filter((requirement) =>
    requirement.scheme === 'exact'
    && requirement.network === quote.network
    && requirement.asset === quote.asset
    && requirement.amount === quote.amountAtomic
    && requirement.payTo === quote.payTo
    && Number.isSafeInteger(requirement.maxTimeoutSeconds)
    && requirement.maxTimeoutSeconds > 0
    && requirement.maxTimeoutSeconds <= 60
    && requirement.extra?.memo === memo
  )
}
