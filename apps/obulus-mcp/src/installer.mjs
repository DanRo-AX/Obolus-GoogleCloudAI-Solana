import { access } from 'node:fs/promises'
import { constants } from 'node:fs'
import { execFile } from 'node:child_process'
import { delimiter, join } from 'node:path'
import { promisify } from 'node:util'

const execFileAsync = promisify(execFile)

export async function installMcp(options = {}) {
  const clients = options.client === 'all' ? ['codex', 'claude', 'gemini'] : [options.client || 'codex']
  if (clients.some((client) => !['codex', 'claude', 'gemini'].includes(client))) {
    throw new Error('client must be codex, claude, gemini, or all')
  }
  const runner = options.runner || execFileAsync
  const env = options.env || process.env
  const results = []
  for (const client of clients) {
    const executable = options.clientExecutables?.[client] || await findExecutable(client, env)
    const name = options.name || 'obulus-full'
    const exists = await serverExists(runner, executable, name, env, client)
    if (exists && options.force !== false) {
      await runner(
        executable,
        client === 'claude'
          ? ['mcp', 'remove', '--scope', 'user', name]
          : ['mcp', 'remove', name],
        { env, timeout: 30_000, maxBuffer: 256 * 1024 },
      )
    } else if (exists) {
      results.push({ client, server: name, status: 'already-configured-unverified' })
      continue
    }
    const serverEnv = {
      OBULUS_MCP_CLIENT: `${client}-mcp`,
      OBULUS_MCP_INSTANCE: `${client}-cli`,
      ...(options.serverEnv || {}),
    }
    const environment = Object.entries(serverEnv).flatMap(([key, value]) =>
      client === 'codex' ? ['--env', `${key}=${value}`] : ['-e', `${key}=${value}`])
    const prefix = client === 'claude'
      ? ['mcp', 'add', '--scope', 'user', name]
      : client === 'gemini'
        ? ['mcp', 'add', '--scope', 'user', ...environment, name]
        : ['mcp', 'add', name]
    await runner(
      executable,
      client === 'gemini'
        ? [...prefix, options.command, ...options.args]
        : [...prefix, ...environment, '--', options.command, ...options.args],
      { env, timeout: 30_000, maxBuffer: 256 * 1024 },
    )
    results.push({ client, server: name, status: exists ? 'updated' : 'installed' })
  }
  return results
}

async function serverExists(runner, executable, name, env, client) {
  try {
    const { stdout = '' } = await runner(executable, client === 'gemini' ? ['mcp', 'list'] : ['mcp', 'get', name], {
      env,
      timeout: 10_000,
      maxBuffer: 64 * 1024,
    })
    if (client === 'gemini') {
      return new RegExp(`(^|\\s)${escapeRegExp(name)}(?=\\s|$)`, 'm').test(stdout)
    }
    return true
  } catch {
    return false
  }
}

function escapeRegExp(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

async function findExecutable(name, env) {
  for (const directory of String(env.PATH || '').split(delimiter).filter(Boolean)) {
    for (const suffix of process.platform === 'win32' ? ['', '.exe', '.cmd'] : ['']) {
      const candidate = join(directory, `${name}${suffix}`)
      try {
        await access(candidate, constants.X_OK)
        return candidate
      } catch {
        // Continue searching PATH.
      }
    }
  }
  throw new Error(`${name} CLI was not found in PATH`)
}
