#!/usr/bin/env node
import { spawn } from 'node:child_process'
import { createInterface } from 'node:readline'
import { pathToFileURL } from 'node:url'

// Pay 0.27.0 implements the stable MCP handshake. Antigravity CLI 1.1.10
// sends a draft 2026-07-28 server/discover probe first. rmcp 0.9 closes the
// stream when it sees that newer request, so this narrow adapter rejects only
// the probe with the standard Method not found response and forwards every
// stable MCP message byte-for-byte after Antigravity falls back to initialize.

export function discoveryFallback(request) {
  if (request?.method !== 'server/discover') return null
  return {
    jsonrpc: '2.0',
    id: request.id ?? null,
    error: { code: -32601, message: 'Method not found: server/discover' },
  }
}

export async function proxyPayMcp(input = process.stdin, output = process.stdout, env = process.env) {
  const command = env.OPENSHELF_PAY_COMMAND || 'pay'
  const args = ['mcp']
  const account = env.OPENSHELF_PAY_ACCOUNT?.trim()
  if (account) args.push('--account', account)

  const child = spawn(command, args, { stdio: ['pipe', 'pipe', 'inherit'] })
  child.stdout.pipe(output)
  child.on('error', (error) => {
    process.stderr.write(`Could not start Pay MCP (${command}): ${error.message}\n`)
  })

  const lines = createInterface({ input, crlfDelay: Infinity, terminal: false })
  for await (const line of lines) {
    if (!line.trim()) continue
    let request
    try {
      request = JSON.parse(line)
    } catch {
      child.stdin.write(`${line}\n`)
      continue
    }
    const fallback = discoveryFallback(request)
    if (fallback) {
      output.write(`${JSON.stringify(fallback)}\n`)
    } else {
      child.stdin.write(`${line}\n`)
    }
  }
  child.stdin.end()
  await new Promise((resolve) => child.once('exit', resolve))
}

const invokedPath = process.argv[1] ? pathToFileURL(process.argv[1]).href : null
if (invokedPath === import.meta.url) {
  proxyPayMcp().catch((error) => {
    process.stderr.write(`Pay MCP compatibility adapter failed: ${error.message}\n`)
    process.exitCode = 1
  })
}
