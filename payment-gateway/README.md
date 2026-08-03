# OPENSHELF outer x402 gateway

This service handles occasional Phantom prepaid-balance refills. It does not
hold a user key and does not execute downstream database purchases.

Flow:

1. `POST /api/v1/payment-bundles` validates the query and verified-wallet
   spending capability, then atomically reserves prepaid credit when available.
2. `GET /api/v1/paid-bundles/{id}` returns x402 `402 Payment Required` for the
   requested refill amount only when the balance cannot cover the job.
3. Phantom signs a Devnet USDC refill to `OPENSHELF_BUNDLE_RECEIVER`, the KMS
   service-wallet address. Later questions skip this step until credit is low.
4. The gateway first enqueues the settlement in the Seoul-region Cloud Tasks
   queue, then performs the same idempotent Rust ledger write synchronously.
   Rust credits the prepaid ledger and changes `quoted → funded`; no document
   is released here. A process or instance restart cannot erase the queued
   reconciliation.
5. The gateway triggers `RESEARCH_ORCHESTRATOR_URL`. Status polling through
   `GET /api/v1/research-jobs/{id}` recovers the same job after response loss.

Single-document and multi-document questions use the same path. The old browser
SPL delegate endpoints and helper key have been removed.

```bash
npm ci
npm run typecheck
npm test
npm run dev
```

The restricted `/rpc` proxy exposes only the read methods needed to construct
a Phantom x402 refill. Production requires `OPENSHELF_SETTLEMENT_QUEUE`,
`OPENSHELF_SETTLEMENT_QUEUE_LOCATION=asia-northeast3`, and
`OPENSHELF_SETTLEMENT_TARGET_URL`.
