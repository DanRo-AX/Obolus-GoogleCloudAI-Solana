# OPENSHELF backend

The Rust service owns the complete question lifecycle:

```text
question -> search/rank private MDs -> HIT -> quote safe metadata
                                  \-> MISS -> create an open call
account -> HttpOnly session -> profile / private memory / balance
open call -> reserve full sandbox budget -> accepted answer -> escrow release
                                            \-> voided -> pending dispute
pending dispute -> admin approve -> document + slot + escrow release
                \-> admin reject  -> remains voided and unpaid
quoted handle -> dynamic x402 quote -> USDC settlement -> reveal one passage
                                           \-> immutable chain receipt
```

SQLite persists users, Argon2id password hashes, hashed session tokens, balance
reservations, profiles, payout wallets, demographic filters, documents, queries,
open calls, answers, reviewed disputes, earning events, and settlement records.
Search never returns an MD passage;
`/api/flash-research` releases content only for handles quoted under that exact
query ID.

## Run locally

Rust 1.89+:

```bash
cd backend
cargo run
```

The API listens on `0.0.0.0:8787` and writes `openshelf.db` in the current
directory. Configuration:

| Variable | Default | Purpose |
| --- | --- | --- |
| `OPENSHELF_BIND` | `0.0.0.0:8787` | Listen address |
| `OPENSHELF_DATABASE` | `openshelf.db` | SQLite path |
| `RUST_LOG` | `openshelf_api=info,tower_http=info` | Log filter |
| `OPENSHELF_INTERNAL_TOKEN` | local development token | Shared secret used only by the x402 gateway |
| `OPENSHELF_DEFAULT_RECEIVER` | none | Devnet wallet for seeded documents with no author profile |
| `OPENSHELF_X402_NETWORK` | Solana Devnet CAIP-2 | Network committed into quotes |
| `OPENSHELF_X402_ASSET` | Circle Devnet USDC | Mint committed into quotes |
| `OPENSHELF_KRW_PER_USDC` | `1350` | Deterministic quote conversion rate |
| `OPENSHELF_QUOTE_TTL_MS` | `300000` | Quote lifetime |

Docker persists SQLite in `/data`:

```bash
docker build -t openshelf-api backend
docker run --rm -p 8787:8787 -v openshelf-data:/data openshelf-api
```

## API

| Method | Path | Responsibility |
| --- | --- | --- |
| `GET` | `/healthz` | Liveness |
| `POST` | `/api/v1/auth/register` `/login` `/logout` | Create, issue, or revoke an HttpOnly session |
| `GET` | `/api/v1/auth/me` | Read the authenticated account and sandbox balance |
| `POST` | `/api/v1/questions/resolve` | Search, rank, and return HIT/MISS plus a safe quote |
| `GET/POST` | `/api/v1/open-calls` | List or commission missing coverage |
| `DELETE` | `/api/v1/open-calls/{id}` | Cancel an owned call and refund unused escrow |
| `POST` | `/api/v1/open-calls/{id}/answers` | Validate an answer and add accepted memory |
| `GET` | `/api/v1/chats/{id}/answers` | Return accepted answers only to the originating chat owner |
| `GET` | `/api/v1/memory` | Read a user's answer and earnings ledger |
| `POST` | `/api/v1/memory/{id}/dispute` | Submit the user's one dispute for review |
| `GET/POST` | `/api/v1/admin/disputes[/{id}/review]` | List and review cases (admin role only) |
| `GET` | `/api/v1/account-controls` | Read server-authoritative strikes/dispute use |
| `GET/DELETE` | `/api/v1/account/balance` `/api/v1/account` | Read the ledger or delete and anonymize the account |
| `GET/POST` | `/api/v1/profile` | Read or persist the anonymous profile and payout wallet |
| `POST` | `/api/v1/profile/preferences` | Persist auto-match and agent-output preferences |
| `GET` | `/api/v1/earnings` | Audit append-only earnings and wallet snapshots |
| `GET` | `/api/flash-research` | Reveal only handles quoted for a query and accrue them once |
| `GET` | `/internal/v1/payment-quotes/{queryId}/{handle}` | Create/reuse an exact short-lived x402 quote (internal token required) |
| `GET` | `/internal/v1/payment-quotes/{id}/document` | Retrieve one quoted passage for the verified gateway |
| `POST` | `/internal/v1/chain-settlements` | Idempotently mirror a confirmed facilitator receipt |

The conduct ladder is enforced in the service, not just the UI. At two strikes,
the author's documents leave auto-match and new payouts are held for 14 days;
at three, further answers are rejected. Submitting a dispute never changes a
strike or payment. An admin approval performs the restoration atomically.

Register and keep the cookie in a local cookie jar:

```bash
curl -s -c /tmp/openshelf.cookies \
  http://localhost:8787/api/v1/auth/register \
  -H 'content-type: application/json' \
  -d '{"email":"buyer@example.com","password":"correct-horse-42"}'
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

`backend/paywall.yml` remains only as a legacy static-gateway example. The
implemented path is `payment-gateway/src/main.ts`, because recipients and prices
must be generated per document rather than fixed in YAML.

## Verify

```bash
cd backend
cargo fmt --check
cargo test --locked
cargo clippy --locked --all-targets -- -D warnings
```

`openapi.json` describes the three endpoints exposed through the Pay gateway;
all other backend routes remain outside that public payment surface.
