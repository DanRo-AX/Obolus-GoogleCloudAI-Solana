import { homedir } from 'node:os'
import { resolve } from 'node:path'

import { runtimeConfig as legacyRuntimeConfig } from '../../../integrations/antigravity/openshelf/runtime/core.mjs'

/**
 * Accept the product-facing OBULUS_* names while continuing to pass the same
 * hardened config object into the audited marketplace runtime.
 */
export function runtimeConfig(env = process.env) {
  const profile = (env.OBULUS_MCP_PROFILE || env.OPENSHELF_AGENT_PROFILE || '').trim()
  if (profile && !/^[A-Za-z0-9_-]{1,64}$/.test(profile)) {
    throw new Error('OBULUS_MCP_PROFILE must use 1-64 letters, numbers, underscores, or hyphens')
  }
  const stateName = profile ? `mcp-session-${profile}.json` : 'mcp-session.json'
  return legacyRuntimeConfig({
    ...env,
    OPENSHELF_API_URL: env.OBULUS_API_URL || env.OPENSHELF_API_URL,
    OPENSHELF_GATEWAY_URL: env.OBULUS_GATEWAY_URL || env.OPENSHELF_GATEWAY_URL,
    OPENSHELF_AGENT_PROFILE: profile || undefined,
    OPENSHELF_AGENT_CLIENT: env.OBULUS_MCP_CLIENT || env.OPENSHELF_AGENT_CLIENT || 'obulus-mcp',
    OPENSHELF_AGENT_INSTANCE: env.OBULUS_MCP_INSTANCE || env.OPENSHELF_AGENT_INSTANCE || profile || 'default',
    OPENSHELF_AGENT_STATE:
      env.OBULUS_MCP_STATE
      || env.OPENSHELF_AGENT_STATE
      || resolve(homedir(), '.config', 'obulus', stateName),
  })
}

export function publicConfig(config = runtimeConfig()) {
  return {
    apiOrigin: config.apiOrigin,
    gatewayOrigin: config.gatewayOrigin,
    statePath: config.statePath,
    client: config.client,
    instance: config.instance,
    networkPolicy: 'Solana Devnet only',
  }
}
