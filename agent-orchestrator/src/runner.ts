import type { PayKitClient } from '@solana/pay-kit/client'
import { Challenge } from 'mppx'

export type PayShResource = {
  quoteId: string
  documentHandle: string
  recipientWallet: string
  network: string
  asset: string
  amountAtomic: string
  ownerAmountAtomic: string
  platformAmountAtomic: string
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
  complete(jobId: string): Promise<unknown>
  fail(jobId: string, error: string): Promise<unknown>
}

export type RunOptions = {
  jobId: string
  signerAddress: string
  payShGatewayBase: string
  api: ResearchApi
  payClient: Pick<PayKitClient, 'fetch'>
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

      let delivered = false
      for (let attempt = 0; attempt <= retryDelays.length; attempt += 1) {
        try {
          await (options.verifyChallenge ?? verifyPayShChallenge)(
            `${options.payShGatewayBase}${resource.resourcePath}`,
            resource,
          )
          const response = await options.payClient.fetch(
            `${options.payShGatewayBase}${resource.resourcePath}`,
            { method: 'GET', headers: { accept: 'application/json' } },
            'mpp',
          )
          if (!response.ok) {
            throw new Error(`Pay.sh returned HTTP ${response.status}`)
          }
        } catch (error) {
          // The response may have been lost after settlement. Refresh first;
          // disappearance from the plan proves delivery and prevents replay.
          plan = await options.api.plan(options.jobId)
          assertPlan(plan, options)
          if (!plan.resources.some((item) => item.quoteId === resource.quoteId)) {
            delivered = true
            break
          }
          if (attempt === retryDelays.length) throw error
          await delay(retryDelays[attempt])
          continue
        }

        plan = await options.api.plan(options.jobId)
        assertPlan(plan, options)
        if (!plan.resources.some((item) => item.quoteId === resource.quoteId)) {
          delivered = true
          break
        }
        if (attempt === retryDelays.length) {
          throw new Error(`Pay.sh did not record delivery for ${resource.documentHandle}`)
        }
        await delay(retryDelays[attempt])
      }
      if (!delivered) throw new Error(`Could not deliver ${resource.documentHandle}`)
    }
    await options.api.complete(options.jobId)
  } catch (error) {
    const message = safeError(error).slice(0, 1_000)
    await options.api.fail(options.jobId, message).catch((persistError) => {
      throw new AggregateError([error, persistError], 'research job and refund persistence failed')
    })
    throw error
  }
}

/** Fail closed on a mispriced or misrouted Pay.sh challenge before KMS signs. */
export async function verifyPayShChallenge(
  url: string,
  resource: PayShResource,
): Promise<void> {
  const response = await fetch(url, { method: 'GET', headers: { accept: 'application/json' } })
  const challenge = Challenge.fromResponse(response)
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
  const splits = Array.isArray(details?.splits) ? details.splits : []
  const ownerSplit = splits.find((item) => {
    if (!item || typeof item !== 'object') return false
    const split = item as Record<string, unknown>
    return split.recipient === resource.recipientWallet && split.amount === resource.ownerAmountAtomic
  })
  if (!ownerSplit) throw new Error('Pay.sh owner split does not match the verified DB recipient')
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

function safeError(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}
