import assert from 'node:assert/strict'
import test from 'node:test'
import {
  backgroundCycleIssue,
  completeBackgroundCycle,
  failBackgroundCycle,
  newBackgroundCycleState,
} from './cycle-readiness.js'

test('a required background safety lane must initialize, recover, and remain fresh', () => {
  const state = newBackgroundCycleState()
  assert.match(backgroundCycleIssue({
    name: 'Pay.sh recovery',
    state,
    nowMonotonicMs: 1_000,
    intervalMs: 30_000,
  }) ?? '', /initial/)

  completeBackgroundCycle(state, 2_000)
  assert.equal(backgroundCycleIssue({
    name: 'Pay.sh recovery',
    state,
    nowMonotonicMs: 3_000,
    intervalMs: 30_000,
  }), null)

  failBackgroundCycle(state, new Error('ledger protocol mismatch'))
  assert.match(backgroundCycleIssue({
    name: 'Pay.sh recovery',
    state,
    nowMonotonicMs: 4_000,
    intervalMs: 30_000,
  }) ?? '', /protocol mismatch/)

  completeBackgroundCycle(state, 5_000)
  assert.match(backgroundCycleIssue({
    name: 'Pay.sh recovery',
    state,
    nowMonotonicMs: 100_000,
    intervalMs: 30_000,
  }) ?? '', /recent/)
})
