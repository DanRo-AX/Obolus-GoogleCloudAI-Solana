import assert from 'node:assert/strict'
import test from 'node:test'
import { integerEnv } from './runtime-config.js'

test('worker timer configuration cannot overflow Node into a one-millisecond hot loop', () => {
  assert.equal(integerEnv('POLL', 10_000, 1_000, 300_000, {}), 10_000)
  assert.equal(integerEnv('POLL', 10_000, 1_000, 300_000, { POLL: ' 1000 ' }), 1_000)
  assert.throws(
    () => integerEnv('POLL', 10_000, 1_000, 300_000, { POLL: '2147483648' }),
    /between 1000 and 300000/,
  )
  assert.throws(
    () => integerEnv('POLL', 10_000, 1_000, 300_000, { POLL: '10000junk' }),
    /base-10 integer/,
  )
})
