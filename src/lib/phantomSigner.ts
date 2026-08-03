import {
  address,
  getTransactionDecoder,
  getTransactionEncoder,
  type Transaction,
  type TransactionModifyingSigner,
  type TransactionWithinSizeLimit,
  type TransactionWithLifetime,
} from '@solana/kit'
import { VersionedTransaction } from '@solana/web3.js'

import type { PhantomProvider } from '@/state/wallet'

/** Adapts Phantom's injected signer to the signer interface used by x402/SVM. */
export function phantomSvmSigner(provider: PhantomProvider): TransactionModifyingSigner {
  const publicKey = provider.publicKey?.toString()
  if (!publicKey) throw new Error('Connect a wallet before paying.')

  const encoder = getTransactionEncoder()
  const decoder = getTransactionDecoder()

  return {
    address: address(publicKey),
    async modifyAndSignTransactions(transactions) {
      const signed: (Transaction & TransactionWithinSizeLimit & TransactionWithLifetime)[] = []
      for (const transaction of transactions) {
        const phantomTransaction = VersionedTransaction.deserialize(
          new Uint8Array(encoder.encode(transaction)),
        )
        const approved = await provider.signTransaction(phantomTransaction)
        signed.push(
          decoder.decode(approved.serialize()) as Transaction &
            TransactionWithinSizeLimit &
            TransactionWithLifetime,
        )
      }
      return signed
    },
  }
}
