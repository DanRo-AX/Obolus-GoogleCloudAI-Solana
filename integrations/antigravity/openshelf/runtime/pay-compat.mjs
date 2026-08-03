#!/usr/bin/env node
import { spawn } from 'node:child_process'
import { createInterface } from 'node:readline'
import { pathToFileURL } from 'node:url'

import { payInvocation } from './pay-command.mjs'

// Pay 0.26.0 implements the stable MCP handshake. Antigravity CLI 1.1.10
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
  const invocation = payInvocation(env)
  const args = [...invocation.args, 'mcp']
  const account = env.OPENSHELF_PAY_ACCOUNT?.trim()
  if (account) args.push('--account', account)

  const child = spawn(invocation.command, args, { stdio: ['pipe', 'pipe', 'inherit'] })
  await new Promise((resolve, reject) => {
    child.once('spawn', resolve)
    child.once('error', reject)
  })
  child.stdout.pipe(output)

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
  const exitCode = await new Promise((resolve, reject) => {
    child.once('error', reject)
    child.once('close', resolve)
  })
  if (exitCode !== 0) {
    throw new Error(`Pay MCP exited with status ${String(exitCode)}`)
  }
}

const invokedPath = process.argv[1] ? pathToFileURL(process.argv[1]).href : null
if (invokedPath === import.meta.url) {
  proxyPayMcp().catch((error) => {
    process.stderr.write(`Pay MCP compatibility adapter failed: ${error.message}\n`)
    process.exitCode = 1
  })
}
