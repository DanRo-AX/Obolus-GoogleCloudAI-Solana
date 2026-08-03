<h1 align="center">
  <img src="public/OBOLUS-MARK.svg" alt="Obolus" width="56" valign="middle" /> Obolus
</h1>

<p align="center">
  <a href="https://github.com/DanRo-AX/Obolus-GoogleCloudAI-Solana"><img src="https://img.shields.io/github/stars/DanRo-AX/Obolus-GoogleCloudAI-Solana?style=flat&amp;label=%E2%98%85&amp;color=08C" alt="GitHub stars" /></a>
  <a href="https://github.com/DanRo-AX/Obolus-GoogleCloudAI-Solana/actions/workflows/ci.yml"><img src="https://github.com/DanRo-AX/Obolus-GoogleCloudAI-Solana/actions/workflows/ci.yml/badge.svg" alt="CI" /></a>
  <img src="https://img.shields.io/badge/Solana-Devnet-9945FF?style=flat" alt="Settles on Solana Devnet" />
  <img src="https://img.shields.io/badge/x402-v2%20exact%2FSVM-08C?style=flat" alt="x402 v2, exact scheme, SVM" />
  <img src="https://img.shields.io/badge/React%2019%20%C2%B7%20Rust%201.89%20%C2%B7%20Node%2024-4493F8?style=flat" alt="React 19, Rust 1.89, Node 24" />
</p>

<p align="center">
  <sub><a href="docs/readme/README.ko.md">한국어</a></sub>
</p>

<p align="center">
  <strong>The internet, as a database. Priced by the document.</strong><br/>
  Obolus is a search service that reads documents people wrote themselves instead of the web,<br/>
  and pays for them one at a time. Opening a document costs ₩5–₩20, and that money goes<br/>
  straight to the wallet of whoever wrote it. No approval dialog, no subscription.
</p>

<h3 align="center"><a href="#getting-started"><ins>Getting started</ins></a></h3>

<p align="center">
  <img src="docs/assets/hero.png" alt="Obolus asking a question, with the shelf search box on the landing page" width="960" />
</p>

## Features

<table>
<tr>
<td width="50%" valign="middle">

### Searches people, not the web

A general model fills the blank with the likeliest sentence. Obolus opens documents written by people who actually live there and pays each of them for what they wrote.

Searching and ranking are free. You are billed only for the documents that end up quoted.

</td>
<td width="50%">
  <img src="docs/assets/feature-thesis.png" alt="A free general model's generic answer beside four paid passages from people who live in Paris" width="100%" />
</td>
</tr>
<tr>
<td width="50%" valign="middle">

### Misses turn into paid open calls

If nothing on the shelves fits, the answer is not "no results". Name what one answer is worth, and the question goes out as a paid call to people who would know.

- Eleven fields on a vertical rail
- Filters by pay, fit, and remaining slots

</td>
<td width="50%">
  <img src="docs/assets/feature-board.png" alt="The open-calls board with a field rail and pay filters" width="100%" />
</td>
</tr>
<tr>
<td width="50%" valign="middle">

### Payment over HTTP 402

HTTP already had a status code for this. The server answers `402` with a price, the wallet pays it, the document opens. Nobody is asked to approve ₩12.

Prices read in won because that is what the people on the shelves think in. USDC is what moves on Solana.

</td>
<td width="50%">
  <img src="docs/assets/feature-settlement.png" alt="An example settlement receipt: four documents opened for a total of ₩38" width="100%" />
</td>
</tr>
<tr>
<td width="50%" valign="middle">

### Wallet-only accounts

No email, no password, no name. Connecting reads your public address; entering signs one expiring message that cannot move funds or approve a transaction. An asker only ever sees a handle.

Devnet SOL and USDC faucet links are on the sign-in page, before you connect.

</td>
<td width="50%">
  <img src="docs/assets/feature-login.png" alt="The wallet-only sign-in page with the question lifecycle beside it" width="100%" />
</td>
</tr>
<tr>
<td width="50%" valign="middle">

### Priced per document, not per panel

What people know has only ever traded whole: a panel study, an annual licence, three hundred responses compressed into one report.

Here the unit is one document, one open, one answer. It stays yours and keeps earning.

</td>
<td width="50%">
  <img src="docs/assets/feature-panel.png" alt="A row-by-row comparison between a survey panel and Obolus" width="100%" />
</td>
</tr>
<tr>
<td width="50%" valign="middle">

### Terms on the page, not in a policy

What you hand over and what is never taken sit side by side on the landing page rather than in a policy nobody opens.

Delete your shelf and it burns. Every document drops out of search immediately and is destroyed.

</td>
<td width="50%">
  <img src="docs/assets/feature-deal.png" alt="What you hand over, and what Obolus never takes" width="100%" />
</td>
</tr>
<tr>
<td width="50%" valign="middle">

### Public coverage for thin shelves

Under 300 documents a shelf cannot answer reliably, and the index says so. You cannot browse the documents themselves.

What is public: where questions come back empty, and what somebody has already offered to fill it.

</td>
<td width="50%">
  <img src="docs/assets/feature-coverage.png" alt="The thin-shelves page explaining free discovery, query-specific authority, and the paid boundary" width="100%" />
</td>
</tr>
<tr>
<td width="50%" valign="middle">

### English and Korean, both first-class

Not a translation layer bolted on. Korean gets its own typeface stack, weight, tracking, and `word-break: keep-all`, and the copy is rewritten per surface rather than translated sentence by sentence.

Switch in the sidebar footer. The choice survives a reload.

</td>
<td width="50%">
  <img src="docs/assets/feature-korean.png" alt="The same landing page rendered in Korean" width="100%" />
</td>
</tr>
</table>

**Also included**

- **[Antigravity plugin](integrations/antigravity/openshelf/README.md)**: the whole asker and contributor lifecycle as 23 `openshelf` MCP tools, plus the official Pay.sh MCP wallet behind a narrow handshake adapter.
- **Prepaid credit with recovery**: prove wallet ownership once, top up when low. A browser that loses the response reconciles against the server and retries only the handles that were never paid.
- **Open-call escrow**: a paid call reserves its full budget up front. Accepted answers release one unit each, and cancellation or account deletion returns the exact unused remainder as a payout claim.
- **A conduct ladder stated before signup**: false claims or low-quality answers earn a warning, and three warnings suspend the account. It is on the onboarding screen, not in the terms.
- **AI as liquidity, never as an author**: when human coverage is thin, Gemini on Vertex AI may give a free general baseline. It lives in `ai_baselines`, has no price, cannot be resold, earns no authority, and can never fill an open-call slot.
- **A deliberately narrow contributor memory agent**: it reuses an existing paid answer only for an opted-in call that is 82%+ near-identical and still passes targeting, pricing, lock, and conduct rules. Everything else needs the person.
- **Receipts**: every chat, every purchased document, every transaction link, in one place.

---

## How it works

```text
ask → search the shelves → rank by similarity → HIT or MISS
  HIT  → reserve prepaid credit → pay N owners → cited answer + receipt
  MISS → "Nobody has covered this yet. Want me to ask people?"
       → "How many people?"  → "What do you want to pay per answer?"
       → call posted → open-calls board
```

That branch is the only thing this project had to invent, so `src/pages/Chat.tsx`
implements it as a state machine that speaks exactly that dialogue. When enough
matching documents already exist the order inverts: no call is posted, and the
question goes straight to "here is the price, settle now?"

Matching, ranking, budget filtering, author deduplication, and the hit/miss
decision all run in the Rust service, using 768-dimensional hash embeddings, word
and character n-grams, entity anchors, trust, freshness, and topic-personalized
PageRank over curator-verified evidence edges. Paid, self-owned, inferred, and
raw UGC edges cannot buy authority. The search response carries handles and
prices, never a passage.

<details>
<summary><strong>The two settlement paths, in full</strong></summary>

**Agent path: the official Pay.sh gateway.** This is the default for autonomous agents.

1. Free search returns payment-safe handles and a query-scoped recovery token.
2. The agent checks the free recovery URL, then prepares one query-bound Pay.sh resource per unopened handle.
3. `pay curl` handles the HTTP 402/MPP exchange. Pay.sh splits all but one USDC atomic unit directly to the verified contributor wallet.
4. Rust re-validates the immutable quote, price band, asset, network, query, handle, and runtime recipient before returning the snapshot.
5. A lost response is recovered for free, and retries do not accrue twice.

**Browser path: Phantom and prepaid credit.** No companion process, no separate install.

1. Rust searches private documents and returns only safe handles and KRW prices.
2. It commits the exact handles, content hashes, beneficiary wallets, per-document atomic prices, total, mint, network, and expiry into one job.
3. It atomically reserves the job cost from verified prepaid credit. If credit is low, an unpaid refill resource returns x402 v2 `402 Payment Required` and Phantom tops up once.
4. A confirmed refill credits the ledger and funds the job. It does not reveal passages or accrue earnings.
5. The server agent runs Pay.sh/MPP per document, and Rust releases only that exact paid snapshot, idempotently.
6. Rust reloads only server-proven opened passages, then Gemini on Vertex AI writes a cited synthesis. With no provider configured the UI shows an evidence-only result rather than inventing an answer.
7. A permanent partial failure restores the exact unpaid atomic remainder to prepaid credit.

No user private key, browser helper key, or SPL delegate ever reaches Rust, the
gateway, or Cloud Run. The service wallet signs through GCP KMS. See
[`docs/agent-payment-threat-model.md`](docs/agent-payment-threat-model.md).

</details>

Implementation diagrams: **[system architecture and ERD](architecture.html)**.

---

## Tech stack

<p>
  <kbd>React&nbsp;19</kbd> &nbsp; <kbd>TypeScript&nbsp;5.9</kbd> &nbsp; <kbd>Vite&nbsp;8</kbd> &nbsp; <kbd>Tailwind&nbsp;v4</kbd> &nbsp; <kbd>React&nbsp;Router&nbsp;7</kbd> &nbsp; <kbd>three.js</kbd> &nbsp;
  <kbd>Rust&nbsp;1.89&nbsp;/&nbsp;Axum</kbd> &nbsp; <kbd>Cloud SQL&nbsp;/&nbsp;PostgreSQL</kbd> &nbsp;
  <kbd>x402&nbsp;v2&nbsp;—&nbsp;exact&nbsp;/&nbsp;SVM</kbd> &nbsp; <kbd>Solana&nbsp;Devnet</kbd> &nbsp; <kbd>USDC</kbd> &nbsp; <kbd>Phantom</kbd> &nbsp;
  <kbd>Pay.sh&nbsp;+&nbsp;MPP</kbd> &nbsp; <kbd>GCP&nbsp;KMS</kbd> &nbsp; <kbd>Cloud&nbsp;Run</kbd> &nbsp; <kbd>Gemini&nbsp;on&nbsp;Vertex&nbsp;AI</kbd>
</p>

---

## Getting started

```bash
npm ci
npm --prefix payment-gateway ci
npm --prefix agent-orchestrator ci

cp .env.example .env             # set the KMS service-wallet public key and a Devnet RPC
gcloud auth application-default login   # local Vertex AI ADC, no API key
                                 # set GOOGLE_CLOUD_PROJECT in .env; enable the Vertex AI API for it

npm run dev:stack                # frontend, Rust API, and the x402 gateway together
```

| Process | Port | Started by |
| --- | --- | --- |
| Frontend (Vite) | `4319` | `npm run dev:stack` |
| Rust API (Axum) | `8787` | `npm run dev:stack` |
| x402 gateway | `1402` | `npm run dev:stack` |
| Pay.sh gateway (sandbox) | `3402` | `npm run pay:gateway:sandbox` |

Optional:

```bash
npm run pay:gateway:sandbox      # the official Pay.sh gateway, local sandbox
npm run x402:devnet:smoke        # funded-wallet settlement verification
```

The paid path is live by default. Set `VITE_X402_ENABLED=false` only when you
explicitly want the old sandbox-ledger path, or `VITE_BACKEND_ENABLED=false` for
the fully static fallback.

### Agents (Antigravity and plain MCP)

```bash
agy plugin install ./integrations/antigravity/openshelf
npm run agent:doctor
node integrations/antigravity/openshelf/runtime/server.mjs auth login --email YOU@example.com
agy
```

Use `/mcp` to confirm both `openshelf` and `pay` are connected. Free search and
AI baselines need no Pay account. Before the first paid action, create or select
a locally protected named Pay account, and set `OPENSHELF_PAY_ACCOUNT=NAME` when
it should differ from the Pay default. **The plugin requires explicit approval
for the exact aggregate Devnet amount before it invokes Pay.**

The same service runs without Antigravity:

```bash
npm run agent:tools                          # list all 23 commands
npm run agent:tools -- ask_people            # one exact input schema
npm run agent:call -- ask_people --json \
  '{"question":"What do people living in Paris actually eat on weeknights?","requestedDocuments":3}'
```

Authenticated contributor commands reuse the local session from `auth login`.
Paid commands return an exact URL and amount for the separate Pay MCP. They
never receive a private key.

See [`integrations/antigravity/openshelf/README.md`](integrations/antigravity/openshelf/README.md),
[`docs/ACCOUNT-LINKING.md`](docs/ACCOUNT-LINKING.md), [`pay/PAY.md`](pay/PAY.md),
and [`docs/PAY-SH.md`](docs/PAY-SH.md) for Cloud Run + GCP KMS deployment.

---

## Building and testing

```bash
npm run build                    # tsc -b && vite build
npm run lint                     # oxlint
npm run check:all                # every workspace: build, lint, typecheck, tests, clippy
```

`check:all` needs a Rust toolchain (`rust-toolchain.toml` pins 1.89.0) because it
runs `cargo test` and `cargo clippy -D warnings` against `backend/`. CI runs the
frontend, agent-orchestrator, payment-gateway, and backend jobs separately. See
[`.github/workflows/ci.yml`](.github/workflows/ci.yml).

---

## Screens

| Route | Screen | What it does |
| --- | --- | --- |
| `/` | **Ask** | The front door. Ask, and SHELF searches the shelves; a miss becomes an open call. |
| `/chat/:id` | Chat | One question's thread, including the hit/miss dialogue and the settlement preview. |
| `/dashboard` | **Open calls** | The answerer's board. Calls arrive with a price per answer; pick one, answer, get paid. |
| `/memory` | **My shelf** | Everything you have answered. The thicker it gets, the better auto-match sticks. |
| `/archive` | Receipts | Chats, purchased documents, and transaction links. |
| `/coverage` | Thin shelves | Where questions come back empty, and what has been offered to fill them. |
| `/answer/:orderId` | Answer | One screen, one question, a few warm-ups first. |
| `/onboarding` | Set-up | Handle, bands, fields, payout wallet, and the three-strike conduct ladder. |
| `/whitepaper` | The argument | The long-form case for the thing. |
| `/login` `/terms` `/privacy` `/admin/disputes` | | Wallet sign-in, legal, admin dispute review. |

---

## Repository structure

| Path | What lives there |
| --- | --- |
| `src/` | The React app: pages, components, `i18n/`, and the `data/` fixtures the landing page labels as illustrations. |
| `backend/` | The Rust/Axum service: search, ranking, ledger, escrow, disputes, sessions. [`backend/README.md`](backend/README.md) states the exact boundary. |
| `payment-gateway/` | The x402 v2 gateway: quotes, verify/settle delegation, payout and escrow workers. |
| `agent-orchestrator/` | The Cloud Run agent that pays each document's Pay.sh challenge. |
| `pay/` | Pay.sh paywall definitions, Dockerfile, and the Cloud Build + GCP KMS deployment. |
| `integrations/antigravity/openshelf/` | The plugin: 23 MCP tools, skills, and the Pay handshake adapter. |
| `docs/` | Threat model, account linking, Pay.sh deployment, code review, ranking notes. |
| `architecture.html` | System architecture and ERD, as one openable file. |

---

## Project status

Stated here rather than smoothed over, because the distinction matters for anyone reading the code.

**Working today.** Paid document opens and paid open-call budgets use actual
x402 exact/SVM settlement on Solana Devnet. Sessions are server-issued HttpOnly
cookies, and client-supplied `userId` values are rejected. Escrow reservation,
deterministic per-answer payout, and exact refund on cancellation or account
deletion are all implemented. Account deletion revokes every session, destroys
profile, memory, and document text, and anonymizes the append-only financial
audit rows. Content hashes, immutable versions, corrections that lock the
superseded passage, private export logs, and public manifests that expose only
matching metadata also work. The server enforces both the two-strike
auto-match/payout hold and the three-strike suspension.

**Labelled sandbox.** The ₩100,000 signup balance and zero-price calls are a
clearly labelled ledger, not fiat. The local Pay.sh sandbox proves the full
402/delivery/recovery contract, not a Devnet transfer. A funded Devnet receipt
still needs the team's external Pay account, KMS IAM principal, and Devnet USDC.

**Out of scope.** Mainnet. A public Devnet service would still need a managed
RPC, a durable multi-instance queue and database, distributed rate limits, email
verification, KMS secret management, and an external identity provider for
social login.

**Still open.** Carried over from the founding meeting and answered honestly in
the product FAQ rather than hidden:

1. **How the shelves get filled at launch.** The biggest unsolved problem. An empty shelf leaves the librarian nothing to do.
2. **Voice versus chat collection.** Undecided. v1 uses the open-call answer flow.
3. **Cold-start authority.** Relevance exploration works, but production calibration and Sybil-resistant identity are needed before graph authority is mature.
4. **Low-effort answers.** ID-verified identity is out of scope for v1.

Further reading: [`SCENARIO-AUDIT.md`](SCENARIO-AUDIT.md) for Chrome-verified
scenarios and prioritized gaps, [`docs/CODE-REVIEW.md`](docs/CODE-REVIEW.md) for
the production audit, and [`BRIEF.md`](BRIEF.md), the source-of-truth product
brief every line of copy was written against.

---

## License

No `LICENSE` file is committed yet, so default copyright applies: all rights
reserved. Open an issue if you need terms for a specific use.
