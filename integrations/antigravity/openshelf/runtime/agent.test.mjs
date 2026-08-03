import assert from 'node:assert/strict'
import { mkdtemp, readFile, rm, stat } from 'node:fs/promises'
import { createServer } from 'node:http'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import test from 'node:test'

import {
  DEVNET_NETWORK,
  DEVNET_USDC,
  assertDevnetQuote,
  readState,
  runtimeConfig,
  sessionTokenFrom,
  writeState,
} from './core.mjs'
import {
  authenticate,
  decodeCliArguments,
  handleMcpRequest,
  invokeCliTool,
} from './server.mjs'
import { discoveryFallback } from './pay-compat.mjs'
import { callTool, tools } from './tools.mjs'

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
    'prepare_open_call',
    'prepare_payout_wallet_link',
    'list_opportunities',
    'submit_human_answer',
    'earnings_and_claims',
  ]) {
    assert.ok(names.includes(expected), `${expected} should be exposed`)
  }
  assert.equal(names.length, tools.length)
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
      assert.equal(request.headers['x-openshelf-query-token'], 'query-secret')
      response.writeHead(201, { 'content-type': 'application/json' })
      response.end(
        JSON.stringify({
          resourceUrl: `${fixture.origin}/api/v1/paid-bundles/bundle_1`,
          quote: devnetQuote({
            id: 'bundle_1',
            resourcePath: '/api/v1/paid-bundles/bundle_1',
            totalPriceKrw: 300,
          }),
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
})

test('mainnet or changed asset payment quotes fail closed', () => {
  const quote = devnetQuote()
  assert.equal(assertDevnetQuote(quote), quote)
  assert.throws(
    () => assertDevnetQuote({ ...quote, network: 'solana:mainnet' }),
    /non-Devnet/,
  )
  assert.throws(() => assertDevnetQuote({ ...quote, asset: 'unknown' }), /unknown asset/)
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
    priceKrw: 300,
    expiresAt: Date.now() + 300_000,
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
