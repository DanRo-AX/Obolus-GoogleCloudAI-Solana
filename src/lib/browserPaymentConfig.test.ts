import assert from 'node:assert/strict'
import test from 'node:test'
import { krwPerUsdc, prepaidTopUpAtomic } from './browserPaymentConfig.ts'

test('wallet top-up config is exact atomic decimal rather than clamped or NaN', () => {
  assert.equal(prepaidTopUpAtomic(undefined), 5_000_000)
  assert.equal(prepaidTopUpAtomic('0.100001'), 100_001)
  assert.equal(prepaidTopUpAtomic('1000'), 1_000_000_000)
  for (const hostile of ['NaN', 'Infinity', '-1', '5junk', '0.000001', '1000.000001', '1.0000001']) {
    assert.throws(() => prepaidTopUpAtomic(hostile))
  }
})

test('managed browser conversion preview cannot drift from the ledger', () => {
  assert.equal(krwPerUsdc(undefined, true), 1_350)
  assert.equal(krwPerUsdc('1400', false), 1_400)
  assert.throws(() => krwPerUsdc('1400', true), /must match/)
  assert.throws(() => krwPerUsdc('1350krw', false), /base-10 integer/)
})
