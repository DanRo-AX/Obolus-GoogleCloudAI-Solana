import assert from 'node:assert/strict'
import test from 'node:test'
import { base58 } from '@scure/base'
import {
  ComputeBudgetProgram,
  Keypair,
  PublicKey,
  TransactionInstruction,
  TransactionMessage,
  VersionedTransaction,
} from '@solana/web3.js'
import {
  matchesPreparedTransaction,
  processDirectPayShPaymentAttempts,
  processResearchPaymentAttempts,
  unanimousSettlementSignature,
  type DirectPayShPaymentAttempt,
  type ResearchPaymentAttempt,
  type ResearchPaymentReconciliationApi,
} from './pay-sh-reconciler.js'

const payer = Keypair.fromSeed(Uint8Array.from({ length: 32 }, (_, index) => 200 - index))
const feePayer = Keypair.fromSeed(Uint8Array.from({ length: 32 }, (_, index) => index + 1))
const operator = Keypair.fromSeed(Uint8Array.from({ length: 32 }, (_, index) => index + 40))
const owner = Keypair.fromSeed(Uint8Array.from({ length: 32 }, (_, index) => index + 80))
const attacker = Keypair.fromSeed(Uint8Array.from({ length: 32 }, (_, index) => index + 120))
const mint = new PublicKey('4zMMC9srt5Ri5X14GAgXhaHii3GnPAEERYPJgZJDncDU')
const tokenProgram = new PublicKey('TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA')
const associatedTokenProgram = new PublicKey('ATokenGPvbdGVxr1b2hvZbsiqW5xWH25efTNsLJA8knL')
const memoProgram = new PublicKey('MemoSq4gqABAXKb96qnH8TysNcWxMyWCqXgDLGmfcHr')
const externalId = 'human-document-krw-700#9af'
const operatorWallet = operator.publicKey.toBase58()

function transactionPair(
  kind: 'quoted-usdc' | 'misdirected-usdc' | 'excessive-priority-fee' = 'quoted-usdc',
): {
  prepared: Uint8Array
  candidate: Uint8Array
  signature: string
  recentBlockhash: string
} {
  const recentBlockhash = new PublicKey(Uint8Array.from(
    { length: 32 },
    (_, index) => index + 20,
  )).toBase58()
  const instructions = [
    ...(kind === 'excessive-priority-fee'
      ? [ComputeBudgetProgram.setComputeUnitPrice({ microLamports: 10_001n })]
      : []),
    transferChecked(payer.publicKey, operator.publicKey, 1n),
    new TransactionInstruction({
      programId: memoProgram,
      keys: [],
      data: Buffer.from(externalId),
    }),
    transferChecked(
      payer.publicKey,
      kind === 'misdirected-usdc' ? attacker.publicKey : owner.publicKey,
      518_518n,
    ),
  ]
  const message = new TransactionMessage({
    payerKey: feePayer.publicKey,
    recentBlockhash,
    instructions,
  }).compileToV0Message()
  const preparedTransaction = new VersionedTransaction(message)
  preparedTransaction.sign([payer])
  const prepared = preparedTransaction.serialize()
  const candidateTransaction = VersionedTransaction.deserialize(prepared)
  candidateTransaction.sign([feePayer])
  const candidate = candidateTransaction.serialize()
  return {
    prepared,
    candidate,
    signature: base58.encode(candidateTransaction.signatures[0]),
    recentBlockhash,
  }
}

function transferChecked(
  authority: PublicKey,
  recipient: PublicKey,
  amount: bigint,
): TransactionInstruction {
  const data = Buffer.alloc(10)
  data[0] = 12
  data.writeBigUInt64LE(amount, 1)
  data[9] = 6
  return new TransactionInstruction({
    programId: tokenProgram,
    keys: [
      { pubkey: associatedTokenAddress(authority), isSigner: false, isWritable: true },
      { pubkey: mint, isSigner: false, isWritable: false },
      { pubkey: associatedTokenAddress(recipient), isSigner: false, isWritable: true },
      { pubkey: authority, isSigner: true, isWritable: false },
    ],
    data,
  })
}

function associatedTokenAddress(ownerAddress: PublicKey): PublicKey {
  return PublicKey.findProgramAddressSync(
    [ownerAddress.toBuffer(), tokenProgram.toBuffer(), mint.toBuffer()],
    associatedTokenProgram,
  )[0]
}

function attempt(overrides: Partial<ResearchPaymentAttempt> = {}): ResearchPaymentAttempt {
  const { prepared, recentBlockhash } = transactionPair()
  return {
    jobId: 'job-1',
    quoteId: 'quote-1',
    attemptId: 'a'.repeat(64),
    status: 'prepared',
    reconcileAfter: Date.now() - 1,
    createdAt: Date.now() - 30_000,
    preparedAt: Date.now() - 29_000,
    payer: payer.publicKey.toBase58(),
    network: 'devnet',
    asset: mint.toBase58(),
    amountAtomic: '518519',
    ownerAmountAtomic: '518518',
    platformAmountAtomic: '1',
    recipientWallet: owner.publicKey.toBase58(),
    platformRecipientWallet: operatorWallet,
    signedTransactionBase64: Buffer.from(prepared).toString('base64'),
    recentBlockhash,
    challengeId: 'challenge-1',
    externalId,
    challengeExpiresAt: Date.now() + 60_000,
    ...overrides,
  }
}

function claimedAttempt(
  overrides: Partial<ResearchPaymentAttempt> = {},
): ResearchPaymentAttempt {
  return attempt({
    status: 'claimed',
    payer: '',
    preparedAt: undefined,
    platformRecipientWallet: undefined,
    signedTransactionBase64: undefined,
    recentBlockhash: undefined,
    challengeId: undefined,
    externalId: undefined,
    challengeExpiresAt: undefined,
    ...overrides,
  })
}

function apiFor(
  paymentAttempt: ResearchPaymentAttempt,
  events: string[],
): ResearchPaymentReconciliationApi {
  return {
    list: async () => [paymentAttempt],
    defer: async (_job, _attempt, absenceObserved = false) => {
      events.push(absenceObserved ? 'defer:absence' : 'defer')
    },
    settle: async (_job, _attempt, signature) => { events.push(`settle:${signature}`) },
    release: async (_job, _attempt, status) => { events.push(`release:${status}`) },
  }
}

function rpcFetch(
  handler: (method: string, rpcUrl: string) => unknown,
): typeof globalThis.fetch {
  return async (input, init) => {
    assert.equal(init?.redirect, 'error', 'RPC redirects would collapse independent origins')
    const body = JSON.parse(String(init?.body)) as { id: number; method: string }
    return new Response(JSON.stringify({
      jsonrpc: '2.0',
      id: body.id,
      result: handler(body.method, String(input)),
    }), {
      status: 200,
      headers: { 'content-type': 'application/json' },
    })
  }
}

test('matches the finalized transaction when Pay.sh fills only the zero fee-payer signature', () => {
  const { prepared, candidate, signature } = transactionPair()
  assert.equal(matchesPreparedTransaction(prepared, candidate, signature), true)

  const changedMessage = candidate.slice()
  changedMessage[changedMessage.length - 1] ^= 1
  assert.equal(matchesPreparedTransaction(prepared, changedMessage, signature), false)

  const changedPayerSignature = candidate.slice()
  changedPayerSignature[1 + 64] ^= 1
  assert.equal(matchesPreparedTransaction(prepared, changedPayerSignature, signature), false)
})

test('operator-wallet rotation cannot orphan an exact finalized transaction', async () => {
  const events: string[] = []
  const paymentAttempt = attempt()
  const { candidate, signature } = transactionPair()
  await processResearchPaymentAttempts({
    api: apiFor(paymentAttempt, events),
    rpcUrls: ['https://rpc-a.example', 'https://rpc-b.example'],
    operatorWallet: Keypair.generate().publicKey.toBase58(),
    fetchImpl: rpcFetch((method) => {
      if (method === 'getSignaturesForAddress') {
        return [{ signature, err: null, blockTime: Math.floor(Date.now() / 1_000) }]
      }
      if (method === 'getTransaction') {
        return {
          meta: { err: null },
          transaction: [Buffer.from(candidate).toString('base64'), 'base64'],
        }
      }
      throw new Error(`unexpected RPC ${method}`)
    }),
  })
  assert.deepEqual(events, [`settle:${signature}`])
})

test('one RPC cannot claim settlement while another finalized view omits it', async () => {
  const events: string[] = []
  const { candidate, signature } = transactionPair()
  const run = await processResearchPaymentAttempts({
    api: apiFor(attempt(), events),
    rpcUrls: ['https://lagging-rpc.example', 'https://archive-rpc.example'],
    operatorWallet,
    fetchImpl: rpcFetch((method, rpcUrl) => {
      if (method === 'getSignaturesForAddress') {
        return rpcUrl.includes('lagging-rpc')
          ? []
          : [{ signature, err: null, blockTime: Math.floor(Date.now() / 1_000) }]
      }
      if (method === 'getTransaction' && rpcUrl.includes('archive-rpc')) {
        return {
          meta: { err: null },
          transaction: [Buffer.from(candidate).toString('base64'), 'base64'],
        }
      }
      throw new Error(`unexpected RPC ${method} at ${rpcUrl}`)
    }),
  })
  assert.deepEqual(events, ['defer'])
  assert.deepEqual(run.degradedAttempts, ['a'.repeat(64)])
})

test('an oversized chunked RPC response cannot release or settle a Pay.sh fence', async () => {
  const events: string[] = []
  let cancelled = false
  const run = await processResearchPaymentAttempts({
    api: apiFor(attempt(), events),
    rpcUrls: ['https://oversized-rpc.example', 'https://honest-rpc.example'],
    operatorWallet,
    fetchImpl: async (input, init) => {
      const body = JSON.parse(String(init?.body)) as { id: number; method: string }
      if (String(input).includes('oversized-rpc')) {
        return new Response(new ReadableStream<Uint8Array>({
          start(controller) {
            controller.enqueue(new Uint8Array(1024 * 1024 + 1))
          },
          cancel() {
            cancelled = true
          },
        }))
      }
      assert.equal(body.method, 'getSignaturesForAddress')
      return Response.json({ jsonrpc: '2.0', id: body.id, result: [] })
    },
  })

  assert.deepEqual(events, ['defer'])
  assert.deepEqual(run.degradedAttempts, ['a'.repeat(64)])
  assert.equal(cancelled, true)
})

test('a lost public-agent callback settles through the direct attempt ledger', async () => {
  const events: string[] = []
  const { candidate, signature } = transactionPair()
  const directAttempt: DirectPayShPaymentAttempt = (() => {
    const { jobId: _jobId, ...direct } = attempt()
    return direct
  })()
  await processDirectPayShPaymentAttempts({
    api: {
      list: async () => [directAttempt],
      defer: async () => { events.push('defer') },
      settle: async (attemptId, settledSignature) => {
        events.push(`settle:${attemptId[0]}:${settledSignature}`)
      },
      release: async () => { events.push('release') },
    },
    rpcUrls: ['https://rpc-a.example', 'https://rpc-b.example'],
    operatorWallet,
    fetchImpl: rpcFetch((method) => {
      if (method === 'getSignaturesForAddress') {
        return [{ signature, err: null, blockTime: Math.floor(Date.now() / 1_000) }]
      }
      if (method === 'getTransaction') {
        return {
          meta: { err: null },
          transaction: [Buffer.from(candidate).toString('base64'), 'base64'],
        }
      }
      throw new Error(`unexpected RPC ${method}`)
    }),
  })
  assert.deepEqual(events, [`settle:a:${signature}`])
})

test('uses the exact transaction id directly when the persisted credential is fully signed', async () => {
  const events: string[] = []
  const { candidate, signature } = transactionPair()
  const paymentAttempt = attempt({
    signedTransactionBase64: Buffer.from(candidate).toString('base64'),
  })
  const rpcMethods: string[] = []
  await processResearchPaymentAttempts({
    api: apiFor(paymentAttempt, events),
    rpcUrls: ['https://rpc-a.example', 'https://rpc-b.example'],
    operatorWallet,
    fetchImpl: rpcFetch((method) => {
      rpcMethods.push(method)
      if (method === 'getTransaction') {
        return {
          meta: { err: null },
          transaction: [Buffer.from(candidate).toString('base64'), 'base64'],
        }
      }
      throw new Error(`unexpected RPC ${method}`)
    }),
  })
  assert.deepEqual(events, [`settle:${signature}`])
  assert.deepEqual(rpcMethods, ['getTransaction', 'getTransaction'])
})

test('a finalized transaction without explicit execution status is never credited', async () => {
  const events: string[] = []
  const { candidate } = transactionPair()
  await processResearchPaymentAttempts({
    api: apiFor(attempt({
      signedTransactionBase64: Buffer.from(candidate).toString('base64'),
    }), events),
    rpcUrls: ['https://rpc-a.example', 'https://rpc-b.example'],
    operatorWallet,
    fetchImpl: rpcFetch((method) => {
      if (method === 'getTransaction') {
        return {
          meta: null,
          transaction: [Buffer.from(candidate).toString('base64'), 'base64'],
        }
      }
      throw new Error(`unexpected RPC ${method}`)
    }),
  })
  assert.deepEqual(events, ['defer'])
})

test('a copied successful signature cannot settle a different prepared message', async () => {
  const events: string[] = []
  const { candidate: actualChainTransaction } = transactionPair()
  const copiedSignatureCredential = actualChainTransaction.slice()
  copiedSignatureCredential[copiedSignatureCredential.length - 1] ^= 1
  await processResearchPaymentAttempts({
    api: apiFor(attempt({
      status: 'ambiguous',
      absenceObservedAt: Date.now() - 5 * 60_000,
      signedTransactionBase64: Buffer.from(copiedSignatureCredential).toString('base64'),
    }), events),
    rpcUrls: ['https://rpc-a.example', 'https://rpc-b.example'],
    operatorWallet,
    fetchImpl: rpcFetch((method) => {
      if (method === 'getTransaction') {
        return {
          meta: { err: null },
          transaction: [Buffer.from(actualChainTransaction).toString('base64'), 'base64'],
        }
      }
      if (method === 'isBlockhashValid') return { value: false }
      throw new Error(`unexpected RPC ${method}`)
    }),
  })
  assert.deepEqual(events, ['defer'])
});

test('RPC settlement evidence needs two identical finalized signatures', () => {
  const first = '1'.repeat(64)
  const second = '2'.repeat(64)
  assert.equal(unanimousSettlementSignature([{ kind: 'settled', signature: first }]), null)
  assert.equal(unanimousSettlementSignature([
    { kind: 'settled', signature: first },
    { kind: 'absent' },
  ]), null)
  assert.equal(unanimousSettlementSignature([
    { kind: 'settled', signature: first },
    { kind: 'settled', signature: second },
  ]), null)
  assert.equal(unanimousSettlementSignature([
    { kind: 'settled', signature: first },
    { kind: 'settled', signature: first },
  ]), first)
})

test('records absence durably before an invalid blockhash can release the fence', async () => {
  const events: string[] = []
  await processResearchPaymentAttempts({
    api: apiFor(attempt({ status: 'ambiguous' }), events),
    rpcUrls: ['https://rpc-a.example', 'https://rpc-b.example'],
    operatorWallet,
    fetchImpl: rpcFetch((method) => {
      if (method === 'getSignaturesForAddress') return []
      if (method === 'isBlockhashValid') return { value: false }
      throw new Error(`unexpected RPC ${method}`)
    }),
  })
  assert.deepEqual(events, ['defer:absence'])
})

test('one RPC can never authorize another charge from absence alone', async () => {
  const events: string[] = []
  await processResearchPaymentAttempts({
    api: apiFor(attempt({ status: 'ambiguous' }), events),
    rpcUrls: ['https://only-rpc.example'],
    operatorWallet,
    fetchImpl: rpcFetch((method) => {
      if (method === 'getSignaturesForAddress') return []
      if (method === 'isBlockhashValid') return { value: false }
      throw new Error(`unexpected RPC ${method}`)
    }),
  })
  assert.deepEqual(events, ['defer'])
})

test('a stored blockhash from another transaction can never authorize release', async () => {
  const events: string[] = []
  let rpcCalls = 0
  await processResearchPaymentAttempts({
    api: apiFor(attempt({ recentBlockhash: '11111111111111111111111111111111' }), events),
    rpcUrls: ['https://rpc-a.example', 'https://rpc-b.example'],
    operatorWallet,
    fetchImpl: async () => {
      rpcCalls += 1
      throw new Error('mismatched evidence must fail before RPC')
    },
  })
  assert.deepEqual(events, ['defer'])
  assert.equal(rpcCalls, 0)
})

test('a legacy attempt without a durable platform recipient never reaches RPC', async () => {
  const events: string[] = []
  let rpcCalls = 0
  await processResearchPaymentAttempts({
    api: apiFor(attempt({ platformRecipientWallet: undefined }), events),
    rpcUrls: ['https://rpc-a.example', 'https://rpc-b.example'],
    operatorWallet,
    fetchImpl: async () => {
      rpcCalls += 1
      throw new Error('unsnapshotted payment terms must fail before RPC')
    },
  })
  assert.deepEqual(events, ['defer'])
  assert.equal(rpcCalls, 0)
})

test('a finalized USDC payment redirected from the owner can never satisfy the quote', async () => {
  const events: string[] = []
  const { prepared, recentBlockhash } = transactionPair('misdirected-usdc')
  let rpcCalls = 0
  await processResearchPaymentAttempts({
    api: apiFor(attempt({
      signedTransactionBase64: Buffer.from(prepared).toString('base64'),
      recentBlockhash,
    }), events),
    rpcUrls: ['https://rpc-a.example', 'https://rpc-b.example'],
    operatorWallet,
    fetchImpl: async () => {
      rpcCalls += 1
      throw new Error('invalid payment semantics must fail before RPC')
    },
  })
  assert.deepEqual(events, ['defer'])
  assert.equal(rpcCalls, 0)
})

test('an excessive service-paid priority fee is rejected before RPC recovery', async () => {
  const events: string[] = []
  const { prepared, recentBlockhash } = transactionPair('excessive-priority-fee')
  let rpcCalls = 0
  await processResearchPaymentAttempts({
    api: apiFor(attempt({
      signedTransactionBase64: Buffer.from(prepared).toString('base64'),
      recentBlockhash,
    }), events),
    rpcUrls: ['https://rpc-a.example', 'https://rpc-b.example'],
    operatorWallet,
    fetchImpl: async () => {
      rpcCalls += 1
      throw new Error('excessive service fee must fail before RPC')
    },
  })
  assert.deepEqual(events, ['defer'])
  assert.equal(rpcCalls, 0)
})

test('releases only on a later finalized pass after durable absence was already observed', async () => {
  const events: string[] = []
  await processResearchPaymentAttempts({
    api: apiFor(attempt({
      status: 'ambiguous',
      createdAt: Date.now() - 11 * 60_000,
      preparedAt: Date.now() - 10 * 60_000,
      absenceObservedAt: Date.now() - 5 * 60_000,
    }), events),
    rpcUrls: ['https://rpc-a.example', 'https://rpc-b.example'],
    operatorWallet,
    fetchImpl: rpcFetch((method) => {
      if (method === 'getSignaturesForAddress') return []
      if (method === 'isBlockhashValid') return { value: false }
      throw new Error(`unexpected RPC ${method}`)
    }),
  })
  assert.deepEqual(events, ['release:ambiguous'])
})

test('keeps the fence when finalized RPC cannot return an exact transaction', async () => {
  const events: string[] = []
  await processResearchPaymentAttempts({
    api: apiFor(attempt(), events),
    rpcUrls: ['https://rpc.example'],
    operatorWallet,
    fetchImpl: rpcFetch((method) => {
      if (method === 'getSignaturesForAddress') {
        return [{ signature: 'rpc-signature', err: null, blockTime: Math.floor(Date.now() / 1_000) }]
      }
      if (method === 'getTransaction') return null
      throw new Error(`unexpected RPC ${method}`)
    }),
  })
  assert.deepEqual(events, ['defer'])
})

test('a validator clock an hour behind cannot hide an exact finalized payment', async () => {
  const events: string[] = []
  const { candidate, signature } = transactionPair()
  await processResearchPaymentAttempts({
    api: apiFor(attempt(), events),
    rpcUrls: ['https://rpc-a.example', 'https://rpc-b.example'],
    operatorWallet,
    fetchImpl: rpcFetch((method) => {
      if (method === 'getSignaturesForAddress') {
        return [{
          signature,
          err: null,
          blockTime: Math.floor(Date.now() / 1_000) - 60 * 60,
        }]
      }
      if (method === 'getTransaction') {
        return {
          meta: { err: null },
          transaction: [Buffer.from(candidate).toString('base64'), 'base64'],
        }
      }
      throw new Error(`unexpected RPC ${method}`)
    }),
  })
  assert.deepEqual(events, [`settle:${signature}`])
})

test('a claim with no durable signed credential is released without consulting RPC', async () => {
  const events: string[] = []
  let rpcCalls = 0
  await processResearchPaymentAttempts({
    api: apiFor(claimedAttempt(), events),
    rpcUrls: ['https://rpc.example'],
    operatorWallet,
    fetchImpl: async () => {
      rpcCalls += 1
      throw new Error('RPC must not be called')
    },
  })
  assert.deepEqual(events, ['release:claimed'])
  assert.equal(rpcCalls, 0)
})

test('future ledger time cannot skip history and authorize another Pay.sh charge', async () => {
  const events: string[] = []
  let rpcCalls = 0
  const run = await processResearchPaymentAttempts({
    api: apiFor(attempt({ createdAt: Date.now() + 24 * 60 * 60_000 }), events),
    rpcUrls: ['https://rpc-a.example', 'https://rpc-b.example'],
    operatorWallet,
    fetchImpl: async () => {
      rpcCalls += 1
      throw new Error('an impossible creation time must fail before chain history is filtered')
    },
  })
  assert.deepEqual(events, ['defer'])
  assert.deepEqual(run.degradedAttempts, ['a'.repeat(64)])
  assert.equal(rpcCalls, 0)
})

test('claimed status with signed evidence is never treated as proof no request left', async () => {
  const events: string[] = []
  let rpcCalls = 0
  const { prepared } = transactionPair()
  const run = await processResearchPaymentAttempts({
    api: apiFor(claimedAttempt({
      payer: payer.publicKey.toBase58(),
      signedTransactionBase64: Buffer.from(prepared).toString('base64'),
    }), events),
    rpcUrls: ['https://rpc-a.example', 'https://rpc-b.example'],
    operatorWallet,
    fetchImpl: async () => {
      rpcCalls += 1
      throw new Error('torn claimed evidence must remain fenced before RPC')
    },
  })
  assert.deepEqual(events, ['defer'])
  assert.deepEqual(run.degradedAttempts, ['a'.repeat(64)])
  assert.equal(rpcCalls, 0)
})

test('one broken attempt cannot starve later reconciliation work in the same batch', async () => {
  const events: string[] = []
  const first = claimedAttempt({ attemptId: 'a'.repeat(64) })
  const second = claimedAttempt({ attemptId: 'b'.repeat(64) })
  const api: ResearchPaymentReconciliationApi = {
    list: async () => [first, second],
    defer: async (_jobId, attemptId) => {
      events.push(`defer:${attemptId[0]}`)
      if (attemptId === first.attemptId) throw new Error('backend unavailable')
    },
    settle: async () => undefined,
    release: async (_jobId, attemptId) => {
      events.push(`release:${attemptId[0]}`)
      if (attemptId === first.attemptId) throw new Error('release failed')
    },
  }
  await assert.rejects(
    processResearchPaymentAttempts({ api, rpcUrls: ['https://rpc.example'], operatorWallet }),
    AggregateError,
  )
  assert.deepEqual(events, ['release:a', 'defer:a', 'release:b'])
})
