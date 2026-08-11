import assert from 'node:assert/strict'
import test from 'node:test'
import { shouldClearAuthentication } from './authBootstrap.ts'

test('only an explicit unauthorized response clears authenticated state', () => {
  assert.equal(shouldClearAuthentication(401), true)
  assert.equal(shouldClearAuthentication(0), false)
  assert.equal(shouldClearAuthentication(500), false)
  assert.equal(shouldClearAuthentication(undefined), false)
})
