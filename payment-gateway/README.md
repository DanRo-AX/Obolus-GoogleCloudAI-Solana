# OPENSHELF x402 gateway

This service is the narrow public payment boundary in front of the Rust API. It
generates one exact quote per matched document, delegates Solana verification
and settlement to an x402 facilitator, releases the passage only after a valid
payment, and mirrors the receipt into Rust. Reconciliation entries are written
to `X402_OUTBOX_PATH` before the mirror call and replayed idempotently.

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
