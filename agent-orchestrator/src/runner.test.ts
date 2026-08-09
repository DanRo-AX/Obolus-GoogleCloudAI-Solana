import assert from 'node:assert/strict'
import test from 'node:test'
import { Challenge } from 'mppx'
import { PayShPaymentNotSentError } from './payment-errors.js'
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

function resource(overrides: Partial<PayShResource> = {}): PayShResource {
  return {
    quoteId: 'q1', queryId: 'query-1', documentHandle: 'A', recipientWallet: 'owner-a',
    network: 'devnet', asset: 'USDC', amountAtomic: '30', ownerAmountAtomic: '29',
    platformAmountAtomic: '1', priceKrw: 700, expiresAt: Date.now() + 600_000,
    status: 'quoted', resourcePath: '/a?research_job_id=bundle_1',
    ...overrides,
  }
}

test('pays every resource once and completes', async () => {
  const remaining = [
    resource({ amountAtomic: '10', ownerAmountAtomic: '9' }),
    resource({ quoteId: 'q2', documentHandle: 'B', recipientWallet: 'owner-b', amountAtomic: '20', ownerAmountAtomic: '19', resourcePath: '/b?research_job_id=bundle_1' }),
  ]
  const paid: string[] = []
  let completed = false
  const api: ResearchApi = {
    plan: async () => plan([...remaining]),
    beginPayment: async () => undefined,
    complete: async () => { completed = true },
    fail: async () => { throw new Error('unexpected failure') },
    hold: async () => { throw new Error('unexpected hold') },
  }
  await runResearchJob({
    jobId: 'bundle_1', signerAddress: 'agent', payShGatewayBase: 'https://pay', api,
    internalPaymentToken: 'research-worker-secret',
    retryDelaysMs: [],
    verifyChallenge: async () => undefined,
    payClient: { fetch: async (url, init) => {
      assert.equal(
        new Headers(init?.headers).get('x-openshelf-internal-token'),
        'research-worker-secret',
      )
      const value = String(url)
      paid.push(value)
      remaining.shift()
      return new Response('{}', { status: 200 })
    } },
  })
  assert.equal(completed, true)
  assert.deepEqual(paid.map((url) => new URL(url).pathname), ['/a', '/b'])
  for (const url of paid) {
    assert.equal(new URL(url).searchParams.get('research_job_id'), 'bundle_1')
    assert.match(new URL(url).searchParams.get('payment_attempt_id') ?? '', /^[0-9a-f]{64}$/)
  }
})

test('lost response is not paid twice when the ledger proves delivery', async () => {
  let remaining = [resource()]
  let calls = 0
  const api: ResearchApi = {
    plan: async () => plan([...remaining]),
    beginPayment: async () => undefined,
    complete: async () => undefined,
    fail: async () => { throw new Error('unexpected failure') },
    hold: async () => { throw new Error('unexpected hold') },
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
  const paidResource = resource()
  let failure = ''
  const api: ResearchApi = {
    plan: async () => plan([paidResource]),
    beginPayment: async () => undefined,
    complete: async () => undefined,
    fail: async (_jobId, error) => { failure = error },
    hold: async () => { throw new Error('unexpected hold') },
  }
  await assert.rejects(runResearchJob({
    jobId: 'bundle_1', signerAddress: 'agent', payShGatewayBase: 'https://pay', api,
    retryDelaysMs: [], verifyChallenge: async () => { throw new Error('MPP unavailable') },
    payClient: { fetch: async () => { throw new Error('unexpected paid call') } },
  }), /MPP unavailable/)
  assert.match(failure, /MPP unavailable/)
})

test('an ambiguous paid call is held and never paid twice or refunded', async () => {
  const paidResource = resource()
  let calls = 0
  let held = ''
  let failed = false
  const api: ResearchApi = {
    plan: async () => plan([paidResource]),
    beginPayment: async () => undefined,
    complete: async () => undefined,
    fail: async () => { failed = true },
    hold: async (_jobId, error) => { held = error },
  }
  await assert.rejects(runResearchJob({
    jobId: 'bundle_1', signerAddress: 'agent', payShGatewayBase: 'https://pay', api,
    retryDelaysMs: [0, 0], verifyChallenge: async () => undefined,
    payClient: { fetch: async () => {
      calls += 1
      throw new Error('upstream response lost after charge')
    } },
  }), /payment outcome is unknown/)
  assert.equal(calls, 1)
  assert.equal(failed, false)
  assert.match(held, /payment outcome is unknown/)
})

test('does not invoke Pay.sh unless the exact durable attempt is fenced first', async () => {
  const paidResource = resource()
  let paid = false
  let failed = ''
  const api: ResearchApi = {
    plan: async () => plan([paidResource]),
    beginPayment: async (_jobId, quoteId, attemptId) => {
      assert.equal(quoteId, 'q1')
      assert.match(attemptId, /^[0-9a-f]{64}$/)
      throw new Error('durable fence unavailable')
    },
    complete: async () => undefined,
    fail: async (_jobId, error) => { failed = error },
    hold: async () => { throw new Error('unexpected hold') },
  }
  await assert.rejects(runResearchJob({
    jobId: 'bundle_1', signerAddress: 'agent', payShGatewayBase: 'https://pay', api,
    retryDelaysMs: [], verifyChallenge: async () => undefined,
    payClient: { fetch: async () => { paid = true; return new Response('{}') } },
  }), /durable fence unavailable/)
  assert.equal(paid, false)
  assert.match(failed, /durable fence unavailable/)
})

test('leaves a fenced job to reconciliation when durable prepare prevents transport', async () => {
  const paidResource = resource()
  let persisted = false
  const api: ResearchApi = {
    plan: async () => plan([paidResource]),
    beginPayment: async () => undefined,
    complete: async () => undefined,
    fail: async () => { persisted = true },
    hold: async () => { persisted = true },
  }
  await assert.rejects(runResearchJob({
    jobId: 'bundle_1', signerAddress: 'agent', payShGatewayBase: 'https://pay', api,
    retryDelaysMs: [], verifyChallenge: async () => undefined,
    payClient: {
      fetch: async () => {
        throw new PayShPaymentNotSentError('Rust prepare did not commit')
      },
    },
  }), /prepare did not commit/)
  assert.equal(persisted, false)
})

test('rejects an MPP challenge that charges more than the committed quote', async () => {
  const originalFetch = globalThis.fetch
  const paidResource = resource()
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
    await assert.rejects(verifyPayShChallenge('https://pay/a', paidResource), /does not match quote/)
  } finally {
    globalThis.fetch = originalFetch
  }
})

test('a challenge server that never responds cannot pin the research job forever', async () => {
  const hangingFetch: typeof globalThis.fetch = async (_input, init) =>
    await new Promise<Response>((_resolve, reject) => {
      assert.ok(init?.signal)
      init.signal.addEventListener('abort', () => reject(init.signal?.reason), { once: true })
    })
  const startedAt = Date.now()
  await assert.rejects(
    verifyPayShChallenge(
      'https://pay.example/hung',
      resource(),
      undefined,
      undefined,
      hangingFetch,
      5,
    ),
    /abort|timeout/i,
  )
  assert.ok(Date.now() - startedAt < 500)
})
