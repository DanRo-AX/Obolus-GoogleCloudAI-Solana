import { createKeyPairSignerFromBytes } from '@solana/kit'
import { Connection, Keypair, PublicKey } from '@solana/web3.js'
import { x402Client } from '@x402/core/client'
import type { Network } from '@x402/core/types'
import { decodePaymentResponseHeader, wrapFetchWithPayment } from '@x402/fetch'
import { ExactSvmScheme } from '@x402/svm/exact/client'

import { withSufficientSvmComputeBudget } from '../src/lib/svmComputeBudget.ts'

const DEVNET = 'solana:EtWTRABZaYq6iMfeYKouRu166VU2xqa1' as Network
const DEVNET_RPC = process.env.X402_RPC_URL?.trim() || 'https://api.devnet.solana.com'
const DEVNET_USDC = '4zMMC9srt5Ri5X14GAgXhaHii3GnPAEERYPJgZJDncDU'
const MAX_PAYMENT_ATOMIC = BigInt(process.env.MAX_PAYMENT_ATOMIC?.trim() || '1000000')
const WAIT_FOR_FUNDS = process.env.WAIT_FOR_FUNDS === 'true'
const resourceUrl = required('PAID_RESOURCE_URL')

const secret = process.env.SVM_PRIVATE_KEY?.trim()
const keypair = secret
  ? Keypair.fromSecretKey(Uint8Array.from(JSON.parse(secret) as number[]))
  : Keypair.generate()
const payer = keypair.publicKey.toBase58()
const connection = new Connection(DEVNET_RPC, 'confirmed')

console.log(JSON.stringify({ event: 'wallet_ready', payer, secretPersisted: false }))

const challenge = await fetch(resourceUrl, { headers: { accept: 'application/json' } })
if (challenge.status !== 402) {
  throw new Error(`expected an unpaid 402 challenge, received ${challenge.status}`)
}
const challengeBody = (await challenge.json()) as {
  quote?: {
    payTo?: string
    asset?: string
    amountAtomic?: string
    network?: string
    id?: string
  }
}
const quote = challengeBody.quote
if (!quote?.payTo || !quote.asset || !quote.amountAtomic || !quote.network) {
  throw new Error('402 body did not contain a complete OPENSHELF quote')
}
if (quote.network !== DEVNET) throw new Error(`expected Devnet quote, received ${quote.network}`)
if (quote.asset !== DEVNET_USDC) {
  throw new Error(`expected Circle Devnet USDC, received ${quote.asset}`)
}
const amount = BigInt(quote.amountAtomic)
if (amount > MAX_PAYMENT_ATOMIC) {
  throw new Error(`quote ${amount} exceeds client cap ${MAX_PAYMENT_ATOMIC}`)
}

let balance = await tokenBalance(connection, keypair.publicKey, new PublicKey(DEVNET_USDC))
while (balance < amount) {
  console.log(
    JSON.stringify({
      event: 'funding_required',
      payer,
      mint: DEVNET_USDC,
      requiredAtomic: amount.toString(),
      currentAtomic: balance.toString(),
    }),
  )
  if (!WAIT_FOR_FUNDS) process.exit(2)
  await delay(10_000)
  balance = await tokenBalance(connection, keypair.publicKey, new PublicKey(DEVNET_USDC))
}

const signer = withSufficientSvmComputeBudget(
  await createKeyPairSignerFromBytes(keypair.secretKey),
)
const client = new x402Client().register(DEVNET, new ExactSvmScheme(signer))
client.registerPolicy((_version, requirements) =>
  requirements.filter(
    (requirement) =>
      requirement.network === DEVNET &&
      requirement.asset === DEVNET_USDC &&
      BigInt(requirement.amount) <= MAX_PAYMENT_ATOMIC,
  ),
)

const paidFetch = wrapFetchWithPayment(fetch, client)
const response = await paidFetch(resourceUrl, {
  method: 'GET',
  headers: { accept: 'application/json' },
})
const responseText = await response.text()
if (!response.ok) throw new Error(`paid request failed (${response.status}): ${responseText}`)

const paymentResponse = response.headers.get('PAYMENT-RESPONSE')
if (!paymentResponse) throw new Error('paid response did not contain PAYMENT-RESPONSE')
const receipt = decodePaymentResponseHeader(paymentResponse)
if (!receipt.success || !receipt.transaction) {
  throw new Error('facilitator receipt was unsuccessful')
}

const transaction = await confirmedTransaction(connection, receipt.transaction)
if (transaction.meta?.err) {
  throw new Error(`Devnet transaction failed: ${JSON.stringify(transaction.meta.err)}`)
}
const payerDelta = ownerTokenDelta(transaction.meta, payer, DEVNET_USDC)
const recipientDelta = ownerTokenDelta(transaction.meta, quote.payTo, DEVNET_USDC)
if (payerDelta !== -amount || recipientDelta !== amount) {
  throw new Error(
    `unexpected USDC deltas: payer=${payerDelta}, recipient=${recipientDelta}, expected=${amount}`,
  )
}

console.log(
  JSON.stringify(
    {
      event: 'devnet_settlement_verified',
      quoteId: quote.id,
      payer,
      recipient: quote.payTo,
      mint: quote.asset,
      amountAtomic: amount.toString(),
      transactionSignature: receipt.transaction,
      payerDeltaAtomic: payerDelta.toString(),
      recipientDeltaAtomic: recipientDelta.toString(),
      response: JSON.parse(responseText),
    },
    null,
    2,
  ),
)

function required(name: string): string {
  const value = process.env[name]?.trim()
  if (!value) throw new Error(`${name} is required`)
  return value
}

async function tokenBalance(connection: Connection, owner: PublicKey, mint: PublicKey) {
  const accounts = await connection.getParsedTokenAccountsByOwner(owner, { mint })
  return accounts.value.reduce(
    (sum, account) =>
      sum + BigInt(account.account.data.parsed.info.tokenAmount.amount as string),
    0n,
  )
}

async function confirmedTransaction(connection: Connection, signature: string) {
  for (let attempt = 0; attempt < 20; attempt += 1) {
    const transaction = await connection.getTransaction(signature, {
      commitment: 'confirmed',
      maxSupportedTransactionVersion: 0,
    })
    if (transaction) return transaction
    await delay(1_000)
  }
  throw new Error(`Devnet transaction ${signature} was not available after confirmation`)
}

function ownerTokenDelta(
  meta: NonNullable<Awaited<ReturnType<Connection['getTransaction']>>>['meta'],
  owner: string,
  mint: string,
) {
  const total = (balances: typeof meta.preTokenBalances) =>
    (balances ?? [])
      .filter((balance) => balance.owner === owner && balance.mint === mint)
      .reduce((sum, balance) => sum + BigInt(balance.uiTokenAmount.amount), 0n)
  return total(meta.postTokenBalances) - total(meta.preTokenBalances)
}

function delay(milliseconds: number) {
  return new Promise<void>((resolve) => setTimeout(resolve, milliseconds))
}
