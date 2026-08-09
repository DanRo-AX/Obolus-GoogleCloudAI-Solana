import assert from 'node:assert/strict'
import test from 'node:test'
import {
  ledgerBlockHeight,
  observePreparedPayout,
  processRefundClaims,
  validatePayoutClaim,
  type PayoutClaim,
} from './refunds.js'

test('KMS payout block heights remain exact across bigint JSON serialization', () => {
  assert.equal(ledgerBlockHeight(469_758_340n), 469_758_340)
  assert.equal(
    ledgerBlockHeight(BigInt(Number.MAX_SAFE_INTEGER)),
    Number.MAX_SAFE_INTEGER,
  )
  for (const value of [0n, -1n, BigInt(Number.MAX_SAFE_INTEGER) + 1n, 1.5, Number.NaN]) {
    assert.throws(() => ledgerBlockHeight(value))
  }
})

const claim: PayoutClaim = {
  id: 'real-prepared-payout',
  kind: 'open_call_refund',
  escrowWallet: '11111111111111111111111111111111',
  recipientWallet: '11111111111111111111111111111111',
  asset: '4zMMC9srt5Ri5X14GAgXhaHii3GnPAEERYPJgZJDncDU',
  network: 'solana:EtWTRABZaYq6iMfeYKouRu166VU2xqa1',
  amountAtomic: '518519',
  status: 'prepared',
  transactionSignature: '5'.repeat(88),
  signedTransactionBase64: Buffer.from(new Uint8Array(180).fill(7)).toString('base64'),
  recentBlockhash: '11111111111111111111111111111111',
  lastValidBlockHeight: 100,
}

type RpcView = {
  status: { err: unknown; confirmationStatus: string | null } | null | 'malformed'
  blockHeight: number
}

function rpcFetch(views: Record<string, RpcView>): typeof globalThis.fetch {
  return async (input, init) => {
    assert.equal(init?.redirect, 'error')
    const origin = new URL(String(input)).origin
    const view = views[origin]
    assert.ok(view, `unexpected RPC origin ${origin}`)
    const request = JSON.parse(String(init?.body)) as { method: string; id: number }
    if (request.method === 'getSignatureStatuses') {
      return Response.json({
        jsonrpc: '2.0',
        id: request.id,
        result: {
          value: [view.status === 'malformed' ? { confirmationStatus: 'finalized' } : view.status],
        },
      })
    }
    if (request.method === 'getBlockHeight') {
      return Response.json({ jsonrpc: '2.0', id: request.id, result: view.blockHeight })
    }
    throw new Error(`unexpected method ${request.method}`)
  }
}

test('one lying or lagging RPC cannot complete or abandon a prepared payout', async () => {
  const rpcUrls = ['https://rpc-a.example/path', 'https://rpc-b.example/other']
  const fetchImpl = rpcFetch({
    'https://rpc-a.example': {
      status: { err: null, confirmationStatus: 'finalized' },
      blockHeight: 101,
    },
    'https://rpc-b.example': { status: null, blockHeight: 101 },
  })
  assert.equal(
    await observePreparedPayout({ claim, rpcUrls, fetchImpl }),
    'inconclusive',
  )

  const malformedFetch = rpcFetch({
    'https://rpc-a.example': { status: 'malformed', blockHeight: 101 },
    'https://rpc-b.example': { status: null, blockHeight: 101 },
  })
  assert.equal(
    await observePreparedPayout({ claim, rpcUrls, fetchImpl: malformedFetch }),
    'inconclusive',
  )
})

test('two distinct finalized views are required for either payout outcome', async () => {
  const rpcUrls = ['https://rpc-a.example', 'https://rpc-b.example']
  assert.equal(
    await observePreparedPayout({
      claim,
      rpcUrls,
      fetchImpl: rpcFetch({
        'https://rpc-a.example': {
          status: { err: null, confirmationStatus: 'finalized' },
          blockHeight: 99,
        },
        'https://rpc-b.example': {
          status: { err: null, confirmationStatus: 'finalized' },
          blockHeight: 101,
        },
      }),
    }),
    'confirmed',
  )
  assert.equal(
    await observePreparedPayout({
      claim,
      rpcUrls,
      fetchImpl: rpcFetch({
        'https://rpc-a.example': { status: null, blockHeight: 101 },
        'https://rpc-b.example': { status: null, blockHeight: 102 },
      }),
    }),
    'absent_or_failed',
  )
})

test('two confirmed views are still a reversible fork, not a completed payout', async () => {
  const rpcUrls = ['https://rpc-a.example', 'https://rpc-b.example']
  assert.equal(
    await observePreparedPayout({
      claim,
      rpcUrls,
      fetchImpl: rpcFetch({
        'https://rpc-a.example': {
          status: { err: null, confirmationStatus: 'confirmed' },
          blockHeight: 101,
        },
        'https://rpc-b.example': {
          status: { err: null, confirmationStatus: 'confirmed' },
          blockHeight: 102,
        },
      }),
    }),
    'inconclusive',
  )
})

test('two URL aliases for one RPC origin still count as one witness', async () => {
  let calls = 0
  const fetchImpl: typeof globalThis.fetch = async () => {
    calls += 1
    throw new Error('one origin must be rejected before any RPC request')
  }
  assert.equal(
    await observePreparedPayout({
      claim,
      rpcUrls: ['https://RPC-A.example/path', 'https://rpc-a.example:443/another'],
      fetchImpl,
    }),
    'inconclusive',
  )
  assert.equal(calls, 0)
})

test('one RPC that never closes its socket becomes inconclusive within its deadline', async () => {
  const startedAt = Date.now()
  const fetchImpl: typeof globalThis.fetch = async (input, init) => {
    const origin = new URL(String(input)).origin
    if (origin === 'https://rpc-a.example') {
      const request = JSON.parse(String(init?.body)) as { id: number; method: string }
      return request.method === 'getSignatureStatuses'
        ? Response.json({ jsonrpc: '2.0', id: request.id, result: { value: [null] } })
        : Response.json({ jsonrpc: '2.0', id: request.id, result: 101 })
    }
    return await new Promise<Response>((_resolve, reject) => {
      assert.ok(init?.signal)
      init.signal.addEventListener('abort', () => reject(init.signal?.reason), { once: true })
    })
  }
  assert.equal(await observePreparedPayout({
    claim,
    rpcUrls: ['https://rpc-a.example', 'https://rpc-b.example'],
    fetchImpl,
    rpcTimeoutMs: 5,
  }), 'inconclusive')
  assert.ok(Date.now() - startedAt < 500)
})

test('a corrupted payout row cannot reach RPC or KMS preparation', async () => {
  let rpcCalls = 0
  let prepareCalls = 0
  let failCalls = 0
  const corrupted = { ...claim, status: 'leased', escrowWallet: '11111111111111111111111111111111' }
  delete corrupted.transactionSignature
  delete corrupted.signedTransactionBase64
  delete corrupted.recentBlockhash
  delete corrupted.lastValidBlockHeight
  await processRefundClaims({
    signer: { address: 'SysvarRent111111111111111111111111111111111' } as never,
    rpcUrls: ['https://rpc-a.example', 'https://rpc-b.example'],
    fetchImpl: async () => {
      rpcCalls += 1
      throw new Error('corrupted claim must fail before RPC')
    },
    workerId: 'corruption-test-worker',
    api: {
      lease: async () => [corrupted],
      prepare: async () => {
        prepareCalls += 1
        return corrupted
      },
      complete: async () => corrupted,
      fail: async () => {
        failCalls += 1
        return corrupted
      },
    },
  })
  assert.equal(rpcCalls, 0)
  assert.equal(prepareCalls, 0)
  assert.equal(failCalls, 1)
})

test('payout economic fields reject alternate mint, hex amount, and partial evidence', () => {
  const signerAddress = claim.escrowWallet
  assert.throws(
    () => validatePayoutClaim({ ...claim, asset: '11111111111111111111111111111111' }, signerAddress),
    /rejected asset/,
  )
  assert.throws(
    () => validatePayoutClaim({ ...claim, amountAtomic: '0x10' }, signerAddress),
    /canonical positive integer/,
  )
  assert.throws(
    () => validatePayoutClaim({ ...claim, signedTransactionBase64: null }, signerAddress),
    /missing exact transaction evidence/,
  )
})
