import { execFile } from 'node:child_process'
import { delimiter, isAbsolute, join } from 'node:path'
import { access } from 'node:fs/promises'
import { constants } from 'node:fs'
import { promisify } from 'node:util'

const execFileAsync = promisify(execFile)
export const MCP_SERVER_NAMES = ['obulus', 'obulus-pay', 'pay']
export const SAFE_MCP_SERVER_NAMES = ['obulus', 'obulus-pay']

/** Register the two constrained Obulus surfaces and, only when requested, broad official Pay MCP. */
export async function installMcpServers(options) {
  const clients = normalizeClients(options.client)
  const names = options.includeOfficialPay ? MCP_SERVER_NAMES : SAFE_MCP_SERVER_NAMES
  const descriptors = validateDescriptors(options.descriptors, names)
  const runner = options.runner || execFileAsync
  const env = options.env || process.env
  const results = []

  for (const client of clients) {
    const executable =
      options.clientExecutables?.[client] || (await findExecutable(client, env))
    for (const descriptor of descriptors) {
      const exists = await serverExists(runner, executable, client, descriptor.name, env)
      if (exists) {
        if (options.force === false) {
          results.push({ client, server: descriptor.name, status: 'already-configured-unverified' })
          continue
        }
        await runner(executable, removeArguments(client, descriptor.name), {
          env,
          timeout: 30_000,
          maxBuffer: 256 * 1024,
        })
      }
      await runner(executable, addArguments(client, descriptor), {
        env,
        timeout: 30_000,
        maxBuffer: 256 * 1024,
      })
      results.push({ client, server: descriptor.name, status: exists ? 'updated' : 'installed' })
    }
  }
  return results
}

export async function inspectMcpServers(options = {}) {
  const clients = normalizeClients(options.client || 'all')
  const runner = options.runner || execFileAsync
  const env = options.env || process.env
  const result = []
  for (const client of clients) {
    try {
      const executable =
        options.clientExecutables?.[client] || (await findExecutable(client, env))
      for (const server of MCP_SERVER_NAMES) {
        result.push({
          client,
          server,
          configured: await serverExists(runner, executable, client, server, env),
        })
      }
    } catch (error) {
      result.push({ client, configured: false, error: error.message })
    }
  }
  return result
}

function validateDescriptors(descriptors, names) {
  if (!Array.isArray(descriptors)) throw new Error('MCP descriptors are required')
  const byName = new Map(descriptors.map((descriptor) => [descriptor.name, descriptor]))
  if (names.some((name) => !byName.has(name))) {
    throw new Error(`MCP descriptors must contain: ${names.join(', ')}`)
  }
  return names.map((name) => {
    const descriptor = byName.get(name)
    if (!descriptor.command || !isAbsolute(String(descriptor.command))) {
      throw new Error(`${name} command must be an absolute executable path`)
    }
    return {
      name,
      command: descriptor.command,
      args: descriptor.args || [],
      env: descriptor.env || {},
    }
  })
}

function removeArguments(client, name) {
  return client === 'claude' ? ['mcp', 'remove', '--scope', 'user', name] : ['mcp', 'remove', name]
}

function normalizeClients(client) {
  if (client === 'all') return ['codex', 'claude']
  if (client === 'codex' || client === 'claude') return [client]
  throw new Error('client must be codex, claude, or all')
}

async function serverExists(runner, executable, client, name, env) {
  try {
    await runner(executable, ['mcp', 'get', name], {
      env,
      timeout: 10_000,
      maxBuffer: 64 * 1024,
    })
    return true
  } catch {
    return false
  }
}

function addArguments(client, descriptor) {
  const environment = Object.entries(descriptor.env).flatMap(([key, value]) =>
    client === 'codex' ? ['--env', `${key}=${value}`] : ['-e', `${key}=${value}`],
  )
  if (client === 'codex') {
    return [
      'mcp',
      'add',
      descriptor.name,
      ...environment,
      '--',
      descriptor.command,
      ...descriptor.args,
    ]
  }
  return [
    'mcp',
    'add',
    '--scope',
    'user',
    descriptor.name,
    ...environment,
    '--',
    descriptor.command,
    ...descriptor.args,
  ]
}

async function findExecutable(name, env) {
  for (const directory of String(env.PATH || '').split(delimiter).filter(Boolean)) {
    const suffixes = process.platform === 'win32' ? ['', '.exe', '.cmd'] : ['']
    for (const suffix of suffixes) {
      const candidate = join(directory, `${name}${suffix}`)
      try {
        await access(candidate, constants.X_OK)
        return candidate
      } catch {
        // Keep searching PATH.
      }
    }
  }
  throw new Error(`${name} CLI was not found in PATH`)
}
