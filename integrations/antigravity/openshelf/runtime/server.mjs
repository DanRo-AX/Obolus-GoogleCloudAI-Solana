#!/usr/bin/env node
import { execFile } from 'node:child_process'
import { createInterface } from 'node:readline/promises'
import { pathToFileURL } from 'node:url'
import { promisify, stripVTControlCharacters } from 'node:util'

import {
  AgentError,
  apiRequest,
  emptyState,
  jsonRequest,
  readState,
  runtimeConfig,
  sessionTokenFrom,
  writeState,
} from './core.mjs'
import { callTool, tools } from './tools.mjs'

const execFileAsync = promisify(execFile)

export async function runMcp(input = process.stdin, output = process.stdout) {
  const lines = createInterface({ input, crlfDelay: Infinity, terminal: false })
  for await (const line of lines) {
    if (!line.trim()) continue
    let request
    try {
      request = JSON.parse(line)
    } catch {
      output.write(`${JSON.stringify(jsonRpcError(null, -32700, 'Parse error'))}\n`)
      continue
    }
    const response = await handleMcpRequest(request)
    if (response) output.write(`${JSON.stringify(response)}\n`)
  }
}

export async function handleMcpRequest(request) {
  const id = request.id ?? null
  try {
    // Antigravity CLI 1.1.10 probes the draft 2026-07-28 stateless protocol
    // before attempting the stable initialize handshake. Advertise only the
    // stable version this small stdio server implements so the client safely
    // falls back to initialize instead of waiting on a new-protocol session.
    if (request.method === 'server/discover') {
      return {
        jsonrpc: '2.0',
        id,
        result: {
          resultType: 'complete',
          _meta: {
            'io.modelcontextprotocol/serverInfo': { name: 'openshelf', version: '0.3.0' },
          },
          ttlMs: 0,
          cacheScope: 'public',
          supportedVersions: ['2025-06-18'],
          capabilities: { tools: { listChanged: false } },
          instructions: serverInstructions,
        },
      }
    }
    if (request.method === 'initialize') {
      return {
        jsonrpc: '2.0',
        id,
        result: {
          protocolVersion: '2025-06-18',
          capabilities: { tools: { listChanged: false } },
          serverInfo: { name: 'openshelf', version: '0.3.0' },
          instructions: serverInstructions,
        },
      }
    }
    if (request.method === 'notifications/initialized' || request.method?.startsWith('notifications/')) {
      return null
    }
    if (request.method === 'ping') return { jsonrpc: '2.0', id, result: {} }
    if (request.method === 'tools/list') {
      return { jsonrpc: '2.0', id, result: { tools } }
    }
    if (request.method === 'tools/call') {
      const name = request.params?.name
      const args = request.params?.arguments || {}
      const result = await callTool(name, args)
      return {
        jsonrpc: '2.0',
        id,
        result: {
          content: [{ type: 'text', text: JSON.stringify(result, null, 2) }],
          structuredContent: normalizeStructured(result),
          isError: false,
        },
      }
    }
    return jsonRpcError(id, -32601, `Method not found: ${request.method}`)
  } catch (error) {
    if (request.method === 'tools/call') {
      const safe = safeError(error)
      return {
        jsonrpc: '2.0',
        id,
        result: {
          content: [{ type: 'text', text: JSON.stringify(safe, null, 2) }],
          structuredContent: safe,
          isError: true,
        },
      }
    }
    return jsonRpcError(id, -32603, error.message || 'Internal error')
  }
}

const serverInstructions =
  'Human evidence marketplace on Solana Devnet. OpenShelf tools prepare exact payments; use the separate Pay MCP curl tool only after showing the amount and receiving user approval. AI baselines are free orientation, never human evidence. Never invent a contributor answer.'

function normalizeStructured(value) {
  if (value && typeof value === 'object' && !Array.isArray(value)) return value
  return { value }
}

function jsonRpcError(id, code, message) {
  return { jsonrpc: '2.0', id, error: { code, message } }
}

function safeError(error) {
  return {
    error: {
      code: error?.code || 'agent_error',
      message: error?.message || 'OpenShelf agent request failed',
      status: error?.status || 500,
    },
  }
}

export async function authenticate(mode, { email, password, ageConfirmed14 = false, config }) {
  if (!email || !password) throw new AgentError('email and password are required', 'invalid_auth')
  const path = mode === 'register' ? '/api/v1/auth/register' : '/api/v1/auth/login'
  const { body, response } = await jsonRequest(`${config.apiOrigin}${path}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ email, password, ageConfirmed14 }),
  })
  const state = await readState(config)
  state.token = sessionTokenFrom(response)
  state.user = body.user
  await writeState(state, config)
  return { user: body.user, balance: body.balance, statePath: config.statePath }
}

async function runCli(argv = process.argv.slice(2)) {
  const [command = 'help', subcommand, ...rest] = argv
  const config = runtimeConfig()
  if (command === 'mcp') return runMcp()
  if (command === 'auth') return authCommand(subcommand, rest, config)
  if (command === 'call') return toolCommand(subcommand, rest, config)
  if (command === 'doctor') return doctor(config)
  if (command === 'help' || command === '--help' || command === '-h') {
    printHelp()
    return
  }
  throw new AgentError(`Unknown command: ${command}`, 'unknown_command')
}

export async function invokeCliTool(name, rawArguments, config = runtimeConfig()) {
  if (!name) throw new AgentError('A tool name is required.', 'invalid_arguments')
  let args
  try {
    args = JSON.parse(rawArguments)
  } catch {
    throw new AgentError('--json must contain one valid JSON object.', 'invalid_arguments')
  }
  if (!args || typeof args !== 'object' || Array.isArray(args)) {
    throw new AgentError('--json must contain one JSON object.', 'invalid_arguments')
  }
  return callTool(name, args, { config })
}

async function toolCommand(name, argv, config) {
  const rawArguments = decodeCliArguments(
    option(argv, '--json'),
    option(argv, '--json-b64'),
  )
  const result = await invokeCliTool(name, rawArguments, config)
  process.stdout.write(`${JSON.stringify(result, null, 2)}\n`)
}

export function decodeCliArguments(rawArguments, encodedArguments) {
  if (rawArguments) return rawArguments
  if (encodedArguments) {
    if (
      encodedArguments.length > 131_072 ||
      encodedArguments.length % 4 !== 0 ||
      !/^[A-Za-z0-9+/]+={0,2}$/.test(encodedArguments)
    ) {
      throw new AgentError('--json-b64 must be canonical base64.', 'invalid_arguments')
    }
    return Buffer.from(encodedArguments, 'base64').toString('utf8')
  }
  throw new AgentError('Use call TOOL --json-b64 BASE64 or --json \'{...}\'.', 'invalid_arguments')
}

async function authCommand(command, argv, config) {
  if (command === 'login' || command === 'register') {
    const email = option(argv, '--email') || (await promptText('Email: '))
    const password = await readSecret('Password: ')
    let ageConfirmed14 = false
    if (command === 'register') {
      const repeated = await readSecret('Repeat password: ')
      if (password !== repeated) throw new AgentError('Passwords do not match.', 'invalid_auth')
      ageConfirmed14 = optionPresent(argv, '--age-confirmed')
      if (!ageConfirmed14) {
        ageConfirmed14 = (await promptText('Confirm you are at least 14 years old (yes/no): '))
          .trim()
          .toLowerCase() === 'yes'
      }
    }
    const result = await authenticate(command, { email, password, ageConfirmed14, config })
    process.stdout.write(`${JSON.stringify(result, null, 2)}\n`)
    return
  }
  if (command === 'status') {
    const result = await apiRequest('/api/v1/auth/me', {}, { config })
    process.stdout.write(`${JSON.stringify(result.body, null, 2)}\n`)
    return
  }
  if (command === 'logout') {
    const state = await readState(config)
    if (state.token) {
      try {
        await apiRequest('/api/v1/auth/logout', { method: 'POST' }, { config, state })
      } catch (error) {
        if (error.status !== 401) throw error
      }
    }
    await writeState(emptyState(config), config)
    process.stdout.write('Signed out. Local session token and query capabilities were cleared.\n')
    return
  }
  throw new AgentError('Use auth login, register, status, or logout.', 'unknown_auth_command')
}

async function doctor(config) {
  const checks = await Promise.all([
    health(`${config.apiOrigin}/readyz`, 'Rust API'),
    health(`${config.gatewayOrigin}/readyz`, 'x402 gateway'),
    executableVersion('pay', ['--version'], 'Pay.sh'),
    payAccountStatus(),
  ])
  const payAccount = checks.find((check) => check.name === 'Pay account')
  const report = {
    networkPolicy: 'Solana Devnet only',
    apiOrigin: config.apiOrigin,
    gatewayOrigin: config.gatewayOrigin,
    statePath: config.statePath,
    checks,
    paidActionsReady: payAccount?.ok === true,
    ok: checks.every((check) => check.ok || check.requiredFor === 'paid actions only'),
  }
  process.stdout.write(`${JSON.stringify(report, null, 2)}\n`)
  if (!report.ok) process.exitCode = 1
}

async function payAccountStatus(env = process.env) {
  const args = ['whoami']
  const account = env.OPENSHELF_PAY_ACCOUNT?.trim()
  if (account) args.push('--account', account)
  try {
    const { stdout, stderr } = await execFileAsync('pay', args, { timeout: 10_000 })
    const detail = stripVTControlCharacters([stdout, stderr].filter(Boolean).join('\n')).trim()
    return {
      name: 'Pay account',
      ok: !/no mainnet account|run pay setup/i.test(detail),
      requiredFor: 'paid actions only',
      detail,
    }
  } catch (error) {
    return {
      name: 'Pay account',
      ok: false,
      requiredFor: 'paid actions only',
      detail: error.code === 'ENOENT' ? 'pay is not installed' : error.message,
    }
  }
}

async function health(url, name) {
  try {
    const { body } = await jsonRequest(url)
    return { name, ok: true, detail: body }
  } catch (error) {
    return { name, ok: false, detail: error.message }
  }
}

async function executableVersion(command, args, name) {
  try {
    const { stdout, stderr } = await execFileAsync(command, args, { timeout: 10_000 })
    return { name, ok: true, detail: (stdout || stderr).trim() }
  } catch (error) {
    return { name, ok: false, detail: error.code === 'ENOENT' ? `${command} is not installed` : error.message }
  }
}

function option(argv, name) {
  const index = argv.indexOf(name)
  return index >= 0 ? argv[index + 1] : null
}

function optionPresent(argv, name) {
  return argv.includes(name)
}

async function promptText(prompt) {
  const promptInterface = createInterface({ input: process.stdin, output: process.stderr })
  try {
    return await promptInterface.question(prompt)
  } finally {
    promptInterface.close()
  }
}

async function readSecret(prompt) {
  if (!process.stdin.isTTY || !process.stderr.isTTY) {
    throw new AgentError('Password input requires an interactive terminal.', 'interactive_required')
  }
  process.stderr.write(prompt)
  process.stdin.setRawMode(true)
  process.stdin.resume()
  process.stdin.setEncoding('utf8')
  return new Promise((resolve, reject) => {
    let value = ''
    const cleanup = () => {
      process.stdin.off('data', onData)
      process.stdin.setRawMode(false)
      process.stdin.pause()
      process.stderr.write('\n')
    }
    const onData = (chunk) => {
      for (const character of chunk) {
        if (character === '\u0003') {
          cleanup()
          reject(new AgentError('Password entry cancelled.', 'cancelled'))
          return
        }
        if (character === '\r' || character === '\n') {
          cleanup()
          resolve(value)
          return
        }
        if (character === '\u007f' || character === '\b') {
          value = value.slice(0, -1)
          continue
        }
        if (character >= ' ') value += character
      }
    }
    process.stdin.on('data', onData)
  })
}

function printHelp() {
  process.stdout.write(`OpenShelf Antigravity runtime\n\n`)
  process.stdout.write(`  server.mjs auth login --email you@example.com\n`)
  process.stdout.write(`  server.mjs auth register --email you@example.com --age-confirmed\n`)
  process.stdout.write(`  server.mjs auth status\n`)
  process.stdout.write(`  server.mjs auth logout\n`)
  process.stdout.write(`  server.mjs call TOOL --json-b64 BASE64\n`)
  process.stdout.write(`  server.mjs doctor\n`)
  process.stdout.write(`  server.mjs mcp\n`)
}

const invokedPath = process.argv[1] ? pathToFileURL(process.argv[1]).href : null
if (invokedPath === import.meta.url) {
  runCli().catch((error) => {
    process.stderr.write(`${JSON.stringify(safeError(error), null, 2)}\n`)
    process.exitCode = 1
  })
}
