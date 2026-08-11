#!/usr/bin/env node

import { ed25519 } from '@noble/curves/ed25519'
import {
  createKeyPairSignerFromBytes,
  getBase58Decoder,
} from '@solana/kit'
import { Connection, Keypair, PublicKey } from '@solana/web3.js'
import { x402Client } from '@x402/core/client'
import { decodePaymentResponseHeader, wrapFetchWithPayment } from '@x402/fetch'
import { ExactSvmScheme } from '@x402/svm/exact/client'
import { randomUUID } from 'node:crypto'
import {
  chmodSync,
  existsSync,
  lstatSync,
  mkdirSync,
  readFileSync,
  renameSync,
  writeFileSync,
} from 'node:fs'
import { tmpdir } from 'node:os'
import { basename, join, resolve, sep } from 'node:path'

import { withSufficientSvmComputeBudget } from '../src/lib/svmComputeBudget.ts'

const DEVNET = 'solana:EtWTRABZaYq6iMfeYKouRu166VU2xqa1'
const DEVNET_USDC = '4zMMC9srt5Ri5X14GAgXhaHii3GnPAEERYPJgZJDncDU'
const DEFAULT_API = 'https://obolus-api-amjeodet3q-du.a.run.app'
const DEFAULT_GATEWAY = 'https://obolus-gateway-amjeodet3q-du.a.run.app'
const WALLET_FILE = 'wallets.json'
const RUN_FILE = 'finalist-run.json'
const base58 = getBase58Decoder()
const args = parseArgs(process.argv.slice(2))
const stateDir = safeStateDirectory(args.stateDir)
const statePath = join(stateDir, WALLET_FILE)

if (args.command === 'prepare') {
  const state = loadOrCreateWallets(statePath)
  const buyer = keypair(state.buyerSecret)
  const connection = new Connection(args.rpcPrimary, 'confirmed')
  const balance = await tokenBalance(connection, buyer.publicKey)
  console.log(JSON.stringify({
    status: balance > 0n ? 'funded' : 'funding-required',
    network: DEVNET,
    mint: DEVNET_USDC,
    buyer: buyer.publicKey.toBase58(),
    currentAtomic: balance.toString(),
    stateDirectory: stateDir,
    secretPersistedOutsideRepository: true,
  }, null, 2))
  process.exit(0)
}

const contribution = loadContribution(args.contributionFile, stateDir)
const rpcUrls = independentRpcUrls(process.env.OPENSHELF_FINALIST_RPC_URLS)
const state = loadOrCreateWallets(statePath)
state.runNonce ??= randomUUID()
persistState(statePath, state)
const buyer = keypair(state.buyerSecret)
const contributor = keypair(state.contributorSecret)
const api = args.apiOrigin
const gateway = args.gatewayOrigin
const connection = new Connection(rpcUrls[0], 'confirmed')
const buyerBalance = await tokenBalance(connection, buyer.publicKey)
if (buyerBalance === 0n) {
  stop(`buyer ${buyer.publicKey.toBase58()} needs Circle Solana Devnet USDC before --run`)
}

const buyerSession = await walletSession(api, buyer)
const callInput = {
  question: contribution.question,
  unitPrice: contribution.unitPrice,
  target: contribution.target,
  chatId: `finalist-${buyer.publicKey.toBase58().slice(0, 10)}-${state.runNonce}`,
  shelf: contribution.shelf,
  category: contribution.category,
  filters: contribution.filters,
}
let quote = await apiJson(`${api}/api/v1/open-call-funding-quotes`, {
  method: 'POST',
  cookie: buyerSession.cookie,
  body: callInput,
})
if (quote.network !== DEVNET || quote.asset !== DEVNET_USDC) {
  stop('hosted funding quote is not exact Solana Devnet USDC')
}
if (BigInt(quote.amountAtomic) > buyerBalance) {
  stop(`buyer balance ${buyerBalance} is below exact quote ${quote.amountAtomic}`)
}

let fundingSignature = state.fundingSignature ?? null
if (quote.status === 'quoted' && state.fundingAttemptQuoteId !== quote.id) {
  let paymentMayHaveLeft = false
  try {
    fundingSignature = await payExactQuote({
      gateway,
      quote,
      payer: buyer,
      onReadyToSubmit() {
        paymentMayHaveLeft = true
        Object.assign(state, {
          fundingAttemptQuoteId: quote.id,
          fundingAttemptedAt: Date.now(),
        })
        persistState(statePath, state)
      },
    })
    Object.assign(state, { fundingSignature, quoteId: quote.id })
    persistState(statePath, state)
  } catch (error) {
    if (!paymentMayHaveLeft) throw error
    console.error(
      `funding response is uncertain for ${quote.id}; reconciling the durable quote without another payment`,
    )
  }
} else if (quote.status === 'quoted') {
  console.error(
    `funding attempt for ${quote.id} is already durable; reconciling without another payment`,
  )
}
quote = await poll(async () => {
  const current = await apiJson(`${api}/api/v1/open-call-funding-quotes/${encodeURIComponent(quote.id)}`, {
    cookie: buyerSession.cookie,
  })
  return current.status === 'funded' && current.openCallId ? current : null
}, 90_000, 'funded open call')
if (!fundingSignature && quote.openCallId) {
  const calls = await apiJson(`${api}/api/v1/open-calls`, { cookie: buyerSession.cookie })
  const fundedCall = Array.isArray(calls)
    ? calls.find((call) => call.id === quote.openCallId)
    : null
  fundingSignature = fundedCall?.fundingTransactionSignature ?? null
}
if (!fundingSignature) stop('funded open call is missing its x402 funding receipt')
const openCallId = quote.openCallId
Object.assign(state, { fundingSignature, quoteId: quote.id, openCallId })
persistState(statePath, state)

const contributorSession = await walletSession(api, contributor)
const handle = `finalist_${contributor.publicKey.toBase58().slice(0, 10).toLowerCase()}`
const profile = await apiJson(`${api}/api/v1/profile`, {
  method: 'POST',
  cookie: contributorSession.cookie,
  body: {
    handle,
    ...contribution.profile,
    wallet: contributor.publicKey.toBase58(),
    autoMatch: true,
    agents: false,
    browserAlerts: false,
    emailAlerts: false,
  },
})
if (!profile.walletVerified || profile.wallet !== contributor.publicKey.toBase58()) {
  stop('wallet-native contributor payout identity was not verified')
}

let contributorClaims = await payoutClaims(api, contributorSession.cookie, openCallId)
let payout = contributorClaims.find((claim) => claim.kind === 'open_call_answer')
if (!payout) {
  await apiJson(`${api}/api/v1/open-calls/${encodeURIComponent(openCallId)}/reservation`, {
    method: 'POST',
    cookie: contributorSession.cookie,
  }).catch((error) => {
    if (!String(error.message).includes('409')) throw error
  })
  const submission = await apiJson(`${api}/api/v1/open-calls/${encodeURIComponent(openCallId)}/answers`, {
    method: 'POST',
    cookie: contributorSession.cookie,
    body: {
      answer: contribution.answer,
      interviewResponses: contribution.interviewResponses,
    },
  })
  if (submission.issues?.length || submission.memory?.status !== 'settled') {
    stop('hosted contributor answer did not become a settled human document')
  }
}

payout = await poll(async () => {
  contributorClaims = await payoutClaims(api, contributorSession.cookie, openCallId)
  return contributorClaims.find((claim) =>
    claim.kind === 'open_call_answer' && claim.status === 'confirmed' && claim.transactionSignature
  ) ?? null
}, 180_000, 'confirmed contributor payout')

let buyerClaims = await payoutClaims(api, buyerSession.cookie, openCallId)
let refund = buyerClaims.find((claim) => claim.kind === 'open_call_refund')
if (!refund) {
  await apiJson(`${api}/api/v1/open-calls/${encodeURIComponent(openCallId)}`, {
    method: 'DELETE',
    cookie: buyerSession.cookie,
  })
}

let retryBlocked = false
try {
  await apiJson(`${api}/api/v1/open-calls/${encodeURIComponent(openCallId)}`, {
    method: 'DELETE',
    cookie: buyerSession.cookie,
  })
} catch (error) {
  retryBlocked = String(error.message).includes('409')
}
if (!retryBlocked) stop('repeated cancellation did not stop before a second refund')

refund = await poll(async () => {
  buyerClaims = await payoutClaims(api, buyerSession.cookie, openCallId)
  return buyerClaims.find((claim) =>
    claim.kind === 'open_call_refund' && claim.status === 'confirmed' && claim.transactionSignature
  ) ?? null
}, 180_000, 'confirmed unused escrow refund')

contributorClaims = await payoutClaims(api, contributorSession.cookie, openCallId)
buyerClaims = await payoutClaims(api, buyerSession.cookie, openCallId)
const payoutsForCall = contributorClaims.filter((claim) => claim.kind === 'open_call_answer')
const refundsForCall = buyerClaims.filter((claim) => claim.kind === 'open_call_refund')
if (payoutsForCall.length !== 1 || refundsForCall.length !== 1) {
  stop(`expected one payout and one refund, found ${payoutsForCall.length}/${refundsForCall.length}`)
}

const fundingFinality = await finalizedOnAll(rpcUrls, fundingSignature)
const payoutFinality = await finalizedOnAll(rpcUrls, payout.transactionSignature)
const refundFinality = await finalizedOnAll(rpcUrls, refund.transactionSignature)
const fundingEscrowDelta = ownerTokenDelta(
  fundingFinality[0].meta,
  quote.payTo,
  DEVNET_USDC,
)
const fundingBuyerDelta = ownerTokenDelta(
  fundingFinality[0].meta,
  buyer.publicKey.toBase58(),
  DEVNET_USDC,
)
const payoutOwnerDelta = ownerTokenDelta(
  payoutFinality[0].meta,
  contributor.publicKey.toBase58(),
  DEVNET_USDC,
)
const payoutEscrowDelta = ownerTokenDelta(payoutFinality[0].meta, payout.escrowWallet, DEVNET_USDC)
const refundOwnerDelta = ownerTokenDelta(
  refundFinality[0].meta,
  buyer.publicKey.toBase58(),
  DEVNET_USDC,
)
if (payoutOwnerDelta !== BigInt(payout.amountAtomic) || payoutEscrowDelta !== -BigInt(payout.amountAtomic)) {
  stop('contributor payout token deltas do not match the durable claim')
}
if (fundingEscrowDelta !== BigInt(quote.amountAtomic) || fundingBuyerDelta !== -BigInt(quote.amountAtomic)) {
  stop('buyer x402 funding token deltas do not match the exact quote')
}
if (refundOwnerDelta !== BigInt(refund.amountAtomic)) {
  stop('buyer refund token delta does not match the durable claim')
}

const run = {
  runId: `hosted-devnet-${Date.now()}`,
  network: DEVNET,
  activityKind: 'open_call_lifecycle',
  activityId: openCallId,
  activityStatus: 'cancelled_refunded',
  quotes: [{
    id: quote.id,
    kind: 'open-call-funding',
    status: 'funded',
    amountAtomic: quote.amountAtomic,
    asset: quote.asset,
  }, {
    id: payout.id,
    kind: 'open-call-payout',
    status: 'delivered',
    amountAtomic: payout.amountAtomic,
    asset: payout.asset,
  }],
  transactions: [{
    kind: 'open-call-funding',
    signature: fundingSignature,
    quoteIds: [quote.id],
    status: 'finalized',
    finalityProviderCount: fundingFinality.length,
    ownerDeltaAtomic: fundingEscrowDelta.toString(),
    payerDeltaAtomic: fundingBuyerDelta.toString(),
  }, {
    kind: 'open-call-payout',
    signature: payout.transactionSignature,
    quoteIds: [payout.id],
    status: 'finalized',
    finalityProviderCount: payoutFinality.length,
    ownerDeltaAtomic: payoutOwnerDelta.toString(),
    payerDeltaAtomic: payoutEscrowDelta.toString(),
  }],
  duplicateProtection: {
    retryAttempts: 1,
    duplicateSettlementCount: 0,
  },
  refund: {
    claimId: refund.id,
    status: 'finalized',
    amountAtomic: refund.amountAtomic,
    signature: refund.transactionSignature,
    finalityProviderCount: refundFinality.length,
  },
}
writePrivateJson(join(stateDir, RUN_FILE), run)
Object.assign(state, {
  fundingSignature,
  quoteId: quote.id,
  openCallId,
  payoutClaimId: payout.id,
  refundClaimId: refund.id,
  completedAt: Date.now(),
})
persistState(statePath, state)

console.log(JSON.stringify({
  status: 'ready-for-evidence-recorder',
  network: DEVNET,
  runId: run.runId,
  activityKind: run.activityKind,
  activityId: run.activityId,
  payoutClaimId: payout.id,
  payoutSignature: payout.transactionSignature,
  refundClaimId: refund.id,
  refundSignature: refund.transactionSignature,
  finalityProviderCount: rpcUrls.length,
  duplicateSettlementCount: 0,
  runFile: join(stateDir, RUN_FILE),
}, null, 2))

function parseArgs(values) {
  const result = {
    command: null,
    stateDir: null,
    apiOrigin: DEFAULT_API,
    gatewayOrigin: DEFAULT_GATEWAY,
    rpcPrimary: 'https://api.devnet.solana.com',
    contributionFile: null,
  }
  for (let index = 0; index < values.length; index += 1) {
    const value = values[index]
    if (value === '--prepare') result.command = 'prepare'
    else if (value === '--run') result.command = 'run'
    else if (value === '--state-dir') result.stateDir = required(values, ++index, value)
    else if (value === '--api-origin') result.apiOrigin = origin(required(values, ++index, value))
    else if (value === '--gateway-origin') result.gatewayOrigin = origin(required(values, ++index, value))
    else if (value === '--rpc-primary') result.rpcPrimary = required(values, ++index, value)
    else if (value === '--contribution-file') result.contributionFile = required(values, ++index, value)
    else stop(`unknown argument: ${value}`)
  }
  if (!['prepare', 'run'].includes(result.command)) stop('choose exactly one of --prepare or --run')
  if (!result.stateDir) stop('--state-dir is required')
  if (result.command === 'run' && !result.contributionFile) {
    stop('--contribution-file is required for --run; its attestations are operator declarations, not cryptographic authorship proof')
  }
  return result
}

function required(values, index, flag) {
  if (!values[index]) stop(`${flag} requires a value`)
  return values[index]
}

function origin(value) {
  const parsed = new URL(value)
  if (parsed.protocol !== 'https:' && !['127.0.0.1', 'localhost'].includes(parsed.hostname)) {
    stop('service origins must use HTTPS')
  }
  return parsed.origin
}

function safeStateDirectory(value) {
  const directory = resolve(value)
  const temporaryRoot = resolve(tmpdir())
  if (directory === temporaryRoot || !directory.startsWith(`${temporaryRoot}${sep}`)) {
    stop(`state directory must be a dedicated child of ${temporaryRoot}`)
  }
  if (basename(directory).length < 8) stop('state directory name is too broad')
  if (existsSync(directory) && lstatSync(directory).isSymbolicLink()) {
    stop('state directory must not be a symbolic link')
  }
  mkdirSync(directory, { recursive: true, mode: 0o700 })
  chmodSync(directory, 0o700)
  return directory
}

function loadContribution(value, stateDirectory) {
  const path = resolve(value)
  if (!path.startsWith(`${stateDirectory}${sep}`)) {
    stop('contribution file must be inside the dedicated state directory')
  }
  if (!existsSync(path)) stop('contribution file does not exist')
  const metadata = lstatSync(path)
  if (metadata.isSymbolicLink() || !metadata.isFile()) {
    stop('contribution file must be a regular file, not a link')
  }
  if ((metadata.mode & 0o077) !== 0) stop('contribution file permissions must be 0600')
  if (metadata.size <= 0 || metadata.size > 64 * 1024) {
    stop('contribution file must be between 1 byte and 64 KiB')
  }
  let contribution
  try {
    contribution = JSON.parse(readFileSync(path, 'utf8'))
  } catch {
    stop('contribution file must contain valid JSON')
  }
  const categories = new Set(['life', 'food', 'family', 'health', 'business', 'sales', 'engineering', 'education', 'sports', 'travel', 'money'])
  const ageBands = new Set(['under-25', '25-34', '35-44', '45-54', '55-plus'])
  const regions = new Set(['seoul', 'gyeonggi', 'metro', 'town', 'abroad'])
  const households = new Set(['alone', 'partner', 'kids', 'parents', 'shared'])
  const yearBands = new Set(['under-1', '1-3', '3-7', '7-plus'])
  const text = (field, minimum, maximum) => {
    const candidate = String(contribution[field] ?? '').trim()
    if (candidate.length < minimum || candidate.length > maximum) {
      stop(`contribution ${field} must be ${minimum}-${maximum} characters`)
    }
    return candidate
  }
  const question = text('question', 8, 1_000)
  const shelf = text('shelf', 3, 120)
  const answer = text('answer', 80, 10_000)
  const category = String(contribution.category ?? '')
  if (!categories.has(category)) stop('contribution category is unsupported')
  const unitPrice = Number(contribution.unitPrice)
  if (![5, 10, 15, 25, 100, 300, 500, 700, 800, 1_000].includes(unitPrice)) {
    stop('contribution unitPrice must use a hosted Pay.sh price band')
  }
  const target = Number(contribution.target)
  if (!Number.isInteger(target) || target < 2 || target > 20) {
    stop('contribution target must be an integer from 2 to 20 so the run can prove payout and refund')
  }
  if (contribution.authorAttestation !== true || contribution.usageConsent !== true) {
    stop('the human author must attest factual authorship and consent to demo storage and paid opening')
  }
  const profile = contribution.profile
  if (!profile || typeof profile !== 'object' || Array.isArray(profile)) {
    stop('contribution profile is required')
  }
  for (const field of ['ageBand', 'region', 'household', 'field', 'years']) {
    if (typeof profile[field] !== 'string' || !profile[field].trim()) {
      stop(`contribution profile.${field} is required`)
    }
  }
  if (!Array.isArray(profile.speaksTo) || !profile.speaksTo.includes(category)) {
    stop('contribution profile.speaksTo must include the call category')
  }
  if (!ageBands.has(profile.ageBand)
    || !regions.has(profile.region)
    || !households.has(profile.household)
    || !categories.has(profile.field)
    || !yearBands.has(profile.years)
    || new Set(profile.speaksTo).size !== profile.speaksTo.length
    || profile.speaksTo.some((field) => !categories.has(field))) {
    stop('contribution profile contains an unsupported demographic band or field')
  }
  const filters = contribution.filters ?? { field: category }
  if (!filters || typeof filters !== 'object' || Array.isArray(filters)
    || (filters.ageBand !== undefined && !ageBands.has(filters.ageBand))
    || (filters.region !== undefined && !regions.has(filters.region))
    || (filters.household !== undefined && !households.has(filters.household))
    || (filters.field !== undefined && !categories.has(filters.field))
    || (filters.category !== undefined && !categories.has(filters.category))
    || (filters.maxUnitPriceKrw !== undefined
      && (!Number.isSafeInteger(filters.maxUnitPriceKrw) || filters.maxUnitPriceKrw < 0 || filters.maxUnitPriceKrw > 10_000_000))) {
    stop('contribution filters contain an unsupported value')
  }
  const interviewResponses = contribution.interviewResponses
  if (!Array.isArray(interviewResponses) || !(1 <= interviewResponses.length && interviewResponses.length <= 4)) {
    stop('contribution interviewResponses must contain 1-4 factual answers')
  }
  for (const response of interviewResponses) {
    if (!response || typeof response !== 'object'
      || !String(response.questionId ?? '').trim()
      || !String(response.prompt ?? '').trim()
      || !String(response.answer ?? '').trim()) {
      stop('each contribution interview response requires questionId, prompt, and answer')
    }
  }
  return {
    question,
    shelf,
    answer,
    category,
    unitPrice,
    target,
    filters,
    profile,
    interviewResponses,
  }
}

function loadOrCreateWallets(path) {
  if (existsSync(path)) {
    if (lstatSync(path).isSymbolicLink()) stop('wallet state must not be a symbolic link')
    const value = JSON.parse(readFileSync(path, 'utf8'))
    keypair(value.buyerSecret)
    keypair(value.contributorSecret)
    return value
  }
  const value = {
    buyerSecret: [...Keypair.generate().secretKey],
    contributorSecret: [...Keypair.generate().secretKey],
    createdAt: Date.now(),
  }
  writePrivateJson(path, value)
  return value
}

function keypair(bytes) {
  if (!Array.isArray(bytes) || bytes.length !== 64) stop('wallet state contains an invalid keypair')
  return Keypair.fromSecretKey(Uint8Array.from(bytes))
}

function persistState(path, value) {
  writePrivateJson(path, value)
}

function writePrivateJson(path, value) {
  const temporary = `${path}.${process.pid}.tmp`
  writeFileSync(temporary, `${JSON.stringify(value, null, 2)}\n`, { mode: 0o600, flag: 'wx' })
  renameSync(temporary, path)
  chmodSync(path, 0o600)
}

async function walletSession(apiOrigin, walletKeypair) {
  const wallet = walletKeypair.publicKey.toBase58()
  const challenge = await apiJson(`${apiOrigin}/api/v1/auth/wallet/challenge`, {
    method: 'POST',
    body: { wallet },
  })
  const signature = base58.decode(
    ed25519.sign(new TextEncoder().encode(challenge.message), walletKeypair.secretKey.slice(0, 32)),
  )
  const response = await fetch(`${apiOrigin}/api/v1/auth/wallet/verify`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      wallet,
      challengeId: challenge.id,
      signature,
      ageConfirmed14: true,
    }),
  })
  if (!response.ok) throw await responseError(response)
  const setCookie = response.headers.get('set-cookie')
  const cookie = setCookie?.split(';', 1)[0]
  if (!cookie) stop('wallet verification did not issue a session cookie')
  return { wallet, cookie }
}

async function apiJson(url, { method = 'GET', cookie, body } = {}) {
  const headers = { accept: 'application/json' }
  if (cookie) headers.cookie = cookie
  if (body !== undefined) headers['content-type'] = 'application/json'
  const response = await fetch(url, {
    method,
    headers,
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  })
  if (!response.ok) throw await responseError(response)
  if (response.status === 204) return null
  return response.json()
}

async function responseError(response) {
  const text = (await response.text()).slice(0, 1_000)
  return new Error(`HTTP ${response.status}: ${text}`)
}

async function payExactQuote({ gateway, quote, payer, onReadyToSubmit }) {
  const resourceUrl = `${gateway}${quote.resourcePath}`
  const challenge = await fetch(resourceUrl, { headers: { accept: 'application/json' } })
  if (challenge.status !== 402) throw new Error(`expected x402 challenge, received ${challenge.status}`)
  const signer = withSufficientSvmComputeBudget(
    await createKeyPairSignerFromBytes(payer.secretKey),
  )
  const client = new x402Client().register(DEVNET, new ExactSvmScheme(signer))
  const memo = `openshelf:v1:open_call:${quote.id}`
  client.registerPolicy((_version, requirements) => requirements.filter((requirement) =>
    requirement.scheme === 'exact'
      && requirement.network === quote.network
      && requirement.asset === quote.asset
      && requirement.payTo === quote.payTo
      && BigInt(requirement.amount) === BigInt(quote.amountAtomic)
      && Number.isSafeInteger(requirement.maxTimeoutSeconds)
      && requirement.maxTimeoutSeconds > 0
      && requirement.maxTimeoutSeconds <= 60
      && requirement.extra?.memo === memo
  ))
  onReadyToSubmit()
  const paid = await wrapFetchWithPayment(fetch, client)(resourceUrl, {
    method: 'GET',
    headers: { accept: 'application/json' },
  })
  const encoded = paid.headers.get('PAYMENT-RESPONSE')
  if (encoded) {
    const receipt = decodePaymentResponseHeader(encoded)
    if (receipt.success && receipt.transaction) return receipt.transaction
  }
  if (!paid.ok) {
    const receipt = encoded ? decodePaymentResponseHeader(encoded) : null
    const detail = receipt?.errorReason ?? receipt?.errorMessage ?? 'no settlement reason'
    throw new Error(`x402 funding failed with HTTP ${paid.status}: ${detail}`)
  }
  if (!encoded) stop('funded response omitted the x402 payment receipt')
  const receipt = decodePaymentResponseHeader(encoded)
  if (!receipt.success || !receipt.transaction) stop('x402 funding receipt was not successful')
  return receipt.transaction
}

async function payoutClaims(apiOrigin, cookie, openCallId) {
  const claims = await apiJson(`${apiOrigin}/api/v1/payout-claims`, { cookie })
  return claims.filter((claim) => claim.openCallId === openCallId)
}

async function poll(task, timeoutMs, label) {
  const deadline = Date.now() + timeoutMs
  let lastError
  while (Date.now() < deadline) {
    try {
      const value = await task()
      if (value) return value
    } catch (error) {
      lastError = error
    }
    await delay(1_500)
  }
  throw new Error(`${label} did not converge${lastError ? `: ${lastError.message}` : ''}`)
}

function parseRpcValues(value) {
  const text = String(value ?? '').trim()
  if (!text) stop('OPENSHELF_FINALIST_RPC_URLS is required for two-provider finality')
  if (text.startsWith('[')) {
    const parsed = JSON.parse(text)
    if (!Array.isArray(parsed)) stop('RPC URL JSON must be an array')
    return parsed
  }
  return text.split(/[\n,]/)
}

function independentRpcUrls(value) {
  const byOrigin = new Map()
  for (const candidate of parseRpcValues(value)) {
    const url = new URL(String(candidate).trim())
    if (url.protocol !== 'https:') stop('finality RPC URLs must use HTTPS')
    if (!byOrigin.has(url.origin)) byOrigin.set(url.origin, url.toString())
  }
  if (byOrigin.size < 2) stop('two independent RPC origins are required')
  return [...byOrigin.values()]
}

async function finalizedOnAll(rpcUrls, transactionSignature) {
  return poll(async () => {
    const transactions = await Promise.all(rpcUrls.map((rpcUrl) => rpcTransaction(rpcUrl, transactionSignature)))
    if (transactions.some((transaction) => !transaction)) return null
    if (transactions.some((transaction) => transaction.meta?.err)) {
      stop(`transaction ${transactionSignature} failed on chain`)
    }
    const signatures = transactions.map((transaction) => transaction.transaction.signatures[0])
    if (signatures.some((signature) => signature !== transactionSignature)) {
      stop('independent RPCs returned a different transaction signature')
    }
    return transactions
  }, 120_000, `two-provider finalized transaction ${transactionSignature}`)
}

async function rpcTransaction(rpcUrl, transactionSignature) {
  const response = await fetch(rpcUrl, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      jsonrpc: '2.0',
      id: 1,
      method: 'getTransaction',
      params: [transactionSignature, {
        commitment: 'finalized',
        encoding: 'jsonParsed',
        maxSupportedTransactionVersion: 0,
      }],
    }),
    signal: AbortSignal.timeout(10_000),
  })
  if (!response.ok) throw new Error(`RPC returned HTTP ${response.status}`)
  const payload = await response.json()
  if (payload.error) throw new Error(`RPC rejected getTransaction (${payload.error.code})`)
  return payload.result
}

function ownerTokenDelta(meta, owner, mint) {
  const total = (balances) => (balances ?? [])
    .filter((balance) => balance.owner === owner && balance.mint === mint)
    .reduce((sum, balance) => sum + BigInt(balance.uiTokenAmount.amount), 0n)
  return total(meta.postTokenBalances) - total(meta.preTokenBalances)
}

async function tokenBalance(connectionValue, owner) {
  const accounts = await connectionValue.getParsedTokenAccountsByOwner(owner, {
    mint: new PublicKey(DEVNET_USDC),
  })
  return accounts.value.reduce(
    (sum, account) => sum + BigInt(account.account.data.parsed.info.tokenAmount.amount),
    0n,
  )
}

function delay(milliseconds) {
  return new Promise((resolveValue) => setTimeout(resolveValue, milliseconds))
}

function stop(message) {
  console.error(message)
  process.exit(2)
}
