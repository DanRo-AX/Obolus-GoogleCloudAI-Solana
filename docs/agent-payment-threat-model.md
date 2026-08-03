# Research payment threat model

## Security boundary

The browser proves wallet ownership once and signs only balance refills with
Phantom. OPENSHELF never receives a user private key, seed phrase, SPL delegate,
or token-account authority. A revocable 30-day capability can spend only the
verified wallet's OPENSHELF prepaid ledger balance.

Protected assets are private human passages, the query capability, the service
wallet balance, verified owner recipients, and the original payer's refundable
remainder.

## Enforced invariants

- Search metadata is free; passage text is released only by a paid Pay.sh callback.
- A job commits unique handles, content hashes, versions, consent versions,
  recipients, and prices before balance reservation.
- Balance check and reservation are atomic, so concurrent questions cannot
  overspend one wallet.
- A refill is credited only after exact on-chain settlement; the job budget is
  the sum of per-DB atomic charges.
- Outer settlement only funds a job; it never records owner earnings.
- Each Pay.sh callback must match its job, query, handle, quote, price, owner,
  network, asset, exchange rate, and internal service token.
- Status exposes citations only for the exact job-linked quote marked delivered.
- Completed and balance-refunded jobs are idempotently recovered, not re-quoted.
- Partial failure restores only undelivered document amounts to prepaid credit.
- Refunds use durable prepared transactions and signature replay protection.

## Residual risks

- The service wallet and prepaid ledger are custodial. Keep KMS IAM scope small,
  reconcile chain balance against the ledger, and separate production projects.
- A stolen web session can spend its prepaid balance, but cannot access Phantom
  or other wallet funds. CSP/XSS controls and session revocation remain required.
- Cloud Run currently uses one orchestrator instance to prevent concurrent job
  ownership. Horizontal scaling requires a database lease/fencing token.
- A Pay.sh/facilitator or RPC outage delays completion/refund; it does not grant
  content access.
- Devnet assets have no production value or finality guarantees.
- Query answers can still be inaccurate; payment proves provenance/access, not truth.
