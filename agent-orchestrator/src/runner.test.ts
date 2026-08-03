import assert from 'node:assert/strict'
import test from 'node:test'
import { Challenge } from 'mppx'
import { runResearchJob, verifyPayShChallenge, type PayShResource, type ResearchApi, type ResearchJobPlan } from './runner.js'

function plan(resources: ResearchJobPlan['resources']): ResearchJobPlan {
  return {
    id: 'bundle_1',
    payer: 'buyer',
    payTo: 'agent',
    network: 'devnet',
    asset: 'usdc',
    amountAtomic: '30',
    status: 'processing',
    resources,
  }
}

test('pays every resource once and completes', async () => {
  const remaining = [
    { quoteId: 'q1', documentHandle: 'A', recipientWallet: 'owner-a', network: 'devnet', asset: 'USDC', amountAtomic: '10', ownerAmountAtomic: '9', platformAmountAtomic: '1', status: 'quoted', resourcePath: '/a?research_job_id=bundle_1' },
    { quoteId: 'q2', documentHandle: 'B', recipientWallet: 'owner-b', network: 'devnet', asset: 'USDC', amountAtomic: '20', ownerAmountAtomic: '19', platformAmountAtomic: '1', status: 'quoted', resourcePath: '/b?research_job_id=bundle_1' },
  ]
  const paid: string[] = []
  let completed = false
  const api: ResearchApi = {
    plan: async () => plan([...remaining]),
    complete: async () => { completed = true },
    fail: async () => { throw new Error('unexpected failure') },
  }
  await runResearchJob({
    jobId: 'bundle_1', signerAddress: 'agent', payShGatewayBase: 'https://pay', api,
    retryDelaysMs: [],
    verifyChallenge: async () => undefined,
    payClient: { fetch: async (url) => {
      const value = String(url)
      paid.push(value)
      remaining.shift()
      return new Response('{}', { status: 200 })
    } },
  })
  assert.equal(completed, true)
  assert.deepEqual(paid, [
    'https://pay/a?research_job_id=bundle_1',
    'https://pay/b?research_job_id=bundle_1',
  ])
})

test('lost response is not paid twice when the ledger proves delivery', async () => {
  let remaining = [{ quoteId: 'q1', documentHandle: 'A', recipientWallet: 'owner-a', network: 'devnet', asset: 'USDC', amountAtomic: '30', ownerAmountAtomic: '29', platformAmountAtomic: '1', status: 'quoted', resourcePath: '/a?research_job_id=bundle_1' }]
  let calls = 0
  const api: ResearchApi = {
    plan: async () => plan([...remaining]),
    complete: async () => undefined,
    fail: async () => { throw new Error('unexpected failure') },
  }
  await runResearchJob({
    jobId: 'bundle_1', signerAddress: 'agent', payShGatewayBase: 'https://pay', api,
    retryDelaysMs: [],
    verifyChallenge: async () => undefined,
    payClient: { fetch: async () => {
      calls += 1
      remaining = []
      throw new Error('response lost')
    } },
  })
  assert.equal(calls, 1)
})

test('persists failure so the unused balance becomes refundable', async () => {
  const resource = { quoteId: 'q1', documentHandle: 'A', recipientWallet: 'owner-a', network: 'devnet', asset: 'USDC', amountAtomic: '30', ownerAmountAtomic: '29', platformAmountAtomic: '1', status: 'quoted', resourcePath: '/a?research_job_id=bundle_1' }
  let failure = ''
  const api: ResearchApi = {
    plan: async () => plan([resource]),
    complete: async () => undefined,
    fail: async (_jobId, error) => { failure = error },
  }
  await assert.rejects(runResearchJob({
    jobId: 'bundle_1', signerAddress: 'agent', payShGatewayBase: 'https://pay', api,
    retryDelaysMs: [], verifyChallenge: async () => undefined,
    payClient: { fetch: async () => { throw new Error('MPP unavailable') } },
  }), /MPP unavailable/)
  assert.match(failure, /MPP unavailable/)
})

test('rejects an MPP challenge that charges more than the committed quote', async () => {
  const originalFetch = globalThis.fetch
  const resource: PayShResource = {
    quoteId: 'q1', documentHandle: 'A', recipientWallet: 'owner-a',
    network: 'devnet', asset: 'USDC', amountAtomic: '30',
    ownerAmountAtomic: '29', platformAmountAtomic: '1', status: 'quoted',
    resourcePath: '/a?research_job_id=bundle_1',
  }
  const challenge = Challenge.from({
    id: 'challenge-1', realm: 'pay.example', method: 'solana', intent: 'charge',
    request: {
      amount: '31', currency: 'USDC', recipient: 'operator',
      methodDetails: { network: 'devnet', splits: [{ recipient: 'owner-a', amount: '29' }] },
    },
  })
  globalThis.fetch = async () => new Response(null, {
    status: 402,
    headers: { 'www-authenticate': Challenge.serialize(challenge) },
  })
  try {
    await assert.rejects(verifyPayShChallenge('https://pay/a', resource), /does not match quote/)
  } finally {
    globalThis.fetch = originalFetch
  }
})
