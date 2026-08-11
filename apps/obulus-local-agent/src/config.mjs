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
  }
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
