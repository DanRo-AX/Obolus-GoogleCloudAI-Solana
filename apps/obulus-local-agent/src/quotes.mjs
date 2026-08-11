import { DEVNET_NETWORK, DEVNET_USDC } from './constants.mjs'
import { LocalAgentError } from './errors.mjs'

const BUNDLE_FIELDS = [
  'id',
  'queryId',
  'payTo',
  'network',
  'asset',
  'amountAtomic',
  'budgetAtomic',
  'minimumDepositAtomic',
  'requiresPayment',
  'availableBalanceAtomic',
  'totalPriceKrw',
  'krwPerUsdc',
  'expiresAt',
  'resourcePath',
  'bundleHash',
  'status',
]

const DOCUMENT_FIELDS = [
  'id',
  'queryId',
  'documentHandle',
  'payTo',
  'network',
  'asset',
  'amountAtomic',
  'priceKrw',
  'krwPerUsdc',
  'expiresAt',
  'resourcePath',
  'canonicalUrl',
  'contentHash',
  'documentVersion',
  'status',
  'consentVersion',
]

export function assertDevnetQuote(quote, now = Date.now()) {
  if (!quote || quote.network !== DEVNET_NETWORK || quote.asset !== DEVNET_USDC) {
    throw new LocalAgentError(
      'Refusing a payment outside Solana Devnet or with an unknown asset.',
      'unsafe_payment_quote',
    )
  }
  if (!/^[1-9]\d*$/.test(String(quote.amountAtomic || ''))) {
    throw new LocalAgentError('Payment amount must be a positive atomic integer.', 'unsafe_payment_quote')
  }
  if (!Number.isSafeInteger(quote.expiresAt) || quote.expiresAt <= now) {
    throw new LocalAgentError('The payment quote expired.', 'quote_expired', 410)
  }
  if (typeof quote.payTo !== 'string' || !quote.payTo) {
    throw new LocalAgentError('The payment recipient is missing.', 'unsafe_payment_quote')
  }
  if (!/^[1-9A-HJ-NP-Za-km-z]{32,44}$/.test(quote.payTo)) {
    throw new LocalAgentError('The payment recipient is not a Solana address.', 'unsafe_payment_quote')
  }
  return quote
}

export function assertDocumentQuote({
  quote,
  queryId,
  handle,
  resourcePath,
  expectedPriceKrw,
  budgetKrw,
  maxUnitPriceKrw,
  now = Date.now(),
}) {
  assertDevnetQuote(quote, now)
  const expectedAtomic = krwToUsdcAtomic(quote.priceKrw, quote.krwPerUsdc)
  if (
    quote.queryId !== queryId ||
    quote.documentHandle !== handle ||
    quote.resourcePath !== resourcePath ||
    quote.status !== 'quoted' ||
    quote.krwPerUsdc !== 1_350 ||
    !Number.isSafeInteger(quote.priceKrw) ||
    quote.priceKrw < 1 ||
    quote.amountAtomic !== expectedAtomic ||
    quote.priceKrw !== expectedPriceKrw ||
    (Number.isSafeInteger(budgetKrw) && quote.priceKrw > budgetKrw) ||
    (Number.isSafeInteger(maxUnitPriceKrw) && quote.priceKrw > maxUnitPriceKrw) ||
    !/^[0-9a-f]{64}$/.test(quote.contentHash || '') ||
    !Number.isSafeInteger(quote.documentVersion) ||
    quote.documentVersion < 1 ||
    typeof quote.consentVersion !== 'string' ||
    !quote.consentVersion ||
    quote.canonicalUrl !== `/api/v1/documents/${handle}`
  ) {
    throw new LocalAgentError(
      'The document quote is not bound to this exact query and resource.',
      'unsafe_payment_quote',
    )
  }
  return quote
}

export function exactDocumentQuote({
  gatewayQuote,
  canonicalQuote,
  queryId,
  handle,
  resourcePath,
  expectedPriceKrw,
  budgetKrw,
  maxUnitPriceKrw,
  now = Date.now(),
}) {
  if (!gatewayQuote || !canonicalQuote) {
    throw new LocalAgentError('The document quote is malformed.', 'unsafe_payment_quote')
  }
  for (const field of DOCUMENT_FIELDS) {
    if (gatewayQuote[field] !== canonicalQuote[field]) {
      throw new LocalAgentError(
        'Gateway economics do not match the canonical research ledger.',
        'unsafe_payment_quote',
      )
    }
  }
  return assertDocumentQuote({
    quote: canonicalQuote,
    queryId,
    handle,
    resourcePath,
    expectedPriceKrw,
    budgetKrw,
    maxUnitPriceKrw,
    now,
  })
}

export function exactBundleQuote({ gatewayQuote, canonicalQuote, queryId, handles, now = Date.now() }) {
  if (!gatewayQuote || !canonicalQuote) {
    throw new LocalAgentError('The bundle quote is malformed.', 'unsafe_payment_quote')
  }
  for (const field of BUNDLE_FIELDS) {
    if (gatewayQuote[field] !== canonicalQuote[field]) {
      throw new LocalAgentError(
        'Gateway economics do not match the canonical research ledger.',
        'unsafe_payment_quote',
      )
    }
  }
  if (
    canonicalQuote.queryId !== queryId ||
    JSON.stringify(canonicalQuote.documentHandles) !== JSON.stringify(handles) ||
    JSON.stringify(gatewayQuote.documentHandles) !== JSON.stringify(handles)
  ) {
    throw new LocalAgentError('The quote is not bound to this query and selection.', 'unsafe_payment_quote')
  }
  assertDevnetQuote(canonicalQuote, now)
  const amount = canonicalAtomic(canonicalQuote.amountAtomic, true)
  const budget = canonicalAtomic(canonicalQuote.budgetAtomic, true)
  const minimum = canonicalAtomic(canonicalQuote.minimumDepositAtomic, true)
  const available = canonicalAtomic(canonicalQuote.availableBalanceAtomic, false)
  if (
    amount === null ||
    amount !== budget ||
    amount !== minimum ||
    available !== 0n ||
    canonicalQuote.requiresPayment !== true ||
    canonicalQuote.status !== 'quoted' ||
    canonicalQuote.krwPerUsdc !== 1_350 ||
    !/^[0-9a-f]{64}$/.test(canonicalQuote.bundleHash || '') ||
    canonicalQuote.resourcePath !== `/api/v1/paid-bundles/${canonicalQuote.id}`
  ) {
    throw new LocalAgentError(
      'The quote violates the one-shot local-agent funding contract.',
      'unsafe_payment_quote',
    )
  }
  return canonicalQuote
}

export function paymentPlan(paymentUrl, quote, purpose, now = Date.now()) {
  assertDevnetQuote(quote, now)
  return {
    status: 'approval_required',
    purpose,
    paymentUrl,
    quote: {
      id: quote.id,
      network: quote.network,
      asset: quote.asset,
      amountAtomic: String(quote.amountAtomic),
      amountUsdc: atomicToUsdc(quote.amountAtomic),
      totalPriceKrw: quote.totalPriceKrw ?? quote.priceKrw,
      expiresAt: quote.expiresAt,
      payTo: quote.payTo,
    },
    approvalBinding: Object.fromEntries(
      Object.entries(quote).filter(([key]) =>
        [...DOCUMENT_FIELDS, ...BUNDLE_FIELDS, 'documentHandles'].includes(key),
      ),
    ),
  }
}

function canonicalAtomic(value, positive) {
  if (typeof value !== 'string' || !/^(0|[1-9]\d*)$/.test(value)) return null
  const atomic = BigInt(value)
  if (positive && atomic === 0n) return null
  return atomic
}

function atomicToUsdc(value) {
  const atomic = BigInt(value)
  const whole = atomic / 1_000_000n
  const fraction = (atomic % 1_000_000n).toString().padStart(6, '0').replace(/0+$/, '')
  return fraction ? `${whole}.${fraction}` : whole.toString()
}

function krwToUsdcAtomic(priceKrw, krwPerUsdc) {
  if (!Number.isSafeInteger(priceKrw) || priceKrw < 0 || !Number.isSafeInteger(krwPerUsdc) || krwPerUsdc < 1) {
    return null
  }
  const numerator = BigInt(priceKrw) * 1_000_000n
  const denominator = BigInt(krwPerUsdc)
  return ((numerator + denominator - 1n) / denominator || 1n).toString()
}
