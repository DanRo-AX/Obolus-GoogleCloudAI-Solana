import assert from 'node:assert/strict'
import test from 'node:test'
import { Keypair } from '@solana/web3.js'
import {
  buildAcknowledgeDeliveryInstruction,
  buildCreateAndFundInstruction,
  buildResolveDisputeInstruction,
  buildSettleInstruction,
  deriveInvoicePda,
  validateOnchainInvoice,
  type CreateOnchainInvoiceArgs,
} from './obulusSettlementProgram.ts'

const keys = Array.from({ length: 10 }, () => Keypair.generate().publicKey.toBase58())

function invoice(): CreateOnchainInvoiceArgs {
  return {
    invoiceHash: '11'.repeat(32),
    queryHash: '22'.repeat(32),
    bundleRoot: '33'.repeat(32),
    authorization: keys[2],
    disputeResolver: keys[8],
    totalAmountAtomic: '100',
    platformFeeAtomic: '10',
    expiresAtUnixSeconds: 2_000_000_000,
    disputeWindowSeconds: 300,
    lineItems: [
      {
        recipientTokenAccount: keys[6],
        documentHash: 'aa'.repeat(32),
        documentVersion: 3,
        amountAtomic: '90',
        kind: 0,
      },
      {
        recipientTokenAccount: keys[7],
        documentHash: 'ff'.repeat(32),
        documentVersion: 1,
        amountAtomic: '10',
        kind: 1,
      },
    ],
  }
}

test('buyer signature and order-specific PDA are mandatory for escrow funding', () => {
  const args = invoice()
  const instruction = buildCreateAndFundInstruction(args, {
    programId: keys[0], payer: keys[1], payerTokenAccount: keys[3],
    escrowTokenAccount: keys[4], refundTokenAccount: keys[5], mint: keys[9],
  })
  const derived = deriveInvoicePda(keys[0], keys[1], args.invoiceHash)
  assert.equal(instruction.keys[0].pubkey.toBase58(), keys[1])
  assert.equal(instruction.keys[0].isSigner, true)
  assert.equal(instruction.keys[1].pubkey.toBase58(), derived.address)
  assert.equal(instruction.keys[1].isSigner, false)
  assert.equal(instruction.data[0], 0)
  assert.equal(instruction.data.length, 1 + 32 * 5 + 8 * 3 + 4 + 4 + 77 * 2)
  assert.deepEqual(
    instruction.keys.slice(8).map((key) => key.pubkey.toBase58()),
    [keys[6], keys[7]],
  )
  assert.notEqual(
    derived.address,
    deriveInvoicePda(keys[0], keys[1], '44'.repeat(32)).address,
  )
})

test('delivery needs the precommitted authorization but settlement needs no developer key', () => {
  const acknowledgement = buildAcknowledgeDeliveryInstruction(
    keys[0], keys[2], keys[3], '55'.repeat(32),
  )
  assert.equal(acknowledgement.keys[0].pubkey.toBase58(), keys[2])
  assert.equal(acknowledgement.keys[0].isSigner, true)
  const settlement = buildSettleInstruction(keys[0], keys[3], keys[4], keys[9], [keys[6], keys[7]])
  assert.equal(settlement.keys.some((key) => key.isSigner), false)
  assert.deepEqual(
    settlement.keys.slice(4).map((key) => key.pubkey.toBase58()),
    [keys[6], keys[7]],
  )
  const resolution = buildResolveDisputeInstruction(keys[0], keys[8], keys[3], true)
  assert.equal(resolution.keys[0].pubkey.toBase58(), keys[8])
  assert.equal(resolution.keys[0].isSigner, true)
  assert.deepEqual([...resolution.data], [4, 1])
})

test('a changed recipient, fee or line-item sum is rejected before wallet approval', () => {
  const changedFee = invoice()
  changedFee.platformFeeAtomic = '11'
  assert.throws(() => validateOnchainInvoice(changedFee), /fee policy|balance/)

  const missingPayout = invoice()
  missingPayout.lineItems[0].amountAtomic = '89'
  assert.throws(() => validateOnchainInvoice(missingPayout), /do not balance/)

  const duplicate = invoice()
  duplicate.lineItems.push({ ...duplicate.lineItems[0] })
  duplicate.totalAmountAtomic = '190'
  assert.throws(() => validateOnchainInvoice(duplicate), /duplicate payout/)

  const unsafeWindow = invoice()
  unsafeWindow.disputeWindowSeconds = 0
  assert.throws(() => validateOnchainInvoice(unsafeWindow), /dispute window/)
})
