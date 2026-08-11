import { randomUUID } from 'node:crypto'
import { createInterface } from 'node:readline/promises'

import { LocalAgentError } from './errors.mjs'
import { requirePaymentIntent, updateState } from './state.mjs'

export async function approvePaymentIntent(config, intentId, options = {}) {
  const now = options.now?.() ?? Date.now()
  let snapshot = null
  await updateState(config, (state) => {
    const intent = requirePaymentIntent(state, intentId, now)
    if (intent.status !== 'prepared') {
      throw new LocalAgentError(
        `Payment intent is ${intent.status}; only a prepared intent can be approved.`,
        'intent_not_approvable',
        409,
      )
    }
    snapshot = structuredClone(intent)
    return state
  })

  const phrase = `APPROVE ${intentId.slice(-8)}`
  const summary = [
    'Obulus one-time Pay.sh approval',
    `Purpose: ${snapshot.purpose}`,
    `Amount: ${snapshot.amountAtomic} atomic units (${snapshot.asset})`,
    `Network: ${snapshot.network}`,
    `Recipient: ${snapshot.payTo}`,
    `Pay.sh account: ${snapshot.payAccount}`,
    `Immutable quote: ${snapshot.quoteId}`,
    `Expires: ${new Date(snapshot.expiresAt).toISOString()}`,
    `Type exactly: ${phrase}`,
  ].join('\n')

  const accepted = options.confirm
    ? await options.confirm({ phrase, summary, intent: snapshot })
    : await interactiveConfirmation(summary, phrase, options)
  if (!accepted) {
    throw new LocalAgentError('Payment approval was not granted.', 'approval_rejected', 403)
  }

  await updateState(config, (state) => {
    const intent = requirePaymentIntent(state, intentId, options.now?.() ?? Date.now())
    if (intent.status !== 'prepared') {
      throw new LocalAgentError('Payment intent changed before approval.', 'intent_changed', 409)
    }
    if (approvalFingerprint(intent) !== approvalFingerprint(snapshot)) {
      throw new LocalAgentError(
        'Payment economics changed while approval was pending.',
        'intent_changed',
        409,
      )
    }
    intent.status = 'approved'
    intent.approvedAt = options.now?.() ?? Date.now()
    intent.approvalNonce = randomUUID()
    return state
  })
  return { intentId, status: 'approved', expiresAt: snapshot.expiresAt }
}

function approvalFingerprint(intent) {
  return JSON.stringify({
    queryId: intent.queryId,
    quoteId: intent.quoteId,
    purpose: intent.purpose,
    paymentUrlHash: intent.paymentUrlHash,
    amountAtomic: intent.amountAtomic,
    network: intent.network,
    asset: intent.asset,
    payTo: intent.payTo,
    payAccount: intent.payAccount,
    expiresAt: intent.expiresAt,
    approvalBinding: intent.approvalBinding,
  })
}

async function interactiveConfirmation(summary, phrase, options) {
  const input = options.input || process.stdin
  const output = options.output || process.stdout
  if (!input.isTTY || !output.isTTY) {
    throw new LocalAgentError(
      'Approval requires a real interactive terminal; piped or model-generated approval is refused.',
      'interactive_approval_required',
      403,
    )
  }
  output.write(`${summary}\n`)
  const lines = createInterface({ input, output })
  try {
    return (await lines.question('> ')).trim() === phrase
  } finally {
    lines.close()
  }
}
