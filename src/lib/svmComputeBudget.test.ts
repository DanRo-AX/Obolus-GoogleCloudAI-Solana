import assert from 'node:assert/strict'
import test from 'node:test'

import {
  address,
  createKeyPairSignerFromBytes,
  getTransactionDecoder,
  getTransactionEncoder,
  type Transaction,
  type TransactionModifyingSigner,
  type TransactionWithinSizeLimit,
  type TransactionWithLifetime,
} from '@solana/kit'
import {
  ComputeBudgetInstruction,
  ComputeBudgetProgram,
  Keypair,
  PublicKey,
  TransactionInstruction,
  TransactionMessage,
  VersionedTransaction,
} from '@solana/web3.js'

import {
  OPENSHELF_X402_COMPUTE_UNIT_LIMIT,
  raiseSvmComputeUnitLimit,
  withSufficientSvmComputeBudget,
} from './svmComputeBudget.ts'

const MEMO_PROGRAM = new PublicKey('MemoSq4gqABAXKb96qnH8TysNcWxMyWCqXgDLGmfcHr')

test('raises the x402 compute limit before an in-memory payer signs', async () => {
  const payer = Keypair.generate()
  const signer = await createKeyPairSignerFromBytes(payer.secretKey)
  const transaction = unsignedTransaction(payer.publicKey)

  const [signed] = await withSufficientSvmComputeBudget(signer)
    .modifyAndSignTransactions([transaction])

  assert.equal(computeUnitLimit(signed), OPENSHELF_X402_COMPUTE_UNIT_LIMIT)
  assert.ok(signed.signatures[signer.address])
})

test('raises the limit before delegating to a browser-wallet signer', async () => {
  const payer = Keypair.generate()
  const transaction = unsignedTransaction(payer.publicKey)
  let observedUnits = 0
  const browserSigner: TransactionModifyingSigner = {
    address: address(payer.publicKey.toBase58()),
    async modifyAndSignTransactions(transactions) {
      observedUnits = computeUnitLimit(transactions[0])
      return transactions as readonly (
        Transaction & TransactionWithinSizeLimit & TransactionWithLifetime
      )[]
    },
  }

  await withSufficientSvmComputeBudget(browserSigner)
    .modifyAndSignTransactions([transaction])

  assert.equal(observedUnits, OPENSHELF_X402_COMPUTE_UNIT_LIMIT)
})

test('refuses to rewrite an already signed or ambiguous transaction', () => {
  const payer = Keypair.generate()
  const transaction = unsignedTransaction(payer.publicKey)
  const signerAddress = Object.keys(transaction.signatures)[0]
  assert.ok(signerAddress)

  assert.throws(
    () => raiseSvmComputeUnitLimit({
      ...transaction,
      signatures: { ...transaction.signatures, [signerAddress]: new Uint8Array(64) },
    }),
    /before signing/,
  )

  const ambiguous = unsignedTransaction(payer.publicKey, true)
  assert.throws(() => raiseSvmComputeUnitLimit(ambiguous), /exactly one/)
})

function unsignedTransaction(payer: PublicKey, duplicateLimit = false) {
  const instructions = [
    ComputeBudgetProgram.setComputeUnitLimit({ units: 20_000 }),
    ...(duplicateLimit ? [ComputeBudgetProgram.setComputeUnitLimit({ units: 30_000 })] : []),
    ComputeBudgetProgram.setComputeUnitPrice({ microLamports: 1n }),
    new TransactionInstruction({
      programId: MEMO_PROGRAM,
      keys: [],
      data: Buffer.from('openshelf:test'),
    }),
  ]
  const message = new TransactionMessage({
    payerKey: payer,
    recentBlockhash: '11111111111111111111111111111111',
    instructions,
  }).compileToV0Message()
  const wire = new VersionedTransaction(message).serialize()
  return getTransactionDecoder().decode(wire)
}

function computeUnitLimit(transaction: Transaction) {
  const wire = getTransactionEncoder().encode(transaction)
  const decoded = VersionedTransaction.deserialize(new Uint8Array(wire))
  const keys = decoded.message.getAccountKeys().staticAccountKeys
  const instruction = decoded.message.compiledInstructions.find((candidate) =>
    keys[candidate.programIdIndex]?.equals(ComputeBudgetProgram.programId)
      && candidate.data.length === 5
      && candidate.data[0] === 2
  )
  assert.ok(instruction)
  return ComputeBudgetInstruction.decodeSetComputeUnitLimit({
    programId: ComputeBudgetProgram.programId,
    keys: [],
    data: Buffer.from(instruction.data),
  }).units
}
