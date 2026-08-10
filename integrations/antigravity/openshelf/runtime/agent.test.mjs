import assert from 'node:assert/strict'
import { execFile } from 'node:child_process'
import { mkdtemp, readFile, rm, stat, writeFile } from 'node:fs/promises'
import { createServer } from 'node:http'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import test from 'node:test'
import { promisify } from 'node:util'

import {
  DEVNET_NETWORK,
  DEVNET_USDC,
  assertDevnetQuote,
  emptyState,
  exactAgentBundleQuote,
  jsonRequest,
  readState,
  runtimeConfig,
  sessionTokenFrom,
  updateState,
  writeState,
} from './core.mjs'
import {
  authenticate,
  describeTools,
  decodeCliArguments,
  handleMcpRequest,
  invokeCliTool,
  runtimeReadiness,
} from './server.mjs'
import { discoveryFallback } from './pay-compat.mjs'
import { payInvocation } from './pay-command.mjs'
import { callTool, tools } from './tools.mjs'

const execFileAsync = promisify(execFile)

test('MCP advertises complete asker and contributor actions', async () => {
  const discovery = await handleMcpRequest({
    jsonrpc: '2.0',
    id: 0,
    method: 'server/discover',
    params: {
      _meta: { 'io.modelcontextprotocol/protocolVersion': '2026-07-28' },
    },
  })
  assert.deepEqual(discovery.result.supportedVersions, ['2025-06-18'])
  assert.equal(discovery.result._meta['io.modelcontextprotocol/serverInfo'].name, 'openshelf')

  const initialized = await handleMcpRequest({
    jsonrpc: '2.0',
    id: 1,
    method: 'initialize',
    params: {},
  })
  assert.equal(initialized.result.serverInfo.name, 'openshelf')
  const listed = await handleMcpRequest({ jsonrpc: '2.0', id: 2, method: 'tools/list' })
  const names = listed.result.tools.map((tool) => tool.name)
  for (const expected of [
    'ask_people',
    'prepare_evidence_payment',
    'evidence_payment_status',
    'prepare_open_call',
    'prepare_payout_wallet_link',
    'list_opportunities',
    'submit_human_answer',
    'earnings_and_claims',
  ]) {
    assert.ok(names.includes(expected), `${expected} should be exposed`)
  }
  assert.equal(names.length, tools.length)
  assert.equal(describeTools().length, tools.length)
  assert.equal(describeTools('ask_people').inputSchema.required[0], 'question')
  assert.throws(() => describeTools('not_a_tool'), /Unknown tool/)
})

test('Pay adapter forces Antigravity discovery back to the stable handshake', () => {
  assert.deepEqual(
    discoveryFallback({ jsonrpc: '2.0', id: 7, method: 'server/discover', params: {} }),
    {
      jsonrpc: '2.0',
      id: 7,
      error: { code: -32601, message: 'Method not found: server/discover' },
    },
  )
  assert.equal(discoveryFallback({ jsonrpc: '2.0', id: 8, method: 'initialize' }), null)
})

test('repository adapter exposes the pinned official Pay CLI', async () => {
  const invocation = payInvocation(
    { ...process.env, OPENSHELF_PAY_COMMAND: '' },
    { projectPay: '/definitely/missing/pay', findSystemPay: () => null },
  )
  assert.equal(invocation.source, 'pinned-npx')
  const { stdout, stderr } = await execFileAsync(
    invocation.command,
    [...invocation.args, '--version'],
    { timeout: 60_000 },
  )
  assert.match(`${stdout}${stderr}`, /^pay 0\.26\./m)
  assert.deepEqual(
    payInvocation({ OPENSHELF_PAY_COMMAND: '/trusted/custom-pay' }),
    { command: '/trusted/custom-pay', args: [], source: 'override' },
  )
})

test('tool boundary validates schemas before network access', async () => {
  await assert.rejects(
    () => callTool('ask_people', { question: 'short' }),
    /arguments\.question is too short/,
  )
  await assert.rejects(
    () => callTool('ask_people', { question: 'A sufficiently concrete question', hidden: true }),
    /arguments\.hidden is not supported/,
  )
  await assert.rejects(
    () => callTool('answer_shelf_starter', {
      starterId: 'starter_1',
      answer: 'A concrete firsthand answer.',
      priceKrw: 17,
    }),
    /arguments\.priceKrw must be one of/,
  )
})

test('doctor separates free readiness from paid readiness', () => {
  assert.deepEqual(
    runtimeReadiness([
      { name: 'Rust API', ok: true },
      { name: 'x402 gateway', ok: false, requiredFor: 'paid actions only' },
      { name: 'Pay.sh', ok: false, requiredFor: 'paid actions only' },
      { name: 'Pay account', ok: false, requiredFor: 'paid actions only' },
    ]),
    { ok: true, paidActionsReady: false },
  )
  assert.deepEqual(
    runtimeReadiness([
      { name: 'Rust API', ok: false },
      { name: 'x402 gateway', ok: true, requiredFor: 'paid actions only' },
      { name: 'Pay.sh', ok: true, requiredFor: 'paid actions only' },
      { name: 'Pay account', ok: true, requiredFor: 'paid actions only' },
    ]),
    { ok: false, paidActionsReady: false },
  )
})

test('local authentication stores only the session token in a private file', async (context) => {
  const fixture = await fixtureServer((request, response) => {
    if (request.url === '/api/v1/auth/login') {
      response.writeHead(200, {
        'content-type': 'application/json',
        'set-cookie': 'openshelf_session=local-secret-token; HttpOnly; SameSite=Lax; Path=/',
      })
      response.end(
        JSON.stringify({
          user: { id: 'user_1', email: 'human@example.com', role: 'user' },
          balance: { currency: 'KRW', availableKrw: 100000, reservedKrw: 0, heldKrw: 0 },
        }),
      )
      return
    }
    response.writeHead(404).end()
  })
  context.after(fixture.close)
  const directory = await mkdtemp(join(tmpdir(), 'openshelf-agent-auth-'))
  context.after(() => rm(directory, { recursive: true, force: true }))
  const config = {
    apiOrigin: fixture.origin,
    gatewayOrigin: fixture.origin,
    statePath: join(directory, 'session.json'),
  }
  const result = await authenticate('login', {
    email: 'human@example.com',
    password: 'not-persisted',
    config,
  })
  assert.equal(result.user.email, 'human@example.com')
  const stored = await readFile(config.statePath, 'utf8')
  assert.match(stored, /local-secret-token/)
  assert.doesNotMatch(stored, /not-persisted/)
  assert.equal((await stat(config.statePath)).mode & 0o777, 0o600)
  assert.equal((await readState(config)).token, 'local-secret-token')
})

test('ask and aggregate evidence preparation keep query capability local', async (context) => {
  let bundlePreparations = 0
  let currentBundleQuote = null
  const fixture = await fixtureServer(async (request, response) => {
    if (request.url === '/api/v1/questions/resolve' && request.method === 'POST') {
      response.writeHead(200, { 'content-type': 'application/json' })
      response.end(
        JSON.stringify({
          queryId: 'query_1',
          paymentAccessToken: 'query-secret',
          decision: 'hit',
          reason: 'coverage_ready',
          liquidityState: 'human_covered',
          aiBaselineEligible: false,
          requestedDocuments: 2,
          candidateCount: 2,
          matches: [
            { handle: 'HUMAN_1', priceKrw: 100 },
            { handle: 'HUMAN_2', priceKrw: 200 },
          ],
          quote: { currency: 'KRW', documentCount: 2, totalPriceKrw: 300 },
          openCall: null,
        }),
      )
      return
    }
    if (request.url === '/api/v1/payment-bundles' && request.method === 'POST') {
      bundlePreparations += 1
      assert.equal(request.headers['x-openshelf-query-token'], 'query-secret')
      assert.equal(request.headers['x-openshelf-agent-payment-mode'], 'exact-agent-bundle-v1')
      assert.equal(request.headers['x-openshelf-wallet-session'], undefined)
      const chunks = []
      for await (const chunk of request) chunks.push(chunk)
      assert.deepEqual(JSON.parse(Buffer.concat(chunks).toString('utf8')), {
        queryId: 'query_1',
        handles: ['HUMAN_1', 'HUMAN_2'],
      })
      currentBundleQuote = devnetQuote({
        id: 'bundle_1',
        resourcePath: '/api/v1/paid-bundles/bundle_1',
        totalPriceKrw: 300,
        queryId: 'query_1',
        documentHandles: ['HUMAN_1', 'HUMAN_2'],
        status: bundlePreparations === 1 ? 'quoted' : 'completed',
        requiresPayment: bundlePreparations === 1,
      })
      response.writeHead(201, { 'content-type': 'application/json' })
      response.end(
        JSON.stringify({
          resourceUrl: 'https://attacker.invalid/collect-instead',
          quote: currentBundleQuote,
        }),
      )
      return
    }
    if (request.url === '/api/v1/agent-payment-bundles/bundle_1' && request.method === 'GET') {
      assert.equal(request.headers['x-openshelf-query-token'], 'query-secret')
      response.writeHead(200, { 'content-type': 'application/json' })
      response.end(JSON.stringify(currentBundleQuote))
      return
    }
    if (request.url === '/api/v1/research-jobs/bundle_1' && request.method === 'GET') {
      assert.equal(request.headers['x-openshelf-query-token'], 'query-secret')
      response.writeHead(200, { 'content-type': 'application/json' })
      response.end(
        JSON.stringify({
          id: 'bundle_1',
          queryId: 'query_1',
          status: 'completed',
          citations: [
            { handle: 'HUMAN_1', shelf: 'Local', excerpt: 'First paid answer', price: 100 },
            { handle: 'HUMAN_2', shelf: 'Local', excerpt: 'Second paid answer', price: 200 },
          ],
          pendingHandles: [],
        }),
      )
      return
    }
    response.writeHead(404, { 'content-type': 'application/json' })
    response.end(JSON.stringify({ error: { message: 'not found' } }))
  })
  context.after(fixture.close)
  const directory = await mkdtemp(join(tmpdir(), 'openshelf-agent-query-'))
  context.after(() => rm(directory, { recursive: true, force: true }))
  const config = {
    apiOrigin: fixture.origin,
    gatewayOrigin: fixture.origin,
    statePath: join(directory, 'session.json'),
  }
  await writeState(
    { token: null, user: null, queries: {}, apiOrigin: fixture.origin, gatewayOrigin: fixture.origin },
    config,
  )
  const resolution = await callTool('ask_people', { question: 'What do people actually do?' }, { config })
  assert.equal(resolution.queryId, 'query_1')
  assert.equal(resolution.paymentAccessToken, undefined)

  const plan = await callTool(
    'prepare_evidence_payment',
    { queryId: 'query_1', handles: ['HUMAN_1', 'HUMAN_2'] },
    { config },
  )
  assert.equal(plan.status, 'approval_required')
  assert.equal(plan.quote.amountUsdc, '0.0003')
  assert.equal(plan.paymentUrl, `${fixture.origin}/api/v1/paid-bundles/bundle_1`)
  assert.doesNotMatch(JSON.stringify(plan), /query-secret/)

  const recovered = await callTool(
    'evidence_payment_status',
    { queryId: 'query_1', jobId: 'bundle_1' },
    { config },
  )
  assert.equal(recovered.status, 'completed')
  assert.deepEqual(recovered.citations.map((citation) => citation.handle), ['HUMAN_1', 'HUMAN_2'])
  assert.doesNotMatch(JSON.stringify(recovered), /query-secret/)

  const restartRecovery = await callTool(
    'prepare_evidence_payment',
    { queryId: 'query_1', handles: ['HUMAN_1', 'HUMAN_2'] },
    { config },
  )
  assert.deepEqual(
    {
      status: restartRecovery.status,
      jobId: restartRecovery.jobId,
      jobStatus: restartRecovery.jobStatus,
      hasPaymentUrl: Object.hasOwn(restartRecovery, 'paymentUrl'),
    },
    {
      status: 'recovery_required',
      jobId: 'bundle_1',
      jobStatus: 'completed',
      hasPaymentUrl: false,
    },
  )
})

test('mainnet or changed asset payment quotes fail closed', () => {
  const quote = devnetQuote()
  assert.equal(assertDevnetQuote(quote), quote)
  assert.throws(
    () => assertDevnetQuote({ ...quote, network: 'solana:mainnet' }),
    /non-Devnet/,
  )
  assert.throws(() => assertDevnetQuote({ ...quote, asset: 'unknown' }), /unknown asset/)

  const canonicalBundle = devnetQuote({
    id: 'bundle_canonical',
    queryId: 'query_canonical',
    documentHandles: ['HUMAN_1', 'HUMAN_2'],
    resourcePath: '/api/v1/paid-bundles/bundle_canonical',
    status: 'quoted',
    requiresPayment: true,
  })
  assert.equal(
    exactAgentBundleQuote({
      gatewayQuote: canonicalBundle,
      canonicalQuote: canonicalBundle,
      queryId: 'query_canonical',
      handles: ['HUMAN_1', 'HUMAN_2'],
    }),
    canonicalBundle,
  )
  assert.throws(
    () =>
      exactAgentBundleQuote({
        gatewayQuote: { ...canonicalBundle, amountAtomic: '3000' },
        canonicalQuote: canonicalBundle,
        queryId: 'query_canonical',
        handles: ['HUMAN_1', 'HUMAN_2'],
      }),
    /does not match the canonical research ledger/,
  )
})

test('runtime endpoints reject insecure remote HTTP origins', () => {
  assert.throws(
    () =>
      runtimeConfig({
        OPENSHELF_API_URL: 'http://example.com',
        OPENSHELF_GATEWAY_URL: 'http://127.0.0.1:1402',
        OPENSHELF_AGENT_STATE: '/tmp/test-state',
      }),
    /must use HTTPS/,
  )
  assert.match(
    runtimeConfig({
      OPENSHELF_API_URL: 'http://127.0.0.1:8787',
      OPENSHELF_GATEWAY_URL: 'http://127.0.0.1:1402',
      OPENSHELF_AGENT_PROFILE: 'buyer_1',
    }).statePath,
    /agent-session-buyer_1\.json$/,
  )
  assert.throws(
    () =>
      runtimeConfig({
        OPENSHELF_API_URL: 'http://127.0.0.1:8787',
        OPENSHELF_GATEWAY_URL: 'http://127.0.0.1:1402',
        OPENSHELF_AGENT_PROFILE: '../other-user',
      }),
    /OPENSHELF_AGENT_PROFILE/,
  )
})

test('session cookie parser rejects responses without an OpenShelf session', () => {
  const response = new Response('{}', { status: 200 })
  assert.throws(() => sessionTokenFrom(response), /session cookie/)
})

test('agent HTTP boundary aborts a 200 response whose JSON body never finishes', async (context) => {
  const fixture = await fixtureServer((_request, response) => {
    response.writeHead(200, { 'content-type': 'application/json' })
    response.write('{"status":"half')
    setTimeout(() => response.end('"}'), 250)
  })
  context.after(fixture.close)
  const started = performance.now()
  await assert.rejects(
    () => jsonRequest(`${fixture.origin}/half-open`, {}, { timeoutMs: 50 }),
    (error) => error?.code === 'request_timeout',
  )
  assert.ok(performance.now() - started < 200)
})

test('one hundred concurrent agent queries preserve every recovery capability', async (context) => {
  const directory = await mkdtemp(join(tmpdir(), 'openshelf-agent-state-race-'))
  context.after(() => rm(directory, { recursive: true, force: true }))
  const config = {
    apiOrigin: 'http://127.0.0.1:8787',
    gatewayOrigin: 'http://127.0.0.1:1402',
    statePath: join(directory, 'session.json'),
  }
  await writeState(emptyState(config), config)
  await Promise.all(Array.from({ length: 100 }, (_, index) =>
    updateState(config, async (state) => {
      await Promise.resolve()
      state.queries[`query_${index}`] = {
        paymentAccessToken: `recovery_${index}`,
        handles: [`doc_${index}`],
      }
      return state
    })))
  const persisted = await readState(config)
  assert.equal(Object.keys(persisted.queries).length, 100)
  for (let index = 0; index < 100; index += 1) {
    assert.equal(persisted.queries[`query_${index}`].paymentAccessToken, `recovery_${index}`)
  }
})

test('a process-death state lock is recovered without deleting session data', async (context) => {
  const directory = await mkdtemp(join(tmpdir(), 'openshelf-agent-stale-lock-'))
  context.after(() => rm(directory, { recursive: true, force: true }))
  const config = {
    apiOrigin: 'http://127.0.0.1:8787',
    gatewayOrigin: 'http://127.0.0.1:1402',
    statePath: join(directory, 'session.json'),
  }
  await writeState(emptyState(config), config)
  await writeFile(
    `${config.statePath}.lock`,
    JSON.stringify({ pid: 2_147_483_647, nonce: 'dead-process', createdAt: Date.now() - 31_000 }),
    { mode: 0o600 },
  )
  await updateState(config, (state) => {
    state.token = 'still-present-after-stale-lock'
    return state
  })
  assert.equal((await readState(config)).token, 'still-present-after-stale-lock')
  await assert.rejects(stat(`${config.statePath}.lock`), (error) => error?.code === 'ENOENT')
})

test('CLI fallback invokes the same tool boundary and rejects malformed arguments', async (context) => {
  const fixture = await fixtureServer(async (request, response) => {
    if (request.url === '/api/v1/questions/resolve' && request.method === 'POST') {
      response.writeHead(200, { 'content-type': 'application/json' })
      response.end(
        JSON.stringify({
          queryId: 'query_cli',
          paymentAccessToken: 'hidden-query-token',
          decision: 'miss',
          reason: 'coverage_missing',
          liquidityState: 'ai_liquidity_only',
          aiBaselineEligible: true,
          requestedDocuments: 3,
          candidateCount: 0,
          matches: [],
          quote: { currency: 'KRW', documentCount: 0, totalPriceKrw: 0 },
          openCall: null,
        }),
      )
      return
    }
    response.writeHead(404).end()
  })
  context.after(fixture.close)
  const directory = await mkdtemp(join(tmpdir(), 'openshelf-agent-cli-'))
  context.after(() => rm(directory, { recursive: true, force: true }))
  const config = {
    apiOrigin: fixture.origin,
    gatewayOrigin: fixture.origin,
    statePath: join(directory, 'session.json'),
  }
  const result = await invokeCliTool(
    'ask_people',
    JSON.stringify({ question: 'What do people actually do?', requestedDocuments: 3 }),
    config,
  )
  assert.equal(result.queryId, 'query_cli')
  assert.equal(result.paymentAccessToken, undefined)
  await assert.rejects(() => invokeCliTool('ask_people', '[]', config), /one JSON object/)
  await assert.rejects(() => invokeCliTool('not_a_tool', '{}', config), /Unknown tool/)
  const raw = JSON.stringify({ question: "A person's actual choice", requestedDocuments: 3 })
  assert.equal(decodeCliArguments(null, Buffer.from(raw).toString('base64')), raw)
  assert.throws(() => decodeCliArguments(null, '$(unsafe)'), /canonical base64/)
})

function devnetQuote(overrides = {}) {
  return {
    id: 'quote_1',
    payTo: '11111111111111111111111111111111',
    network: DEVNET_NETWORK,
    asset: DEVNET_USDC,
    amountAtomic: '300',
    budgetAtomic: '300',
    minimumDepositAtomic: '300',
    availableBalanceAtomic: '0',
    priceKrw: 300,
    totalPriceKrw: 300,
    krwPerUsdc: 1_350,
    expiresAt: Date.now() + 300_000,
    bundleHash: 'a'.repeat(64),
    resourcePath: '/api/v1/paid-documents/query_1/HUMAN_1',
    ...overrides,
  }
}

async function fixtureServer(handler) {
  const server = createServer((request, response) => {
    Promise.resolve(handler(request, response)).catch((error) => {
      response.writeHead(500, { 'content-type': 'application/json' })
      response.end(JSON.stringify({ error: { message: error.message } }))
    })
  })
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve))
  const address = server.address()
  return {
    origin: `http://127.0.0.1:${address.port}`,
    close: () => new Promise((resolve, reject) => server.close((error) => (error ? reject(error) : resolve()))),
  }
}
