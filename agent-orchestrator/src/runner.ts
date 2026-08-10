import { randomBytes } from 'node:crypto'
import { Challenge } from 'mppx'
import { PayShPaymentNotSentError } from './payment-errors.js'

export type PayShResource = {
  quoteId: string
  queryId: string
  documentHandle: string
  recipientWallet: string
  network: string
  asset: string
  amountAtomic: string
  ownerAmountAtomic: string
  platformAmountAtomic: string
  priceKrw: number
  expiresAt: number
  status: string
  resourcePath: string
}

export type ResearchJobPlan = {
  id: string
  payer: string
  payTo: string
  network: string
  asset: string
  amountAtomic: string
  status: string
  resources: PayShResource[]
}

export type ResearchApi = {
  plan(jobId: string): Promise<ResearchJobPlan>
  beginPayment(jobId: string, quoteId: string, attemptId: string): Promise<unknown>
  complete(jobId: string): Promise<unknown>
  fail(jobId: string, error: string): Promise<unknown>
  hold(jobId: string, error: string): Promise<unknown>
}

export type ResearchPayClient = {
  fetch(
    input: string | URL | Request,
    init: RequestInit | undefined,
    protocol: 'mpp',
    context: { jobId: string; attemptId: string; resource: PayShResource },
  ): Promise<Response>
}

export type RunOptions = {
  jobId: string
  signerAddress: string
  payShGatewayBase: string
  operatorWallet?: string
  internalPaymentToken?: string
  api: ResearchApi
  payClient: ResearchPayClient
  retryDelaysMs?: readonly number[]
  verifyChallenge?: (url: string, resource: PayShResource) => Promise<void>
}

/**
 * Executes one durable job. Before every retry it asks the ledger for a fresh
 * plan, so a payment that landed despite a lost HTTP response is never paid a
 * second time. The Rust API is the source of truth, not process memory.
 */
export async function runResearchJob(options: RunOptions): Promise<void> {
  const retryDelays = options.retryDelaysMs ?? [500, 1_500, 3_000]
  try {
    let plan = await options.api.plan(options.jobId)
    assertPlan(plan, options)
    for (;;) {
      const resource = plan.resources[0]
      if (!resource) break
      const paymentAttemptId = randomBytes(32).toString('hex')
      const paidUrl = withQueryParameter(
        `${options.payShGatewayBase}${resource.resourcePath}`,
        'payment_attempt_id',
        paymentAttemptId,
      )

      let delivered = false
      for (let attempt = 0; attempt <= retryDelays.length; attempt += 1) {
        try {
          await (options.verifyChallenge ?? verifyPayShChallenge)(
            paidUrl,
            resource,
          )
        } catch (error) {
          if (attempt === retryDelays.length) throw error
          await delay(retryDelays[attempt])
          continue
        }

        // This commit is the durable point of no return. Until the exact
        // attempt owns the job, the external paid URL is never invoked.
        await options.api.beginPayment(options.jobId, resource.quoteId, paymentAttemptId)
        try {
          const response = await options.payClient.fetch(
            paidUrl,
            {
              method: 'GET',
              signal: AbortSignal.timeout(60_000),
              headers: {
                accept: 'application/json',
                ...(options.internalPaymentToken
                  ? { 'x-openshelf-internal-token': options.internalPaymentToken }
                  : {}),
              },
            },
            'mpp',
            {
              jobId: options.jobId,
              attemptId: paymentAttemptId,
              resource,
            },
          )
          if (!response.ok) {
            throw new Error(`Pay.sh returned HTTP ${response.status}`)
          }
        } catch (error) {
          if (error instanceof PayShPaymentNotSentError) throw error
          // Calling PayKit may already have moved funds. Refresh once, but
          // never invoke the paid URL again while that outcome is ambiguous.
          plan = await reloadPlanAfterPayment(options, resource, error)
          if (!plan.resources.some((item) => item.quoteId === resource.quoteId)) {
            delivered = true
            break
          }
          throw new AmbiguousPayShPaymentError(
            `Pay.sh payment outcome is unknown for ${resource.documentHandle}: ${safeError(error)}`,
          )
        }

        plan = await reloadPlanAfterPayment(options, resource)
        if (!plan.resources.some((item) => item.quoteId === resource.quoteId)) {
          delivered = true
          break
        }
        if (attempt === retryDelays.length) {
          throw new AmbiguousPayShPaymentError(
            `Pay.sh accepted payment but did not record delivery for ${resource.documentHandle}`,
          )
        }
        throw new AmbiguousPayShPaymentError(
          `Pay.sh accepted payment but delivery remains pending for ${resource.documentHandle}`,
        )
      }
      if (!delivered) throw new Error(`Could not deliver ${resource.documentHandle}`)
    }
    await options.api.complete(options.jobId)
  } catch (error) {
    // The durable attempt remains the authority. Its claimed/prepared timeout
    // will release it only after proving no paid request could have landed.
    if (error instanceof PayShPaymentNotSentError) throw error
    const message = safeError(error).slice(0, 1_000)
    const persist = error instanceof AmbiguousPayShPaymentError
      ? options.api.hold(options.jobId, message)
      : options.api.fail(options.jobId, message)
    await persist.catch((persistError) => {
      throw new AggregateError([error, persistError], 'research job and refund persistence failed')
    })
    throw error
  }
}

class AmbiguousPayShPaymentError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'AmbiguousPayShPaymentError'
  }
}

async function reloadPlanAfterPayment(
  options: RunOptions,
  resource: PayShResource,
  paymentError?: unknown,
): Promise<ResearchJobPlan> {
  try {
    const plan = await options.api.plan(options.jobId)
    assertPlan(plan, options)
    return plan
  } catch (error) {
    const paymentContext = paymentError ? `; payment call: ${safeError(paymentError)}` : ''
    throw new AmbiguousPayShPaymentError(
      `Could not verify Pay.sh delivery for ${resource.documentHandle}: ${safeError(error)}${paymentContext}`,
    )
  }
}

/** Fail closed on a mispriced or misrouted Pay.sh challenge before KMS signs. */
export async function verifyPayShChallenge(
  url: string,
  resource: PayShResource,
  operatorWallet?: string,
  feePayerKey?: string,
  fetchImpl: typeof globalThis.fetch = globalThis.fetch,
  timeoutMs = 10_000,
): Promise<void> {
  const response = await fetchImpl(url, {
    method: 'GET',
    signal: AbortSignal.timeout(timeoutMs),
    headers: { accept: 'application/json' },
  })
  const challenge = Challenge.fromResponse(response)
  validatePayShChallenge(challenge, resource, operatorWallet, feePayerKey)
}

export function validatePayShChallenge(
  challenge: Challenge.Challenge,
  resource: PayShResource,
  operatorWallet?: string,
  feePayerKey?: string,
): void {
  const request = challenge.request as Record<string, unknown>
  if (challenge.method !== 'solana' || challenge.intent !== 'charge') {
    throw new Error('Pay.sh did not offer a Solana MPP charge')
  }
  if (request.amount !== resource.amountAtomic) {
    throw new Error(`Pay.sh amount ${String(request.amount)} does not match quote ${resource.amountAtomic}`)
  }
  const currency = request.currency
  if (currency !== 'USDC' && currency !== resource.asset) {
    throw new Error('Pay.sh challenge asset does not match the research quote')
  }
  const details = request.methodDetails as Record<string, unknown> | undefined
  const challengeNetwork = String(details?.network ?? 'mainnet')
  const expectedDevnet = resource.network.includes('EtWTRAB') || resource.network === 'devnet'
  if ((expectedDevnet && challengeNetwork !== 'devnet') || (!expectedDevnet && challengeNetwork === 'devnet')) {
    throw new Error('Pay.sh challenge network does not match the research quote')
  }
  if (operatorWallet && request.recipient !== operatorWallet) {
    throw new Error('Pay.sh primary recipient does not match the configured operator wallet')
  }
  if (feePayerKey && (details?.feePayer !== true || details.feePayerKey !== feePayerKey)) {
    throw new Error('Pay.sh fee payer does not match the configured KMS signer')
  }
  const expectedExternalId = `human-document-krw-${resource.priceKrw}#`
  if (
    typeof request.externalId !== 'string'
    || !request.externalId.startsWith(expectedExternalId)
    || request.externalId.length <= expectedExternalId.length
    || request.externalId.length > expectedExternalId.length + 32
  ) {
    throw new Error('Pay.sh external id does not match the quoted resource')
  }
  if (
    typeof details?.recentBlockhash !== 'string'
    || details.recentBlockhash.length < 32
    || details.recentBlockhash.length > 64
  ) {
    throw new Error('Pay.sh challenge is missing a valid recent blockhash')
  }
  const challengeExpiresAt = challenge.expires ? Date.parse(challenge.expires) : Number.NaN
  if (!Number.isSafeInteger(challengeExpiresAt) || challengeExpiresAt <= Date.now()) {
    throw new Error('Pay.sh challenge is missing a future expiry')
  }
  const splits = Array.isArray(details?.splits) ? details.splits : []
  const ownerSplit = splits.find((item) => {
    if (!item || typeof item !== 'object') return false
    const split = item as Record<string, unknown>
    return split.recipient === resource.recipientWallet && split.amount === resource.ownerAmountAtomic
  })
  if (!ownerSplit) throw new Error('Pay.sh owner split does not match the verified DB recipient')
  if (splits.length !== 1) throw new Error('Pay.sh challenge contains an unexpected split')
  const splitTotal = splits.reduce((sum, item) => {
    if (!item || typeof item !== 'object') throw new Error('Pay.sh split is malformed')
    return sum + BigInt(String((item as Record<string, unknown>).amount))
  }, 0n)
  if (BigInt(resource.amountAtomic) - splitTotal !== BigInt(resource.platformAmountAtomic)) {
    throw new Error('Pay.sh platform remainder does not match the quote')
  }
}

function assertPlan(plan: ResearchJobPlan, options: RunOptions): void {
  if (plan.id !== options.jobId) throw new Error('research plan id mismatch')
  if (plan.payTo !== options.signerAddress) {
    throw new Error(
      `research budget wallet ${plan.payTo} does not match KMS signer ${options.signerAddress}`,
    )
  }
  const budget = BigInt(plan.amountAtomic)
  const pending = plan.resources.reduce((sum, item) => sum + BigInt(item.amountAtomic), 0n)
  if (budget <= 0n || pending > budget) throw new Error('research plan exceeds funded budget')
  for (const resource of plan.resources) {
    if (!resource.resourcePath.startsWith('/')) throw new Error('Pay.sh resource must be relative')
    if (!resource.resourcePath.includes(`research_job_id=${encodeURIComponent(plan.id)}`)) {
      throw new Error('Pay.sh resource is not bound to the funded research job')
    }
  }
}

function delay(milliseconds: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, milliseconds))
}

function withQueryParameter(url: string, name: string, value: string): string {
  const parsed = new URL(url)
  parsed.searchParams.set(name, value)
  return parsed.toString()
}

function safeError(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}
