import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import { branchForAgentAction } from './agentActionPolicy.ts'

describe('branchForAgentAction', () => {
  it('turns a covered result into an approval screen, never an automatic payment', () => {
    assert.deepEqual(branchForAgentAction('hit', false, 'propose_evidence_purchase'), {
      phase: 'confirm',
      generateBaseline: false,
    })
  })

  it('offers an Open Call while also preparing the free public answer', () => {
    assert.deepEqual(branchForAgentAction('miss', true, 'propose_open_call'), {
      phase: 'ask-order',
      generateBaseline: true,
    })
  })

  it('generates a baseline only when the server says the miss is eligible', () => {
    assert.deepEqual(branchForAgentAction('miss', true, 'generate_general_baseline'), {
      phase: 'baseline',
      generateBaseline: true,
    })
    assert.deepEqual(branchForAgentAction('miss', false, 'generate_general_baseline'), {
      phase: 'baseline',
      generateBaseline: false,
    })
  })

  it('honors a no-spend stop for both hit and miss results', () => {
    assert.equal(branchForAgentAction('hit', false, 'finish_without_purchase').phase,
      'declined',
    )
    assert.deepEqual(branchForAgentAction('miss', true, 'finish_without_purchase'), {
      phase: 'declined',
      generateBaseline: false,
    })
  })

  it('keeps an older eligible miss on the free answer path', () => {
    assert.deepEqual(branchForAgentAction('miss', true), {
      phase: 'baseline',
      generateBaseline: true,
    })
  })
})
