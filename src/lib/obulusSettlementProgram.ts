import { PublicKey, SystemProgram, TransactionInstruction } from '@solana/web3.js'

export const OBULUS_INVOICE_SEED = new TextEncoder().encode('obulus-invoice')
export const TOKEN_PROGRAM_ID = new PublicKey('TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA')
export const ASSOCIATED_TOKEN_PROGRAM_ID = new PublicKey(
  'ATokenGPvbdGVxr1b2hvZbsiqW5xWH25efTNsLJA8knL',
)
export const MAX_ONCHAIN_LINE_ITEMS = 20
export const MAX_ONCHAIN_PROTOCOL_FEE_BPS = 1_000n
export const MIN_DISPUTE_WINDOW_SECONDS = 60
export const MAX_DISPUTE_WINDOW_SECONDS = 86_400

export type OnchainInvoiceLineItem = {
  recipientTokenAccount: string
  documentHash: string
  documentVersion: number
  amountAtomic: string
  kind: 0 | 1
}

export type CreateOnchainInvoiceArgs = {
  invoiceHash: string
  queryHash: string
  bundleRoot: string
  authorization: string
  disputeResolver: string
  totalAmountAtomic: string
  platformFeeAtomic: string
  expiresAtUnixSeconds: number
  disputeWindowSeconds: number
  lineItems: OnchainInvoiceLineItem[]
}

export type CreateAndFundAccounts = {
  programId: string
  payer: string
  payerTokenAccount: string
  escrowTokenAccount: string
  refundTokenAccount: string
  mint: string
}

/**
 * Derives the order-specific PDA that owns only this invoice's escrow. It has
 * no private key, so neither Obulus nor a developer can transfer its funds
 * outside the immutable program state machine.
 */
export function deriveInvoicePda(
  programId: string,
  payer: string,
  invoiceHash: string,
): { address: string; bump: number } {
  const [address, bump] = PublicKey.findProgramAddressSync(
    [OBULUS_INVOICE_SEED, new PublicKey(payer).toBytes(), hex32(invoiceHash, 'invoice hash')],
    new PublicKey(programId),
  )
  return { address: address.toBase58(), bump }
}

/** Builds the buyer-signed create+fund instruction using the exact Borsh wire format. */
export function buildCreateAndFundInstruction(
  args: CreateOnchainInvoiceArgs,
  accounts: CreateAndFundAccounts,
): TransactionInstruction {
  validateOnchainInvoice(args)
  const invoice = deriveInvoicePda(accounts.programId, accounts.payer, args.invoiceHash)
  const data = concatBytes(
    Uint8Array.of(0),
    hex32(args.invoiceHash, 'invoice hash'),
    hex32(args.queryHash, 'query hash'),
    hex32(args.bundleRoot, 'bundle root'),
    new PublicKey(args.authorization).toBytes(),
    new PublicKey(args.disputeResolver).toBytes(),
    u64(args.totalAmountAtomic),
    u64(args.platformFeeAtomic),
    i64(args.expiresAtUnixSeconds),
    u32(args.disputeWindowSeconds),
    u32(args.lineItems.length),
    ...args.lineItems.map(encodeLineItem),
  )
  return new TransactionInstruction({
    programId: new PublicKey(accounts.programId),
    keys: [
      { pubkey: new PublicKey(accounts.payer), isSigner: true, isWritable: true },
      { pubkey: new PublicKey(invoice.address), isSigner: false, isWritable: true },
      { pubkey: new PublicKey(accounts.payerTokenAccount), isSigner: false, isWritable: true },
      { pubkey: new PublicKey(accounts.escrowTokenAccount), isSigner: false, isWritable: true },
      { pubkey: new PublicKey(accounts.refundTokenAccount), isSigner: false, isWritable: false },
      { pubkey: new PublicKey(accounts.mint), isSigner: false, isWritable: false },
      { pubkey: TOKEN_PROGRAM_ID, isSigner: false, isWritable: false },
      { pubkey: SystemProgram.programId, isSigner: false, isWritable: false },
      ...args.lineItems.map((item) => ({
        pubkey: new PublicKey(item.recipientTokenAccount), isSigner: false, isWritable: false,
      })),
    ],
    data: Buffer.from(data),
  })
}

export function buildAcknowledgeDeliveryInstruction(
  programId: string,
  authorization: string,
  invoicePda: string,
  deliveryRoot: string,
): TransactionInstruction {
  return new TransactionInstruction({
    programId: new PublicKey(programId),
    keys: [
      { pubkey: new PublicKey(authorization), isSigner: true, isWritable: false },
      { pubkey: new PublicKey(invoicePda), isSigner: false, isWritable: true },
    ],
    data: Buffer.from(concatBytes(Uint8Array.of(1), hex32(deliveryRoot, 'delivery root'))),
  })
}

export function buildSettleInstruction(
  programId: string,
  invoicePda: string,
  escrowTokenAccount: string,
  mint: string,
  recipientTokenAccounts: readonly string[],
): TransactionInstruction {
  if (recipientTokenAccounts.length === 0 || recipientTokenAccounts.length > MAX_ONCHAIN_LINE_ITEMS) {
    throw new Error('settlement needs the invoice\'s exact recipient token-account list')
  }
  return new TransactionInstruction({
    programId: new PublicKey(programId),
    keys: [
      { pubkey: new PublicKey(invoicePda), isSigner: false, isWritable: true },
      { pubkey: new PublicKey(escrowTokenAccount), isSigner: false, isWritable: true },
      { pubkey: new PublicKey(mint), isSigner: false, isWritable: false },
      { pubkey: TOKEN_PROGRAM_ID, isSigner: false, isWritable: false },
      ...recipientTokenAccounts.map((recipient) => ({
        pubkey: new PublicKey(recipient), isSigner: false, isWritable: true,
      })),
    ],
    data: Buffer.from([2]),
  })
}

export function buildDisputeInstruction(
  programId: string,
  payer: string,
  invoicePda: string,
): TransactionInstruction {
  return new TransactionInstruction({
    programId: new PublicKey(programId),
    keys: [
      { pubkey: new PublicKey(payer), isSigner: true, isWritable: false },
      { pubkey: new PublicKey(invoicePda), isSigner: false, isWritable: true },
    ],
    data: Buffer.from([3]),
  })
}

export function buildResolveDisputeInstruction(
  programId: string,
  disputeResolver: string,
  invoicePda: string,
  refund: boolean,
): TransactionInstruction {
  return new TransactionInstruction({
    programId: new PublicKey(programId),
    keys: [
      { pubkey: new PublicKey(disputeResolver), isSigner: true, isWritable: false },
      { pubkey: new PublicKey(invoicePda), isSigner: false, isWritable: true },
    ],
    data: Buffer.from([4, refund ? 1 : 0]),
  })
}

export function buildRefundInstruction(
  programId: string,
  caller: string,
  callerMustSign: boolean,
  invoicePda: string,
  escrowTokenAccount: string,
  refundTokenAccount: string,
  mint: string,
): TransactionInstruction {
  return new TransactionInstruction({
    programId: new PublicKey(programId),
    keys: [
      { pubkey: new PublicKey(caller), isSigner: callerMustSign, isWritable: false },
      { pubkey: new PublicKey(invoicePda), isSigner: false, isWritable: true },
      { pubkey: new PublicKey(escrowTokenAccount), isSigner: false, isWritable: true },
      { pubkey: new PublicKey(refundTokenAccount), isSigner: false, isWritable: true },
      { pubkey: new PublicKey(mint), isSigner: false, isWritable: false },
      { pubkey: TOKEN_PROGRAM_ID, isSigner: false, isWritable: false },
    ],
    data: Buffer.from([5]),
  })
}

export function deriveAssociatedTokenAddress(owner: string, mint: string): string {
  return PublicKey.findProgramAddressSync(
    [
      new PublicKey(owner).toBytes(),
      TOKEN_PROGRAM_ID.toBytes(),
      new PublicKey(mint).toBytes(),
    ],
    ASSOCIATED_TOKEN_PROGRAM_ID,
  )[0].toBase58()
}

export function validateOnchainInvoice(args: CreateOnchainInvoiceArgs): void {
  hex32(args.invoiceHash, 'invoice hash')
  hex32(args.queryHash, 'query hash')
  hex32(args.bundleRoot, 'bundle root')
  new PublicKey(args.authorization)
  new PublicKey(args.disputeResolver)
  if (!Number.isSafeInteger(args.expiresAtUnixSeconds) || args.expiresAtUnixSeconds <= 0) {
    throw new Error('invoice expiry must be a positive Unix timestamp')
  }
  if (!Number.isSafeInteger(args.disputeWindowSeconds)
    || args.disputeWindowSeconds < MIN_DISPUTE_WINDOW_SECONDS
    || args.disputeWindowSeconds > MAX_DISPUTE_WINDOW_SECONDS) {
    throw new Error('invoice dispute window is outside the program safety bounds')
  }
  if (args.lineItems.length === 0 || args.lineItems.length > MAX_ONCHAIN_LINE_ITEMS) {
    throw new Error('invoice must contain between one and twenty line items')
  }
  const total = parseAtomic(args.totalAmountAtomic)
  const platformFee = parseAtomic(args.platformFeeAtomic)
  if (total <= 0n || platformFee * 10_000n > total * MAX_ONCHAIN_PROTOCOL_FEE_BPS) {
    throw new Error('invoice economics exceed the on-chain fee policy')
  }
  let lineTotal = 0n
  let platformTotal = 0n
  const identities = new Set<string>()
  let platformFeeItems = 0
  for (const item of args.lineItems) {
    new PublicKey(item.recipientTokenAccount)
    hex32(item.documentHash, 'document hash')
    if (!Number.isSafeInteger(item.documentVersion) || item.documentVersion < 0) {
      throw new Error('document version must be a non-negative integer')
    }
    const amount = parseAtomic(item.amountAtomic)
    if (amount <= 0n) throw new Error('invoice line-item amount must be positive')
    const identity = [item.documentHash, item.documentVersion, item.kind].join(':')
    if (identities.has(identity)) throw new Error('invoice contains a duplicate payout')
    identities.add(identity)
    lineTotal += amount
    if (item.kind === 1) {
      platformFeeItems += 1
      platformTotal += amount
    }
  }
  if (lineTotal !== total || platformTotal !== platformFee) {
    throw new Error('invoice line items do not balance to the committed totals')
  }
  if ((platformFee === 0n && platformFeeItems !== 0)
    || (platformFee > 0n && platformFeeItems !== 1)) {
    throw new Error('invoice must contain exactly one protocol-fee line item')
  }
}

function encodeLineItem(item: OnchainInvoiceLineItem): Uint8Array {
  return concatBytes(
    new PublicKey(item.recipientTokenAccount).toBytes(),
    hex32(item.documentHash, 'document hash'),
    u32(item.documentVersion),
    u64(item.amountAtomic),
    Uint8Array.of(item.kind),
  )
}

function parseAtomic(value: string): bigint {
  if (!/^(0|[1-9][0-9]*)$/.test(value)) throw new Error('atomic amount must be canonical decimal')
  const parsed = BigInt(value)
  if (parsed > 0xffff_ffff_ffff_ffffn) throw new Error('atomic amount exceeds u64')
  return parsed
}

function hex32(value: string, field: string): Uint8Array {
  if (!/^[0-9a-f]{64}$/.test(value)) throw new Error(`${field} must be 32 bytes of lowercase hex`)
  return Uint8Array.from(value.match(/../g) ?? [], (byte) => Number.parseInt(byte, 16))
}

function u32(value: number): Uint8Array {
  if (!Number.isSafeInteger(value) || value < 0 || value > 0xffff_ffff) {
    throw new Error('value exceeds u32')
  }
  const bytes = new Uint8Array(4)
  new DataView(bytes.buffer).setUint32(0, value, true)
  return bytes
}

function u64(value: string): Uint8Array {
  const bytes = new Uint8Array(8)
  new DataView(bytes.buffer).setBigUint64(0, parseAtomic(value), true)
  return bytes
}

function i64(value: number): Uint8Array {
  if (!Number.isSafeInteger(value)) throw new Error('timestamp exceeds JavaScript safe integer')
  const bytes = new Uint8Array(8)
  new DataView(bytes.buffer).setBigInt64(0, BigInt(value), true)
  return bytes
}

function concatBytes(...chunks: Uint8Array[]): Uint8Array {
  const result = new Uint8Array(chunks.reduce((size, chunk) => size + chunk.length, 0))
  let offset = 0
  for (const chunk of chunks) {
    result.set(chunk, offset)
    offset += chunk.length
  }
  return result
}
