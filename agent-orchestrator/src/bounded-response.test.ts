import assert from 'node:assert/strict'
import test from 'node:test'
import { boundedResponseText } from './bounded-response.js'

test('a chunked recovery response cannot bypass the byte limit', async () => {
  let cancelled = false
  const response = new Response(new ReadableStream<Uint8Array>({
    start(controller) {
      controller.enqueue(new Uint8Array(8))
      controller.enqueue(new Uint8Array(9))
    },
    cancel() {
      cancelled = true
    },
  }))

  await assert.rejects(
    boundedResponseText(response, 16, 'recovery RPC response'),
    /exceeded the size limit/,
  )
  assert.equal(cancelled, true)
})

test('a bounded recovery response remains valid JSON input', async () => {
  const response = Response.json({ result: { slot: 7 } })
  assert.deepEqual(JSON.parse(await boundedResponseText(response, 1_024)), {
    result: { slot: 7 },
  })
})
