import {
  fetchMint,
  findAssociatedTokenPda,
  getCreateAssociatedTokenIdempotentInstruction,
  getTransferCheckedInstruction,
  TOKEN_PROGRAM_ADDRESS,
} from '@solana-program/token'
import {
  appendTransactionMessageInstructions,
  createSolanaRpc,
  createTransactionMessage,
  devnet,
  getBase64EncodedWireTransaction,
  getSignatureFromTransaction,
  pipe,
  setTransactionMessageFeePayerSigner,
  setTransactionMessageLifetimeUsingBlockhash,
  signTransactionMessageWithSigners,
  signature,
  type Address,
  type Base64EncodedWireTransaction,
  type KeyPairSigner,
} from '@solana/kit'

export type PayoutClaim = {
  id: string
  kind: string
  escrowWallet: string
  recipientWallet: string
  asset: string
  network: string
  amountAtomic: string
  status: string
  transactionSignature?: string | null
  signedTransactionBase64?: string | null
  recentBlockhash?: string | null
  lastValidBlockHeight?: number | null
}

export type RefundApi = {
  lease(workerId: string, escrowWallet: string, network: string): Promise<PayoutClaim[]>
  prepare(claimId: string, body: object): Promise<PayoutClaim>
  complete(claimId: string, body: object): Promise<PayoutClaim>
  fail(claimId: string, body: object): Promise<PayoutClaim>
}

const DEVNET_NETWORK = 'solana:EtWTRABZaYq6iMfeYKouRu166VU2xqa1'

/** Processes durable contributor and refund claims from the KMS escrow wallet. */
export async function processRefundClaims(options: {
  api: RefundApi
  signer: KeyPairSigner
  rpcUrl: string
  workerId: string
}): Promise<void> {
  const rpc = createSolanaRpc(devnet(options.rpcUrl))
  const claims = await options.api.lease(
    options.workerId,
    options.signer.address,
    DEVNET_NETWORK,
  )
  for (const claim of claims) {
    try {
      if (
        claim.status === 'prepared' &&
        claim.transactionSignature &&
        claim.signedTransactionBase64 &&
        claim.lastValidBlockHeight
      ) {
        const status = (await rpc.getSignatureStatuses([
          signature(claim.transactionSignature),
        ], { searchTransactionHistory: true }).send()).value[0]
        if (status?.err) throw new Error(`refund failed on-chain: ${JSON.stringify(status.err)}`)
        if (status?.confirmationStatus === 'confirmed' || status?.confirmationStatus === 'finalized') {
          await options.api.complete(claim.id, {
            workerId: options.workerId,
            transactionSignature: claim.transactionSignature,
          })
          continue
        }
        const height = await rpc.getBlockHeight({ commitment: 'confirmed' }).send()
        if (height > BigInt(claim.lastValidBlockHeight)) {
          await options.api.fail(claim.id, {
            workerId: options.workerId,
            error: 'prepared refund expired without landing',
            abandonPreparedTransaction: true,
          })
          continue
        }
        await broadcastAndConfirm(options.api, rpc, options.workerId, claim)
        continue
      }

      const mint = claim.asset as Address
      const recipient = claim.recipientWallet as Address
      const [source] = await findAssociatedTokenPda({
        owner: options.signer.address,
        tokenProgram: TOKEN_PROGRAM_ADDRESS,
        mint,
      })
      const [destination] = await findAssociatedTokenPda({
        owner: recipient,
        tokenProgram: TOKEN_PROGRAM_ADDRESS,
        mint,
      })
      const mintInfo = await fetchMint(rpc, mint, { commitment: 'confirmed' })
      const amount = BigInt(claim.amountAtomic)
      if (amount <= 0n) throw new Error('refund amount must be positive')
      const latest = (await rpc.getLatestBlockhash({ commitment: 'confirmed' }).send()).value
      const message = pipe(
        createTransactionMessage({ version: 0 }),
        (value) => setTransactionMessageFeePayerSigner(options.signer, value),
        (value) => setTransactionMessageLifetimeUsingBlockhash(latest, value),
        (value) => appendTransactionMessageInstructions([
          getCreateAssociatedTokenIdempotentInstruction({
            payer: options.signer,
            ata: destination,
            owner: recipient,
            mint,
          }),
          getTransferCheckedInstruction({
            source,
            mint,
            destination,
            authority: options.signer,
            amount,
            decimals: mintInfo.data.decimals,
          }),
        ], value),
      )
      const transaction = await signTransactionMessageWithSigners(message)
      const prepared = await options.api.prepare(claim.id, {
        workerId: options.workerId,
        transactionSignature: getSignatureFromTransaction(transaction),
        signedTransactionBase64: getBase64EncodedWireTransaction(transaction),
        recentBlockhash: latest.blockhash,
        lastValidBlockHeight: Number(latest.lastValidBlockHeight),
      })
      await broadcastAndConfirm(options.api, rpc, options.workerId, prepared)
    } catch (error) {
      await options.api.fail(claim.id, {
        workerId: options.workerId,
        error: safeError(error).slice(0, 1_000),
        abandonPreparedTransaction: false,
      }).catch(() => undefined)
    }
  }
}

async function broadcastAndConfirm(
  api: RefundApi,
  rpc: ReturnType<typeof createSolanaRpc>,
  workerId: string,
  claim: PayoutClaim,
): Promise<void> {
  if (!claim.transactionSignature || !claim.signedTransactionBase64) {
    throw new Error('prepared refund is incomplete')
  }
  const sent = await rpc.sendTransaction(
    claim.signedTransactionBase64 as Base64EncodedWireTransaction,
    { encoding: 'base64', skipPreflight: false, preflightCommitment: 'confirmed', maxRetries: 3n },
  ).send()
  if (sent !== claim.transactionSignature) throw new Error('refund signature mismatch')
  for (let attempt = 0; attempt < 60; attempt += 1) {
    const status = (await rpc.getSignatureStatuses([
      signature(claim.transactionSignature),
    ], { searchTransactionHistory: true }).send()).value[0]
    if (status?.err) throw new Error(`refund failed: ${JSON.stringify(status.err)}`)
    if (status?.confirmationStatus === 'confirmed' || status?.confirmationStatus === 'finalized') {
      await api.complete(claim.id, { workerId, transactionSignature: sent })
      return
    }
    await new Promise((resolve) => setTimeout(resolve, 1_000))
  }
  throw new Error('refund confirmation timed out')
}

function safeError(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}
