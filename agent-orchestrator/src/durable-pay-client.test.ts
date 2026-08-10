import assert from 'node:assert/strict'
import test from 'node:test'
import { Challenge, Credential } from 'mppx'
import { installDurablePayFetchFence } from './durable-pay-client.js'
import type { PayShResource } from './runner.js'

const resource: PayShResource = {
  quoteId: 'quote-700',
  queryId: 'query-1',
  documentHandle: 'doc-a',
  recipientWallet: 'owner-wallet',
  network: 'devnet',
  asset: 'USDC',
  amountAtomic: '518519',
  ownerAmountAtomic: '518518',
  platformAmountAtomic: '1',
  priceKrw: 700,
  expiresAt: Date.now() + 10 * 60_000,
  status: 'quoted',
  resourcePath: '/api/v2/pay-sh/documents/700/query-1/doc-a?research_job_id=job-1',
}

test('the exact MPP credential is durable before the paid HTTP request can leave', async () => {
  const realFetch = globalThis.fetch
  let externalCalls = 0
  globalThis.fetch = async () => {
    externalCalls += 1
    return new Response('{}', { status: 200 })
  }
  const fence = installDurablePayFetchFence('https://pay.example')
  let releasePrepare: (() => void) | undefined
  const prepareGate = new Promise<void>((resolve) => { releasePrepare = resolve })
  let preparedRecord: Record<string, unknown> | undefined
  const challenge = Challenge.from({
    id: 'challenge-hmac-value',
    realm: 'pay.example',
    method: 'solana',
    intent: 'charge',
    expires: new Date(Date.now() + 5 * 60_000).toISOString(),
    request: {
      amount: '518519',
      currency: 'USDC',
      recipient: 'operator-wallet',
      externalId: 'human-document-krw-700#9af',
      methodDetails: {
        network: 'devnet',
        feePayer: true,
        feePayerKey: 'kms-signer',
        recentBlockhash: '11111111111111111111111111111111',
        splits: [{ recipient: 'owner-wallet', amount: '518518' }],
      },
    },
  })
  const signedTransactionBase64 = Buffer.alloc(180, 7).toString('base64')
  const authorization = Credential.serialize({
    challenge,
    payload: { type: 'transaction', transaction: signedTransactionBase64 },
  })
  const attemptId = 'a'.repeat(64)

  try {
    const paidRequest = fence.withAttempt({
      jobId: 'job-1',
      attemptId,
      resource,
      signerAddress: 'kms-signer',
      operatorWallet: 'operator-wallet',
      prepare: async (record) => {
        preparedRecord = record
        await prepareGate
      },
    }, () => globalThis.fetch(
      `https://pay.example${resource.resourcePath}&payment_attempt_id=${attemptId}`,
      { headers: { authorization } },
    ))

    await new Promise((resolve) => setImmediate(resolve))
    assert.equal(externalCalls, 0, 'paid transport escaped before durable prepare')
    assert.equal(preparedRecord?.payer, 'kms-signer')
    assert.equal(preparedRecord?.platformRecipientWallet, 'operator-wallet')
    assert.equal(preparedRecord?.signedTransactionBase64, signedTransactionBase64)
    assert.equal(preparedRecord?.externalId, 'human-document-krw-700#9af')
    releasePrepare?.()
    const response = await paidRequest
    assert.equal(response.status, 200)
    assert.equal(externalCalls, 1)
  } finally {
    globalThis.fetch = realFetch
  }
})

test('a paid Pay.sh request without the matching in-process attempt fails closed', async () => {
  const realFetch = globalThis.fetch
  let externalCalls = 0
  globalThis.fetch = async () => {
    externalCalls += 1
    return new Response('{}')
  }
  installDurablePayFetchFence('https://pay.example')
  try {
    await assert.rejects(
      globalThis.fetch(
        `https://pay.example/document?payment_attempt_id=${'b'.repeat(64)}`,
        { headers: { authorization: 'Payment e30' } },
      ),
      /no active durable research payment fence/,
    )
    assert.equal(externalCalls, 0)
  } finally {
    globalThis.fetch = realFetch
  }
})
