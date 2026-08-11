import {
  getCompiledTransactionMessageDecoder,
  getCompiledTransactionMessageEncoder,
  isTransactionModifyingSigner,
  isTransactionPartialSigner,
  type Transaction,
  type TransactionModifyingSigner,
  type TransactionSigner,
  type TransactionWithinSizeLimit,
  type TransactionWithLifetime,
} from '@solana/kit'

const COMPUTE_BUDGET_PROGRAM = 'ComputeBudget111111111111111111111111111111'
const SET_COMPUTE_UNIT_LIMIT = 2
type SignableTransaction = Transaction & TransactionWithinSizeLimit & TransactionWithLifetime

/**
 * x402/svm 2.20.0 emits a 20,000 CU limit. A transfer plus our quote-bound
 * memo consumes 25,332 CU on Devnet, so the upstream default cannot settle.
 * Keep this comfortably below the gateway's 200,000 CU fee-sponsorship cap.
 */
export const OPENSHELF_X402_COMPUTE_UNIT_LIMIT = 50_000

/**
 * Turns either a browser-wallet modifying signer or an in-memory partial
 * signer into the modifying signer x402 needs, raising only its existing
 * SetComputeUnitLimit instruction before any party signs the message.
 */
export function withSufficientSvmComputeBudget(
  signer: TransactionSigner,
  minimumUnits = OPENSHELF_X402_COMPUTE_UNIT_LIMIT,
): TransactionModifyingSigner {
  return {
    address: signer.address,
    async modifyAndSignTransactions(transactions, config) {
      const adjusted = transactions.map((transaction) =>
        raiseSvmComputeUnitLimit(transaction, minimumUnits),
      ) as SignableTransaction[]

      if (isTransactionModifyingSigner(signer)) {
        return signer.modifyAndSignTransactions(adjusted, config)
      }
      if (isTransactionPartialSigner(signer)) {
        const signatures = await signer.signTransactions(adjusted, config)
        return adjusted.map((transaction, index) => Object.freeze({
          ...transaction,
          signatures: Object.freeze({
            ...transaction.signatures,
            ...signatures[index],
          }),
        }) as SignableTransaction)
      }
      throw new Error('SVM signer cannot sign an adjusted x402 transaction')
    },
  }
}

export function raiseSvmComputeUnitLimit<TTransaction extends Transaction>(
  transaction: TTransaction,
  minimumUnits = OPENSHELF_X402_COMPUTE_UNIT_LIMIT,
): TTransaction {
  if (!Number.isSafeInteger(minimumUnits) || minimumUnits <= 0 || minimumUnits > 200_000) {
    throw new Error('x402 compute-unit limit must be between 1 and 200,000')
  }
  if (Object.values(transaction.signatures).some((signature) => signature !== null)) {
    throw new Error('x402 compute-unit limit must be adjusted before signing')
  }

  const decoder = getCompiledTransactionMessageDecoder()
  const encoder = getCompiledTransactionMessageEncoder()
  const message = decoder.decode(transaction.messageBytes)
  const programIndex = message.staticAccounts.findIndex(
    (account) => String(account) === COMPUTE_BUDGET_PROGRAM,
  )
  if (programIndex < 0) throw new Error('x402 transaction omitted the compute-budget program')

  let matches = 0
  let changed = false
  const instructions = message.instructions.map((instruction) => {
    const data = instruction.data
    if (
      instruction.programAddressIndex !== programIndex
      || !data
      || data.length !== 5
      || data[0] !== SET_COMPUTE_UNIT_LIMIT
    ) return instruction

    matches += 1
    const currentUnits = new DataView(data.buffer, data.byteOffset, data.byteLength)
      .getUint32(1, true)
    if (currentUnits >= minimumUnits) return instruction

    const adjustedData = new Uint8Array(data)
    new DataView(adjustedData.buffer, adjustedData.byteOffset, adjustedData.byteLength)
      .setUint32(1, minimumUnits, true)
    changed = true
    return { ...instruction, data: adjustedData }
  })

  if (matches !== 1) {
    throw new Error(`x402 transaction must contain exactly one compute-unit limit; received ${matches}`)
  }
  if (!changed) return transaction

  return Object.freeze({
    ...transaction,
    messageBytes: encoder.encode({ ...message, instructions }) as Transaction['messageBytes'],
  }) as TTransaction
}
