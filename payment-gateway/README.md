# OPENSHELF outer x402 gateway

This service handles Phantom prepaid-balance refills and is the only public
authorization boundary in front of the official Pay.sh gate. It does not hold a
user key.

Flow:

1. `POST /api/v1/payment-bundles` validates the query and selects one explicit
   funding contract. Browsers present a verified-wallet session and atomically
   reserve prepaid credit. Local agents present
   `x-openshelf-agent-payment-mode: exact-agent-bundle-v1`; they receive a
   one-shot quote whose deposit is exactly the research budget and which can
   never create reusable balance. Supplying both modes, neither mode, an
   unknown agent protocol, or an agent top-up fails before quote creation.
2. `GET /api/v1/paid-bundles/{id}` returns x402 `402 Payment Required` for the
   requested refill amount only when the balance cannot cover the job.
3. Phantom signs a Devnet USDC refill to `OPENSHELF_BUNDLE_RECEIVER`, the KMS
   service-wallet address. Later questions skip this step until credit is low.
4. The gateway first enqueues the settlement in the Seoul-region Cloud Tasks
   queue, then performs the same idempotent Rust ledger write synchronously.
   Rust credits and reserves the prepaid ledger for a browser refill. An agent
   deposit instead binds the finalized chain payer directly to the job without
   touching prepaid accounts. Both change `quoted → funded`; no document is
   released here. A process or instance restart cannot erase the queued
   reconciliation.
5. The gateway triggers `RESEARCH_ORCHESTRATOR_URL`. Status polling through
   `GET /api/v1/research-jobs/{id}` recovers the same job after response loss.
6. Direct agents use this same origin for resolve, Pay.sh resource, recovery,
   and paid-document calls. The unpaid challenge passes through. A paid MPP
   credential is validated and durably bound to its quote before the private
   Pay.sh transport starts; concurrent different credentials fail closed.

The query row serializes bundle preparation. The same query, ordered documents,
snapshot hash, price, and payment policy cannot be reserved concurrently by the
browser-prepaid and agent-direct contracts. Agent retries before or after
settlement recover the same quote. If downstream research fails, any unspent
agent-direct budget becomes an on-chain refund claim for the finalized payer;
it is never converted into custodial prepaid credit.

Single-document and multi-document questions use the same path. The old browser
SPL delegate endpoints and helper key have been removed.

Before a funded bundle can be created, quoted for wallet payment, or reported
ready, the gateway requires the research orchestrator's `/readyz` to succeed
within five seconds without redirects. An unavailable worker therefore prevents
new custodial funds from being accepted instead of creating a paid job with no
healthy consumer. The dependency check follows request authentication and body
validation. Public readiness and concurrent middleware checks share one
in-flight probe plus a one-second positive/250-millisecond negative cache, so a
traffic burst cannot fan out into the same number of KMS and payout-backlog
checks; the short cache does not turn readiness into a durable health claim.

Before Phantom approval, the browser refetches the canonical bundle through a
separate Rust endpoint protected by both the query capability and prepaid wallet
session. It requires the gateway copy to match that quote, the original query
and ordered handles, and the exact refill implied by the browser-requested top-up
and the immutable minimum deposit recorded when the quote was created. A later
balance change in another tab is never reinterpreted as the old deficit. It then
keeps only `402 Payment Required`
alternatives that match the canonical scheme, network, mint, atomic amount,
recipient, timeout ceiling, and
`openshelf:v1:{bundle|open_call}:<quote-id>` memo. Tests cover both inconsistent
402 substitution and a gateway that consistently inflates its create request
and later 402 response. The fully prepaid zero-refill path branches before any
wallet-payment policy is registered, while a second tab that observes
`settling` follows recovery instead of paying the same quote.

The local agent performs the same trust split without a wallet session through
`GET /api/v1/agent-payment-bundles/{id}` on the Rust API. It accepts a gateway
bundle only when every field and ordered handle equals the canonical one-shot
quote, verifies amount = budget = minimum deposit and zero prepaid balance, and
reconstructs the paid URL from its configured gateway origin rather than using
the gateway's returned absolute URL.

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

`production`, `prod`, `staging`, and `stage` all enable managed safeguards;
unknown deployment names and malformed booleans fail startup. Ports are bounded
to 1–65535, rate limits to 1–10,000/minute, reconciliation intervals to
5–300 seconds, batches to 1–100, and signature scans to 1–20 pages. These
bounds also reject Node timer values that would overflow into a one-millisecond
hot loop.
Cloud Run service/job markers also force managed safeguards, so an accidental
`OPENSHELF_ENV=development` cannot downgrade a deployed process.
`OPENSHELF_REQUIRE_RESEARCH_ORCHESTRATOR=false` is accepted only by an
unmanaged direct-Pay.sh sandbox. It omits the research dependency from global
readiness without weakening bundle creation or bundle payment, which continue
to probe the orchestrator directly. Managed runtimes reject the override.

Managed deployments additionally require `PAY_SH_PRIVATE_URL`,
`OPENSHELF_PAY_FRONT_TOKEN`, `OPENSHELF_PAY_OPERATOR_WALLET`, and
`OPENSHELF_PAY_GCP_KMS_PUBKEY`. `PAY_SH_RPC_URL` defaults to `X402_RPC_URL`, but
may be different in sandbox. Managed deployments also require
`PAY_SH_RECONCILIATION_RPC_URLS` to contribute at least one independent origin.
Before durable prepare or external collection, the
public proxy verifies that the quoted owner/mint associated token account exists
and belongs to the SPL Token Program. It also validates the query capability and
exact signed MPP credential. Agents must never receive the private Pay.sh URL or
front token.

Credential validation is economic, not merely syntactic. Before a paid request
can be persisted or forwarded, the gateway verifies the buyer signature and
requires the signed transaction to contain only the pinned payment template:
the exact USDC mint/source ATA, platform and owner destination ATAs, exact split
amounts, and exact resource memo. Any other Authorization scheme, malformed MPP
header, redirected valid USDC transfer, extra program, or unresolved address
table fails before the private collector is called.

The private Pay.sh callback is deliberately read-only: it can construct the
quoted citation response but cannot mark delivery or credit earnings. The
gateway keeps that upstream body private, decodes the standard
`Payment-Receipt`, verifies its fee-payer signature against the exact durable
transaction, then requires every configured Pay.sh RPC origin to reproduce those
byte-identical bytes as `finalized`. Only then does it record the direct or
funded-research settlement in Rust and return the body. A missing receipt, a
mismatched receipt, RPC disagreement, or a lost Rust commit response leaves the
prepared fence for exact chain recovery and exposes no paid content through the
public response.

`X402_RECONCILIATION_RPC_URLS` must name at least one second-provider origin in
managed environments. The gateway persists the exact payer-signed transaction
before the facilitator can settle it. The normal paid response calls the
facilitator exactly once and remains buffered until every configured origin
returns its declared signature with the same byte-identical finalized
transaction. `X402_SETTLEMENT_FINALITY_TIMEOUT_MS` (default 20 seconds, maximum
45 seconds) and `X402_SETTLEMENT_FINALITY_POLL_INTERVAL_MS` (default 500 ms)
bound that wait. Each immediate provider read is independently canceled after
`X402_SETTLEMENT_FINALITY_RPC_TIMEOUT_MS` (default 3 seconds), has a 128 KiB
response limit, and does not use the background reconciler's retries. The single
facilitator POST is separately canceled after
`X402_FACILITATOR_SETTLEMENT_TIMEOUT_MS` (default 15 seconds), and its response
body is capped at 64 KiB. A transport timeout remains ambiguous: it returns a
recoverable failure and keeps the durable attempt; the SDK is never allowed to
fall through to a second facilitator call. Lost callbacks are credited only
when all configured origins later return the same byte-identical finalized
transaction. A
failed/absent transaction is released only after all origins also report its
blockhash invalid on two passes separated by the durable five-minute interval.
One unavailable or contradictory provider keeps the fence closed.
The same rule applies to legacy attempts that predate exact transaction
evidence: every configured provider must independently recover the same
signature, so the compatibility path cannot fall back to one optimistic RPC.
Migration marks only rows that already existed before exact-evidence enforcement
as legacy. Database insert/immutability triggers reject an older running API
revision that tries to create or rewrite another evidence-free attempt.
The gateway also sends the `x-openshelf-payment-protocol: exact-chain-v1`
control header. Deploy the backend revision first: old gateways will fail
before facilitator settlement, while callbacks for transfers already in flight
remain accepted for durable recovery.

The optional local `payout:once`/`payout:watch` worker is deliberately subject
to the same payout safety contract as the production KMS orchestrator. It will
not start without a second origin in `X402_RECONCILIATION_RPC_URLS`, completes a
claim only when every origin reports its exact signature `finalized`, and asks
Rust to clear expired prepared bytes only through the server's two-pass absence
fence. It is a Devnet recovery tool, not a production key-custody substitute.
