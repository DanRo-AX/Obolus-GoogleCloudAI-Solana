import { timingSafeEqual } from 'node:crypto'
import express, { type NextFunction, type Request, type Response } from 'express'
import { createGcpKmsSigner } from '@solana/keychain-gcp-kms'
import type { KeyPairSigner } from '@solana/kit'
import { createPayKitClient } from '@solana/pay-kit/client'
import { runResearchJob, type ResearchApi, type ResearchJobPlan } from './runner.js'
import { processRefundClaims, type PayoutClaim, type RefundApi } from './refunds.js'

const rustApiUrl = requiredEnv('RUST_API_URL').replace(/\/$/, '')
const payShGatewayBase = requiredEnv('PAY_SH_GATEWAY_BASE').replace(/\/$/, '')
const internalToken = requiredEnv('OPENSHELF_INTERNAL_TOKEN')
if (internalToken.length < 32) {
  throw new Error('OPENSHELF_INTERNAL_TOKEN must be at least 32 characters')
}
const rpcUrl = requiredEnv('OPENSHELF_PAY_RPC_URL')
const keyName = requiredEnv('OPENSHELF_PAY_GCP_KMS_KEY_NAME')
const publicKey = requiredEnv('OPENSHELF_PAY_GCP_KMS_PUBKEY')
const port = integerEnv('PORT', 1410)
const pollMs = integerEnv('OPENSHELF_RESEARCH_POLL_MS', 10_000)
const refundWorkerId = process.env.OPENSHELF_REFUND_WORKER_ID?.trim() || `research-refund-${process.pid}`

const signer = createGcpKmsSigner({ keyName, publicKey, requestDelayMs: 50 })
// pay-kit 0.8 types its payer as an in-memory KeyPairSigner even though the
// MPP charge path consumes only the standard transaction-signer interface.
// Restricting this client to MPP keeps all private-key material inside KMS.
const payClient = await createPayKitClient({
  signer: signer as unknown as KeyPairSigner,
  rpcUrl,
  accept: ['mpp'],
})
const running = new Map<string, Promise<void>>()
let refundReconciliation: Promise<void> | null = null

async function internalJson<T>(path: string, init: RequestInit = {}): Promise<T> {
  const response = await fetch(`${rustApiUrl}${path}`, {
    ...init,
    headers: {
      'content-type': 'application/json',
      'x-openshelf-internal-token': internalToken,
      ...init.headers,
    },
  })
  if (!response.ok) {
    throw new Error(`Rust API ${response.status}: ${(await response.text()).slice(0, 500)}`)
  }
  return (await response.json()) as T
}

const api: ResearchApi = {
  plan: (jobId) =>
    internalJson<ResearchJobPlan>(
      `/internal/v1/research-jobs/${encodeURIComponent(jobId)}/plan`,
    ),
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
}
const refundApi: RefundApi = {
  lease: (workerId, escrowWallet, network) =>
    internalJson<PayoutClaim[]>('/internal/v1/payout-claims/lease', {
      method: 'POST',
      body: JSON.stringify({ workerId, escrowWallet, network, limit: 20, leaseMs: 60_000 }),
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

function enqueue(jobId: string): Promise<void> {
  const existing = running.get(jobId)
  if (existing) return existing
  const task = runResearchJob({
    jobId,
    signerAddress: signer.address,
    payShGatewayBase,
    api,
    payClient,
  })
    .catch((error) => console.error(`research job ${jobId} failed`, safeError(error)))
    .finally(() => running.delete(jobId))
  running.set(jobId, task)
  return task
}

async function reconcile(): Promise<void> {
  const jobs = await internalJson<string[]>('/internal/v1/research-jobs/runnable')
  for (const jobId of jobs) void enqueue(jobId)
}

async function reconcileRefunds(): Promise<void> {
  await processRefundClaims({
    api: refundApi,
    signer: signer as unknown as KeyPairSigner,
    rpcUrl,
    workerId: refundWorkerId,
  })
}

function enqueueRefundReconciliation(): Promise<void> {
  if (refundReconciliation) return refundReconciliation
  refundReconciliation = reconcileRefunds().finally(() => {
    refundReconciliation = null
  })
  return refundReconciliation
}

const app = express()
app.disable('x-powered-by')
app.use(express.json({ limit: '8kb' }))
app.get('/healthz', (_request, response) => {
  response.json({ status: 'ok', signer: signer.address, running: running.size })
})
app.get('/readyz', async (_request, response) => {
  try {
    await signer.isAvailable()
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
void reconcile().catch((error) => console.error('initial reconcile failed', safeError(error)))
void enqueueRefundReconciliation().catch((error) => console.error('initial refund reconcile failed', safeError(error)))
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

function integerEnv(name: string, fallback: number): number {
  const value = Number.parseInt(process.env[name] ?? '', 10)
  return Number.isSafeInteger(value) && value > 0 ? value : fallback
}

function safeError(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}
