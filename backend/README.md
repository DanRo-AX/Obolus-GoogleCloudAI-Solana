# OPENSHELF backend

The Rust service owns the complete question lifecycle:

```text
question -> search/rank private MDs -> HIT -> quote safe metadata
                                  \-> MISS -> create an open call
account -> HttpOnly session -> profile / private memory / balance
open call -> reserve full sandbox budget -> recommend + notify matching contributors
          -> hold a 10-minute answer slot -> accepted answer -> escrow release
          -> 82%+ near-identical paid memory + opted-in agent -> exact answer reuse
                                            \-> voided -> pending dispute
pending dispute -> admin approve -> document + slot + escrow release
                \-> admin reject  -> remains voided and unpaid
quoted handles -> direct quote (1) or exact bundle quote (2–100)
               -> one USDC settlement -> reveal committed passage snapshots
               \-> progress/recovery token -> immutable chain receipt + beneficiary claims
author wallet -> signed Ed25519 challenge -> verified payout destination
paid passage -> buyer feedback/report -> admin review -> ranking reliability
opened passages -> server-canonical evidence -> Gemini/Vertex cited synthesis
memory -> hash/version/lock/correction -> public manifest + private export log
```

SQLite persists users, Argon2id password hashes, hashed session and query tokens, balance
reservations, profiles, payout wallets, demographic filters, documents, queries,
open calls, answers, reviewed disputes and buyer reports, earning events, and settlement records.
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
| `OPENSHELF_DATABASE` | `openshelf.db` | SQLite path |
| `OPENSHELF_ENV` | `development` | Enables production secret and secure-cookie guards |
| `OPENSHELF_SEED_DEMO` | non-production-dependent | Seed demo personas/calls; forbidden in production |
| `OPENSHELF_FRONTEND_ORIGIN` | `http://localhost:4319` | Exact credentialed CORS origin |
| `OPENSHELF_TRUST_PROXY` | `false` | Trust ingress-overwritten `X-Forwarded-For` for per-client limits |
| `OPENSHELF_SECURE_COOKIES` | production-dependent | Force the `Secure` session-cookie flag |
| `OPENSHELF_REQUIRE_MAINNET` | `false` | Reject default Devnet network/mint configuration |
| `RUST_LOG` | `openshelf_api=info,tower_http=info` | Log filter |
| `OPENSHELF_INTERNAL_TOKEN` | local development token | Shared secret used only by the x402 gateway |
| `OPENSHELF_DEFAULT_RECEIVER` | none | Devnet wallet for seeded documents with no author profile |
| `OPENSHELF_BUNDLE_RECEIVER` | defaults to `OPENSHELF_DEFAULT_RECEIVER` | Escrow/custody wallet receiving one aggregate payment for a multi-document quote |
| `OPENSHELF_X402_NETWORK` | Solana Devnet CAIP-2 | Network committed into quotes |
| `OPENSHELF_X402_ASSET` | Circle Devnet USDC | Mint committed into quotes |
| `OPENSHELF_KRW_PER_USDC` | `1350` | Deterministic quote conversion rate |
| `OPENSHELF_QUOTE_TTL_MS` | `300000` | Quote lifetime |
| `OPENSHELF_ALLOW_DEMO_OPEN` | development-dependent | Enable the non-x402 demo opener; keep false publicly |
| `OPENSHELF_GEMINI_MODEL` | `gemini-2.5-flash` | Evidence synthesis model |
| `OPENSHELF_VERTEX_ENDPOINT` | none | Vertex generate-content endpoint |
| `OPENSHELF_GOOGLE_ACCESS_TOKEN` | none | Local Vertex bearer override; Cloud Run/GCE uses metadata ADC |
| `GEMINI_API_KEY` | none | Local Gemini API fallback |
| `OPENSHELF_EMAIL_ENDPOINT` | none | Optional Resend-compatible contributor-alert endpoint |
| `OPENSHELF_EMAIL_API_KEY` | none | Bearer token for the email endpoint |
| `OPENSHELF_EMAIL_FROM` | none | Verified sender used for contributor alerts |

Production also refuses to start against a database that already contains the
demo corpus. Use a clean production database rather than relabelling a populated
development volume.

Docker persists SQLite in `/data`:

```bash
docker build -t openshelf-api backend
docker run --rm -p 8787:8787 -v openshelf-data:/data \
  -e OPENSHELF_INTERNAL_TOKEN='replace-with-at-least-32-random-characters' \
  openshelf-api
```

## API

| Method | Path | Responsibility |
| --- | --- | --- |
| `GET` | `/healthz` | Liveness |
| `GET` | `/readyz` | SQLite readiness and deployment environment |
| `POST` | `/api/v1/auth/register` `/login` `/logout` | Create, issue, or revoke an HttpOnly session |
| `GET` | `/api/v1/auth/me` | Read the authenticated account and sandbox balance |
| `POST` | `/api/v1/questions/resolve` | Search, rank, and return HIT/MISS plus a safe quote |
| `POST` | `/api/v1/answers/synthesize` | Synthesize only server-proven opened passages (query token required) |
| `GET` | `/api/v1/questions/{id}/payment-progress` | Reconcile settled/quoted/unpaid handles for a payer |
| `GET` | `/api/v1/questions/{id}/paid-documents/{handle}` | Recover a previously settled passage without paying again |
| `POST` | `/api/v1/questions/{id}/paid-documents/{handle}/feedback` | Record paid-buyer feedback or a report |
| `GET/POST` | `/api/v1/open-calls` | List or commission missing coverage |
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
| `GET/DELETE` | `/api/v1/account/balance` `/api/v1/account` | Read the ledger or delete and anonymize the account |
| `GET` | `/api/v1/account/export` | Export profile, private memories, and access log |
| `GET` | `/api/v1/contributors/{handle}` | Public payment-safe contributor manifest |
| `GET` | `/api/v1/personas/{handle}` | PR #9 compatibility alias for a contributor manifest |
| `GET` | `/api/v1/documents/{handle}` | Public hash/version/price metadata without content |
| `GET/POST` | `/api/v1/profile` | Read or persist the anonymous profile and payout wallet |
| `POST` | `/api/v1/profile/preferences` | Persist search auto-match, exact-memory agent, browser, and email-alert preferences |
| `POST` | `/api/v1/profile/wallet/challenge` `/verify` | Prove payout-wallet ownership with a signed message |
| `GET` | `/api/v1/earnings` | Audit append-only earnings and wallet snapshots |
| `GET` | `/api/flash-research` | Reveal only handles quoted for a query and accrue them once |
| `GET` | `/internal/v1/payment-quotes/{queryId}/{handle}` | Create/reuse an exact short-lived x402 quote (internal token required) |
| `GET` | `/internal/v1/payment-quotes/{id}/document` | Retrieve one quoted passage for the verified gateway |
| `GET` | `/internal/v1/payment-quotes/{id}/snapshot` | Buffer the immutable quote snapshot without marking delivery |
| `POST` | `/internal/v1/chain-settlements` | Idempotently mirror a confirmed facilitator receipt |
| `GET/POST` | `/internal/v1/bundle-payouts` | Claim and idempotently record exact bundle-author payouts |

The conduct ladder is enforced in the service, not just the UI. At two strikes,
the author's documents leave auto-match and new payouts are held for 14 days;
at three, further answers are rejected. Submitting a dispute never changes a
strike or payment. An admin approval performs the restoration atomically.

An unverified profile wallet is never used as an on-chain recipient. Updating the
address revokes verification, one verified wallet cannot belong to two accounts,
and user-authored documents cannot fall back to the seeded-content receiver.

Answer submissions may include `interviewResponses` from the optional warm-up
conversation. Those turns are returned only in the respondent's authenticated
memory stream. They are not copied into the searchable document, quoted to a
buyer, priced, or settled separately; the final `answer` remains the sale unit.

Contributor delivery is server-owned. Eligible calls receive a recommendation
score and an in-app notification; the frontend polls every five seconds and may
surface new unread items through the browser Notification API. Email is opt-in
and written to a durable SQLite outbox. Delivery runs only when all three email
environment variables above are configured, so a missing provider never blocks
call creation. Opening the interview reserves one remaining slot for ten minutes
and renews it while the page stays open.

The memory agent never generates a human experience. When explicitly enabled,
it can reuse the contributor's exact previously paid answer only when the old
and new questions score at least 82% similar, the category and demographic
target match, the old document remains unlocked, its price floor is met, and
the account is below the two-strike restriction. Otherwise the call is sent to
the person for a fresh interview.

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

The resolution includes a query-scoped `paymentAccessToken`. Persist it only with
that local query and send it as `x-openshelf-query-token` when reading payment
progress, recovering already-paid passages, synthesizing paid evidence, or
submitting feedback. Only the
SHA-256 token hash is stored and the capability expires after seven days.
Progress and recovery additionally require the
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
and prices must be generated per document rather than fixed in YAML. See
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
