import { mkdir, readFile, rename, writeFile } from 'node:fs/promises'
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
  await mkdir(dirname(config.statePath), { recursive: true, mode: 0o700 })
  const temporary = `${config.statePath}.${process.pid}.tmp`
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

export async function jsonRequest(url, init = {}) {
  let response
  try {
    response = await fetch(url, init)
  } catch (error) {
    throw new AgentError(`Could not reach ${new URL(url).origin}: ${error.message}`, 'offline')
  }
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
