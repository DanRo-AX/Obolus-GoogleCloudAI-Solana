import {
  scanExactFinalizedPayShPayment,
  type DirectPayShPaymentAttempt,
} from '../agent-orchestrator/src/pay-sh-reconciler.js'
import { boundedResponseText } from '../agent-orchestrator/src/bounded-response.js'

const rustApiUrl = requiredEnv('RUST_API_URL').replace(/\/$/, '')
const internalToken = requiredEnv('OPENSHELF_INTERNAL_TOKEN')
const rpcUrl = requiredEnv('PAY_SH_RPC_URL')
const timeoutMs = positiveIntegerEnv('OPENSHELF_SANDBOX_RECOVERY_TIMEOUT_MS', 90_000)
const MAX_INTERNAL_RESPONSE_BYTES = 1024 * 1024

async function internalJson<T>(path: string, init: RequestInit = {}): Promise<T> {
  const response = await fetch(`${rustApiUrl}${path}`, {
    ...init,
    redirect: 'error',
    signal: AbortSignal.timeout(20_000),
    headers: {
      'content-type': 'application/json',
      'x-openshelf-internal-token': internalToken,
      ...init.headers,
    },
  })
  const body = await boundedResponseText(
    response,
    MAX_INTERNAL_RESPONSE_BYTES,
    'Rust recovery API response',
  )
  if (!response.ok) {
    throw new Error(`Rust recovery API ${response.status}: ${body.slice(0, 500)}`)
  }
  return JSON.parse(body) as T
}

const deadline = Date.now() + timeoutMs
while (Date.now() < deadline) {
  const attempts = await internalJson<DirectPayShPaymentAttempt[]>(
    '/internal/v1/direct-pay-sh-attempts/reconciliation?limit=10',
  )
  for (const attempt of attempts) {
    const scan = await scanExactFinalizedPayShPayment({
      attempt,
      rpcUrl,
      maxSignaturePages: 5,
    })
    if (scan.kind !== 'settled') continue
    await internalJson(
      `/internal/v1/direct-pay-sh-attempts/${encodeURIComponent(attempt.attemptId)}/settle`,
      {
        method: 'POST',
        body: JSON.stringify({ transactionSignature: scan.signature }),
      },
    )
    console.log(JSON.stringify({
      status: 'recovered-exact-finalized-payment',
      attemptId: attempt.attemptId,
      transactionSignature: scan.signature,
    }))
    process.exit(0)
  }
  await new Promise((resolve) => setTimeout(resolve, 1_000))
}

throw new Error(`No due exact finalized Pay.sh payment was recovered within ${timeoutMs}ms`)

function requiredEnv(name: string): string {
  const value = process.env[name]?.trim()
  if (!value) throw new Error(`${name} is required`)
  return value
}

function positiveIntegerEnv(name: string, fallback: number): number {
  const raw = process.env[name]?.trim()
  if (!raw) return fallback
  if (!/^[1-9][0-9]*$/.test(raw)) throw new Error(`${name} must be a positive integer`)
  const value = Number(raw)
  if (!Number.isSafeInteger(value) || value > 300_000) {
    throw new Error(`${name} must be at most 300000`)
  }
  return value
}
