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
      [...invocation.args, 'curl', claimed.paymentUrl],
      {
        env: payChildEnvironment(options.env || process.env),
        timeout: 120_000,
        maxBuffer: 2 * 1024 * 1024,
      },
    )
    await updateState(config, (state) => {
      const intent = requirePaymentIntent(state, intentId, options.now?.() ?? Date.now(), {
        allowExpired: true,
      })
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
      response: boundedText(result.stdout),
      diagnostics: boundedText(result.stderr),
    }
  } catch (error) {
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
      `Pay.sh execution is ambiguous and will not be retried automatically: ${error.message}`,
      'payment_ambiguous',
      502,
    )
  }
}

export function assertIntentBinding(config, intent) {
  const url = new URL(intent.paymentUrl)
  const binding = intent.approvalBinding
  if (
    url.origin !== config.gatewayOrigin ||
    url.username ||
    url.password ||
    url.search ||
    url.hash ||
    url.pathname !== binding?.resourcePath ||
    sha256(intent.paymentUrl) !== intent.paymentUrlHash ||
    intent.quoteId !== binding?.id ||
    intent.amountAtomic !== String(binding?.amountAtomic) ||
    intent.network !== binding?.network ||
    intent.asset !== binding?.asset ||
    intent.payTo !== binding?.payTo
  ) {
    throw new LocalAgentError('The approved payment binding is invalid.', 'unsafe_payment_intent')
  }
}

function sha256(value) {
  return createHash('sha256').update(value).digest('hex')
}

function boundedText(value) {
  const text = String(value || '')
  return text.length > 200_000 ? `${text.slice(0, 200_000)}\n[truncated]` : text
}
