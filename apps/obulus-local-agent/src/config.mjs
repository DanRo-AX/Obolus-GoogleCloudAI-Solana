import { homedir } from 'node:os'
import { resolve } from 'node:path'

export function runtimeConfig(env = process.env) {
  return {
    apiOrigin: checkedOrigin(
      env.OBULUS_API_URL || env.OPENSHELF_API_URL || 'http://127.0.0.1:8787',
      'OBULUS_API_URL',
    ),
    gatewayOrigin: checkedOrigin(
      env.OBULUS_GATEWAY_URL || env.OPENSHELF_GATEWAY_URL || 'http://127.0.0.1:1402',
      'OBULUS_GATEWAY_URL',
    ),
    statePath: resolve(
      env.OBULUS_LOCAL_STATE || `${homedir()}/.config/obulus/local-agent-state.json`,
    ),
    payAccount: checkedPayAccount(
      env.OBULUS_PAY_ACCOUNT || env.OPENSHELF_PAY_ACCOUNT || '',
    ),
    anthropicApiKey: checkedOptionalSecret(
      env.OBULUS_CLAUDE_API_KEY || env.ANTHROPIC_API_KEY || '',
      'Claude API key',
    ),
    anthropicBaseUrl: checkedOptionalOrigin(env.OBULUS_CLAUDE_BASE_URL || ''),
    anthropicModel: checkedModel(env.OBULUS_CLAUDE_MODEL || 'claude-sonnet-4-5'),
  }
}

function checkedOptionalSecret(value, label) {
  const secret = String(value || '').trim()
  if (!secret) return null
  if (secret.length < 16 || secret.length > 2_048 || secret.includes('\n')) {
    throw new Error(`${label} is malformed`)
  }
  return secret
}

function checkedOptionalOrigin(value) {
  const origin = String(value || '').trim()
  if (!origin) return null
  return checkedOrigin(origin, 'OBULUS_CLAUDE_BASE_URL')
}

function checkedModel(value) {
  const model = String(value || '').trim()
  if (!/^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/.test(model)) {
    throw new Error('OBULUS_CLAUDE_MODEL is malformed')
  }
  return model
}

function checkedPayAccount(value) {
  const account = value.trim()
  if (!account) return null
  if (!/^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$/.test(account)) {
    throw new Error('OBULUS_PAY_ACCOUNT must be a safe Pay.sh account name')
  }
  return account
}

function checkedOrigin(value, label) {
  const parsed = new URL(value)
  if (parsed.pathname !== '/' || parsed.search || parsed.hash) {
    throw new Error(`${label} must be an origin without a path, query, or fragment`)
  }
  if (parsed.protocol !== 'https:' && !['127.0.0.1', 'localhost'].includes(parsed.hostname)) {
    throw new Error(`${label} must use HTTPS unless it is a loopback URL`)
  }
  return parsed.origin
}
