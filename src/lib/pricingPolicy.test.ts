import assert from 'node:assert/strict'
import test from 'node:test'

import {
  DATA_OWNER_BPS,
  formatKrwPreview,
  PROTOCOL_FEE_BPS,
  protocolFeeBreakdown,
} from './pricingPolicy.ts'

test('the document price includes a 90/10 owner and protocol split', () => {
  assert.equal(DATA_OWNER_BPS, 9_000)
  assert.equal(PROTOCOL_FEE_BPS, 1_000)
  assert.deepEqual(protocolFeeBreakdown(38), {
    ownerKrw: 34.2,
    protocolKrw: 3.8,
  })
})

test('micropayment previews retain one decimal place when needed', () => {
  assert.equal(formatKrwPreview(34.2), '34.2')
  assert.equal(formatKrwPreview(20), '20')
})

test('invalid document totals are rejected', () => {
  for (const total of [-1, Number.NaN, Number.POSITIVE_INFINITY]) {
    assert.throws(() => protocolFeeBreakdown(total))
  }
})
