# Obulus settlement program

This native Solana program is the Mainnet-hardening settlement boundary for an
Obulus evidence invoice. It is intentionally separate from the existing hosted
Devnet Pay.sh path so the deployed prototype remains reproducible while the
program is audited and promoted.

## Security model

- The buyer signs `CreateAndFund`; a server session cannot create a funded
  invoice.
- The invoice PDA is derived from `obulus-invoice`, payer and `invoiceHash`, so
  the same invoice cannot be funded twice under a second identity.
- Mint, exact recipient token accounts, line-item amounts, protocol-fee cap,
  expiry and refund token account are stored before funds move.
- A buyer-selected authorization key must acknowledge `deliveryRoot` before
  settlement. Use the buyer key or a locally protected Pay.sh agent key when
  removing central delivery trust is required.
- A bounded dispute window begins after delivery acknowledgement. Settlement
  cannot run during that window, and the buyer cannot open a late dispute once
  it closes.
- A separate resolver fixed in the signed invoice must decide a post-delivery
  dispute. The buyer cannot consume evidence and unilaterally refund it.
- Settlement transfers every line item atomically after the dispute window. A
  mismatch in order, recipient, mint or amount fails the whole transaction.
- Expiry refunds only invoices that never reached delivery. Once delivery is
  acknowledged, funds either settle or follow the independent dispute result;
  this prevents a buyer from consuming data and waiting for a free refund.
- Undelivered expired or independently refund-approved invoices can be
  refunded by anyone, but only to the fixed buyer token account.
- Questions and private passages remain off-chain; only hashes and economic
  state are stored.

## State transitions

```text
CreateAndFund -> Funded -> AcknowledgeDelivery -> Delivered -> window -> Settle -> Settled
                                                   \-> Dispute -> resolver
                                                       | approve seller -> Delivered
                                                       \ approve buyer  -> Refunded
                       \-> expiry -------------------------------------> Refunded
```

Run native invariant tests:

```bash
cargo test --manifest-path programs/obulus-settlement/Cargo.toml
```

An SBF build, external security audit and immutable deployment are required
before setting the program upgrade authority to `--final`. Never make an
unaudited financial program immutable.

The repository includes a browser-safe instruction encoder and PDA helpers in
`src/lib/obulusSettlementProgram.ts`. They apply the same fee ceiling, require
the buyer as the funding signer, and preserve the exact recipient order the
program verifies. The hosted Devnet payment path remains separate until an
audited program is deployed and its program id is configured.
