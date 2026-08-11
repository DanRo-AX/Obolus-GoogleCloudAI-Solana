#!/usr/bin/env node
import { createInterface } from 'node:readline/promises'
import { pathToFileURL } from 'node:url'

import { runtimeConfig } from './config.mjs'
import { safeError } from './errors.mjs'
import { executeApprovedIntent } from './payment-broker.mjs'

const payTool = {
  name: 'pay_approved_intent',
  description:
    'Execute exactly one interactively approved Obulus payment intent through local Pay.sh. No URL, headers, method, recipient, or amount can be supplied by the model.',
  inputSchema: {
    type: 'object',
    properties: { intentId: { type: 'string', minLength: 8 } },
    required: ['intentId'],
    additionalProperties: false,
  },
}

export async function runPayMcp(
  config = runtimeConfig(),
  input = process.stdin,
  output = process.stdout,
  options = {},
) {
  const lines = createInterface({ input, crlfDelay: Infinity, terminal: false })
  for await (const line of lines) {
    if (!line.trim()) continue
    let request
    try {
      request = JSON.parse(line)
    } catch {
      output.write(`${JSON.stringify(errorResponse(null, -32700, 'Parse error'))}\n`)
      continue
    }
    const response = await handlePayMcpRequest(request, config, options)
    if (response) output.write(`${JSON.stringify(response)}\n`)
  }
}

export async function handlePayMcpRequest(request, config, options = {}) {
  const id = request.id ?? null
  if (request.method === 'server/discover' || request.method === 'initialize') {
    return {
      jsonrpc: '2.0',
      id,
      result: {
        protocolVersion: '2025-06-18',
        capabilities: { tools: { listChanged: false } },
        serverInfo: { name: 'obulus-approved-pay', version: '0.1.0' },
        instructions:
          'This server cannot prepare or alter payments. It executes only a locally stored, interactively approved, one-time Obulus intent through Pay.sh.',
      },
    }
  }
  if (request.method === 'notifications/initialized' || request.method?.startsWith('notifications/')) {
    return null
  }
  if (request.method === 'ping') return { jsonrpc: '2.0', id, result: {} }
  if (request.method === 'tools/list') {
    return { jsonrpc: '2.0', id, result: { tools: [payTool] } }
  }
  if (request.method === 'tools/call') {
    try {
      if (request.params?.name !== payTool.name) throw new Error('Only pay_approved_intent is allowed')
      const args = request.params?.arguments || {}
      if (Object.keys(args).length !== 1 || typeof args.intentId !== 'string') {
        throw new Error('intentId is the only supported argument')
      }
      const result = await executeApprovedIntent(config, args.intentId, options)
      return {
        jsonrpc: '2.0',
        id,
        result: {
          content: [{ type: 'text', text: JSON.stringify(result, null, 2) }],
          structuredContent: result,
          isError: false,
        },
      }
    } catch (error) {
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
  }
  return errorResponse(id, -32601, `Method not found: ${request.method}`)
}

function errorResponse(id, code, message) {
  return { jsonrpc: '2.0', id, error: { code, message } }
}

const invoked = process.argv[1] ? pathToFileURL(process.argv[1]).href : null
if (invoked === import.meta.url) {
  runPayMcp().catch((error) => {
    process.stderr.write(`Obulus Pay.sh broker failed: ${error.message}\n`)
    process.exitCode = 1
  })
}
