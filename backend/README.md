# OPENSHELF backend

The Rust service owns the complete question lifecycle:

```text
question -> search/rank private MDs -> HIT -> quote safe metadata
                                  \-> MISS -> create an open call
account -> HttpOnly session -> profile / private memory / balance
open call -> zero-price sandbox or one exact Devnet escrow funding transaction
          -> recommend + notify matching contributors -> hold a 10-minute answer slot
          -> accepted answer -> deterministic contributor payout claim
          -> cancellation/account deletion -> exact unused payer refund claim
          -> 82%+ near-identical paid memory + opted-in agent -> exact answer reuse
                                            \-> voided -> pending dispute
pending dispute -> admin approve -> document + slot + escrow release
                \-> admin reject  -> remains voided and unpaid
quoted handles -> direct quote (1) or exact bundle quote (2–100)
               -> one USDC settlement -> reveal committed passage snapshots
               \-> progress/recovery token -> immutable chain receipt + beneficiary claims
author wallet -> browser Ed25519 challenge or Pay SIWX -> verified payout destination
paid passage -> buyer feedback/report -> admin review -> ranking reliability
opened passages -> server-canonical evidence -> Gemini on Vertex AI cited synthesis
memory -> hash/version/lock/correction -> public manifest + private export log
```

The database persists users, Argon2id password hashes, hashed session and query tokens, balance
reservations, profiles, payout wallets, demographic filters, documents, queries,
open calls, answers, reviewed disputes and buyer reports, earning events, and settlement records.
Local development may use SQLite; every staging or production process requires an
explicit PostgreSQL connection string and refuses SQLite paths.
Search never returns an MD passage;
`/api/flash-research` releases content only for handles quoted under that exact
query ID.

## Run locally

Rust 1.89+:

```bash
cd backend
cargo run
```

The API listens on `127.0.0.1:8787` and writes `openshelf.db` in the current
directory. Configuration:

| Variable | Default | Purpose |
| --- | --- | --- |
| `OPENSHELF_BIND` | `127.0.0.1:8787` | Listen address; non-loopback requires a strong internal token |
| `OPENSHELF_DATABASE` | `openshelf.db` in local development only | SQLite path locally; explicit PostgreSQL connection string required in staging/production |
| `OPENSHELF_ROLLBACK_AUDIT_BUCKET` | none locally; required in managed environments | GCS bucket receiving create-only payment and model-call intents before external transport is authorized |
| `OPENSHELF_ROLLBACK_AUDIT_PREFIX` | bucket root | Validated lower-case object prefix; set to `obolus/rollback-audit` when using shared `ax-apps-storage` |
| `OPENSHELF_ENV` | `development` | `development/dev/local/test` or managed `staging/stage/production/prod`; unknown values fail startup |
| `OPENSHELF_SEED_DEMO` | `false` | Explicit test/UI-fixture opt-in; synthetic personas/calls are forbidden in managed environments |
| `OPENSHELF_FRONTEND_ORIGIN` | `http://localhost:4319` | Exact credentialed CORS origin |
| `OPENSHELF_AGENT_API_ORIGIN` | `http://127.0.0.1:8787` | Exact public API origin embedded in one-time Pay SIWX wallet-link resources; remote production values require HTTPS |
| `OPENSHELF_SECURE_COOKIES` | production-dependent | Force the `Secure` session-cookie flag |
| `OPENSHELF_REQUIRE_MAINNET` | `false` | Reject default Devnet network/mint configuration |
| `RUST_LOG` | `openshelf_api=info,tower_http=info` | Log filter |
| `OPENSHELF_INTERNAL_TOKEN` | local development token | Shared secret used only by the x402 gateway |
| `OPENSHELF_DEFAULT_RECEIVER` | none | Devnet wallet for seeded documents with no author profile |
| `OPENSHELF_BUNDLE_RECEIVER` | defaults to `OPENSHELF_DEFAULT_RECEIVER` | Escrow/custody wallet receiving one aggregate payment for a multi-document quote |
| `OPENSHELF_X402_NETWORK` | Solana Devnet CAIP-2 | Network committed into quotes |
| `OPENSHELF_X402_ASSET` | Circle Devnet USDC | Mint committed into quotes |
| `OPENSHELF_KRW_PER_USDC` | `1350` | Deterministic quote conversion rate (1–1,000,000,000; fixed to 1350 in managed environments) |
| `OPENSHELF_QUOTE_TTL_MS` | `300000` | Quote lifetime (30 seconds–24 hours) |
| `OPENSHELF_ALLOW_DEMO_OPEN` | development-dependent | Enable the non-x402 demo opener; keep false publicly |
| `OPENSHELF_ACCEPT_LEGACY_PAY_SH_CALLBACKS` | `false` | Temporary staged-cutover flag for already-metered v1 callbacks; never leave enabled after retiring the v1 meter |
| `GOOGLE_CLOUD_PROJECT` | none | Vertex AI billing/resource project; required for model calls |
| `GOOGLE_CLOUD_LOCATION` | `global` | Vertex AI location; regional endpoints are derived safely |
| `OPENSHELF_VERTEX_MODEL` | `gemini-2.5-flash` | Gemini model hosted by Vertex AI |
| `OPENSHELF_AI_BASELINE_TTL_MS` | `21600000` | Lifetime of a zero-price general AI baseline (1 minute–24 hours); never a human document |
| `OPENSHELF_EMAIL_PASSWORD_AUTH_ENABLED` | `false` | Deferred email/password account surface; when false, register/login/forgot/reset routes are not mounted |
| `OPENSHELF_EMAIL_ENDPOINT` | none | Optional Resend-compatible password-reset and contributor-alert endpoint |
| `OPENSHELF_EMAIL_API_KEY` | none | Bearer token for the email endpoint; inject from Secret Manager |
| `OPENSHELF_EMAIL_FROM` | none | Verified sender used for password resets and contributor alerts |

Managed environments also refuse to start against a database that already
contains the demo corpus. Use a clean PostgreSQL database rather than
relabelling a populated development volume. Explicit booleans and integers are
strictly parsed, so misspellings such as `flase`, suffixes such as `60000ms`,
and out-of-range values fail startup instead of silently selecting a default.

The production convention uses `ax-apps-storage` with
`OPENSHELF_ROLLBACK_AUDIT_PREFIX=obolus/rollback-audit`; a dedicated bucket is
also supported. Register its consumer, owner, purpose, service account, allowed
object prefix, and review date in the data-access registry before changing IAM.
Give the API workload a conditional bucket binding for the registered prefix
and a custom role containing only `storage.objects.create` and
`storage.objects.get`; do not grant delete, overwrite, list, a broad project
storage role, or a service-account key. GCS retention is bucket-wide rather
than prefix-scoped, so a shared-bucket retention or object-protection change
requires review with every existing consumer. Production remains blocked until
the selected protection lasts longer than the maximum Cloud SQL PITR window.
The API validates the prefix, uses
`ifGenerationMatch=0`, byte-compares an existing object on exact retry, and
returns `503` before the caller can reach an external payment rail if the audit
write cannot be proven. The same gate applies before an externally billed
Vertex request; its object contains only provider policy, a one-way scope hash,
input hash, and budget window, never the prompt, human evidence, profile, or
generated answer.
The restore sweep requires a unique `OPENSHELF_RESTORE_ID` and first installs
an unresolved PostgreSQL recovery-window hold. Missing or mismatched audit
objects receive their own holds. Readiness fails and database triggers reject
new chain attempts, Pay.sh preparations, payout preparations, and model-call
fences even from a stale application revision; settlement and reconciliation
of already-started work remain enabled. Do not treat sweep exit `0` as traffic
permission. After chain, Pay.sh, payout, and provider receipts are reconciled,
use `rollback_hold_resolve` with the exact recovery ID, the explicit
`payments-stopped-and-external-receipts-reconciled` acknowledgement, and a
durable incident/report reference as resolution evidence.

If PostgreSQL terminates an idle session during maintenance, the next top-level
store operation reconnects before issuing any query. Reconnection never occurs
inside an individual query or transaction, because continuing half a ledger
mutation on a new session could commit torn payment state.

Vertex authentication uses Application Default Credentials. For local
development, run `gcloud auth application-default login`; for production,
attach a least-privilege runtime service account with `roles/aiplatform.user`
through the hosting platform or Workload Identity. Do not create or commit a
service-account key, and do not manage expiring bearer tokens in `.env`.

The production image contains no database fallback. For an explicitly local
container-only smoke test, provide a development SQLite path and mount it:

```bash
docker build -t openshelf-api backend
docker run --rm -p 8787:8787 -v openshelf-data:/data \
  -e OPENSHELF_ENV=development \
  -e OPENSHELF_DATABASE=/data/openshelf.db \
  -e OPENSHELF_INTERNAL_TOKEN='replace-with-at-least-32-random-characters' \
  openshelf-api
```

The image defaults to `OPENSHELF_ENV=production`, so an actual deployment fails
closed unless HTTPS origins, secure cookies, a strong internal token, and a
clean PostgreSQL database satisfy the managed-environment guards. The explicit development
override above is only for a local published-port container.

## API

| Method | Path | Responsibility |
| --- | --- | --- |
| `GET` | `/healthz` | Liveness |
| `GET` | `/readyz` | Database/recovery readiness and deployment environment |
| `POST` | `/api/v1/auth/logout` | Revoke an HttpOnly wallet session |
| `GET` | `/api/v1/auth/me` | Read the authenticated account and sandbox balance |
| `POST` | `/api/v1/questions/resolve` | Search, rank, and return HIT/MISS plus a safe quote |
| `GET` | `/api/v1/public-evidence` | Search source-, license-, date-, record-ID-, and hash-bound open institutional records; never human coverage |
| `POST` | `/api/v1/questions/{id}/ai-baseline` | Generate/cache a free public answer with official records and Google Search grounding, without opening private human passages (query token required) |
| `POST` | `/api/v1/answers/synthesize` | Synthesize only server-proven opened passages (query token required) |
| `GET/POST` | `/api/v1/shelf-starters` | List or explicitly generate AI interview prompts; never fake buyers or bounties |
| `POST` | `/api/v1/shelf-starters/{id}/answer` | Turn a quality-checked human answer—not the AI prompt—into a priced document |
| `GET` | `/api/v1/questions/{id}/payment-progress` | Reconcile settled/quoted/unpaid handles for a payer |
| `GET` | `/api/v1/questions/{id}/paid-documents/{handle}` | Recover a previously settled passage without paying again |
| `POST` | `/api/v1/questions/{id}/paid-documents/{handle}/feedback` | Record paid-buyer feedback or a report |
| `GET/POST` | `/api/v1/open-calls` | List or commission missing coverage |
| `POST/GET` | `/api/v1/open-call-funding-quotes[/{id}]` | Prepare or reconcile one exact Devnet funding quote for a paid call |
| `DELETE` | `/api/v1/open-calls/{id}` | Cancel an owned call and refund unused escrow |
| `POST` | `/api/v1/open-calls/{id}/answers` | Validate an answer, retain private interview context, and add accepted memory |
| `POST/DELETE` | `/api/v1/open-calls/{id}/reservation` | Hold, renew, or release one answer slot for ten minutes |
| `POST` | `/api/v1/open-calls/{id}/reservation/release` | Keepalive-safe release used while the answer page is closing |
| `GET` | `/api/v1/notifications` | Read ranked call, auto-match, and buyer-result notifications |
| `POST` | `/api/v1/notifications/read` | Mark selected notifications, or the whole inbox, read |
| `GET` | `/api/v1/chats/{id}/answers` | Return accepted answers only to the originating chat owner |
| `GET` | `/api/v1/memory` | Read a user's answer and earnings ledger |
| `PATCH` | `/api/v1/memory/{id}` | Lock/unlock memory and remove/restore it in matching |
| `POST` | `/api/v1/memory/{id}/corrections` | Create a new immutable version and lock the old one |
| `POST` | `/api/v1/memory/{id}/dispute` | Submit the user's one dispute for review |
| `GET/POST` | `/api/v1/admin/disputes[/{id}/review]` | List and review cases (admin role only) |
| `GET/POST` | `/api/v1/admin/document-feedback[/{id}/review]` | List and review paid-buyer reports (admin only) |
| `POST` | `/api/v1/admin/evidence-edges` | Add independently owned verified authority edges (admin only) |
| `GET` | `/api/v1/account-controls` | Read server-authoritative strikes/dispute use |
| `GET/DELETE` | `/api/v1/account/balance` `/api/v1/account` | Read the ledger, or atomically tombstone payment snapshots and anonymize the account once external payments are no longer in flight |
| `GET` | `/api/v1/account/export` | Export profile, private memories, and access log |
| `GET` | `/api/v1/contributors/{handle}` | Public payment-safe contributor manifest |
| `GET` | `/api/v1/personas/{handle}` | PR #9 compatibility alias for a contributor manifest |
| `GET` | `/api/v1/documents/{handle}` | Public hash/version/price metadata without content |
| `GET/POST` | `/api/v1/profile` | Read or persist the anonymous profile and payout wallet |
| `POST` | `/api/v1/profile/preferences` | Persist search auto-match, exact-memory agent, browser, and email-alert preferences |
| `POST` | `/api/v1/profile/wallet/challenge` `/verify` | Prove payout-wallet ownership with a signed message |
| `POST/GET` | `/api/v1/profile/wallet/siwx[/{id}]` | Create an authenticated one-time payout link, then verify a Pay `SIGN-IN-WITH-X` ownership signature without exporting its key |
| `GET` | `/api/v1/payment-bundles/{id}` | Return the canonical bundle quote only to its query capability and prepaid wallet session, for pre-wallet gateway cross-checking |
| `GET` | `/api/v1/agent-payment-bundles/{id}` | Return an agent-direct canonical quote to its query capability for independent gateway and recovery cross-checking |
| `GET` | `/api/v1/earnings` | Audit append-only earnings and wallet snapshots |
| `GET` | `/api/v1/payout-claims` | Inspect contributor/refund claim status and confirmed payout signatures |
| `POST` | `/api/v1/auth/register` `/login` `/password/forgot` `/password/reset` | Deferred email/password surface; mounted only when `OPENSHELF_EMAIL_PASSWORD_AUTH_ENABLED=true` |
| `GET` | `/api/v1/admin/ai-liquidity-metrics` | Audit AI-only/hybrid coverage, starter conversion, and zero priced-AI/authority invariants |
| `GET` | `/api/flash-research` | Reveal only handles quoted for a query and accrue them once |
| `GET` | `/internal/v1/payment-quotes/{queryId}/{handle}` | Create/reuse an exact short-lived x402 quote (internal token required) |
| `GET` | `/internal/v1/payment-quotes/{id}/document` | Retrieve one quoted passage for the verified gateway |
| `GET` | `/internal/v1/payment-quotes/{id}/snapshot` | Buffer the immutable quote snapshot without marking delivery |
| `POST` | `/internal/v1/chain-settlements` | Idempotently mirror a confirmed facilitator receipt |
| `POST` | `/internal/v1/open-call-chain-settlements` | Activate a paid call only after its exact Devnet receipt is mirrored |
| `POST` | `/internal/v1/agent-payment-bundles` | Create/reuse an exact one-shot aggregate quote for the explicit agent protocol without a prepaid wallet session or balance |
| `GET/POST` | `/internal/v1/payout-claims/*` | Inspect signer-owned backlog, then lease, prepare, finalize, or two-pass release crash-safe Devnet payout work (`exact-payout-v1`) |

The conduct ladder is enforced in the service, not just the UI. At two strikes,
the author's documents leave auto-match and new payouts are held for 14 days;
at three, further answers are rejected. Submitting a dispute never changes a
strike or payment. An admin approval performs the restoration atomically.

An unverified profile wallet is never used as an on-chain recipient. Updating the
address revokes verification, one verified wallet cannot belong to two accounts,
and user-authored documents cannot fall back to the seeded-content receiver.
Wallet-only users are created with one atomic user/balance/signup-credit/identity
transaction; both synthetic email suffixes are unavailable to public signup or
password reset. All generated entity ids use 128 bits of OS entropy so separate
API processes do not share a timestamp/counter collision domain.
The SIWX path uses Pay's canonical Solana sign-in message, checks domain, URI,
chain, nonce, issued/expiry time, request ID, Ed25519 signature, and one-time
consumption before applying the same wallet-uniqueness rule. It links a wallet
to an already authenticated OpenShelf user; it does not infer identity from a
Google account or email address.

Answer submissions may include `interviewResponses` from the optional warm-up
conversation. Those turns are returned only in the respondent's authenticated
memory stream. They are not copied into the searchable document, quoted to a
buyer, priced, or settled separately; the final `answer` remains the sale unit.

Contributor delivery is server-owned. Eligible calls receive a recommendation
score and an in-app notification; the frontend polls every five seconds and may
surface new unread items through the browser Notification API. The managed
launch is wallet-only, so email/password routes and email alerts are not exposed.
The durable email outbox remains dormant for a later reviewed rollout. When all
three email environment variables are configured, API instances acquire
expiring database leases before contacting the provider and send the stable
outbox id as the provider idempotency key. Enabling email/password auth in a
managed environment fails startup unless all three provider values are present.
A crash can replay an id only after lease expiry; a successful delivery erases
the stored recipient, subject, and body. After five provider failures the row
becomes `exhausted`, emits an error log, and erases its recipient and message
payload; operational alert routing is a prerequisite for that future rollout.
Opening the interview reserves one remaining slot for ten minutes and renews it
while the page stays open.

Answer, cancellation, and dispute approval serialize on the same open-call row.
An approved dispute can fill only an open call with remaining capacity and
escrow. Sandbox calls release reserved KRW; funded calls instead decrement the
exact remaining atomic escrow and create one contributor payout claim. A
cancelled call can never be reopened by a late administrator decision.

The memory agent never generates a human experience. When explicitly enabled,
it can reuse the contributor's exact previously paid answer only when the old
and new questions score at least 82% similar, the category and demographic
target match, the old document remains unlocked, its price floor is met, and
the account is below the two-strike restriction. Otherwise the call is sent to
the person for a fresh interview.

AI market liquidity is a separate provenance lane. A resolve response reports
`ai_liquidity_only`, `hybrid_coverage`, or `human_covered` from human supply
alone. Only the first two permit the token-scoped baseline endpoint. The model
returns general orientation, stable decision factors, human evidence gaps, and
questions for people under `general-liquidity-v1`; a deterministic post-check
rejects first-person or direct recommendation language. The result lives in
`ai_baselines`, expires, costs zero, and has no path into documents, authority,
memory, matching, or settlement.

Shelf starters cover the inverse cold start. Gemini on Vertex AI receives only the
contributor's broad field and opted-in categories and returns prompts, not
answers. They live in `shelf_starters` with `buyerWaiting=false` and
`guaranteedRewardKrw=0`. A human may answer one and choose a future per-open
price; normal specificity, identifier, duplicate, profile, and suspension
checks run before Rust creates a document with `via = Shelf starter`.

Register and keep the cookie in a local cookie jar:

```bash
curl -s -c /tmp/openshelf.cookies \
  http://localhost:8787/api/v1/auth/register \
  -H 'content-type: application/json' \
  -d '{"email":"buyer@example.com","password":"correct-horse-42","ageConfirmed14":true}'
```

All private examples use `-b /tmp/openshelf.cookies`. To provision the first
reviewer, create the account and promote it out of band:

```bash
sqlite3 openshelf.db \
  "UPDATE users SET role='admin' WHERE email='reviewer@example.com';"
```

Resolve a question:

```bash
curl -s http://localhost:8787/api/v1/questions/resolve \
  -H 'content-type: application/json' \
  -d '{
    "question": "Where do Seongsu residents eat lunch when the queue is long?",
    "requestedDocuments": 5,
    "budgetKrw": 2500
  }'
```

The resolution includes a one-time `paymentAccessToken`. Persist it only with
that local query and send it as `x-openshelf-query-token` when reading payment
progress, recovering already-paid passages, synthesizing paid evidence, or
submitting feedback. Only the
SHA-256 token hash is stored. Progress and recovery additionally require the
settling payer public key, so a UI retry can recover settled handles and pay only
the remaining ones.

The signup balance and open-call escrow are deliberately marked
`KRW_SANDBOX`; they verify money invariants without pretending to hold fiat or
tokens. The direct `/api/flash-research` response is deliberately marked
`network: "demo"`: it exercises privacy, quoting, idempotency, and the earnings
ledger without pretending that a chain transaction occurred. Every accrual is
also written as its own event with source, document, settlement, recipient-wallet
snapshot, payout status, and availability time.

## Exercise the real 402 payment boundary

From the repository root, copy `.env.example`, set a real Devnet receiver, and
start all three processes:

```bash
cp .env.example .env
npm run dev:stack
```

Resolve a covered question and use one returned `queryId` and `handle`:

A plain request to the gateway receives `402 Payment Required`:

```bash
curl -i 'http://127.0.0.1:1402/api/v1/paid-documents/QUERY_ID/HANDLE' \
  -H 'accept: application/json'
```

The `PAYMENT-REQUIRED` header contains x402 v2, Solana Devnet CAIP-2, Circle's
Devnet USDC mint, the exact atomic amount, recipient, and facilitator fee payer.
The Vite app performs the paid retry through Phantom. The facilitator pays the
transaction fee; the buyer wallet needs Devnet USDC, and may need Devnet SOL for
normal wallet setup. One document produces one transfer and one receipt.

`backend/paywall.yml` is a static Pay.sh localnet compatibility example. The
Devnet application path remains `payment-gateway/src/main.ts`, because recipients
and prices must be generated per document rather than fixed in YAML. Antigravity
can authorize those dynamic URLs through Pay's MCP server. See
[`../docs/PAY-SH.md`](../docs/PAY-SH.md).

## Verify

```bash
cd backend
cargo fmt --check
cargo test --locked
cargo clippy --locked --all-targets -- -D warnings
```

`openapi.json` describes the browser integration contracts for payment recovery,
wallet verification, and paid-document feedback. The `/internal/v1/*`
routes remain restricted to the gateway's shared secret.
