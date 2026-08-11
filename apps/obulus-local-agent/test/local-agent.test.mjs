import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { mkdtemp, readFile, rm, stat } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import test from 'node:test'

import { runtimeConfig } from '../src/config.mjs'
import { approvePaymentIntent, paymentApprovalPreview } from '../src/approval.mjs'
import { DEVNET_NETWORK, DEVNET_USDC } from '../src/constants.mjs'
import { LocalMarketplace } from '../src/marketplace.mjs'
import { handleMcpRequest } from '../src/mcp.mjs'
import { handlePayMcpRequest } from '../src/pay-mcp.mjs'
import { payInvocation } from '../src/pay-sh.mjs'
import { executeApprovedIntent } from '../src/payment-broker.mjs'
import { minimizeQuestion } from '../src/privacy.mjs'
import { assertDevnetQuote, exactBundleQuote, exactDocumentQuote } from '../src/quotes.mjs'
import { forgetLocalState, readState, updateState } from '../src/state.mjs'
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

test('MCP exposes the complete buyer and contributor workflow without a generic signing tool', async () => {
  const names = tools.map((tool) => tool.name)
  assert.deepEqual(names.slice(0, 7), [
    'local_privacy_status',
    'search_human_evidence',
    'generate_ai_baseline',
    'prepare_evidence_payment',
    'evidence_payment_status',
    'synthesize_paid_evidence',
    'forget_local_query',
  ])
  assert.equal(names.includes('prepare_open_call'), true)
  assert.equal(names.includes('manage_memory'), true)
  assert.equal(names.includes('earnings_and_claims'), true)
  assert.equal(names.includes('submit_human_answer'), true)
  assert.equal(names.some((name) => /private.?key|seed|generic.?pay|sign.?transaction|phantom/i.test(name)), false)
  const response = await handleMcpRequest(
    { jsonrpc: '2.0', id: 1, method: 'tools/list' },
    {},
  )
  assert.equal(response.result.tools.length, 26)
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

test('contributor tools add the locally stored bearer session only to authenticated endpoints', async (context) => {
  const directory = await mkdtemp(join(tmpdir(), 'obulus-local-'))
  context.after(() => rm(directory, { recursive: true, force: true }))
  const requests = []
  const config = fixtureConfig(directory)
  const marketplace = new LocalMarketplace(config, {
    fetchImpl: async (url, init = {}) => {
      requests.push({ url: String(url), init })
      return jsonResponse({ id: 'wallet-user', email: 'hidden@wallet.obulus.local' })
    },
  })
  await marketplace.setSession('s'.repeat(64), { id: 'wallet-user' })
  const status = await marketplace.accountStatus()
  assert.equal(status.connected, true)
  assert.equal(new Headers(requests[0].init.headers).get('authorization'), `Bearer ${'s'.repeat(64)}`)
  assert.equal(JSON.stringify(status).includes('s'.repeat(64)), false)
  await marketplace.clearSession()
  assert.equal((await readState(config)).sessionToken, null)
})

test('profile edits preserve an already verified Pay.sh payout wallet', async (context) => {
  const directory = await mkdtemp(join(tmpdir(), 'obulus-local-'))
  context.after(() => rm(directory, { recursive: true, force: true }))
  const requests = []
  const config = fixtureConfig(directory)
  const wallet = '11111111111111111111111111111111'
  const marketplace = new LocalMarketplace(config, {
    fetchImpl: async (url, init = {}) => {
      requests.push({ url: String(url), init })
      if (requests.length === 1) return jsonResponse({ handle: 'HUMAN', wallet, walletVerified: true })
      return jsonResponse({ handle: 'HUMAN', wallet, walletVerified: true })
    },
  })
  await marketplace.setSession('s'.repeat(64), { id: 'wallet-user' })
  await marketplace.callAuthenticatedTool('update_profile', {
    handle: 'human',
    ageBand: '25-34',
    region: 'abroad',
    household: 'alone',
    field: 'food',
    years: '3-7',
    speaksTo: ['food', 'travel'],
    autoMatch: true,
    agents: true,
    browserAlerts: true,
    emailAlerts: false,
  })
  assert.equal(requests[0].url, 'https://api.example.com/api/v1/profile')
  assert.equal(requests[1].url, 'https://api.example.com/api/v1/profile')
  assert.equal(JSON.parse(requests[1].init.body).wallet, wallet)
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

test('recipient validation requires a decoded 32-byte Solana public key', () => {
  const quote = documentQuote(1_000)
  assert.equal(assertDevnetQuote(quote, 1_000), quote)
  assert.throws(
    () => assertDevnetQuote({ ...quote, payTo: 'z'.repeat(44) }, 1_000),
    /not a Solana address/,
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
        return {
          stdout: JSON.stringify({
            citations: [{ handle: 'human_2', price: 20, excerpt: 'untrusted paid evidence' }],
            settlement: {
              id: 'quote_2',
              count: 1,
              total: 20,
              network: DEVNET_NETWORK,
            },
          }),
          stderr: 'diagnostics must remain local',
        }
      },
    },
  )
  assert.equal(paid.result.isError, false)
  assert.equal(paid.result.structuredContent.status, 'completed')
  assert.equal(invocation.command, '/trusted/pay')
  assert.deepEqual(invocation.args, [
    'fetch',
    '--account',
    'research',
    'https://pay.example.com/api/v1/paid-quotes/quote_2',
  ])
  assert.equal(invocation.env.UNRELATED_SECRET, undefined)
  assert.deepEqual(paid.result.structuredContent.receipt.citationHandles, ['human_2'])
  assert.equal(JSON.stringify(paid).includes('untrusted paid evidence'), false)
  assert.equal(JSON.stringify(paid).includes('diagnostics must remain local'), false)

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

test('Open Call prepares and executes only the exact authenticated escrow quote', async (context) => {
  const directory = await mkdtemp(join(tmpdir(), 'obulus-local-'))
  context.after(() => rm(directory, { recursive: true, force: true }))
  const config = fixtureConfig(directory)
  const now = 1_000
  const quote = {
    id: 'open_quote_1',
    payTo: '11111111111111111111111111111111',
    network: DEVNET_NETWORK,
    asset: DEVNET_USDC,
    amountAtomic: '55556',
    totalPriceKrw: 75,
    krwPerUsdc: 1_350,
    expiresAt: now + 60_000,
    resourcePath: '/api/v1/funded-open-calls/open_quote_1',
    payloadHash: 'b'.repeat(64),
    status: 'quoted',
    openCallId: null,
  }
  const requests = []
  const marketplace = new LocalMarketplace(config, {
    now: () => now,
    fetchImpl: async (url, init = {}) => {
      requests.push({ url: String(url), init })
      return requests.length === 1 ? jsonResponse(quote, 201) : jsonResponse({ quote }, 402)
    },
  })
  await marketplace.setSession('s'.repeat(64), { id: 'wallet-user' })
  const plan = await marketplace.prepareOpenCall({
    question: '파리 현지 직장인의 평일 저녁 식사 경험을 알려주세요',
    unitPriceKrw: 25,
    target: 3,
    shelf: '파리 현지 직장인',
    category: 'food',
    filters: { region: 'abroad' },
  })
  assert.equal(requests[0].url, 'https://api.example.com/api/v1/open-call-funding-quotes')
  assert.equal(new Headers(requests[0].init.headers).get('authorization'), `Bearer ${'s'.repeat(64)}`)
  assert.deepEqual(JSON.parse(requests[0].init.body), {
    question: '파리 현지 직장인의 평일 저녁 식사 경험을 알려주세요',
    unitPrice: 25,
    target: 3,
    chatId: plan.chatId,
    shelf: '파리 현지 직장인',
    category: 'food',
    filters: { region: 'abroad' },
  })
  assert.equal(requests[1].url, `https://pay.example.com${quote.resourcePath}`)
  const preview = await paymentApprovalPreview(config, plan.intentId, { now: () => now })
  assert.equal(preview.openCallTarget, 3)
  assert.equal(preview.openCallUnitPriceKrw, 25)
  assert.equal(preview.totalPriceKrw, 75)

  await approvePaymentIntent(config, plan.intentId, {
    now: () => now,
    confirm: ({ phrase }) => phrase === preview.confirmationPhrase,
  })
  const receipt = await executeApprovedIntent(config, plan.intentId, {
    now: () => now,
    env: {
      OBULUS_PAY_COMMAND: '/trusted/pay',
      OBULUS_ALLOW_PAY_OVERRIDE: '1',
    },
    runner: async () => ({
      stdout: JSON.stringify({
        quoteId: quote.id,
        status: 'settling',
        target: 3,
        unitPriceKrw: 25,
        totalPriceKrw: 75,
        network: DEVNET_NETWORK,
        mode: 'open_call_escrow',
      }),
      stderr: '',
    }),
  })
  assert.equal(receipt.receipt.kind, 'open_call')
  assert.equal(receipt.receipt.totalPriceKrw, 75)
})

test('Pay.sh resolves an explicit trusted command without Phantom dependencies', () => {
  assert.deepEqual(payInvocation({ OBULUS_PAY_COMMAND: '/trusted/pay', OBULUS_ALLOW_PAY_OVERRIDE: '1' }), {
    command: '/trusted/pay',
    args: [],
    source: 'override',
  })
  assert.throws(
    () => payInvocation({}, { projectPay: '/definitely/missing/pay' }),
    /Pinned Pay\.sh is missing/,
  )
})

test('interactive approval rejects an intent changed while the user is reading it', async (context) => {
  const directory = await mkdtemp(join(tmpdir(), 'obulus-local-'))
  context.after(() => rm(directory, { recursive: true, force: true }))
  const config = fixtureConfig(directory)
  await updateState(config, (state) => {
    state.paymentIntents.intent_changed = fixtureIntent()
    return state
  })
  await assert.rejects(
    approvePaymentIntent(config, 'intent_changed', {
      now: () => 1_000,
      confirm: async () => {
        await updateState(config, (state) => {
          state.paymentIntents.intent_changed.amountAtomic = '999'
          return state
        })
        return true
      },
    }),
    (error) => error.code === 'intent_changed',
  )
})

test('desktop approval preview exposes economics but never the executable capability', async (context) => {
  const directory = await mkdtemp(join(tmpdir(), 'obulus-local-'))
  context.after(() => rm(directory, { recursive: true, force: true }))
  const config = fixtureConfig(directory)
  await updateState(config, (state) => {
    state.paymentIntents.intent_preview_12345678 = fixtureIntent()
    return state
  })
  const preview = await paymentApprovalPreview(config, 'intent_preview_12345678', {
    now: () => 1_000,
  })
  assert.equal(preview.amountUsdc, '0.014815')
  assert.equal(preview.totalPriceKrw, 20)
  assert.deepEqual(preview.documentHandles, ['human_2'])
  assert.equal(preview.confirmationPhrase, 'APPROVE 12345678')
  assert.equal(Object.hasOwn(preview, 'paymentUrl'), false)
  assert.equal(JSON.stringify(preview).includes('capability'), false)
})

test('local capabilities cannot be deleted during Pay.sh execution', async (context) => {
  const directory = await mkdtemp(join(tmpdir(), 'obulus-local-'))
  context.after(() => rm(directory, { recursive: true, force: true }))
  const config = fixtureConfig(directory)
  await updateState(config, (state) => {
    state.queries.query_2 = { paymentAccessToken: 'capability', createdAt: 1_000 }
    state.paymentIntents.intent_executing = { ...fixtureIntent(), status: 'executing' }
    return state
  })
  await assert.rejects(
    forgetLocalState(config),
    (error) => error.code === 'payment_in_progress',
  )
  await assert.rejects(
    forgetLocalState(config, 'query_2'),
    (error) => error.code === 'payment_in_progress',
  )
  await updateState(config, (state) => {
    state.paymentIntents.intent_executing.status = 'ambiguous'
    return state
  })
  await assert.rejects(
    forgetLocalState(config, 'query_2'),
    (error) => error.code === 'payment_in_progress',
  )
  assert.equal((await readState(config)).queries.query_2.paymentAccessToken, 'capability')
})

test('direct recovery converges an uncertain local payment to completed', async (context) => {
  const directory = await mkdtemp(join(tmpdir(), 'obulus-local-'))
  context.after(() => rm(directory, { recursive: true, force: true }))
  const config = fixtureConfig(directory)
  await updateState(config, (state) => {
    state.queries.query_2 = { paymentAccessToken: 'capability', createdAt: 1_000 }
    state.paymentIntents.intent_recovering = {
      ...fixtureIntent(),
      status: 'executing',
      approvalNonce: 'one-time-nonce',
    }
    return state
  })
  const marketplace = new LocalMarketplace(config, {
    now: () => 1_000,
    fetchImpl: async (url, init = {}) => {
      assert.equal(
        String(url),
        'https://api.example.com/api/v1/agent-payment-recoveries/quote_2',
      )
      assert.equal(new Headers(init.headers).get('x-openshelf-query-token'), 'capability')
      return jsonResponse({
        citation: { handle: 'human_2', price: 20 },
        settlement: { quoteId: 'quote_2' },
      })
    },
  })

  const recovered = await marketplace.paymentStatus({ queryId: 'query_2', jobId: 'quote_2' })
  assert.equal(recovered.citation.handle, 'human_2')
  const stored = await readState(config)
  assert.equal(stored.paymentIntents.intent_recovering.status, 'completed')
  assert.equal(stored.paymentIntents.intent_recovering.approvalNonce, undefined)
})

test('a successful process exit without the exact paid receipt remains ambiguous', async (context) => {
  const directory = await mkdtemp(join(tmpdir(), 'obulus-local-'))
  context.after(() => rm(directory, { recursive: true, force: true }))
  const config = fixtureConfig(directory)
  await updateState(config, (state) => {
    state.paymentIntents.intent_bad_receipt = {
      ...fixtureIntent(),
      status: 'approved',
      approvalNonce: 'one-time-nonce',
    }
    return state
  })
  await assert.rejects(
    executeApprovedIntent(config, 'intent_bad_receipt', {
      now: () => 1_000,
      env: {
        OBULUS_PAY_COMMAND: '/trusted/pay',
        OBULUS_ALLOW_PAY_OVERRIDE: '1',
      },
      runner: async () => ({ stdout: '{"error":"HTTP 500"}', stderr: 'private diagnostics' }),
    }),
    (error) => error.code === 'payment_ambiguous' && !error.message.includes('private diagnostics'),
  )
  const stored = await readState(config)
  assert.equal(stored.paymentIntents.intent_bad_receipt.status, 'ambiguous')
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
    payAccount: 'research',
  }
}

function fixtureIntent() {
  const quote = documentQuote(1_000)
  const paymentUrl = `https://pay.example.com/api/v1/paid-quotes/${quote.id}`
  return {
    queryId: quote.queryId,
    quoteId: quote.id,
    status: 'prepared',
    purpose: 'Open exact evidence',
    paymentUrl,
    paymentUrlHash: createHash('sha256').update(paymentUrl).digest('hex'),
    amountAtomic: quote.amountAtomic,
    network: quote.network,
    asset: quote.asset,
    payTo: quote.payTo,
    payAccount: 'research',
    expiresAt: quote.expiresAt,
    approvalBinding: quote,
    createdAt: 1_000,
  }
}

function jsonResponse(body, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
  })
}
