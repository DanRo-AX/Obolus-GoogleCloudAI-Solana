# OPENSHELF x402 gateway

This service is the narrow public payment boundary in front of the Rust API. It
generates one exact quote per matched document, delegates Solana verification
and settlement to an x402 facilitator, releases the passage only after a valid
payment, and mirrors the receipt into Rust. Reconciliation entries are written
to `X402_OUTBOX_PATH`, fsynced before the mirror call, and replayed idempotently.
If the chain succeeds while ledger reconciliation is unavailable, the paid
request returns `202 payment_verified` with a non-paywalled recovery URL keyed
by the quote and transaction signature. Retrying that URL never creates a
second payment challenge. Paid and recovery responses use `private, no-store`.

The root `.env.example` documents every setting. For local development use
`npm run dev:stack` from the repository root.

An agent can exercise a paid resource without the browser. Use a disposable
Devnet wallet secret, never a production key:

```bash
PAID_RESOURCE_URL='http://127.0.0.1:1402/api/v1/paid-documents/QUERY_ID/HANDLE' \
SVM_PRIVATE_KEY='BASE58_SECRET_OR_SOLANA_JSON_ARRAY' \
MAX_PAYMENT_ATOMIC=1000000 \
npm --prefix payment-gateway run pay
```

`MAX_PAYMENT_ATOMIC` is a client-side cap (default 1 USDC) so an agent does not
blindly accept an unexpectedly large challenge.

For a stronger one-shot Devnet verification, use the repository smoke test. It
checks the 402 quote, pays it, fetches the confirmed transaction from Devnet,
and asserts exact USDC balance deltas for payer and recipient:

```bash
PAID_RESOURCE_URL='http://127.0.0.1:1402/api/v1/paid-documents/QUERY_ID/HANDLE' \
SVM_PRIVATE_KEY='SOLANA_JSON_SECRET_ARRAY' \
npm run x402:devnet:smoke
```

With `WAIT_FOR_FUNDS=true` and no secret, it creates a disposable wallet only in
memory and prints the public address to fund. The private key is never printed
or written; stopping the process destroys access to any remaining test funds.
