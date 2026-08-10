import { timingSafeEqual } from 'node:crypto'
import { performance } from 'node:perf_hooks'
import express, { type NextFunction, type Request, type Response } from 'express'
import { createGcpKmsSigner } from '@solana/keychain-gcp-kms'
import type { KeyPairSigner } from '@solana/kit'
import {
  installDurablePayFetchFence,
  type PreparePaymentRecord,
} from './durable-pay-client.js'
import {
  runResearchJob,
  verifyPayShChallenge,
  type ResearchApi,
  type ResearchJobPlan,
  type ResearchPayClient,
} from './runner.js'
import { processRefundClaims, type PayoutClaim, type RefundApi } from './refunds.js'
import {
  payoutCoverageIssue,
} from './payout-coverage.js'
import {
  processDirectPayShPaymentAttempts,
  processResearchPaymentAttempts,
  type DirectPayShPaymentAttempt,
  type DirectPayShPaymentReconciliationApi,
  type ResearchPaymentAttempt,
  type ResearchPaymentReconciliationApi,
} from './pay-sh-reconciler.js'
import { secureServiceOrigin, secureServiceUrl } from './url-policy.js'
import {
  backgroundCycleIssue,
  completeBackgroundCycle,
  failBackgroundCycle,
  newBackgroundCycleState,
} from './cycle-readiness.js'
import { integerEnv } from './runtime-config.js'
import { boundedResponseText } from './bounded-response.js'

const rustApiUrl = secureServiceOrigin('RUST_API_URL', requiredEnv('RUST_API_URL'))
const payShGatewayBase = secureServiceOrigin(
  'PAY_SH_GATEWAY_BASE',
  requiredEnv('PAY_SH_GATEWAY_BASE'),
)
const operatorWallet = requiredEnv('OPENSHELF_PAY_OPERATOR_WALLET')
const internalToken = requiredEnv('OPENSHELF_INTERNAL_TOKEN')
if (internalToken.length < 32) {
  throw new Error('OPENSHELF_INTERNAL_TOKEN must be at least 32 characters')
}
const rpcUrl = secureServiceUrl(
  'OPENSHELF_PAY_RPC_URL',
  requiredEnv('OPENSHELF_PAY_RPC_URL'),
)
const paymentReconciliationRpcUrls = independentRpcUrls([
  rpcUrl,
  ...commaSeparatedEnv('OPENSHELF_PAY_RECONCILIATION_RPC_URLS'),
])
if (paymentReconciliationRpcUrls.length < 2) {
  throw new Error(
    'OPENSHELF_PAY_RECONCILIATION_RPC_URLS must include a second independent RPC origin',
  )
}
const keyName = requiredEnv('OPENSHELF_PAY_GCP_KMS_KEY_NAME')
const publicKey = requiredEnv('OPENSHELF_PAY_GCP_KMS_PUBKEY')
const port = integerEnv('PORT', 1410, 1, 65_535)
const pollMs = integerEnv('OPENSHELF_RESEARCH_POLL_MS', 10_000, 1_000, 300_000)
const paymentReconciliationMs = integerEnv(
  'OPENSHELF_PAY_RECONCILIATION_INTERVAL_MS',
  30_000,
  5_000,
  300_000,
)
const paymentReconciliationBatchSize = integerEnv(
  'OPENSHELF_PAY_RECONCILIATION_BATCH_SIZE',
  25,
  1,
  100,
)
const paymentReconciliationPages = integerEnv(
  'OPENSHELF_PAY_RECONCILIATION_SIGNATURE_PAGES',
  5,
  1,
  20,
)
const refundWorkerId = process.env.OPENSHELF_REFUND_WORKER_ID?.trim() || `research-refund-${process.pid}`
const MAX_INTERNAL_JSON_RESPONSE_BYTES = 1024 * 1024

// This wrapper must exist before PayKit captures globalThis.fetch.
const durablePayFence = installDurablePayFetchFence(payShGatewayBase)
const { createPayKitClient } = await import('@solana/pay-kit/client')
const signer = createGcpKmsSigner({ keyName, publicKey, requestDelayMs: 50 })
// pay-kit 0.8 types its payer as an in-memory KeyPairSigner even though the
// MPP charge path consumes only the standard transaction-signer interface.
// Restricting this client to MPP keeps all private-key material inside KMS.
const rawPayClient = await createPayKitClient({
  signer: signer as unknown as KeyPairSigner,
  rpcUrl,
  accept: ['mpp'],
})
const running = new Map<string, Promise<void>>()
let refundReconciliation: Promise<void> | null = null
let paymentReconciliation: Promise<void> | null = null
const jobPollHealth = newBackgroundCycleState()
const refundReconciliationHealth = newBackgroundCycleState()
const paymentReconciliationHealth = newBackgroundCycleState()

async function internalJson<T>(path: string, init: RequestInit = {}): Promise<T> {
  const response = await durablePayFence.originalFetch(`${rustApiUrl}${path}`, {
    ...init,
    signal: init.signal ?? AbortSignal.timeout(20_000),
    headers: {
      'content-type': 'application/json',
      'x-openshelf-internal-token': internalToken,
      'x-openshelf-research-protocol': 'durable-mpp-v2',
      'x-openshelf-payout-protocol': 'exact-payout-v1',
      ...init.headers,
    },
  })
  const text = await boundedResponseText(
    response,
    MAX_INTERNAL_JSON_RESPONSE_BYTES,
    'Rust API response',
  )
  if (!response.ok) {
    throw new Error(`Rust API ${response.status}: ${text.slice(0, 500)}`)
  }
  return JSON.parse(text) as T
}

const api: ResearchApi = {
  plan: (jobId) =>
    internalJson<ResearchJobPlan>(
      `/internal/v1/research-jobs/${encodeURIComponent(jobId)}/plan`,
    ),
  beginPayment: (jobId, quoteId, attemptId) =>
    internalJson(`/internal/v1/research-jobs/${encodeURIComponent(jobId)}/payment-attempts`, {
      method: 'POST',
      body: JSON.stringify({ quoteId, attemptId }),
    }),
  complete: (jobId) =>
    internalJson(`/internal/v1/research-jobs/${encodeURIComponent(jobId)}/complete`, {
      method: 'POST',
      body: '{}',
    }),
  fail: (jobId, error) =>
    internalJson(`/internal/v1/research-jobs/${encodeURIComponent(jobId)}/fail`, {
      method: 'POST',
      body: JSON.stringify({ error }),
    }),
  hold: (jobId, error) =>
    internalJson(`/internal/v1/research-jobs/${encodeURIComponent(jobId)}/hold`, {
      method: 'POST',
      body: JSON.stringify({ error }),
    }),
}
const payClient: ResearchPayClient = {
  fetch: (input, init, protocol, context) => durablePayFence.withAttempt(
    {
      ...context,
      signerAddress: signer.address,
      operatorWallet,
      prepare: (record: PreparePaymentRecord) => internalJson(
        `/internal/v1/research-jobs/${encodeURIComponent(context.jobId)}`
          + `/payment-attempts/${encodeURIComponent(context.attemptId)}/prepare`,
        { method: 'POST', body: JSON.stringify(record) },
      ),
    },
    () => rawPayClient.fetch(input, init, protocol),
  ),
}
const refundApi: RefundApi = {
  lease: (workerId, escrowWallet, network) =>
    internalJson<PayoutClaim[]>('/internal/v1/payout-claims/lease', {
      method: 'POST',
      // A prepared claim can spend tens of seconds collecting two finalized
      // views. Lease only the claim this process can actively work; otherwise
      // later rows expire in the local array before processing starts.
      body: JSON.stringify({ workerId, escrowWallet, network, limit: 1, leaseMs: 600_000 }),
    }),
  prepare: (claimId, body) => internalJson(
    `/internal/v1/payout-claims/${encodeURIComponent(claimId)}/prepare`,
    { method: 'POST', body: JSON.stringify(body) },
  ),
  complete: (claimId, body) => internalJson(
    `/internal/v1/payout-claims/${encodeURIComponent(claimId)}/complete`,
    { method: 'POST', body: JSON.stringify(body) },
  ),
  fail: (claimId, body) => internalJson(
    `/internal/v1/payout-claims/${encodeURIComponent(claimId)}/fail`,
    { method: 'POST', body: JSON.stringify(body) },
  ),
}
const payoutBacklog = () => internalJson<unknown>(
  '/internal/v1/payout-claims/backlog',
)
const paymentReconciliationApi: ResearchPaymentReconciliationApi = {
  list: (limit) => internalJson<ResearchPaymentAttempt[]>(
    `/internal/v1/research-payment-attempts/reconciliation?limit=${encodeURIComponent(limit)}`,
  ),
  defer: (jobId, attemptId, absenceObserved = false) => internalJson(
    `/internal/v1/research-jobs/${encodeURIComponent(jobId)}`
      + `/payment-attempts/${encodeURIComponent(attemptId)}/defer`,
    { method: 'POST', body: JSON.stringify({ absenceObserved }) },
  ),
  settle: (jobId, attemptId, transactionSignature) => internalJson(
    `/internal/v1/research-jobs/${encodeURIComponent(jobId)}`
      + `/payment-attempts/${encodeURIComponent(attemptId)}/settle`,
    { method: 'POST', body: JSON.stringify({ transactionSignature }) },
  ),
  release: (jobId, attemptId, expectedStatus, reason) => internalJson(
    `/internal/v1/research-jobs/${encodeURIComponent(jobId)}`
      + `/payment-attempts/${encodeURIComponent(attemptId)}/release`,
    { method: 'POST', body: JSON.stringify({ expectedStatus, reason }) },
  ),
}
const directPaymentReconciliationApi: DirectPayShPaymentReconciliationApi = {
  list: (limit) => internalJson<DirectPayShPaymentAttempt[]>(
    `/internal/v1/direct-pay-sh-attempts/reconciliation?limit=${encodeURIComponent(limit)}`,
  ),
  defer: (attemptId, absenceObserved = false) => internalJson(
    `/internal/v1/direct-pay-sh-attempts/${encodeURIComponent(attemptId)}/defer`,
    { method: 'POST', body: JSON.stringify({ absenceObserved }) },
  ),
  settle: (attemptId, transactionSignature) => internalJson(
    `/internal/v1/direct-pay-sh-attempts/${encodeURIComponent(attemptId)}/settle`,
    { method: 'POST', body: JSON.stringify({ transactionSignature }) },
  ),
  release: (attemptId, expectedStatus, reason) => internalJson(
    `/internal/v1/direct-pay-sh-attempts/${encodeURIComponent(attemptId)}/release`,
    { method: 'POST', body: JSON.stringify({ expectedStatus, reason }) },
  ),
}

function enqueue(jobId: string): Promise<void> {
  const existing = running.get(jobId)
  if (existing) return existing
  const task = runResearchJob({
    jobId,
    signerAddress: signer.address,
    payShGatewayBase,
    operatorWallet,
    internalPaymentToken: internalToken,
    api,
    payClient,
    verifyChallenge: (url, resource) => verifyPayShChallenge(
      url,
      resource,
      operatorWallet,
      signer.address,
      durablePayFence.originalFetch,
    ),
  })
    .catch((error) => console.error(`research job ${jobId} failed`, safeError(error)))
    .finally(() => running.delete(jobId))
  running.set(jobId, task)
  return task
}

async function reconcile(): Promise<void> {
  try {
    const jobs = await internalJson<string[]>('/internal/v1/research-jobs/runnable')
    for (const jobId of jobs) void enqueue(jobId)
    completeBackgroundCycle(jobPollHealth, performance.now())
  } catch (error) {
    failBackgroundCycle(jobPollHealth, error)
    throw error
  }
}

async function reconcileRefunds(): Promise<void> {
  try {
    const coverageIssue = payoutCoverageIssue(
      await payoutBacklog(),
      signer.address,
      'solana:EtWTRABZaYq6iMfeYKouRu166VU2xqa1',
    )
    if (coverageIssue) console.error(`payout coverage unsafe: ${coverageIssue}`)
    await processRefundClaims({
      api: refundApi,
      signer: signer as unknown as KeyPairSigner,
      rpcUrls: paymentReconciliationRpcUrls,
      fetchImpl: durablePayFence.originalFetch,
      workerId: refundWorkerId,
    })
    completeBackgroundCycle(refundReconciliationHealth, performance.now())
  } catch (error) {
    failBackgroundCycle(refundReconciliationHealth, error)
    throw error
  }
}

function enqueueRefundReconciliation(): Promise<void> {
  if (refundReconciliation) return refundReconciliation
  refundReconciliation = reconcileRefunds().finally(() => {
    refundReconciliation = null
  })
  return refundReconciliation
}

function enqueuePaymentReconciliation(): Promise<void> {
  if (paymentReconciliation) return paymentReconciliation
  paymentReconciliation = Promise.all([
    processResearchPaymentAttempts({
      api: paymentReconciliationApi,
      rpcUrls: paymentReconciliationRpcUrls,
      fetchImpl: durablePayFence.originalFetch,
      batchSize: paymentReconciliationBatchSize,
      maxSignaturePages: paymentReconciliationPages,
    }),
    processDirectPayShPaymentAttempts({
      api: directPaymentReconciliationApi,
      rpcUrls: paymentReconciliationRpcUrls,
      fetchImpl: durablePayFence.originalFetch,
      batchSize: paymentReconciliationBatchSize,
      maxSignaturePages: paymentReconciliationPages,
    }),
  ]).then((runs) => {
    const degradedAttempts = runs.flatMap((run) => run.degradedAttempts)
    if (degradedAttempts.length > 0) {
      throw new Error(
        `Pay.sh recovery has ${degradedAttempts.length} attempt(s) without complete evidence`,
      )
    }
    completeBackgroundCycle(paymentReconciliationHealth, performance.now())
  }).catch((error) => {
    failBackgroundCycle(paymentReconciliationHealth, error)
    throw error
  }).finally(() => {
    paymentReconciliation = null
  })
  return paymentReconciliation
}

const app = express()
app.disable('x-powered-by')
app.use(express.json({ limit: '8kb' }))
app.get('/healthz', (_request, response) => {
  response.json({
    status: 'ok',
    signer: signer.address,
    running: running.size,
    reconciliationRpcOrigins: paymentReconciliationRpcUrls.length,
  })
})
app.get('/readyz', async (_request, response) => {
  try {
    await Promise.all([
      signer.isAvailable(),
      internalJson<{ status: string }>('/readyz'),
    ])
    const coverageIssue = payoutCoverageIssue(
      await payoutBacklog(),
      signer.address,
      'solana:EtWTRABZaYq6iMfeYKouRu166VU2xqa1',
    )
    if (coverageIssue) throw new Error(coverageIssue)
    const nowMonotonicMs = performance.now()
    for (const issue of [
      backgroundCycleIssue({
        name: 'research job poll',
        state: jobPollHealth,
        nowMonotonicMs,
        intervalMs: pollMs,
      }),
      backgroundCycleIssue({
        name: 'refund reconciliation',
        state: refundReconciliationHealth,
        nowMonotonicMs,
        intervalMs: pollMs,
      }),
      backgroundCycleIssue({
        name: 'Pay.sh payment recovery',
        state: paymentReconciliationHealth,
        nowMonotonicMs,
        intervalMs: paymentReconciliationMs,
      }),
    ]) {
      if (issue) throw new Error(issue)
    }
    response.json({ status: 'ready', signer: signer.address })
  } catch (error) {
    response.status(503).json({ status: 'not_ready', error: safeError(error) })
  }
})
app.post('/internal/v1/research-jobs/:jobId/run', (request, response) => {
  if (!sameSecret(request.header('x-openshelf-internal-token'), internalToken)) {
    response.status(401).json({ error: { code: 'unauthorized', message: 'Unauthorized.' } })
    return
  }
  void enqueue(request.params.jobId)
  response.status(202).json({ jobId: request.params.jobId, status: 'queued' })
})
app.use((error: unknown, _request: Request, response: Response, _next: NextFunction) => {
  console.error('orchestrator request failed', safeError(error))
  response.status(500).json({ error: { code: 'internal_error', message: 'Request failed.' } })
})

setInterval(() => void reconcile().catch((error) => console.error('reconcile failed', safeError(error))), pollMs).unref()
setInterval(() => void enqueueRefundReconciliation().catch((error) => console.error('refund reconcile failed', safeError(error))), pollMs).unref()
setInterval(() => void enqueuePaymentReconciliation().catch((error) => console.error('Pay.sh reconcile failed', safeError(error))), paymentReconciliationMs).unref()
void reconcile().catch((error) => console.error('initial reconcile failed', safeError(error)))
void enqueueRefundReconciliation().catch((error) => console.error('initial refund reconcile failed', safeError(error)))
void enqueuePaymentReconciliation().catch((error) => console.error('initial Pay.sh reconcile failed', safeError(error)))
app.listen(port, '0.0.0.0', () => {
  console.log(`OPENSHELF Pay.sh orchestrator listening on http://0.0.0.0:${port}`)
})

function sameSecret(provided: string | undefined, expected: string): boolean {
  if (!provided) return false
  const left = Buffer.from(provided)
  const right = Buffer.from(expected)
  return left.length === right.length && timingSafeEqual(left, right)
}

function requiredEnv(name: string): string {
  const value = process.env[name]?.trim()
  if (!value) throw new Error(`${name} is required`)
  return value
}

function commaSeparatedEnv(name: string): string[] {
  return (process.env[name] ?? '')
    .split(',')
    .map((value) => value.trim())
    .filter(Boolean)
}

function independentRpcUrls(values: string[]): string[] {
  const byOrigin = new Map<string, string>()
  for (const value of values) {
    const url = new URL(secureServiceUrl('Pay.sh reconciliation RPC', value))
    if (!byOrigin.has(url.origin)) byOrigin.set(url.origin, url.toString())
  }
  return [...byOrigin.values()]
}

function safeError(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}
