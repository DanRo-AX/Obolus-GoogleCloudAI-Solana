# OPENSHELF x402 gateway

This service is the narrow public payment boundary in front of the Rust API. It
generates either a direct quote for one matched document or one exact aggregate
quote for a 2–100 document bundle, delegates Solana verification and settlement
to an x402 facilitator, releases the committed snapshots only after a valid
payment, and mirrors the receipt into Rust. Reconciliation entries are written
to `X402_OUTBOX_PATH` before the mirror call and replayed idempotently.
`/readyz` also verifies that the Rust ledger is reachable. Production startup
rejects a short/local shared secret, an insecure frontend origin, and the public
Devnet RPC fallback. `OPENSHELF_REQUIRE_MAINNET=true` rejects the default Devnet
network.

The browser obtains mint metadata and recent blockhashes through the restricted
`POST /rpc` proxy, which allows only `getAccountInfo` and `getLatestBlockhash`.
It applies a per-process limit configured by `X402_RPC_RATE_LIMIT_PER_MINUTE`;
production still needs a distributed edge rate limit.
The resource server deliberately does not embed a blockhash in the 402 payment
requirements: the middleware rebuilds those requirements for the signed retry,
so a changing blockhash would make an otherwise valid V2 payload fail matching.
`npm run test` guards this invariant.

The root `.env.example` documents every setting. For local development use
`npm run dev:stack` from the repository root.

`POST /api/v1/payment-bundles` requires the query capability and prepares a
non-chargeable immutable quote. `GET /api/v1/paid-bundles/{quoteId}` is the x402
resource and therefore produces one wallet approval for the aggregate amount.
The receiver is an escrow wallet: Rust records each author's verified
beneficiary and `claimable` share, but does not claim that escrow custody itself
is a completed author payout. `GET /api/v1/funded-open-calls/{quoteId}` applies
the same exact-payment boundary to an entire open-call target, so one approval
funds all answer slots.

Create a dedicated Devnet escrow key and run the payout worker with:

```bash
npm --prefix payment-gateway run escrow:create
# fund the printed address with 0.05–0.1 Devnet SOL for transaction fees
npm --prefix payment-gateway run payout:once
# or keep reconciling pending claims
npm --prefix payment-gateway run payout:watch
```

The key path comes from `OPENSHELF_ESCROW_KEYPAIR_PATH`, must be mode 0600, and
must match `OPENSHELF_BUNDLE_RECEIVER`. The worker refuses non-Devnet claims,
stores signed bytes and the deterministic signature before broadcast, retries
the same transaction after a crash, and never marks a claim paid until RPC
confirmation. New paid bundles and open calls deposit their Devnet USDC into
this escrow before claims are created, so a fresh escrow only needs Devnet SOL
up front. Add faucet Devnet USDC separately only when replaying a claim whose
original deposit did not land in this escrow.

An agent can exercise a paid resource without the browser. Use a disposable
Devnet wallet secret, never a production key:

```bash
PAID_RESOURCE_URL='http://127.0.0.1:1402/api/v1/paid-documents/QUERY_ID/HANDLE' \
SVM_PRIVATE_KEY='BASE58_SECRET_OR_SOLANA_JSON_ARRAY' \
MAX_PAYMENT_ATOMIC=1000000 \
npm --prefix payment-gateway run pay
```

`MAX_PAYMENT_ATOMIC` is a client-side cap (default 1 USDC) so an agent does not
blindly accept an unexpectedly large challenge. This CLI still uses a supplied
disposable signer. The fail-closed policy evaluator and its threat tests live in
`src/agent-payment-policy.ts`; unattended end-user signing stays disabled until
a reviewed, non-custodial Solana delegation mechanism is selected.
