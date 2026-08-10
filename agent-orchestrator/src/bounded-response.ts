export async function boundedResponseText(
  response: Response,
  limit: number,
  description = 'HTTP response',
): Promise<string> {
  if (!Number.isSafeInteger(limit) || limit < 1) {
    throw new Error('HTTP response size limit must be a positive safe integer')
  }
  const declared = response.headers.get('content-length')
  if (declared && (!/^\d+$/.test(declared) || Number(declared) > limit)) {
    await response.body?.cancel().catch(() => undefined)
    throw new Error(`${description} exceeded the size limit`)
  }
  if (!response.body) return ''
  const reader = response.body.getReader()
  const chunks: Uint8Array[] = []
  let size = 0
  try {
    while (true) {
      const { done, value } = await reader.read()
      if (done) break
      size += value.byteLength
      if (size > limit) {
        await reader.cancel()
        throw new Error(`${description} exceeded the size limit`)
      }
      chunks.push(value)
    }
  } finally {
    reader.releaseLock()
  }
  return Buffer.concat(chunks.map((chunk) => Buffer.from(chunk))).toString('utf8')
}
