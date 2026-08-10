import assert from 'node:assert/strict'
import test from 'node:test'

import { proxyRequest } from './pages-proxy.ts'

test('API proxy preserves the API path, query, cookie, and streamed response', async () => {
  let forwarded
  const fetchImpl = async (request) => {
    forwarded = request
    const body = new ReadableStream({
      start(controller) {
        controller.enqueue(new TextEncoder().encode('proxied'))
        controller.close()
      },
    })
    return new Response(body, {
      status: 200,
      headers: { 'set-cookie': 'obolus_session=renewed; HttpOnly; Secure; SameSite=Lax' },
    })
  }

  const response = await proxyRequest(
    new Request('https://obolus.pages.dev/api/v1/auth/me?fresh=1', {
      headers: { cookie: 'obolus_session=current' },
    }),
    'https://obolus-api-amjeodet3q-du.a.run.app',
    '',
    fetchImpl,
  )

  assert.equal(
    forwarded.url,
    'https://obolus-api-amjeodet3q-du.a.run.app/api/v1/auth/me?fresh=1',
  )
  assert.equal(forwarded.headers.get('cookie'), 'obolus_session=current')
  assert.equal(forwarded.headers.get('x-forwarded-host'), 'obolus.pages.dev')
  assert.equal(response.headers.get('set-cookie')?.startsWith('obolus_session=renewed'), true)
  assert.equal(response.headers.get('cache-control'), 'private, no-store')
  assert.equal(await response.text(), 'proxied')
})

test('x402 proxy strips only its own routing prefix', async () => {
  let forwardedUrl = ''
  await proxyRequest(
    new Request('https://obolus.pages.dev/x402/api/v1/payment-bundles?id=quote'),
    'https://obolus-gateway-amjeodet3q-du.a.run.app',
    '/x402',
    async (request) => {
      forwardedUrl = request.url
      return new Response(null, { status: 204 })
    },
  )
  assert.equal(
    forwardedUrl,
    'https://obolus-gateway-amjeodet3q-du.a.run.app/api/v1/payment-bundles?id=quote',
  )
})

test('proxy rejects insecure origins and paths outside the configured prefix', async () => {
  const request = new Request('https://obolus.pages.dev/x402/api/v1/payment-bundles')
  await assert.rejects(proxyRequest(request, 'http://obolus-api.example'))
  await assert.rejects(
    proxyRequest(request, 'https://obolus-gateway.example', '/different-prefix'),
  )
})
