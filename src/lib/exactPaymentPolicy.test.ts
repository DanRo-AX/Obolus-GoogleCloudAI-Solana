import assert from 'node:assert/strict'
import test from 'node:test'
import {
  exactQuotePaymentPolicy,
  exactResearchBundleQuote,
  type BrowserPaymentRequirement,
} from './exactPaymentPolicy.ts'

test('wallet approval accepts only the exact durable quote under a hostile 402 response', () => {
  const quote = {
    id: 'pbq_exact_1',
    network: 'solana:EtWTRABZaYq6iMfeYKouRu166VU2xqa1',
    asset: '4zMMC9srt5Ri5X14GAgXhaHii3GnPAEERYPJgZJDncDU',
    amountAtomic: '500000',
    payTo: 'Agent1111111111111111111111111111111111111',
  }
  const exact = {
    scheme: 'exact',
    network: quote.network,
    asset: quote.asset,
    amount: quote.amountAtomic,
    payTo: quote.payTo,
    maxTimeoutSeconds: 60,
    extra: { memo: `openshelf:v1:bundle:${quote.id}` },
  } as BrowserPaymentRequirement
  const attacks = [
    { ...exact, amount: '5000000' },
    { ...exact, payTo: 'Attacker11111111111111111111111111111111111' },
    { ...exact, asset: 'FakeMint111111111111111111111111111111111111' },
    { ...exact, extra: { memo: 'openshelf:v1:bundle:another-quote' } },
    { ...exact, network: 'solana:mainnet' as BrowserPaymentRequirement['network'] },
  ]
  const policy = exactQuotePaymentPolicy('bundle', quote)
  assert.deepEqual(policy(2, [...attacks, exact]), [exact])
})

test('gateway cannot consistently inflate both bundle creation and the 402 refill', () => {
  const canonical = {
    id: 'bundle_exact_1',
    queryId: 'query_1',
    documentHandles: ['doc-a', 'doc-b'],
    payTo: 'Agent1111111111111111111111111111111111111',
    network: 'solana:EtWTRABZaYq6iMfeYKouRu166VU2xqa1',
    asset: '4zMMC9srt5Ri5X14GAgXhaHii3GnPAEERYPJgZJDncDU',
    amountAtomic: '50000000',
    budgetAtomic: '500000',
    minimumDepositAtomic: '500000',
    requiresPayment: true,
    availableBalanceAtomic: '0',
    totalPriceKrw: 675,
    krwPerUsdc: 1350,
    expiresAt: 2_000_000,
    resourcePath: '/api/v1/paid-bundles/bundle_exact_1',
    bundleHash: 'a'.repeat(64),
    status: 'quoted',
  }
  assert.throws(
    () => exactResearchBundleQuote({
      gatewayQuote: canonical,
      canonicalQuote: canonical,
      queryId: 'query_1',
      documentHandles: ['doc-a', 'doc-b'],
      preferredTopUpAtomic: '5000000',
      nowMs: 1_000_000,
    }),
    /exceeds the requested funding contract/,
  )
})

test('a fully prepaid canonical bundle needs no wallet payment policy', () => {
  const canonical = {
    id: 'bundle_prepaid_1',
    queryId: 'query_1',
    documentHandles: ['doc-a'],
    payTo: 'Agent1111111111111111111111111111111111111',
    network: 'solana:EtWTRABZaYq6iMfeYKouRu166VU2xqa1',
    asset: '4zMMC9srt5Ri5X14GAgXhaHii3GnPAEERYPJgZJDncDU',
    amountAtomic: '0',
    budgetAtomic: '500000',
    minimumDepositAtomic: '0',
    requiresPayment: false,
    availableBalanceAtomic: '1000000',
    totalPriceKrw: 675,
    krwPerUsdc: 1350,
    expiresAt: 2_000_000,
    resourcePath: '/api/v1/paid-bundles/bundle_prepaid_1',
    bundleHash: 'b'.repeat(64),
    status: 'funded',
  }
  assert.deepEqual(
    exactResearchBundleQuote({
      gatewayQuote: canonical,
      canonicalQuote: canonical,
      queryId: 'query_1',
      documentHandles: ['doc-a'],
      preferredTopUpAtomic: '5000000',
      nowMs: 1_000_000,
    }),
    canonical,
  )
})

test('a second tab observes an already fenced canonical quote and never pays it again', () => {
  const gatewayQuote = {
    id: 'bundle_racing_1',
    queryId: 'query_1',
    documentHandles: ['doc-a'],
    payTo: 'Agent1111111111111111111111111111111111111',
    network: 'solana:EtWTRABZaYq6iMfeYKouRu166VU2xqa1',
    asset: '4zMMC9srt5Ri5X14GAgXhaHii3GnPAEERYPJgZJDncDU',
    amountAtomic: '5000000',
    budgetAtomic: '500000',
    minimumDepositAtomic: '500000',
    requiresPayment: true,
    availableBalanceAtomic: '0',
    totalPriceKrw: 675,
    krwPerUsdc: 1350,
    expiresAt: 2_000_000,
    resourcePath: '/api/v1/paid-bundles/bundle_racing_1',
    bundleHash: 'c'.repeat(64),
    status: 'quoted',
  }
  const canonicalQuote = {
    ...gatewayQuote,
    requiresPayment: false,
    availableBalanceAtomic: '9000000',
    status: 'settling',
  }
  assert.deepEqual(
    exactResearchBundleQuote({
      gatewayQuote,
      canonicalQuote,
      queryId: 'query_1',
      documentHandles: ['doc-a'],
      preferredTopUpAtomic: '5000000',
      nowMs: 1_000_000,
    }),
    canonicalQuote,
  )
})
