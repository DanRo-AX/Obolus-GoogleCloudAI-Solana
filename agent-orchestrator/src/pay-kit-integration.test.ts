import assert from 'node:assert/strict'
import test from 'node:test'
import { generateKeyPairSigner } from '@solana/kit'
import { base58 } from '@scure/base'
import { Challenge } from 'mppx'
import { installDurablePayFetchFence, type PreparePaymentRecord } from './durable-pay-client.js'
import type { PayShResource } from './runner.js'
import { matchesPreparedTransaction } from './pay-sh-reconciler.js'

test('real PayKit MPP signing traverses the durable credential fence', async () => {
  const payer = await generateKeyPairSigner()
  const operator = await generateKeyPairSigner()
  const owner = await generateKeyPairSigner()
  const challenge = Challenge.from({
    id: 'real-paykit-challenge',
    realm: 'pay.example',
    method: 'solana',
    intent: 'charge',
    expires: new Date(Date.now() + 5 * 60_000).toISOString(),
    request: {
      amount: '30',
      currency: 'SOL',
      recipient: operator.address,
      externalId: 'human-document-krw-700#4be',
      methodDetails: {
        network: 'devnet',
        feePayer: true,
        feePayerKey: payer.address,
        recentBlockhash: payer.address,
        splits: [{ recipient: owner.address, amount: '29' }],
      },
    },
  })
  const resource: PayShResource = {
    quoteId: 'quote-real',
    queryId: 'query-real',
    documentHandle: 'doc-real',
    recipientWallet: owner.address,
    network: 'devnet',
    asset: 'SOL',
    amountAtomic: '30',
    ownerAmountAtomic: '29',
    platformAmountAtomic: '1',
    contentHash: 'aa'.repeat(32),
    documentVersion: 1,
    consentVersion: 'openshelf.consent.v1',
    priceKrw: 700,
    expiresAt: Date.now() + 10 * 60_000,
    status: 'quoted',
    resourcePath: '/document?research_job_id=job-real',
  }

  const realFetch = globalThis.fetch
  let paidTransports = 0
  const paidInternalTokens: Array<string | null> = []
  globalThis.fetch = async (_input, init) => {
    const headers = new Headers(init?.headers)
    const authorization = headers.get('authorization')
    if (authorization) {
      paidTransports += 1
      paidInternalTokens.push(headers.get('x-openshelf-internal-token'))
      return new Response('{}', { status: 200 })
    }
    return new Response(null, {
      status: 402,
      headers: { 'www-authenticate': Challenge.serialize(challenge) },
    })
  }
  const fence = installDurablePayFetchFence('https://pay.example')
  const { createPayKitClient } = await import('@solana/pay-kit/client')
  const client = await createPayKitClient({ signer: payer, rpcUrl: 'https://rpc.invalid', accept: ['mpp'] })
  const attemptId = 'c'.repeat(64)
  let prepared: PreparePaymentRecord | undefined

  try {
    const response = await fence.withAttempt({
      jobId: 'job-real',
      attemptId,
      resource,
      signerAddress: payer.address,
      operatorWallet: operator.address,
      prepare: async (record) => { prepared = record },
    }, () => client.fetch(
      `https://pay.example/document?research_job_id=job-real&payment_attempt_id=${attemptId}`,
      {
        method: 'GET',
        headers: {
          accept: 'application/json',
          'x-openshelf-internal-token': 'research-worker-secret',
        },
      },
      'mpp',
    ))

    assert.equal(response.status, 200)
    assert.equal(paidTransports, 1)
    assert.deepEqual(paidInternalTokens, ['research-worker-secret'])
    assert.equal(prepared?.quoteId, 'quote-real')
    assert.equal(prepared?.payer, payer.address)
    assert.equal(prepared?.platformRecipientWallet, operator.address)
    assert.equal(prepared?.externalId, 'human-document-krw-700#4be')
    assert.equal(prepared?.recentBlockhash, payer.address)
    const transaction = Buffer.from(prepared?.signedTransactionBase64 ?? '', 'base64')
    assert.ok(transaction.length >= 100)
    assert.equal(transaction[0], 1, 'same payer/fee-payer should produce one signature slot')
    assert.equal(
      matchesPreparedTransaction(transaction, transaction, base58.encode(transaction.subarray(1, 65))),
      true,
    )

    let secondPrepared = false
    const secondAttemptId = 'd'.repeat(64)
    const secondResponse = await fence.withAttempt({
      jobId: 'job-real',
      attemptId: secondAttemptId,
      resource,
      signerAddress: payer.address,
      operatorWallet: operator.address,
      prepare: async () => { secondPrepared = true },
    }, () => client.fetch(
      `https://pay.example/document?research_job_id=job-real&payment_attempt_id=${secondAttemptId}`,
      {
        method: 'GET',
        headers: {
          accept: 'application/json',
          'x-openshelf-internal-token': 'research-worker-secret',
        },
      },
      'mpp',
    ))
    assert.equal(secondResponse.status, 200)
    assert.equal(secondPrepared, true)
    assert.equal(paidTransports, 2)
    assert.deepEqual(paidInternalTokens, ['research-worker-secret', 'research-worker-secret'])
  } finally {
    globalThis.fetch = realFetch
  }
})
