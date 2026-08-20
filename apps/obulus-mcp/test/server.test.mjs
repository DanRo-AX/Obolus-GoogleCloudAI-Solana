import assert from 'node:assert/strict'
import { once } from 'node:events'
import { mkdtemp, readFile, rm } from 'node:fs/promises'
import { createServer } from 'node:http'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import test from 'node:test'

import { installMcp } from '../src/installer.mjs'
import { handleMcpRequest } from '../src/server.mjs'
import { callTool, tools } from '../src/tools.mjs'

const payer = '11111111111111111111111111111111'
const state = {
  token: 'session-secret',
  user: { id: 'user-1' },
  queries: {
    q1: {
      paymentAccessToken: 'query-secret',
      handles: ['PARIS_11', 'PARIS_18'],
      question: 'Where do locals eat?',
    },
  },
}

test('exposes 30 unique Obulus tools over MCP', async () => {
  assert.equal(tools.length, 30)
  assert.equal(new Set(tools.map((tool) => tool.name)).size, 30)
  const response = await handleMcpRequest({ jsonrpc: '2.0', id: 1, method: 'tools/list' })
  assert.equal(response.result.tools.length, 30)
  const initialized = await handleMcpRequest({ jsonrpc: '2.0', id: 2, method: 'initialize' })
  assert.equal(initialized.result.serverInfo.name, 'obulus-full')
  assert.equal(initialized.result.protocolVersion, '2025-06-18')
})

test('registers the stdio server with Codex, Claude, and Gemini without replacing the legacy server', async () => {
  const calls = []
  const runner = async (executable, args) => {
    calls.push([executable, args])
    if (args[1] === 'get') throw new Error('not configured')
    return { stdout: '', stderr: '' }
  }
  const results = await installMcp({
    client: 'all',
    runner,
    clientExecutables: { codex: '/bin/codex', claude: '/bin/claude', gemini: '/bin/gemini' },
    command: '/bin/node',
    args: ['/repo/apps/obulus-mcp/src/cli.mjs', 'mcp'],
    serverEnv: { OBULUS_API_URL: 'https://api.obulus.test' },
  })

  assert.deepEqual(results, [
    { client: 'codex', server: 'obulus-full', status: 'installed' },
    { client: 'claude', server: 'obulus-full', status: 'installed' },
    { client: 'gemini', server: 'obulus-full', status: 'installed' },
  ])
  assert.deepEqual(calls, [
    ['/bin/codex', ['mcp', 'get', 'obulus-full']],
    ['/bin/codex', ['mcp', 'add', 'obulus-full', '--env', 'OBULUS_MCP_CLIENT=codex-mcp', '--env', 'OBULUS_MCP_INSTANCE=codex-cli', '--env', 'OBULUS_API_URL=https://api.obulus.test', '--', '/bin/node', '/repo/apps/obulus-mcp/src/cli.mjs', 'mcp']],
    ['/bin/claude', ['mcp', 'get', 'obulus-full']],
    ['/bin/claude', ['mcp', 'add', '--scope', 'user', 'obulus-full', '-e', 'OBULUS_MCP_CLIENT=claude-mcp', '-e', 'OBULUS_MCP_INSTANCE=claude-cli', '-e', 'OBULUS_API_URL=https://api.obulus.test', '--', '/bin/node', '/repo/apps/obulus-mcp/src/cli.mjs', 'mcp']],
    ['/bin/gemini', ['mcp', 'list']],
    ['/bin/gemini', ['mcp', 'add', '--scope', 'user', '-e', 'OBULUS_MCP_CLIENT=gemini-mcp', '-e', 'OBULUS_MCP_INSTANCE=gemini-cli', '-e', 'OBULUS_API_URL=https://api.obulus.test', 'obulus-full', '/bin/node', '/repo/apps/obulus-mcp/src/cli.mjs', 'mcp']],
  ])
})

test('searches official public evidence without authentication', async (t) => {
  const fixture = await fixtureServer(async (request, response) => {
    assert.equal(request.url, '/api/v1/public-evidence?limit=5&q=Paris')
    assert.equal(request.headers.authorization, undefined)
    assert.equal(request.headers['x-obulus-client'], 'agent-mcp')
    assert.equal(request.headers['x-obulus-instance'], 'default')
    json(response, [{ id: 'official-1', source: 'public' }])
  })
  t.after(fixture.close)
  const result = await callTool(
    'search_public_evidence',
    { query: 'Paris', limit: 5 },
    { config: fixture.config, state },
  )
  assert.deepEqual(result, [{ id: 'official-1', source: 'public' }])
})

test('gives every Gemini MCP tool call a distinct trace instance', async (t) => {
  const instances = []
  const fixture = await fixtureServer(async (request, response) => {
    assert.equal(request.headers['x-obulus-client'], 'gemini-mcp')
    instances.push(request.headers['x-obulus-instance'])
    json(response, [{ id: 'official-1', source: 'public' }])
  })
  t.after(fixture.close)
  const options = {
    config: {
      ...fixture.config,
      client: 'gemini-mcp',
      instance: 'gemini-cli',
    },
    state,
  }
  const request = {
    jsonrpc: '2.0',
    id: 7,
    method: 'tools/call',
    params: {
      name: 'search_public_evidence',
      arguments: { query: 'Paris', limit: 5 },
    },
  }
  await handleMcpRequest(request, options)
  await handleMcpRequest({ ...request, id: 8 }, options)
  assert.match(instances[0], /^gemini-cli-[a-f0-9]{12}$/)
  assert.match(instances[1], /^gemini-cli-[a-f0-9]{12}$/)
  assert.notEqual(instances[0], instances[1])
})

test('connects a Pay.sh wallet with free SIWX and stores only the Obulus session', async (t) => {
  const directory = await mkdtemp(join(tmpdir(), 'obulus-mcp-wallet-'))
  t.after(() => rm(directory, { recursive: true, force: true }))
  const fixture = await fixtureServer(async (request, response) => {
    assert.equal(request.url, '/api/v1/auth/wallet/siwx')
    assert.equal(request.headers.authorization, undefined)
    assert.deepEqual(await requestJson(request), { ageConfirmed14: true })
    json(response, {
      resourceUrl: `http://${request.headers.host}/api/v1/auth/wallet/siwx/challenge-1`,
      network: 'solana:EtWTRABZaYq6iMfeYKouRu166VU2xqa1',
    })
  })
  t.after(fixture.close)
  const statePath = join(directory, 'session.json')
  const calls = []
  const result = await callTool(
    'connect_wallet',
    { ageConfirmed14: true, payAccount: 'research' },
    {
      config: { ...fixture.config, statePath },
      state: { token: null, user: null, queries: {} },
      env: { ...process.env, OPENSHELF_PAY_COMMAND: '/mock/pay' },
      execFile: async (command, args) => {
        calls.push([command, args])
        return {
          stdout: JSON.stringify({
            sessionToken: 'wallet-session-secret-1234',
            wallet: payer,
            expiresAt: Date.now() + 60_000,
            user: { id: 'wallet-user', wallet: payer },
          }),
          stderr: '',
        }
      },
    },
  )

  assert.equal(result.connected, true)
  assert.equal(result.usdcSpent, false)
  assert.equal(result.privateKeyExported, false)
  assert.deepEqual(calls, [[
    '/mock/pay',
    ['fetch', '--account', 'research', `${fixture.config.apiOrigin}/api/v1/auth/wallet/siwx/challenge-1`],
  ]])
  const persisted = JSON.parse(await readFile(statePath, 'utf8'))
  assert.equal(persisted.token, 'wallet-session-secret-1234')
  assert.equal(persisted.user.wallet, payer)
})

test('previews invoice with the query capability and rejects unknown handles', async (t) => {
  const fixture = await fixtureServer(async (request, response) => {
    assert.equal(request.url, '/api/v1/questions/q1/settlement-invoice')
    assert.equal(request.method, 'POST')
    assert.equal(request.headers['x-openshelf-query-token'], 'query-secret')
    assert.deepEqual(await requestJson(request), { handles: ['PARIS_11'] })
    json(response, { invoiceHash: 'abc', invoice: { totalPriceKrw: 10 } })
  })
  t.after(fixture.close)
  const result = await callTool(
    'preview_settlement_invoice',
    { queryId: 'q1', handles: ['PARIS_11', 'PARIS_11'] },
    { config: fixture.config, state },
  )
  assert.equal(result.invoice.totalPriceKrw, 10)
  await assert.rejects(
    callTool(
      'preview_settlement_invoice',
      { queryId: 'q1', handles: ['UNKNOWN'] },
      { config: fixture.config, state },
    ),
    { code: 'invalid_handles' },
  )
})

test('reconciles progress and recovers only a quoted paid document', async (t) => {
  const seen = []
  const fixture = await fixtureServer(async (request, response) => {
    seen.push(request.url)
    assert.equal(request.headers['x-openshelf-query-token'], 'query-secret')
    if (request.url.includes('payment-progress')) {
      json(response, { queryId: 'q1', payer, documents: [] })
    } else {
      json(response, {
        citation: { handle: 'PARIS_11', excerpt: 'paid' },
        settlement: { transactionSignature: 'tx' },
      })
    }
  })
  t.after(fixture.close)
  await callTool('payment_progress', { queryId: 'q1', payer }, { config: fixture.config, state })
  const recovered = await callTool(
    'recover_paid_document',
    { queryId: 'q1', handle: 'PARIS_11', payer },
    { config: fixture.config, state },
  )
  assert.equal(recovered.citation.excerpt, 'paid')
  assert.deepEqual(seen, [
    `/api/v1/questions/q1/payment-progress?payer=${payer}`,
    `/api/v1/questions/q1/paid-documents/PARIS_11?payer=${payer}`,
  ])
})

test('prepaid withdrawal requires exact confirmation and uses authenticated session', async (t) => {
  const fixture = await fixtureServer(async (request, response) => {
    assert.equal(request.url, '/api/v1/prepaid/withdrawals')
    assert.equal(request.headers.authorization, 'Bearer session-secret')
    assert.deepEqual(await requestJson(request), { amountAtomic: '1000' })
    json(response, { status: 'queued', amountAtomic: '1000' }, 201)
  })
  t.after(fixture.close)
  await assert.rejects(
    callTool(
      'manage_prepaid_wallet',
      { action: 'withdraw', amountAtomic: '1000' },
      { config: fixture.config, state },
    ),
    { code: 'confirmation_required' },
  )
  const result = await callTool(
    'manage_prepaid_wallet',
    {
      action: 'withdraw',
      amountAtomic: '1000',
      confirmation: 'WITHDRAW OBULUS PREPAID BALANCE',
    },
    { config: fixture.config, state },
  )
  assert.equal(result.status, 'queued')
})

async function fixtureServer(handler) {
  const server = createServer((request, response) => {
    Promise.resolve(handler(request, response)).catch((error) => {
      response.statusCode = 500
      response.end(JSON.stringify({ error: { message: error.message } }))
    })
  })
  server.listen(0, '127.0.0.1')
  await once(server, 'listening')
  const address = server.address()
  const origin = `http://127.0.0.1:${address.port}`
  return {
    config: { apiOrigin: origin, gatewayOrigin: origin, statePath: '/unused' },
    close: () => new Promise((resolve) => server.close(resolve)),
  }
}

function json(response, body, status = 200) {
  response.statusCode = status
  response.setHeader('content-type', 'application/json')
  response.end(JSON.stringify(body))
}

async function requestJson(request) {
  let body = ''
  for await (const chunk of request) body += chunk
  return JSON.parse(body)
}
