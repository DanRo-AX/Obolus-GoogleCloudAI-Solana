import { LocalAgentError } from './errors.mjs'

export async function jsonRequest(url, init = {}, options = {}) {
  const timeoutMs = options.timeoutMs ?? 15_000
  const fetchImpl = options.fetchImpl || fetch
  const timeout = AbortSignal.timeout(timeoutMs)
  const signal = init.signal ? AbortSignal.any([init.signal, timeout]) : timeout
  try {
    const response = await fetchImpl(url, { ...init, signal })
    const text = await response.text()
    let body = null
    if (text) {
      try {
        body = JSON.parse(text)
      } catch {
        body = text
      }
    }
    return { response, body }
  } catch (error) {
    if (error instanceof LocalAgentError) throw error
    if (signal.aborted) {
      throw new LocalAgentError(`Request to ${new URL(url).origin} timed out.`, 'request_timeout', 504)
    }
    throw new LocalAgentError(
      `Could not reach ${new URL(url).origin}: ${error.message}`,
      'offline',
      503,
    )
  }
}

export function requireSuccess(result) {
  if (result.response.ok) return result.body
  throw new LocalAgentError(
    result.body?.error?.message || result.body?.message || `HTTP ${result.response.status}`,
    result.body?.error?.code || `http_${result.response.status}`,
    result.response.status,
    result.body,
  )
}
