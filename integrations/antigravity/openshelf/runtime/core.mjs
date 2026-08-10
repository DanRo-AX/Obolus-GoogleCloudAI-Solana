import { randomUUID } from 'node:crypto'
import { mkdir, open, readFile, rename, stat, unlink, writeFile } from 'node:fs/promises'
import { homedir } from 'node:os'
import { dirname, resolve } from 'node:path'

export const DEVNET_NETWORK = 'solana:EtWTRABZaYq6iMfeYKouRu166VU2xqa1'
export const DEVNET_USDC = '4zMMC9srt5Ri5X14GAgXhaHii3GnPAEERYPJgZJDncDU'

export function runtimeConfig(env = process.env) {
  const profile = env.OPENSHELF_AGENT_PROFILE?.trim()
  if (profile && !/^[A-Za-z0-9_-]{1,64}$/.test(profile)) {
    throw new Error('OPENSHELF_AGENT_PROFILE must use 1-64 letters, numbers, underscores, or hyphens')
  }
  const defaultStateName = profile ? `agent-session-${profile}.json` : 'agent-session.json'
  return {
    apiOrigin: origin(env.OPENSHELF_API_URL || 'http://127.0.0.1:8787', 'OPENSHELF_API_URL'),
    gatewayOrigin: origin(
      env.OPENSHELF_GATEWAY_URL || 'http://127.0.0.1:1402',
      'OPENSHELF_GATEWAY_URL',
    ),
    statePath: resolve(
      env.OPENSHELF_AGENT_STATE || `${homedir()}/.config/openshelf/${defaultStateName}`,
    ),
  }
}

function origin(value, label) {
  const parsed = new URL(value)
  if (parsed.pathname !== '/' || parsed.search || parsed.hash) {
    throw new Error(`${label} must be an origin without a path, query, or fragment`)
  }
  if (
    parsed.protocol !== 'https:' &&
    !['127.0.0.1', 'localhost'].includes(parsed.hostname)
  ) {
    throw new Error(`${label} must use HTTPS unless it is a loopback URL`)
  }
  return parsed.origin
}

export async function readState(config = runtimeConfig()) {
  try {
    const state = JSON.parse(await readFile(config.statePath, 'utf8'))
    return {
      version: 1,
      apiOrigin: config.apiOrigin,
      gatewayOrigin: config.gatewayOrigin,
      token: typeof state.token === 'string' ? state.token : null,
      user: state.user && typeof state.user === 'object' ? state.user : null,
      queries: state.queries && typeof state.queries === 'object' ? state.queries : {},
    }
  } catch (error) {
    if (error?.code !== 'ENOENT') throw error
    return emptyState(config)
  }
}

export async function writeState(state, config = runtimeConfig()) {
  return withStateLock(config, () => writeStateUnlocked(state, config))
}

export async function updateState(config = runtimeConfig(), update) {
  if (typeof update !== 'function') {
    throw new AgentError('State update must be a function.', 'invalid_state_update')
  }
  return withStateLock(config, async () => {
    const current = await readState(config)
    const updated = (await update(current)) ?? current
    await writeStateUnlocked(updated, config)
    return updated
  })
}

async function writeStateUnlocked(state, config) {
  await mkdir(dirname(config.statePath), { recursive: true, mode: 0o700 })
  const temporary = `${config.statePath}.${process.pid}.${randomUUID()}.tmp`
  const persisted = {
    version: 1,
    token: state.token || null,
    user: state.user || null,
    queries: state.queries || {},
  }
  await writeFile(temporary, `${JSON.stringify(persisted, null, 2)}\n`, {
    encoding: 'utf8',
    mode: 0o600,
  })
  await rename(temporary, config.statePath)
}

async function withStateLock(config, operation) {
  await mkdir(dirname(config.statePath), { recursive: true, mode: 0o700 })
  const lockPath = `${config.statePath}.lock`
  const deadline = Date.now() + 5_000
  const nonce = randomUUID()
  let lock
  while (!lock) {
    try {
      lock = await open(lockPath, 'wx', 0o600)
      await lock.writeFile(JSON.stringify({ pid: process.pid, nonce, createdAt: Date.now() }))
    } catch (error) {
      if (lock) {
        await lock.close().catch(() => {})
        await unlink(lockPath).catch(() => {})
        lock = null
      }
      if (error?.code !== 'EEXIST') throw error
      if (await staleStateLock(lockPath)) {
        await unlink(lockPath).catch((unlinkError) => {
          if (unlinkError?.code !== 'ENOENT') throw unlinkError
        })
        continue
      }
      if (Date.now() >= deadline) {
        throw new AgentError(
          `Local agent state is busy: ${config.statePath}`,
          'local_state_busy',
          503,
        )
      }
      await new Promise((resolve) => setTimeout(resolve, 20))
    }
  }
  let result
  let operationError
  try {
    result = await operation()
  } catch (error) {
    operationError = error
  }
  let cleanupError
  try {
    await lock.close()
    const owner = JSON.parse(await readFile(lockPath, 'utf8'))
    if (owner?.nonce === nonce) await unlink(lockPath)
  } catch (error) {
    if (error?.code !== 'ENOENT') cleanupError = error
  }
  if (operationError) throw operationError
  if (cleanupError) throw cleanupError
  return result
}

async function staleStateLock(lockPath) {
  let owner = null
  try {
    owner = JSON.parse(await readFile(lockPath, 'utf8'))
  } catch (error) {
    if (error?.code === 'ENOENT') return false
  }
  const metadata = await stat(lockPath).catch((error) => {
    if (error?.code === 'ENOENT') return null
    throw error
  })
  if (!metadata) return false
  const createdAt = Number.isSafeInteger(owner?.createdAt) ? owner.createdAt : metadata.mtimeMs
  if (Date.now() - createdAt < 30_000) return false
  return !processIsAlive(owner?.pid)
}

function processIsAlive(pid) {
  if (!Number.isSafeInteger(pid) || pid < 1) return false
  try {
    process.kill(pid, 0)
    return true
  } catch (error) {
    return error?.code !== 'ESRCH'
  }
}

export function emptyState(config = runtimeConfig()) {
  return {
    version: 1,
    apiOrigin: config.apiOrigin,
    gatewayOrigin: config.gatewayOrigin,
    token: null,
    user: null,
    queries: {},
  }
}

export function sessionTokenFrom(response) {
  const cookies = response.headers.getSetCookie?.() || [response.headers.get('set-cookie')]
  for (const cookie of cookies.filter(Boolean)) {
    const match = cookie.match(/(?:^|;\s*)openshelf_session=([^;]+)/)
    if (match?.[1]) return match[1]
  }
  throw new Error('OPENSHELF did not return an agent-compatible session cookie')
}

export async function jsonRequest(url, init = {}, options = {}) {
  const timeoutMs = options.timeoutMs ?? 15_000
  if (!Number.isSafeInteger(timeoutMs) || timeoutMs < 1 || timeoutMs > 60_000) {
    throw new AgentError('HTTP timeout must be between 1 and 60000 milliseconds.', 'invalid_timeout')
  }
  const timeoutSignal = AbortSignal.timeout(timeoutMs)
  const signal = init.signal
    ? AbortSignal.any([init.signal, timeoutSignal])
    : timeoutSignal
  let response
  try {
    response = await fetch(url, { ...init, signal })
    const text = await response.text()
    let body = null
    if (text) {
      try {
        body = JSON.parse(text)
      } catch {
        body = text
      }
    }
    if (!response.ok) {
      const message = body?.error?.message || body?.message || `HTTP ${response.status}`
      const code = body?.error?.code || `http_${response.status}`
      throw new AgentError(message, code, response.status, body)
    }
    return { body, response }
  } catch (error) {
    if (error instanceof AgentError) throw error
    if (signal.aborted) {
      throw new AgentError(
        `Request to ${new URL(url).origin} did not complete within ${timeoutMs}ms.`,
        'request_timeout',
        504,
      )
    }
    throw new AgentError(`Could not reach ${new URL(url).origin}: ${error.message}`, 'offline')
  }
}

export async function apiRequest(path, init = {}, options = {}) {
  const config = options.config || runtimeConfig()
  const state = options.state || (await readState(config))
  const headers = new Headers(init.headers || {})
  if (options.auth !== false) {
    if (!state.token) {
      throw new AgentError(
        'Sign in locally first with `node integrations/antigravity/openshelf/runtime/server.mjs auth login --email YOU@example.com`.',
        'authentication_required',
        401,
      )
    }
    headers.set('authorization', `Bearer ${state.token}`)
  }
  if (init.body && !headers.has('content-type')) headers.set('content-type', 'application/json')
  return jsonRequest(`${config.apiOrigin}${path}`, { ...init, headers })
}

export async function gatewayRequest(path, init = {}, options = {}) {
  const config = options.config || runtimeConfig()
  return jsonRequest(`${config.gatewayOrigin}${path}`, init)
}

export function jsonBody(value) {
  return JSON.stringify(value)
}

export function requireQuery(state, queryId) {
  const query = state.queries?.[queryId]
  if (!query?.paymentAccessToken) {
    throw new AgentError(
      `No local payment capability exists for query ${queryId}. Run ask_people again.`,
      'query_context_missing',
    )
  }
  return query
}

export function assertDevnetQuote(quote) {
  if (!quote || quote.network !== DEVNET_NETWORK || quote.asset !== DEVNET_USDC) {
    throw new AgentError(
      'Refusing payment: OPENSHELF returned a non-Devnet network or unknown asset.',
      'unsafe_payment_quote',
    )
  }
  if (!/^[1-9]\d*$/.test(String(quote.amountAtomic || ''))) {
    throw new AgentError('Refusing payment: quote amount is invalid.', 'unsafe_payment_quote')
  }
  if (Number(quote.expiresAt) <= Date.now()) {
    throw new AgentError('The payment quote expired. Prepare it again.', 'quote_expired')
  }
  return quote
}

const AGENT_BUNDLE_SCALAR_FIELDS = [
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

function canonicalAtomic(value, positive) {
  if (typeof value !== 'string' || !/^(0|[1-9]\d*)$/.test(value)) return null
  const atomic = BigInt(value)
  return positive && atomic === 0n ? null : atomic
}

export function exactAgentBundleQuote({ gatewayQuote, canonicalQuote, queryId, handles, now = Date.now() }) {
  if (!gatewayQuote || !canonicalQuote) {
    throw new AgentError('The research payment quote is malformed.', 'unsafe_payment_quote')
  }
  for (const field of AGENT_BUNDLE_SCALAR_FIELDS) {
    if (gatewayQuote[field] !== canonicalQuote[field]) {
      throw new AgentError(
        'The gateway quote does not match the canonical research ledger.',
        'unsafe_payment_quote',
      )
    }
  }
  if (
    !Array.isArray(gatewayQuote.documentHandles)
    || !Array.isArray(canonicalQuote.documentHandles)
    || gatewayQuote.documentHandles.some((handle) => typeof handle !== 'string')
    || canonicalQuote.documentHandles.some((handle) => typeof handle !== 'string')
    || JSON.stringify(gatewayQuote.documentHandles) !== JSON.stringify(canonicalQuote.documentHandles)
    || canonicalQuote.queryId !== queryId
    || JSON.stringify(canonicalQuote.documentHandles) !== JSON.stringify(handles)
  ) {
    throw new AgentError(
      'The canonical research quote does not match the selected documents.',
      'unsafe_payment_quote',
    )
  }
  const amount = canonicalAtomic(canonicalQuote.amountAtomic, true)
  const budget = canonicalAtomic(canonicalQuote.budgetAtomic, true)
  const minimumDeposit = canonicalAtomic(canonicalQuote.minimumDepositAtomic, true)
  const available = canonicalAtomic(canonicalQuote.availableBalanceAtomic, false)
  if (
    amount === null
    || budget === null
    || minimumDeposit === null
    || available !== 0n
    || amount !== budget
    || amount !== minimumDeposit
    || typeof canonicalQuote.id !== 'string'
    || !canonicalQuote.id
    || typeof canonicalQuote.payTo !== 'string'
    || !canonicalQuote.payTo
    || canonicalQuote.network !== DEVNET_NETWORK
    || canonicalQuote.asset !== DEVNET_USDC
    || typeof canonicalQuote.requiresPayment !== 'boolean'
    || canonicalQuote.krwPerUsdc !== 1_350
    || !Number.isSafeInteger(canonicalQuote.totalPriceKrw)
    || canonicalQuote.totalPriceKrw < 0
    || !Number.isSafeInteger(canonicalQuote.expiresAt)
    || typeof canonicalQuote.bundleHash !== 'string'
    || !/^[0-9a-f]{64}$/.test(canonicalQuote.bundleHash)
    || canonicalQuote.resourcePath !== `/api/v1/paid-bundles/${canonicalQuote.id}`
  ) {
    throw new AgentError(
      'The canonical agent quote violates the one-shot funding contract.',
      'unsafe_payment_quote',
    )
  }
  if (canonicalQuote.requiresPayment === true) {
    if (canonicalQuote.status !== 'quoted' || canonicalQuote.expiresAt <= now) {
      throw new AgentError('The canonical research quote is not payable.', 'unsafe_payment_quote')
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
  ].includes(canonicalQuote.status)) {
    throw new AgentError('The canonical research recovery state is invalid.', 'unsafe_payment_quote')
  }
  return canonicalQuote
}

export function paymentPlan(paymentUrl, quote, purpose) {
  assertDevnetQuote(quote)
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
    nextAction:
      'Show this exact amount and purpose to the user. After explicit confirmation, call the Pay MCP curl tool with this paymentUrl and method GET. Never use --sandbox for public Devnet.',
  }
}

function atomicToUsdc(value) {
  const atomic = BigInt(value)
  const whole = atomic / 1_000_000n
  const fraction = (atomic % 1_000_000n).toString().padStart(6, '0').replace(/0+$/, '')
  return fraction ? `${whole}.${fraction}` : whole.toString()
}

export function compactQueryForState(resolution) {
  return {
    paymentAccessToken: resolution.paymentAccessToken,
    handles: resolution.matches.map((match) => match.handle),
    question: resolution.question,
    createdAt: Date.now(),
  }
}

export class AgentError extends Error {
  constructor(message, code = 'agent_error', status = 400, details = null) {
    super(message)
    this.name = 'AgentError'
    this.code = code
    this.status = status
    this.details = details
  }
}
