#!/usr/bin/env node
import { execFile } from 'node:child_process'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { promisify } from 'node:util'

import {
  AgentError,
  apiRequest,
  emptyState,
  jsonRequest,
  readState,
  writeState,
} from '../../../integrations/antigravity/openshelf/runtime/core.mjs'

import { publicConfig, runtimeConfig } from './config.mjs'
import { installMcp } from './installer.mjs'
import { runMcp, safeError } from './server.mjs'
import { callTool, tools } from './tools.mjs'

const execFileAsync = promisify(execFile)

export async function runCli(argv = process.argv.slice(2), env = process.env) {
  const [command = 'help', subcommand, ...rest] = argv
  const config = runtimeConfig(env)
  if (command === 'mcp') return runMcp()
  if (command === 'tools') return printTools(subcommand)
  if (command === 'call') return callCommand(subcommand, rest, config)
  if (command === 'auth') return authCommand(subcommand, rest, config, env)
  if (command === 'doctor') return doctor(config, env)
  if (command === 'install-mcp') return installCommand([subcommand, ...rest].filter(Boolean), config)
  if (['help', '--help', '-h'].includes(command)) return printHelp()
  throw new AgentError(`Unknown command: ${command}`, 'unknown_command')
}

function printTools(name) {
  const value = name
    ? tools.find((tool) => tool.name === name)
    : tools.map(({ name: toolName, description }) => ({ name: toolName, description }))
  if (!value) throw new AgentError(`Unknown tool: ${name}`, 'tool_not_found', 404)
  process.stdout.write(`${JSON.stringify(value, null, 2)}\n`)
}

async function callCommand(name, argv, config) {
  if (!name) throw new AgentError('A tool name is required.', 'invalid_arguments')
  const raw = decodeArguments(option(argv, '--json'), option(argv, '--json-b64'))
  let args
  try {
    args = JSON.parse(raw)
  } catch {
    throw new AgentError('Tool arguments must be one valid JSON object.', 'invalid_arguments')
  }
  const result = await callTool(name, args, { config })
  process.stdout.write(`${JSON.stringify(result, null, 2)}\n`)
}

export function decodeArguments(raw, encoded) {
  if (raw) return raw
  if (encoded) {
    if (encoded.length > 131_072 || encoded.length % 4 !== 0 || !/^[A-Za-z0-9+/]+={0,2}$/.test(encoded)) {
      throw new AgentError('--json-b64 must be canonical base64.', 'invalid_arguments')
    }
    return Buffer.from(encoded, 'base64').toString('utf8')
  }
  return '{}'
}

async function authCommand(command, argv, config, env) {
  if (command === 'login' || command === 'register') {
    throw new AgentError(
      'Managed Obulus is wallet-only. Use the connect_wallet MCP tool; email/password login is disabled.',
      'wallet_auth_required',
    )
  }
  if (command === 'status') {
    const state = await readState(config)
    if (!state.token) {
      process.stdout.write(`${JSON.stringify({ authenticated: false, ...publicConfig(config) }, null, 2)}\n`)
      return
    }
    const me = (await apiRequest('/api/v1/auth/me', {}, { config, state })).body
    process.stdout.write(`${JSON.stringify({ authenticated: true, ...me, ...publicConfig(config) }, null, 2)}\n`)
    return
  }
  if (command === 'logout') {
    const state = await readState(config)
    if (state.token) {
      await apiRequest('/api/v1/auth/logout', { method: 'POST' }, { config, state }).catch((error) => {
        if (error.status !== 401 && error.status !== 404) throw error
      })
    }
    await writeState(emptyState(config), config)
    process.stdout.write('Signed out. Local session and query capabilities were cleared.\n')
    return
  }
  throw new AgentError('Use auth login, register, status, or logout.', 'unknown_auth_command')
}

async function doctor(config, env) {
  const checks = await Promise.all([
    health(`${config.apiOrigin}/readyz`, 'Rust API'),
    health(`${config.gatewayOrigin}/readyz`, 'x402 gateway', false),
    payVersion(env),
  ])
  const report = {
    ...publicConfig(config),
    toolCount: tools.length,
    checks,
    paidActionsReady: checks.every((check) => check.ok),
    ok: checks[0].ok,
  }
  process.stdout.write(`${JSON.stringify(report, null, 2)}\n`)
  if (!report.ok) process.exitCode = 1
}

async function health(url, name, required = true) {
  try {
    return { name, required, ok: true, detail: (await jsonRequest(url)).body }
  } catch (error) {
    return { name, required, ok: false, detail: error.message }
  }
}

async function payVersion(env) {
  try {
    const { stdout, stderr } = await execFileAsync('pay', ['--version'], {
      env,
      timeout: 10_000,
      maxBuffer: 64 * 1024,
    })
    return { name: 'Pay.sh', required: false, ok: true, detail: (stdout || stderr).trim() }
  } catch (error) {
    return {
      name: 'Pay.sh',
      required: false,
      ok: false,
      detail: error.code === 'ENOENT' ? 'pay is not installed; free tools still work' : error.message,
    }
  }
}

async function installCommand(argv, config) {
  const client = option(argv, '--client') || 'all'
  const cliPath = fileURLToPath(import.meta.url)
  const results = await installMcp({
    client,
    force: !argv.includes('--no-force'),
    command: process.execPath,
    args: [cliPath, 'mcp'],
    serverEnv: {
      OBULUS_API_URL: config.apiOrigin,
      OBULUS_GATEWAY_URL: config.gatewayOrigin,
      OBULUS_MCP_STATE: config.statePath,
    },
  })
  process.stdout.write(`${JSON.stringify(results, null, 2)}\n`)
}

function option(argv, name) {
  const index = argv.indexOf(name)
  return index >= 0 ? argv[index + 1] : null
}

function printHelp() {
  process.stdout.write(`Obulus full MCP\n\n`)
  process.stdout.write(`  node src/cli.mjs install-mcp --client codex|claude|gemini|all\n`)
  process.stdout.write(`  Wallet-only sign-in: call the connect_wallet MCP tool\n`)
  process.stdout.write(`  node src/cli.mjs auth status | logout\n`)
  process.stdout.write(`  node src/cli.mjs tools [TOOL]\n`)
  process.stdout.write(`  node src/cli.mjs call TOOL --json '{...}'\n`)
  process.stdout.write(`  node src/cli.mjs doctor\n`)
  process.stdout.write(`  node src/cli.mjs mcp\n`)
}

const invokedPath = process.argv[1] ? pathToFileURL(process.argv[1]).href : null
if (invokedPath === import.meta.url) {
  runCli().catch((error) => {
    process.stderr.write(`${JSON.stringify(safeError(error), null, 2)}\n`)
    process.exitCode = 1
  })
}
