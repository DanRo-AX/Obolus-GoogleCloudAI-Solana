import assert from 'node:assert/strict'
import { mkdtemp, readFile, rm, stat } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import test from 'node:test'

import { runtimeConfig } from '../src/config.mjs'
import { approvePaymentIntent } from '../src/approval.mjs'
import { DEVNET_NETWORK, DEVNET_USDC } from '../src/constants.mjs'
import { LocalMarketplace } from '../src/marketplace.mjs'
import { handleMcpRequest } from '../src/mcp.mjs'
import { handlePayMcpRequest } from '../src/pay-mcp.mjs'
import { payInvocation } from '../src/pay-sh.mjs'
import { minimizeQuestion } from '../src/privacy.mjs'
import { exactBundleQuote, exactDocumentQuote } from '../src/quotes.mjs'
import { tools } from '../src/tools.mjs'

test('remote origins require HTTPS while loopback HTTP remains available', () => {
  assert.throws(
    () => runtimeConfig({ OBULUS_API_URL: 'http://api.example.com' }),
    /must use HTTPS/,
  )
  const config = runtimeConfig({
    OBULUS_API_URL: 'http://127.0.0.1:8787',
    OBULUS_GATEWAY_URL: 'http://localhost:1402',
    OBULUS_LOCAL_STATE: '/tmp/obulus-local-test.json',
  })
  assert.equal(config.apiOrigin, 'http://127.0.0.1:8787')
})

test('strict privacy blocks identifiers and redact mode removes them locally', () => {
  assert.throws(
    () => minimizeQuestion('Please research lee@example.com purchase behavior', 'strict'),
    (error) => error.code === 'sensitive_query_blocked',
  )
  const minimized = minimizeQuestion(
    'Please research lee@example.com purchase behavior in Paris',
    'redact',
  )
  assert.doesNotMatch(minimized.question, /lee@example\.com/)
  assert.deepEqual(minimized.redactions, ['email address'])
})

test('buyer MCP exposes no account, contributor-profile, Phantom, or signing tool', async () => {
  const names = tools.map((tool) => tool.name)
  assert.deepEqual(names, [
    'local_privacy_status',
    'search_human_evidence',
    'generate_ai_baseline',
    'prepare_evidence_payment',
    'evidence_payment_status',
    'synthesize_paid_evidence',
    'forget_local_query',
  ])
  assert.equal(names.some((name) => /auth|profile|wallet|sign|phantom/i.test(name)), false)
  const response = await handleMcpRequest(
    { jsonrpc: '2.0', id: 1, method: 'tools/list' },
    {},
  )
  assert.equal(response.result.tools.length, 7)
})

test('search is accountless, stores only a local capability, and returns no token', async (context) => {
  const directory = await mkdtemp(join(tmpdir(), 'obulus-local-'))
  context.after(() => rm(directory, { recursive: true, force: true }))
  const requests = []
  const fetchImpl = async (url, init = {}) => {
    requests.push({ url: String(url), init })
    return jsonResponse({
      queryId: 'query_1',
      decision: 'hit',
      matches: [{ handle: 'human_1', priceKrw: 20, passage: 'must never escape metadata' }],
      paymentAccessToken: 'local-only-capability',
      futureSecretField: 'must never escape the allowlist',
    })
  }
  const config = fixtureConfig(directory)
  const marketplace = new LocalMarketplace(config, { fetchImpl, now: () => 1_000 })
  const result = await marketplace.search({
    question: 'What do Paris residents choose for weekday dinner?',
    requestedDocuments: 3,
    filters: { region: 'abroad' },
  })
  assert.equal(result.paymentAccessToken, undefined)
  assert.equal(result.futureSecretField, undefined)
  assert.equal(result.matches[0].passage, undefined)
  assert.equal(result.privacy.accountAttached, false)
  const headers = new Headers(requests[0].init.headers)
  assert.equal(headers.has('authorization'), false)
  assert.equal(headers.has('cookie'), false)
  assert.deepEqual(JSON.parse(requests[0].init.body), {
    question: 'What do Paris residents choose for weekday dinner?',
    requestedDocuments: 3,
    filters: { region: 'abroad' },
  })
  const stored = JSON.parse(await readFile(config.statePath, 'utf8'))
  assert.equal(stored.queries.query_1.paymentAccessToken, 'local-only-capability')
  assert.equal(JSON.stringify(stored).includes('Paris residents'), false)
  assert.equal((await stat(config.statePath)).mode & 0o777, 0o600)
})

test('concurrent MCP searches preserve every local recovery capability', async (context) => {
  const directory = await mkdtemp(join(tmpdir(), 'obulus-local-'))
  context.after(() => rm(directory, { recursive: true, force: true }))
  let sequence = 0
  const fetchImpl = async () => {
    const id = ++sequence
    return jsonResponse({
      queryId: `query_${id}`,
      decision: 'hit',
      matches: [{ handle: `human_${id}`, priceKrw: 20 }],
      paymentAccessToken: `capability_${id}`,
    })
  }
  const config = fixtureConfig(directory)
  const marketplace = new LocalMarketplace(config, { fetchImpl, now: () => 1_000 })
  await Promise.all(
    Array.from({ length: 25 }, (_, index) =>
      marketplace.search({ question: `Which local experience is relevant for scenario ${index}?` }),
    ),
  )
  const stored = JSON.parse(await readFile(config.statePath, 'utf8'))
  assert.equal(Object.keys(stored.queries).length, 25)
})

test('single-document payment only returns an exact Pay.sh handoff and never signs', async (context) => {
  const directory = await mkdtemp(join(tmpdir(), 'obulus-local-'))
  context.after(() => rm(directory, { recursive: true, force: true }))
  let call = 0
  const now = 1_000
  const fetchImpl = async () => {
    call += 1
    if (call === 1) {
      return jsonResponse({
        queryId: 'query_2',
        decision: 'hit',
        matches: [{ handle: 'human_2', priceKrw: 20 }],
        paymentAccessToken: 'query-secret',
      })
    }
    const quote = documentQuote(now)
    return call === 2 ? jsonResponse({ quote }, 402) : jsonResponse(quote)
  }
  const marketplace = new LocalMarketplace(fixtureConfig(directory), {
    fetchImpl,
    now: () => now,
  })
  await marketplace.search({ question: 'Which weekday meals do Paris commuters repeat most?' })
  const plan = await marketplace.preparePayment({ queryId: 'query_2', handles: ['human_2'] })
  assert.equal(plan.status, 'approval_required')
  assert.equal(plan.quote.amountAtomic, '14815')
  assert.match(plan.nextAction, /local-agent:approve/)
  assert.match(plan.signingBoundary, /no Phantom/)
  assert.equal(Object.hasOwn(plan, 'paymentUrl'), false)
  assert.equal(Object.hasOwn(plan, 'signature'), false)
})

test('single-document economics and immutable fields must match the canonical Rust quote', () => {
  const quote = documentQuote(1_000)
  assert.equal(
    exactDocumentQuote({
      gatewayQuote: structuredClone(quote),
      canonicalQuote: structuredClone(quote),
      queryId: 'query_2',
      handle: 'human_2',
      resourcePath: quote.resourcePath,
      expectedPriceKrw: 20,
      budgetKrw: 20,
      now: 1_000,
    }).id,
    'quote_2',
  )
  const wrongMath = structuredClone(quote)
  wrongMath.amountAtomic = '15000'
  assert.throws(
    () =>
      exactDocumentQuote({
        gatewayQuote: wrongMath,
        canonicalQuote: wrongMath,
        queryId: 'query_2',
        handle: 'human_2',
        resourcePath: quote.resourcePath,
        expectedPriceKrw: 20,
        budgetKrw: 20,
        now: 1_000,
      }),
    /not bound/,
  )
  const changedConsent = structuredClone(quote)
  changedConsent.consentVersion = 'consent-v2'
  assert.throws(
    () =>
      exactDocumentQuote({
        gatewayQuote: changedConsent,
        canonicalQuote: quote,
        queryId: 'query_2',
        handle: 'human_2',
        resourcePath: quote.resourcePath,
        expectedPriceKrw: 20,
        now: 1_000,
      }),
    /do not match/,
  )
})

test('Pay MCP exposes only a one-time interactively approved intent', async (context) => {
  const directory = await mkdtemp(join(tmpdir(), 'obulus-local-'))
  context.after(() => rm(directory, { recursive: true, force: true }))
  const now = 1_000
  let call = 0
  const marketplace = new LocalMarketplace(fixtureConfig(directory), {
    now: () => now,
    fetchImpl: async () => {
      call += 1
      if (call === 1) {
        return jsonResponse({
          queryId: 'query_pay',
          decision: 'hit',
          matches: [{ handle: 'human_2', priceKrw: 20 }],
          paymentAccessToken: 'local-capability',
        })
      }
      const quote = { ...documentQuote(now), queryId: 'query_pay' }
      quote.resourcePath = '/api/v1/paid-documents/query_pay/human_2'
      return call === 2 ? jsonResponse({ quote }, 402) : jsonResponse(quote)
    },
  })
  await marketplace.search({ question: 'Which local meal choice best fits this exact research scenario?' })
  const plan = await marketplace.preparePayment({ queryId: 'query_pay', handles: ['human_2'] })
  const config = fixtureConfig(directory)
  const before = await handlePayMcpRequest(
    {
      jsonrpc: '2.0',
      id: 1,
      method: 'tools/call',
      params: { name: 'pay_approved_intent', arguments: { intentId: plan.intentId } },
    },
    config,
    { now: () => now },
  )
  assert.equal(before.result.isError, true)
  assert.equal(before.result.structuredContent.error.code, 'payment_not_approved')

  await approvePaymentIntent(config, plan.intentId, {
    now: () => now,
    confirm: ({ phrase, summary }) => phrase.startsWith('APPROVE ') && summary.includes('14815'),
  })
  let invocation = null
  const paid = await handlePayMcpRequest(
    {
      jsonrpc: '2.0',
      id: 2,
      method: 'tools/call',
      params: { name: 'pay_approved_intent', arguments: { intentId: plan.intentId } },
    },
    config,
    {
      now: () => now,
      env: {
        OBULUS_PAY_COMMAND: '/trusted/pay',
        OBULUS_ALLOW_PAY_OVERRIDE: '1',
        PATH: '/usr/bin',
        UNRELATED_SECRET: 'must-not-leak',
      },
      runner: async (command, args, options) => {
        invocation = { command, args, env: options.env }
        return { stdout: '{"paid":true}', stderr: '' }
      },
    },
  )
  assert.equal(paid.result.isError, false)
  assert.equal(paid.result.structuredContent.status, 'completed')
  assert.equal(invocation.command, '/trusted/pay')
  assert.deepEqual(invocation.args, [
    'curl',
    'https://pay.example.com/api/v1/paid-documents/query_pay/human_2',
  ])
  assert.equal(invocation.env.UNRELATED_SECRET, undefined)

  const replay = await handlePayMcpRequest(
    {
      jsonrpc: '2.0',
      id: 3,
      method: 'tools/call',
      params: { name: 'pay_approved_intent', arguments: { intentId: plan.intentId } },
    },
    config,
    { now: () => now },
  )
  assert.equal(replay.result.isError, true)
  const listed = await handlePayMcpRequest(
    { jsonrpc: '2.0', id: 4, method: 'tools/list' },
    config,
  )
  assert.deepEqual(listed.result.tools.map((tool) => tool.name), ['pay_approved_intent'])
})

test('bundle quote must match the canonical query, economics, Devnet, and selection', () => {
  const quote = {
    id: 'bundle_1',
    queryId: 'query_1',
    payTo: '11111111111111111111111111111111',
    network: DEVNET_NETWORK,
    asset: DEVNET_USDC,
    amountAtomic: '20000',
    budgetAtomic: '20000',
    minimumDepositAtomic: '20000',
    requiresPayment: true,
    availableBalanceAtomic: '0',
    totalPriceKrw: 27,
    krwPerUsdc: 1_350,
    expiresAt: 61_000,
    resourcePath: '/api/v1/paid-bundles/bundle_1',
    bundleHash: 'a'.repeat(64),
    status: 'quoted',
    documentHandles: ['one', 'two'],
  }
  assert.equal(
    exactBundleQuote({
      gatewayQuote: structuredClone(quote),
      canonicalQuote: structuredClone(quote),
      queryId: 'query_1',
      handles: ['one', 'two'],
      now: 1_000,
    }).id,
    'bundle_1',
  )
  const changed = structuredClone(quote)
  changed.amountAtomic = '20001'
  assert.throws(
    () =>
      exactBundleQuote({
        gatewayQuote: changed,
        canonicalQuote: quote,
        queryId: 'query_1',
        handles: ['one', 'two'],
        now: 1_000,
      }),
    /do not match/,
  )
})

test('Pay.sh resolves an explicit trusted command without Phantom dependencies', () => {
  assert.deepEqual(payInvocation({ OBULUS_PAY_COMMAND: '/trusted/pay', OBULUS_ALLOW_PAY_OVERRIDE: '1' }), {
    command: '/trusted/pay',
    args: [],
    source: 'override',
  })
})

function documentQuote(now) {
  return {
    id: 'quote_2',
    queryId: 'query_2',
    documentHandle: 'human_2',
    network: DEVNET_NETWORK,
    asset: DEVNET_USDC,
    amountAtomic: '14815',
    priceKrw: 20,
    krwPerUsdc: 1_350,
    expiresAt: now + 60_000,
    payTo: '11111111111111111111111111111111',
    resourcePath: '/api/v1/paid-documents/query_2/human_2',
    canonicalUrl: '/api/v1/documents/human_2',
    contentHash: 'a'.repeat(64),
    documentVersion: 1,
    status: 'quoted',
    consentVersion: 'consent-v1',
  }
}

function fixtureConfig(directory) {
  return {
    apiOrigin: 'https://api.example.com',
    gatewayOrigin: 'https://pay.example.com',
    statePath: join(directory, 'state.json'),
  }
}

function jsonResponse(body, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
  })
}
