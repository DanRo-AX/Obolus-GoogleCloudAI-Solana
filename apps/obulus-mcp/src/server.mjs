#!/usr/bin/env node
import { createInterface } from 'node:readline/promises'

import { callTool, tools } from './tools.mjs'

export const SERVER_NAME = 'obulus-full'
export const SERVER_VERSION = '1.1.0'
export const PROTOCOL_VERSION = '2025-06-18'

export const serverInstructions = [
  'Obulus is a human-evidence marketplace on Solana Devnet.',
  'ask_people, search_public_evidence, AI baselines, invoice previews, payment progress, and paid-document recovery do not require account_status or sign-in.',
  'Never call account_status before free search and never ask for email or password.',
  'Protected profile, contributor, memory, earnings, prepaid, and owned Open Call actions require connect_wallet, which uses a free Pay.sh SIWX signature and spends no USDC.',
  'Search and ranking are free. Firsthand passages are paid and must never be invented.',
  'Before payment, show the exact invoice, amount, purpose, network and asset.',
  'prepare_evidence_payment and prepare_open_call only prepare exact Pay.sh URLs; they never sign or spend.',
  'Use a separate official Pay MCP only after explicit user confirmation.',
  'AI baselines and official public records are free context, not paid human evidence.',
  'On retries, call payment_progress or evidence_payment_status before preparing another payment.',
].join(' ')

export async function handleMcpRequest(request, options = {}) {
  const id = request?.id ?? null
  try {
    if (request.method === 'server/discover') {
      return {
        jsonrpc: '2.0',
        id,
        result: {
          resultType: 'complete',
          _meta: {
            'io.modelcontextprotocol/serverInfo': {
              name: SERVER_NAME,
              version: SERVER_VERSION,
            },
          },
          ttlMs: 0,
          cacheScope: 'public',
          supportedVersions: [PROTOCOL_VERSION],
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
          protocolVersion: PROTOCOL_VERSION,
          capabilities: { tools: { listChanged: false } },
          serverInfo: { name: SERVER_NAME, version: SERVER_VERSION },
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
      const result = await callTool(
        request.params?.name,
        request.params?.arguments || {},
        options,
      )
      const structuredContent = normalizeStructured(result)
      return {
        jsonrpc: '2.0',
        id,
        result: {
          content: [{ type: 'text', text: JSON.stringify(result, null, 2) }],
          structuredContent,
          isError: false,
        },
      }
    }
    return rpcError(id, -32601, `Method not found: ${request.method}`)
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
    return rpcError(id, -32603, error?.message || 'Internal error')
  }
}

export async function runMcp(input = process.stdin, output = process.stdout, options = {}) {
  const lines = createInterface({ input, crlfDelay: Infinity, terminal: false })
  for await (const line of lines) {
    if (!line.trim()) continue
    let request
    try {
      request = JSON.parse(line)
    } catch {
      output.write(`${JSON.stringify(rpcError(null, -32700, 'Parse error'))}\n`)
      continue
    }
    const response = await handleMcpRequest(request, options)
    if (response) output.write(`${JSON.stringify(response)}\n`)
  }
}

function normalizeStructured(value) {
  if (value && typeof value === 'object' && !Array.isArray(value)) return value
  return { value }
}

function rpcError(id, code, message) {
  return { jsonrpc: '2.0', id, error: { code, message } }
}

export function safeError(error) {
  return {
    error: {
      code: error?.code || 'obulus_mcp_error',
      message: error?.message || 'Obulus MCP request failed',
      status: error?.status || 500,
    },
  }
}
