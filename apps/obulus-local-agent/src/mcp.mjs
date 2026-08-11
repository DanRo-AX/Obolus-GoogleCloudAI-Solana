import { createInterface } from 'node:readline/promises'

import { safeError } from './errors.mjs'
import { redactModelSecrets } from './privacy.mjs'
import { callTool, tools } from './tools.mjs'

const instructions =
  'Accountless Obulus buyer client. Search sends only a minimized question and coarse filters. Never request email, profile, password, Phantom, seed phrase, or private key. Obulus tools never sign. After preparing a quote, ask the user to run the displayed interactive approval command. The separate Pay MCP accepts only that exact one-time intent id.'

export async function runMcp(marketplace, input = process.stdin, output = process.stdout) {
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
    const response = await handleMcpRequest(request, marketplace)
    if (response) output.write(`${JSON.stringify(response)}\n`)
  }
}

export async function handleMcpRequest(request, marketplace) {
  const id = request.id ?? null
  try {
    if (request.method === 'server/discover') {
      return {
        jsonrpc: '2.0',
        id,
        result: {
          resultType: 'complete',
          ttlMs: 0,
          cacheScope: 'public',
          supportedVersions: ['2025-06-18'],
          capabilities: { tools: { listChanged: false } },
          instructions,
          _meta: {
            'io.modelcontextprotocol/serverInfo': { name: 'obulus-local', version: '0.1.0' },
          },
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
          serverInfo: { name: 'obulus-local', version: '0.1.0' },
          instructions,
        },
      }
    }
    if (request.method === 'notifications/initialized' || request.method?.startsWith('notifications/')) {
      return null
    }
    if (request.method === 'ping') return { jsonrpc: '2.0', id, result: {} }
    if (request.method === 'tools/list') return { jsonrpc: '2.0', id, result: { tools } }
    if (request.method === 'tools/call') {
      const result = redactModelSecrets(await callTool(
        request.params?.name,
        request.params?.arguments || {},
        marketplace,
      ))
      return {
        jsonrpc: '2.0',
        id,
        result: {
          content: [{ type: 'text', text: JSON.stringify(result, null, 2) }],
          structuredContent: normalize(result),
          isError: false,
        },
      }
    }
    return errorResponse(id, -32601, `Method not found: ${request.method}`)
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
    return errorResponse(id, -32603, error.message || 'Internal error')
  }
}

function normalize(value) {
  return value && typeof value === 'object' && !Array.isArray(value) ? value : { value }
}

function errorResponse(id, code, message) {
  return { jsonrpc: '2.0', id, error: { code, message } }
}
