import { Credential, type Challenge } from 'mppx'
import { PayShPaymentNotSentError } from './payment-errors.js'
import { validatePayShChallenge, type PayShResource } from './runner.js'

export type PreparePaymentRecord = {
  quoteId: string
  payer: string
  platformRecipientWallet: string
  challengeId: string
  externalId: string
  signedTransactionBase64: string
  recentBlockhash: string
  challengeExpiresAt: number
}

export type DurablePaymentContext = {
  jobId: string
  attemptId: string
  resource: PayShResource
  signerAddress: string
  operatorWallet: string
  prepare(record: PreparePaymentRecord): Promise<unknown>
}

export type DurablePayFetchFence = {
  originalFetch: typeof globalThis.fetch
  withAttempt<T>(context: DurablePaymentContext, action: () => Promise<T>): Promise<T>
}

type SolanaTransactionPayload = {
  type: 'transaction'
  transaction: string
}

/**
 * Installs the transport boundary before PayKit is imported. PayKit captures
 * this wrapper as its native fetch, so an MPP Authorization request cannot
 * leave the process until its exact signed transaction is durable in Rust.
 */
export function installDurablePayFetchFence(payShGatewayBase: string): DurablePayFetchFence {
  const gatewayOrigin = new URL(payShGatewayBase).origin
  const originalFetch = globalThis.fetch.bind(globalThis)
  const attempts = new Map<string, DurablePaymentContext>()

  const fencedFetch: typeof globalThis.fetch = async (input, init) => {
    const request = new Request(input, init)
    const url = new URL(request.url)
    if (url.origin !== gatewayOrigin) return originalFetch(input, init)

    const authorization = request.headers.get('authorization')
    if (!authorization || !Credential.extractPaymentScheme(authorization)) {
      return originalFetch(input, init)
    }

    try {
      const attemptId = url.searchParams.get('payment_attempt_id')
      const context = attemptId ? attempts.get(attemptId) : undefined
      if (!attemptId || !context) {
        throw new Error('Pay.sh paid transport has no active durable research payment fence')
      }
      if (context.attemptId !== attemptId) {
        throw new Error('Pay.sh paid transport attempt id does not match its durable fence')
      }

      const credential = Credential.deserialize<SolanaTransactionPayload>(authorization)
      const payload = credential.payload
      if (payload?.type !== 'transaction' || typeof payload.transaction !== 'string') {
        throw new Error('Pay.sh credential does not contain a signed Solana transaction')
      }
      validatePayShChallenge(
        credential.challenge as Challenge.Challenge,
        context.resource,
        context.operatorWallet,
        context.signerAddress,
      )

      const requestData = credential.challenge.request as Record<string, unknown>
      const details = requestData.methodDetails as Record<string, unknown> | undefined
      const externalId = requestData.externalId
      const recentBlockhash = details?.recentBlockhash
      const expiresAt = credential.challenge.expires
        ? Date.parse(credential.challenge.expires)
        : Number.NaN
      if (
        typeof externalId !== 'string'
        || typeof recentBlockhash !== 'string'
        || !Number.isSafeInteger(expiresAt)
      ) {
        throw new Error('Pay.sh credential is missing durable reconciliation metadata')
      }

      await context.prepare({
        quoteId: context.resource.quoteId,
        payer: context.signerAddress,
        platformRecipientWallet: context.operatorWallet,
        challengeId: credential.challenge.id,
        externalId,
        signedTransactionBase64: payload.transaction,
        recentBlockhash,
        challengeExpiresAt: expiresAt,
      })
    } catch (error) {
      throw new PayShPaymentNotSentError(
        `Pay.sh paid request was not sent: ${error instanceof Error ? error.message : String(error)}`,
        { cause: error },
      )
    }
    return originalFetch(input, init)
  }

  globalThis.fetch = fencedFetch
  return {
    originalFetch,
    async withAttempt<T>(context: DurablePaymentContext, action: () => Promise<T>): Promise<T> {
      if (!/^[0-9a-f]{64}$/.test(context.attemptId)) {
        throw new Error('research payment attempt id must be 32 bytes of lowercase hex')
      }
      if (attempts.has(context.attemptId)) {
        throw new Error('research payment attempt is already active in this process')
      }
      attempts.set(context.attemptId, context)
      try {
        return await action()
      } finally {
        attempts.delete(context.attemptId)
      }
    },
  }
}
