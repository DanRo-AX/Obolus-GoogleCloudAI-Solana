import { createHash } from 'node:crypto'
import { execFile } from 'node:child_process'
import { promisify } from 'node:util'

import { LocalAgentError } from './errors.mjs'
import { payChildEnvironment, payInvocation } from './pay-sh.mjs'
import { requirePaymentIntent, updateState } from './state.mjs'

const execFileAsync = promisify(execFile)

export async function executeApprovedIntent(config, intentId, options = {}) {
  const now = options.now?.() ?? Date.now()
  let claimed = null
  await updateState(config, (state) => {
    const intent = requirePaymentIntent(state, intentId, now)
    assertIntentBinding(config, intent)
    if (intent.status !== 'approved' || !intent.approvalNonce) {
      throw new LocalAgentError(
        'This intent has not received an interactive one-time approval.',
        'payment_not_approved',
        403,
      )
    }
    intent.status = 'executing'
    intent.executionStartedAt = now
    claimed = structuredClone(intent)
    return state
  })

  const invocation = payInvocation(options.env || process.env)
  const runner = options.runner || execFileAsync
  try {
    const result = await runner(
      invocation.command,
      [...invocation.args, 'fetch', '--account', claimed.payAccount, claimed.paymentUrl],
      {
        env: payChildEnvironment(options.env || process.env),
        timeout: 120_000,
        maxBuffer: 512 * 1024,
      },
    )
    const verifiedResponse = verifiedPaymentResponse(claimed, result.stdout)
    await updateState(config, (state) => {
      const intent = requirePaymentIntent(state, intentId, options.now?.() ?? Date.now(), {
        allowExpired: true,
      })
      if (intent.status === 'completed') return state
      if (intent.status !== 'executing' || intent.approvalNonce !== claimed.approvalNonce) {
        throw new LocalAgentError('Payment execution state changed unexpectedly.', 'intent_changed', 409)
      }
      intent.status = 'completed'
      intent.completedAt = options.now?.() ?? Date.now()
      delete intent.approvalNonce
      return state
    })
    return {
      intentId,
      status: 'completed',
      payShSource: invocation.source,
      receipt: verifiedResponse,
    }
  } catch {
    await updateState(config, (state) => {
      const intent = state.paymentIntents[intentId]
      if (intent?.status === 'executing' && intent.approvalNonce === claimed.approvalNonce) {
        intent.status = 'ambiguous'
        intent.failedAt = options.now?.() ?? Date.now()
        intent.failure = 'Pay.sh did not return a confirmed success. Inspect recovery before retrying.'
        delete intent.approvalNonce
      }
      return state
    })
    throw new LocalAgentError(
      'Pay.sh execution is ambiguous and will not be retried automatically. Use the recovery tool before considering another payment.',
      'payment_ambiguous',
      502,
    )
  }
}

export function assertIntentBinding(config, intent) {
  const url = new URL(intent.paymentUrl)
  const binding = intent.approvalBinding
  const expectedPath = binding?.documentHandle
    ? `/api/v1/paid-quotes/${encodeURIComponent(binding.id)}`
    : binding?.resourcePath
  if (
    url.origin !== config.gatewayOrigin ||
    url.username ||
    url.password ||
    url.search ||
    url.hash ||
    url.pathname !== expectedPath ||
    sha256(intent.paymentUrl) !== intent.paymentUrlHash ||
    intent.quoteId !== binding?.id ||
    intent.amountAtomic !== String(binding?.amountAtomic) ||
    intent.network !== binding?.network ||
    intent.asset !== binding?.asset ||
    intent.payTo !== binding?.payTo ||
    !config.payAccount ||
    intent.payAccount !== config.payAccount
  ) {
    throw new LocalAgentError('The approved payment binding is invalid.', 'unsafe_payment_intent')
  }
}

function sha256(value) {
  return createHash('sha256').update(value).digest('hex')
}

function verifiedPaymentResponse(intent, stdout) {
  let body
  try {
    body = JSON.parse(String(stdout || ''))
  } catch {
    throw new LocalAgentError('Pay.sh returned a non-JSON response.', 'invalid_payment_response')
  }
  const binding = intent.approvalBinding
  if (binding.documentHandle) {
    const citation = Array.isArray(body?.citations) ? body.citations[0] : null
    if (
      body?.citations?.length !== 1 ||
      citation?.handle !== binding.documentHandle ||
      citation?.price !== binding.priceKrw ||
      body?.settlement?.id !== intent.quoteId ||
      body?.settlement?.count !== 1 ||
      body?.settlement?.total !== binding.priceKrw ||
      body?.settlement?.network !== intent.network
    ) {
      throw new LocalAgentError(
        'Pay.sh did not return the exact approved document receipt.',
        'invalid_payment_response',
      )
    }
    return {
      kind: 'document',
      quoteId: intent.quoteId,
      citationHandles: [citation.handle],
      totalPriceKrw: body.settlement.total,
      network: body.settlement.network,
      evidenceBodyWithheld: true,
    }
  }
  if (
    body?.jobId !== intent.quoteId ||
    body?.status !== 'funding' ||
    body?.documentCount !== binding.documentHandles?.length ||
    body?.total !== binding.totalPriceKrw ||
    body?.network !== intent.network
  ) {
    throw new LocalAgentError(
      'Pay.sh did not return the exact approved bundle receipt.',
      'invalid_payment_response',
    )
  }
  return {
    kind: 'bundle',
    jobId: body.jobId,
    status: body.status,
    documentCount: body.documentCount,
    totalPriceKrw: body.total,
    network: body.network,
  }
}
