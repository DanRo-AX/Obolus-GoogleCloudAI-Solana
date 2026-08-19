import { createHash } from 'node:crypto'
import type { PayShResource, ResearchJobPlan } from './runner.js'

export const SETTLEMENT_INVOICE_SCHEME = 'obulus-settlement-v1'
export const HOSTED_PAY_SH_MODE = 'hosted_pay_sh'
const MAX_PROTOCOL_FEE_BPS = 1_000n

export type SettlementInvoiceLineItem = {
  quoteId: string
  documentHandle: string
  documentHash: string
  documentVersion: number
  consentVersion: string
  recipientWallet: string
  amountAtomic: string
  ownerAmountAtomic: string
  platformAmountAtomic: string
}

export type SettlementInvoice = {
  scheme: string
  settlementMode: string
  jobId: string
  payer: string
  authorization: string
  refundAddress: string
  queryHash: string
  documentBundleRoot: string
  network: string
  asset: string
  totalAmountAtomic: string
  platformFeeAtomic: string
  expiresAt: number
  deliveryPolicy: string
  lineItems: SettlementInvoiceLineItem[]
}

type PlanWithoutInvoice = Omit<ResearchJobPlan, 'invoice' | 'invoiceHash'>

export function createHostedSettlementInvoice(
  plan: PlanWithoutInvoice,
  queryHash: string,
  documentBundleRoot: string,
): SettlementInvoice {
  const platformFee = plan.resources.reduce(
    (sum, resource) => sum + parseAtomic(resource.platformAmountAtomic),
    0n,
  )
  const total = plan.resources.reduce(
    (sum, resource) => sum + parseAtomic(resource.amountAtomic),
    0n,
  )
  return {
    scheme: SETTLEMENT_INVOICE_SCHEME,
    settlementMode: HOSTED_PAY_SH_MODE,
    jobId: plan.id,
    payer: plan.payer,
    authorization: plan.payTo,
    refundAddress: plan.payer,
    queryHash,
    documentBundleRoot,
    network: plan.network,
    asset: plan.asset,
    totalAmountAtomic: total.toString(),
    platformFeeAtomic: platformFee.toString(),
    expiresAt: plan.resources.length > 0
      ? Math.min(...plan.resources.map((resource) => resource.expiresAt))
      : 2_000_000_000_000,
    deliveryPolicy: 'paid_snapshot_only',
    lineItems: plan.resources.map(resourceLineItem),
  }
}

export function hashSettlementInvoice(invoice: SettlementInvoice): string {
  return createHash('sha256').update(canonicalJson(invoice)).digest('hex')
}

/**
 * Recomputes every economic and data commitment received from the Rust ledger.
 * The Cloud Run worker must call this before it asks Pay.sh or KMS to sign.
 */
export function validateSettlementInvoice(plan: ResearchJobPlan): void {
  const invoice = plan.invoice
  requireEqual(invoice.scheme, SETTLEMENT_INVOICE_SCHEME, 'invoice scheme')
  requireEqual(invoice.settlementMode, HOSTED_PAY_SH_MODE, 'settlement mode')
  requireEqual(invoice.jobId, plan.id, 'invoice job')
  requireEqual(invoice.payer, plan.payer, 'invoice payer')
  requireEqual(invoice.authorization, plan.payTo, 'invoice authorization')
  requireEqual(invoice.refundAddress, plan.payer, 'invoice refund address')
  requireEqual(invoice.network, plan.network, 'invoice network')
  requireEqual(invoice.asset, plan.asset, 'invoice asset')
  requireEqual(invoice.deliveryPolicy, 'paid_snapshot_only', 'invoice delivery policy')
  requireHexDigest(invoice.queryHash, 'query hash')
  requireHexDigest(invoice.documentBundleRoot, 'document bundle root')
  if (!Number.isSafeInteger(invoice.expiresAt) || invoice.expiresAt <= 0) {
    throw new Error('invoice expiry is invalid')
  }
  if (hashSettlementInvoice(invoice) !== plan.invoiceHash) {
    throw new Error('settlement invoice hash does not match the Rust commitment')
  }

  const total = parseAtomic(invoice.totalAmountAtomic)
  const platformFee = parseAtomic(invoice.platformFeeAtomic)
  const pendingTotal = plan.resources.reduce(
    (sum, resource) => sum + parseAtomic(resource.amountAtomic),
    0n,
  )
  if (total !== pendingTotal) throw new Error('invoice total does not match pending resources')
  const percentageCeiling = (total * MAX_PROTOCOL_FEE_BPS + 9_999n) / 10_000n
  const positiveShareFloor = BigInt(invoice.lineItems.length)
  if (platformFee > maxBigInt(percentageCeiling, positiveShareFloor)) {
    throw new Error('invoice platform fee exceeds the configured safety ceiling')
  }

  const resources = new Map(plan.resources.map((resource) => [resource.quoteId, resource]))
  if (resources.size !== plan.resources.length || invoice.lineItems.length !== resources.size) {
    throw new Error('invoice contains missing or duplicate evidence line items')
  }
  let invoiceTotal = 0n
  let invoicePlatformFee = 0n
  for (const item of invoice.lineItems) {
    const resource = resources.get(item.quoteId)
    if (!resource) throw new Error('invoice contains an unknown quote')
    validateLineItem(item, resource)
    invoiceTotal += parseAtomic(item.amountAtomic)
    invoicePlatformFee += parseAtomic(item.platformAmountAtomic)
    resources.delete(item.quoteId)
  }
  if (resources.size > 0) throw new Error('invoice omitted a pending resource')
  if (invoiceTotal !== total) throw new Error('invoice line items do not equal its total')
  if (invoicePlatformFee !== platformFee) {
    throw new Error('invoice line-item fees do not equal its platform total')
  }
}

function validateLineItem(item: SettlementInvoiceLineItem, resource: PayShResource): void {
  requireEqual(item.documentHandle, resource.documentHandle, 'invoice document handle')
  requireEqual(item.documentHash, resource.contentHash, 'invoice document hash')
  requireEqual(item.documentVersion, resource.documentVersion, 'invoice document version')
  requireEqual(item.consentVersion, resource.consentVersion, 'invoice consent version')
  requireEqual(item.recipientWallet, resource.recipientWallet, 'invoice recipient')
  requireEqual(item.amountAtomic, resource.amountAtomic, 'invoice amount')
  requireEqual(item.ownerAmountAtomic, resource.ownerAmountAtomic, 'invoice owner amount')
  requireEqual(item.platformAmountAtomic, resource.platformAmountAtomic, 'invoice platform amount')
  requireHexDigest(item.documentHash, 'document hash')
  const amount = parseAtomic(item.amountAtomic)
  const split = parseAtomic(item.ownerAmountAtomic) + parseAtomic(item.platformAmountAtomic)
  if (amount <= 0n || split !== amount) throw new Error('invoice split does not equal line-item amount')
}

function resourceLineItem(resource: PayShResource): SettlementInvoiceLineItem {
  return {
    quoteId: resource.quoteId,
    documentHandle: resource.documentHandle,
    documentHash: resource.contentHash,
    documentVersion: resource.documentVersion,
    consentVersion: resource.consentVersion,
    recipientWallet: resource.recipientWallet,
    amountAtomic: resource.amountAtomic,
    ownerAmountAtomic: resource.ownerAmountAtomic,
    platformAmountAtomic: resource.platformAmountAtomic,
  }
}

function canonicalJson(value: unknown): string {
  if (value === null || typeof value === 'string' || typeof value === 'boolean') {
    return JSON.stringify(value)
  }
  if (typeof value === 'number') {
    if (!Number.isFinite(value)) throw new Error('invoice contains a non-finite number')
    return JSON.stringify(value)
  }
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(',')}]`
  if (typeof value === 'object') {
    const object = value as Record<string, unknown>
    return `{${Object.keys(object).sort().map((key) =>
      `${JSON.stringify(key)}:${canonicalJson(object[key])}`,
    ).join(',')}}`
  }
  throw new Error('invoice contains an unsupported value')
}

function parseAtomic(value: string): bigint {
  if (!/^(0|[1-9][0-9]*)$/.test(value)) throw new Error('invoice contains an invalid atomic amount')
  return BigInt(value)
}

function requireHexDigest(value: string, field: string): void {
  if (!/^[0-9a-f]{64}$/.test(value)) throw new Error(`${field} must be 32 bytes of lowercase hex`)
}

function requireEqual(actual: unknown, expected: unknown, field: string): void {
  if (actual !== expected) throw new Error(`${field} does not match the research plan`)
}

function maxBigInt(left: bigint, right: bigint): bigint {
  return left > right ? left : right
}
