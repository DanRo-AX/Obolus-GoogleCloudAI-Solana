import { base58 } from '@scure/base'
import {
  address,
  getCompiledTransactionMessageDecoder,
  getPublicKeyFromAddress,
  getTransactionDecoder,
  signatureBytes,
  verifySignature,
} from '@solana/kit'
import { findAssociatedTokenPda, TOKEN_PROGRAM_ADDRESS } from '@solana-program/token'
import { Transaction, VersionedTransaction } from '@solana/web3.js'
import { boundedResponseText } from './bounded-response.js'

const COMPUTE_BUDGET_PROGRAM = 'ComputeBudget111111111111111111111111111111'
const MAX_FEE_SPONSORED_COMPUTE_UNITS = 200_000
const MAX_FEE_SPONSORED_MICROLAMPORTS_PER_UNIT = 10_000n
const MEMO_PROGRAM = 'MemoSq4gqABAXKb96qnH8TysNcWxMyWCqXgDLGmfcHr'
const TOKEN_PROGRAM = String(TOKEN_PROGRAM_ADDRESS)
const MAX_LEDGER_ATOMIC = 9_223_372_036_854_775_807n
const RECOVERY_CLOCK_SKEW_MS = 60_000
const MAX_RPC_RESPONSE_BYTES = 1024 * 1024

export type ResearchPaymentAttempt = {
  jobId: string
  quoteId: string
  attemptId: string
  status: 'claimed' | 'prepared' | 'ambiguous'
  reconcileAfter: number
  createdAt: number
  preparedAt?: number
  payer: string
  network: string
  asset: string
  amountAtomic: string
  ownerAmountAtomic: string
  platformAmountAtomic: string
  recipientWallet: string
  platformRecipientWallet?: string
  signedTransactionBase64?: string
  recentBlockhash?: string
  challengeId?: string
  externalId?: string
  challengeExpiresAt?: number
  absenceObservedAt?: number
}

export type ResearchPaymentReconciliationApi = {
  list(limit: number): Promise<ResearchPaymentAttempt[]>
  defer(jobId: string, attemptId: string, absenceObserved?: boolean): Promise<unknown>
  settle(jobId: string, attemptId: string, transactionSignature: string): Promise<unknown>
  release(jobId: string, attemptId: string, expectedStatus: string, reason: string): Promise<unknown>
}

export type DirectPayShPaymentAttempt = Omit<ResearchPaymentAttempt, "jobId">

export type DirectPayShPaymentReconciliationApi = {
  list(limit: number): Promise<DirectPayShPaymentAttempt[]>
  defer(attemptId: string, absenceObserved?: boolean): Promise<unknown>
  settle(attemptId: string, transactionSignature: string): Promise<unknown>
  release(attemptId: string, expectedStatus: string, reason: string): Promise<unknown>
}

export type PaymentReconciliationRun = {
  degradedAttempts: string[]
}

/** Reuses the exact same finalized-chain proof rules for public direct agents. */
export async function processDirectPayShPaymentAttempts(options: {
  api: DirectPayShPaymentReconciliationApi
  rpcUrls: string[]
  /** Current deployment value is diagnostic only; each attempt uses its durable snapshot. */
  operatorWallet?: string
  fetchImpl?: typeof globalThis.fetch
  batchSize?: number
  maxSignaturePages?: number
}): Promise<PaymentReconciliationRun> {
  const adapted: ResearchPaymentReconciliationApi = {
    list: async (limit) => (await options.api.list(limit)).map((attempt) => ({
      ...attempt,
      // The generic scanner only echoes this opaque scope back into callbacks.
      jobId: attempt.quoteId,
    })),
    defer: (_scope, attemptId, absenceObserved) =>
      options.api.defer(attemptId, absenceObserved),
    settle: (_scope, attemptId, transactionSignature) =>
      options.api.settle(attemptId, transactionSignature),
    release: (_scope, attemptId, expectedStatus, reason) =>
      options.api.release(attemptId, expectedStatus, reason),
  }
  return processResearchPaymentAttempts({ ...options, api: adapted })
}

type RpcSignature = {
  signature: string
  err: unknown
  blockTime: number | null
}

export type ExactPayShPaymentScan =
  | { kind: 'settled'; signature: string }
  | { kind: 'failed'; signature: string }
  | { kind: 'absent' }
  | { kind: 'inconclusive' }

/**
 * Proves one provider's exact finalized view without making a consensus or
 * release decision. Production callers must still require agreement from two
 * independent origins; the official Pay sandbox exposes only one simulator,
 * so its process-death drill uses this primitive to exercise discovery and
 * ledger convergence without pretending the simulator is two providers.
 */
export async function scanExactFinalizedPayShPayment(options: {
  attempt: ResearchPaymentAttempt | DirectPayShPaymentAttempt
  rpcUrl: string
  fetchImpl?: typeof globalThis.fetch
  maxSignaturePages?: number
}): Promise<ExactPayShPaymentScan> {
  const attempt = 'jobId' in options.attempt
    ? options.attempt
    : { ...options.attempt, jobId: options.attempt.quoteId }
  validatePaymentReconciliationAttempt(attempt)
  if (
    attempt.status === 'claimed'
    || !attempt.signedTransactionBase64
    || !attempt.recentBlockhash
    || !await isExactQuotedPayShTransaction(attempt)
    || transactionLifetimeToken(attempt.signedTransactionBase64) !== attempt.recentBlockhash
  ) {
    return { kind: 'inconclusive' }
  }
  return scanFinalizedTransactions({
    attempt,
    rpcUrl: options.rpcUrl,
    fetchImpl: options.fetchImpl ?? globalThis.fetch,
    maxPages: options.maxSignaturePages ?? 5,
  })
}

export async function processResearchPaymentAttempts(options: {
  api: ResearchPaymentReconciliationApi
  rpcUrls: string[]
  /** Current deployment value is diagnostic only; each attempt uses its durable snapshot. */
  operatorWallet?: string
  fetchImpl?: typeof globalThis.fetch
  batchSize?: number
  maxSignaturePages?: number
}): Promise<PaymentReconciliationRun> {
  const fetchImpl = options.fetchImpl ?? globalThis.fetch
  const rpcUrls = independentRpcUrls(options.rpcUrls)
  if (rpcUrls.length === 0) throw new Error('at least one Solana reconciliation RPC is required')
  const attempts = await options.api.list(options.batchSize ?? 25)
  const failures: unknown[] = []
  const degradedAttempts: string[] = []
  for (const attempt of attempts) {
    try {
      validatePaymentReconciliationAttempt(attempt)
      if (attempt.status === 'claimed') {
        await options.api.release(
          attempt.jobId,
          attempt.attemptId,
          'claimed',
          'No signed Pay.sh credential was durably prepared before the claim deadline.',
        )
        continue
      }
      if (!attempt.signedTransactionBase64 || !attempt.recentBlockhash) {
        await options.api.defer(attempt.jobId, attempt.attemptId, false)
        degradedAttempts.push(attempt.attemptId)
        continue
      }
      if (!await isExactQuotedPayShTransaction(attempt)) {
        await options.api.defer(attempt.jobId, attempt.attemptId, false)
        degradedAttempts.push(attempt.attemptId)
        continue
      }
      if (
        transactionLifetimeToken(attempt.signedTransactionBase64)
        !== attempt.recentBlockhash
      ) {
        await options.api.defer(attempt.jobId, attempt.attemptId, false)
        degradedAttempts.push(attempt.attemptId)
        continue
      }

      const scans = await Promise.all(rpcUrls.map(async (rpcUrl): Promise<ExactPayShPaymentScan> => {
        try {
          return await scanFinalizedTransactions({
            attempt,
            rpcUrl,
            fetchImpl,
            maxPages: options.maxSignaturePages ?? 5,
          })
        } catch {
          return { kind: 'inconclusive' }
        }
      }))
      const settled = unanimousSettlementSignature(scans)
      if (settled) {
        await options.api.settle(attempt.jobId, attempt.attemptId, settled)
        continue
      }
      if (scans.some((scan) => scan.kind === 'settled' || scan.kind === 'inconclusive')) {
        await options.api.defer(attempt.jobId, attempt.attemptId, false)
        degradedAttempts.push(attempt.attemptId)
        continue
      }

      const blockhashViews = await Promise.all(rpcUrls.map(async (rpcUrl): Promise<boolean | null> => {
        try {
          return await rpc<{ value: boolean }>(fetchImpl, rpcUrl, 'isBlockhashValid', [
            attempt.recentBlockhash,
            { commitment: 'finalized' },
          ]).then((result) => result.value)
        } catch {
          return null
        }
      }))
      // One provider can lag or omit history for longer than the retry window.
      // Never turn that absence into permission to charge again. Automatic
      // release requires two distinct RPC origins, complete scans from all of
      // them, and unanimous finalized blockhash expiry.
      if (
        rpcUrls.length < 2
        || blockhashViews.some((view) => view == null || view)
      ) {
        await options.api.defer(attempt.jobId, attempt.attemptId, false)
        if (rpcUrls.length < 2 || blockhashViews.some((view) => view == null)) {
          degradedAttempts.push(attempt.attemptId)
        }
      } else {
        const failed = scans.find((scan) => scan.kind === 'failed')
        await confirmAbsenceOrRelease(
          options.api,
          attempt,
          failed?.kind === 'failed'
            ? `Exact Pay.sh transaction ${failed.signature} finalized with an error, and two independent RPC origins found no successful transfer.`
            : 'Two independent RPC origins found no exact finalized transaction and agreed that the prepared recent blockhash is no longer valid.',
        )
      }
    } catch (error) {
      // RPC gaps and malformed responses are absence-of-proof, never proof of
      // absence. Keep the durable fence and try another finalized provider view.
      try {
        await options.api.defer(attempt.jobId, attempt.attemptId, false)
        degradedAttempts.push(attempt.attemptId)
      } catch (deferError) {
        failures.push(new AggregateError(
          [error, deferError],
          `Pay.sh reconciliation and defer failed for ${attempt.attemptId}`,
        ))
      }
    }
  }
  if (failures.length > 0) {
    throw new AggregateError(failures, 'one or more Pay.sh reconciliation attempts failed')
  }
  return { degradedAttempts: [...new Set(degradedAttempts)] }
}

function validatePaymentReconciliationAttempt(attempt: ResearchPaymentAttempt): void {
  const now = Date.now()
  if (!/^[A-Za-z0-9:_-]{1,160}$/.test(attempt.jobId)) {
    throw new Error('Pay.sh reconciliation job id is invalid')
  }
  if (!/^[A-Za-z0-9:_-]{1,160}$/.test(attempt.quoteId)) {
    throw new Error('Pay.sh reconciliation quote id is invalid')
  }
  if (!/^[0-9a-f]{64}$/.test(attempt.attemptId)) {
    throw new Error('Pay.sh reconciliation attempt id is invalid')
  }
  if (!['claimed', 'prepared', 'ambiguous'].includes(attempt.status)) {
    throw new Error('Pay.sh reconciliation status is invalid')
  }
  for (const [name, value] of [
    ['createdAt', attempt.createdAt],
    ['reconcileAfter', attempt.reconcileAfter],
  ] as const) {
    if (!Number.isSafeInteger(value) || value <= 0 || value > now + RECOVERY_CLOCK_SKEW_MS) {
      throw new Error(`Pay.sh reconciliation ${name} is invalid`)
    }
  }
  if (
    attempt.preparedAt != null
    && (!Number.isSafeInteger(attempt.preparedAt)
      || attempt.preparedAt < attempt.createdAt
      || attempt.preparedAt > now + RECOVERY_CLOCK_SKEW_MS)
  ) {
    throw new Error('Pay.sh reconciliation preparedAt is invalid')
  }
  if (
    attempt.absenceObservedAt != null
    && (!Number.isSafeInteger(attempt.absenceObservedAt)
      || attempt.absenceObservedAt < (attempt.preparedAt ?? attempt.createdAt)
      || attempt.absenceObservedAt > now + RECOVERY_CLOCK_SKEW_MS)
  ) {
    throw new Error('Pay.sh reconciliation absence observation is invalid')
  }
  const amounts = [
    attempt.amountAtomic,
    attempt.ownerAmountAtomic,
    attempt.platformAmountAtomic,
  ]
  if (amounts.some((value) => !/^(?:0|[1-9][0-9]*)$/.test(value))) {
    throw new Error('Pay.sh reconciliation amount is not canonical')
  }
  const [total, owner, platform] = amounts.map(BigInt)
  if (total <= 0n || total > MAX_LEDGER_ATOMIC || owner + platform !== total) {
    throw new Error('Pay.sh reconciliation amount split is invalid')
  }
  if (attempt.status === 'claimed') {
    if (attempt.payer !== '') {
      throw new Error('claimed Pay.sh attempt unexpectedly contains a payer')
    }
  } else {
    address(attempt.payer)
  }
  address(attempt.asset)
  address(attempt.recipientWallet)
  if (attempt.platformRecipientWallet) address(attempt.platformRecipientWallet)

  if (attempt.status === 'claimed') {
    const preparedEvidence = [
      attempt.preparedAt,
      attempt.signedTransactionBase64,
      attempt.recentBlockhash,
      attempt.challengeId,
      attempt.externalId,
      attempt.challengeExpiresAt,
      attempt.platformRecipientWallet,
    ]
    if (preparedEvidence.some((value) => value != null)) {
      throw new Error('claimed Pay.sh attempt contains partial prepared evidence')
    }
  }
}

type PaymentInstruction = {
  program: string
  accounts: string[]
  data: Uint8Array
}

type PreparedPaymentTransaction = {
  signerAddresses: string[]
  signatures: Uint8Array[]
  messageBytes: Uint8Array
  instructions: PaymentInstruction[]
}

async function isExactQuotedPayShTransaction(
  attempt: ResearchPaymentAttempt,
): Promise<boolean> {
  try {
    if (!attempt.externalId || !attempt.platformRecipientWallet) return false
    const prepared = decodeBase64(attempt.signedTransactionBase64 ?? '')
    const transaction = parsePreparedPaymentTransaction(prepared)
    const payerIndex = transaction.signerAddresses.indexOf(attempt.payer)
    if (payerIndex < 0 || isZero(transaction.signatures[payerIndex])) return false
    for (let index = 0; index < transaction.signerAddresses.length; index += 1) {
      const signature = transaction.signatures[index]
      if (isZero(signature)) continue
      if (!await verifySignature(
        await getPublicKeyFromAddress(address(transaction.signerAddresses[index])),
        signatureBytes(signature),
        transaction.messageBytes,
      )) return false
    }

    const [source, platformDestination, ownerDestination] = await Promise.all([
      payShTokenAccount(attempt.asset, attempt.payer),
      payShTokenAccount(attempt.asset, attempt.platformRecipientWallet),
      payShTokenAccount(attempt.asset, attempt.recipientWallet),
    ])
    const actualTransfers: string[] = []
    let exactResourceMemo = false
    for (const instruction of transaction.instructions) {
      if (instruction.program === TOKEN_PROGRAM) {
        if (
          instruction.accounts.length !== 4
          || instruction.accounts[0] !== source
          || instruction.accounts[1] !== attempt.asset
          || instruction.accounts[3] !== attempt.payer
          || instruction.data.length !== 10
          || instruction.data[0] !== 12
          || instruction.data[9] !== 6
        ) return false
        const amount = Buffer.from(instruction.data).readBigUInt64LE(1)
        actualTransfers.push(`${instruction.accounts[2]}\u0000${amount}`)
      } else if (instruction.program === MEMO_PROGRAM) {
        if (Buffer.from(instruction.data).toString('utf8') === attempt.externalId) {
          exactResourceMemo = true
        }
      } else if (instruction.program === COMPUTE_BUDGET_PROGRAM) {
        if (!validFeeSponsoredComputeBudget(instruction)) return false
      } else if (instruction.program !== COMPUTE_BUDGET_PROGRAM) {
        return false
      }
    }
    const expectedTransfers = [
      `${platformDestination}\u0000${BigInt(attempt.platformAmountAtomic)}`,
      `${ownerDestination}\u0000${BigInt(attempt.ownerAmountAtomic)}`,
    ].sort()
    return exactResourceMemo
      && BigInt(attempt.ownerAmountAtomic) + BigInt(attempt.platformAmountAtomic)
        === BigInt(attempt.amountAtomic)
      && actualTransfers.length === expectedTransfers.length
      && actualTransfers.sort().every((transfer, index) => transfer === expectedTransfers[index])
  } catch {
    return false
  }
}

function validFeeSponsoredComputeBudget(instruction: PaymentInstruction): boolean {
  if (instruction.accounts.length !== 0) return false
  if (instruction.data.length === 5 && instruction.data[0] === 2) {
    return Buffer.from(instruction.data).readUInt32LE(1) <= MAX_FEE_SPONSORED_COMPUTE_UNITS
  }
  if (instruction.data.length === 9 && instruction.data[0] === 3) {
    return Buffer.from(instruction.data).readBigUInt64LE(1)
      <= MAX_FEE_SPONSORED_MICROLAMPORTS_PER_UNIT
  }
  return false
}

function parsePreparedPaymentTransaction(bytes: Uint8Array): PreparedPaymentTransaction {
  const messageBytes = new Uint8Array(getTransactionDecoder().decode(bytes).messageBytes)
  try {
    const transaction = Transaction.from(bytes)
    return {
      signerAddresses: transaction.signatures.map((item) => item.publicKey.toBase58()),
      signatures: transaction.signatures.map((item) =>
        item.signature ? new Uint8Array(item.signature) : new Uint8Array(64)
      ),
      messageBytes,
      instructions: transaction.instructions.map((instruction) => ({
        program: instruction.programId.toBase58(),
        accounts: instruction.keys.map((key) => key.pubkey.toBase58()),
        data: new Uint8Array(instruction.data),
      })),
    }
  } catch {
    const transaction = VersionedTransaction.deserialize(bytes)
    if (transaction.message.addressTableLookups.length !== 0) {
      throw new Error('address-table payment transactions are not independently verifiable')
    }
    const keys = transaction.message.staticAccountKeys
    const signerCount = transaction.message.header.numRequiredSignatures
    return {
      signerAddresses: keys.slice(0, signerCount).map((key) => key.toBase58()),
      signatures: transaction.signatures.map((signature) => new Uint8Array(signature)),
      messageBytes,
      instructions: transaction.message.compiledInstructions.map((instruction) => {
        const program = keys[instruction.programIdIndex]
        const accounts = [...instruction.accountKeyIndexes].map((index) => keys[index])
        if (!program || accounts.some((account) => !account)) {
          throw new Error('payment transaction references an unresolved account')
        }
        return {
          program: program.toBase58(),
          accounts: accounts.map((account) => account.toBase58()),
          data: new Uint8Array(instruction.data),
        }
      }),
    }
  }
}

async function payShTokenAccount(asset: string, owner: string): Promise<string> {
  return String((await findAssociatedTokenPda({
    mint: address(asset),
    owner: address(owner),
    tokenProgram: TOKEN_PROGRAM_ADDRESS,
  }))[0])
}

function independentRpcUrls(values: string[]): string[] {
  const byOrigin = new Map<string, string>()
  for (const value of values) {
    const url = new URL(value)
    if (!byOrigin.has(url.origin)) byOrigin.set(url.origin, url.toString())
  }
  return [...byOrigin.values()]
}

async function confirmAbsenceOrRelease(
  api: ResearchPaymentReconciliationApi,
  attempt: ResearchPaymentAttempt,
  reason: string,
): Promise<void> {
  if (attempt.absenceObservedAt == null) {
    await api.defer(attempt.jobId, attempt.attemptId, true)
    return
  }
  await api.release(attempt.jobId, attempt.attemptId, attempt.status, reason)
}

async function scanFinalizedTransactions(options: {
  attempt: ResearchPaymentAttempt
  rpcUrl: string
  fetchImpl: typeof globalThis.fetch
  maxPages: number
}): Promise<ExactPayShPaymentScan> {
  const prepared = decodeBase64(options.attempt.signedTransactionBase64 ?? '')
  if (!hasValidTransactionEnvelope(prepared)) {
    throw new Error('persisted Pay.sh transaction envelope is malformed')
  }
  const knownSignature = fullySignedTransactionSignature(prepared)
  if (knownSignature) {
    const transactionValue = await rpc<unknown>(options.fetchImpl, options.rpcUrl, 'getTransaction', [
      knownSignature,
      { commitment: 'finalized', encoding: 'base64', maxSupportedTransactionVersion: 0 },
    ])
    if (transactionValue === null) return { kind: 'absent' }
    const transaction = parseExactRpcTransaction(transactionValue)
    const candidate = transaction.bytes
    if (
      !hasValidTransactionEnvelope(candidate)
      || !equalBytes(prepared, candidate)
      || fullySignedTransactionSignature(candidate) !== knownSignature
    ) {
      return { kind: 'inconclusive' }
    }
    if (!(await hasValidTransactionSignatures(candidate))) return { kind: 'inconclusive' }
    return transaction.err === null
      ? { kind: 'settled', signature: knownSignature }
      : { kind: 'failed', signature: knownSignature }
  }
  let before: string | undefined

  for (let page = 0; page < Math.max(1, options.maxPages); page += 1) {
    const signatures = parseRpcSignatures(await rpc<unknown>(
      options.fetchImpl,
      options.rpcUrl,
      'getSignaturesForAddress',
      [
        options.attempt.payer,
        {
          commitment: 'finalized',
          limit: 1_000,
          ...(before ? { before } : {}),
        },
      ],
    ))
    if (signatures.length === 0) return { kind: 'absent' }

    for (const signatureInfo of signatures) {
      const transactionValue = await rpc<unknown>(options.fetchImpl, options.rpcUrl, 'getTransaction', [
        signatureInfo.signature,
        { commitment: 'finalized', encoding: 'base64', maxSupportedTransactionVersion: 0 },
      ])
      if (transactionValue === null) return { kind: 'inconclusive' }
      const transaction = parseExactRpcTransaction(transactionValue)
      if ((signatureInfo.err === null) !== (transaction.err === null)) {
        return { kind: 'inconclusive' }
      }
      const candidate = transaction.bytes
      if (!hasValidTransactionEnvelope(candidate)) return { kind: 'inconclusive' }
      if (matchesPreparedTransaction(prepared, candidate, signatureInfo.signature)) {
        if (!(await hasValidTransactionSignatures(candidate))) return { kind: 'inconclusive' }
        return transaction.err === null
          ? { kind: 'settled', signature: signatureInfo.signature }
          : { kind: 'failed', signature: signatureInfo.signature }
      }
    }
    // Chain blockTime is validator-derived and may disagree sharply with the
    // application clock after NTP jumps or in simulators. It is diagnostic,
    // never a safe history boundary. Pagination is bounded by maxPages, while
    // exact transaction bytes and signatures make older matches unambiguous.
    if (signatures.length < 1_000) return { kind: 'absent' }
    before = signatures.at(-1)?.signature
    if (!before) return { kind: 'inconclusive' }
  }
  return { kind: 'inconclusive' }
}

function parseRpcSignatures(value: unknown): RpcSignature[] {
  if (!Array.isArray(value)) throw new Error('Solana RPC returned invalid signature history')
  return value.map((item) => {
    if (!item || typeof item !== 'object' || Array.isArray(item)) {
      throw new Error('Solana RPC returned a malformed signature entry')
    }
    const entry = item as Record<string, unknown>
    if (typeof entry.signature !== 'string' || !Object.hasOwn(entry, 'err')) {
      throw new Error('Solana RPC signature entry omitted its identity or status')
    }
    let decoded: Uint8Array
    try {
      decoded = base58.decode(entry.signature)
    } catch {
      throw new Error('Solana RPC returned a malformed transaction signature')
    }
    if (decoded.length !== 64) {
      throw new Error('Solana RPC returned a malformed transaction signature')
    }
    if (
      entry.blockTime !== null
      && (!Number.isSafeInteger(entry.blockTime) || Number(entry.blockTime) <= 0)
    ) {
      throw new Error('Solana RPC returned a malformed transaction block time')
    }
    return {
      signature: entry.signature,
      err: entry.err,
      blockTime: entry.blockTime as number | null,
    }
  })
}

function parseExactRpcTransaction(value: unknown): { bytes: Uint8Array; err: unknown } {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error('Solana RPC returned a malformed transaction response')
  }
  const record = value as Record<string, unknown>
  const transaction = record.transaction
  const meta = record.meta
  if (
    !Array.isArray(transaction)
    || transaction.length !== 2
    || typeof transaction[0] !== 'string'
    || transaction[1] !== 'base64'
    || !meta
    || typeof meta !== 'object'
    || Array.isArray(meta)
    || !Object.hasOwn(meta, 'err')
  ) {
    throw new Error('Solana RPC omitted exact transaction bytes or status')
  }
  return {
    bytes: decodeBase64(transaction[0]),
    err: (meta as Record<string, unknown>).err,
  }
}

export function unanimousSettlementSignature(scans: ExactPayShPaymentScan[]): string | null {
  if (scans.length < 2 || scans.some((scan) => scan.kind !== 'settled')) return null
  const signature = scans[0].kind === 'settled' ? scans[0].signature : null
  return signature && scans.every(
    (scan) => scan.kind === 'settled' && scan.signature === signature,
  )
    ? signature
    : null
}

async function hasValidTransactionSignatures(transaction: Uint8Array): Promise<boolean> {
  try {
    const decoded = getTransactionDecoder().decode(transaction)
    const signatures = Object.entries(decoded.signatures)
    if (signatures.length === 0) return false
    const verified = await Promise.all(signatures.map(async ([signer, signature]) => {
      if (!signature || isZero(signature)) return false
      return verifySignature(
        await getPublicKeyFromAddress(address(signer)),
        signature,
        decoded.messageBytes,
      )
    }))
    return verified.every(Boolean)
  } catch {
    return false
  }
}

function transactionLifetimeToken(transactionBase64: string): string | null {
  try {
    const transaction = getTransactionDecoder().decode(decodeBase64(transactionBase64))
    return String(
      getCompiledTransactionMessageDecoder().decode(transaction.messageBytes).lifetimeToken,
    )
  } catch {
    return null
  }
}

function fullySignedTransactionSignature(transaction: Uint8Array): string | null {
  const header = decodeShortVec(transaction)
  for (let index = 0; index < header.value; index += 1) {
    const start = header.offset + index * 64
    if (isZero(transaction.subarray(start, start + 64))) return null
  }
  return base58.encode(transaction.subarray(header.offset, header.offset + 64))
}

/**
 * Pay.sh may fill only signature slots that were zero when the payer-signed
 * credential was persisted. The message and every existing signature must be
 * byte-for-byte identical.
 */
export function matchesPreparedTransaction(
  prepared: Uint8Array,
  candidate: Uint8Array,
  rpcSignature: string,
): boolean {
  try {
    const preparedHeader = decodeShortVec(prepared)
    const candidateHeader = decodeShortVec(candidate)
    if (
      preparedHeader.value !== candidateHeader.value
      || preparedHeader.offset !== candidateHeader.offset
      || prepared.length !== candidate.length
      || preparedHeader.value < 1
    ) return false

    const signatureBytes = preparedHeader.value * 64
    const messageOffset = preparedHeader.offset + signatureBytes
    if (messageOffset > prepared.length) return false
    if (!equalBytes(prepared.subarray(messageOffset), candidate.subarray(messageOffset))) {
      return false
    }
    for (let index = 0; index < preparedHeader.value; index += 1) {
      const start = preparedHeader.offset + index * 64
      const preparedSignature = prepared.subarray(start, start + 64)
      const candidateSignature = candidate.subarray(start, start + 64)
      if (isZero(preparedSignature)) {
        if (isZero(candidateSignature)) return false
      } else if (!equalBytes(preparedSignature, candidateSignature)) {
        return false
      }
    }
    const firstCandidateSignature = candidate.subarray(candidateHeader.offset, candidateHeader.offset + 64)
    return base58.encode(firstCandidateSignature) === rpcSignature
  } catch {
    return false
  }
}

function decodeShortVec(bytes: Uint8Array): { value: number; offset: number } {
  let value = 0
  let shift = 0
  for (let offset = 0; offset < Math.min(bytes.length, 3); offset += 1) {
    const byte = bytes[offset]
    value |= (byte & 0x7f) << shift
    if ((byte & 0x80) === 0) return { value, offset: offset + 1 }
    shift += 7
  }
  throw new Error('invalid Solana short vector')
}

function hasValidTransactionEnvelope(bytes: Uint8Array): boolean {
  try {
    const signatureCount = decodeShortVec(bytes)
    return signatureCount.value >= 1
      && signatureCount.value <= 64
      && signatureCount.offset + signatureCount.value * 64 < bytes.length
  } catch {
    return false
  }
}

function decodeBase64(value: string): Uint8Array {
  const bytes = Buffer.from(value, 'base64')
  if (bytes.length < 100 || bytes.length > 2_048) {
    throw new Error('persisted Pay.sh transaction has an invalid size')
  }
  return bytes
}

function equalBytes(left: Uint8Array, right: Uint8Array): boolean {
  return left.length === right.length && left.every((byte, index) => byte === right[index])
}

function isZero(bytes: Uint8Array): boolean {
  return bytes.every((byte) => byte === 0)
}

let rpcId = 0
async function rpc<T>(
  fetchImpl: typeof globalThis.fetch,
  rpcUrl: string,
  method: string,
  params: unknown[],
): Promise<T> {
  rpcId += 1
  const response = await fetchImpl(rpcUrl, {
    method: 'POST',
    redirect: 'error',
    signal: AbortSignal.timeout(10_000),
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ jsonrpc: '2.0', id: rpcId, method, params }),
  })
  const text = await boundedResponseText(
    response,
    MAX_RPC_RESPONSE_BYTES,
    `Solana RPC ${method} response`,
  )
  if (!response.ok) throw new Error(`Solana RPC ${response.status} during ${method}`)
  const body = JSON.parse(text) as { result?: T; error?: { message?: string } }
  if (body.error || !Object.hasOwn(body, 'result')) {
    throw new Error(`Solana RPC ${method} failed: ${body.error?.message ?? 'missing result'}`)
  }
  return body.result as T
}
