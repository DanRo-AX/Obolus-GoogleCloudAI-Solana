import assert from 'node:assert/strict'
import test from 'node:test'
import { secureServiceOrigin, secureServiceUrl } from './url-policy.js'

test('payment service URLs require encrypted remote transport', () => {
  assert.equal(
    secureServiceUrl('RPC', 'https://rpc.example/v1?api-key=opaque'),
    'https://rpc.example/v1?api-key=opaque',
  )
  assert.equal(secureServiceUrl('API', 'http://127.0.0.1:8787'), 'http://127.0.0.1:8787/')
  assert.throws(() => secureServiceUrl('API', 'http://api.example'), /must use HTTPS/)
  assert.throws(() => secureServiceUrl('PAY', 'ftp://pay.example'), /must use HTTPS/)
  assert.throws(
    () => secureServiceUrl('RPC', 'https://user:secret@rpc.example'),
    /must not embed credentials/,
  )
  assert.throws(() => secureServiceUrl('API', 'https://api.example/#secret'), /fragment/)
})

test('credential-bearing service bases are exact origins', () => {
  assert.equal(secureServiceOrigin('API', 'https://api.example'), 'https://api.example')
  assert.equal(secureServiceOrigin('API', 'http://localhost:8787/'), 'http://localhost:8787')
  assert.throws(
    () => secureServiceOrigin('API', 'https://api.example/internal'),
    /without a path or query/,
  )
  assert.throws(
    () => secureServiceOrigin('API', 'https://api.example?token=misplaced'),
    /without a path or query/,
  )
})
