# OPENSHELF

Implementation diagrams: [system architecture and ERD](./architecture.html)

An agent that searches what people wrote instead of the web, and pays them over
x402 for every document it opens.

> Turn the internet into a database, and charge x402 for access.

React 19 + TypeScript + Vite + Tailwind v4, a Rust/Axum API, SQLite, and an
x402/Solana payment gateway.

```bash
npm ci
npm --prefix payment-gateway ci
cp .env.example .env  # set the direct and bundle receiver Devnet wallets
gcloud auth application-default login  # local Vertex AI ADC; no API key
# set GOOGLE_CLOUD_PROJECT in .env; Vertex AI API must be enabled for it
npm run dev:stack     # frontend :4319, Rust :8787, x402 gateway :1402
npm run x402:devnet:smoke # optional funded-wallet settlement verification
```

Verification:

```bash
npm run check:all
npm run build
```

The paid path is live by default. Set `VITE_X402_ENABLED=false` only when you
explicitly want the old sandbox-ledger path, or
`VITE_BACKEND_ENABLED=false` for the fully static fallback.

## Actual payment path

1. Rust searches private documents and returns only safe handles and KRW prices.
2. For one document, the gateway asks Rust for a short-lived direct-author
   quote. For two or more, Rust commits the exact handles, content hashes,
   beneficiary wallets, total, mint, network, and expiry into one bundle quote.
3. An unpaid resource request returns x402 v2 `402 Payment Required` with a
   `PAYMENT-REQUIRED` header.
4. The browser x402 client asks Phantom once. A single document pays its author
   directly; a multi-document purchase sends one aggregate transfer to the
   configured bundle escrow and retries with `PAYMENT-SIGNATURE`.
5. The public Devnet facilitator verifies and settles it, the gateway releases
   the purchase-time content snapshot, and Rust records the signature
   idempotently.
6. Rust reloads only server-proven opened passages, then Gemini on Vertex AI produces
   a cited synthesis. Without a provider, the UI shows an explicit evidence-only
   result instead of inventing an answer.
7. Direct-to-author payments are marked `onchain`. Bundle shares are marked
   `claimable` against each author's verified wallet. The Devnet payout worker
   leases each claim, persists the exact signed transaction before broadcast,
   resumes safely after a crash, and marks it paid only after confirmation.
   Neither path is added again to the sandbox KRW balance. Failed ledger mirrors
   remain in the gateway outbox and retry safely.

Paid MISS/open-call commissions use the same one-approval model. Rust commits
the question, target, display budget, exact Devnet USDC amount, mint, escrow
receiver, and expiry. Phantom approves one transfer for the whole target; only
the confirmed settlement creates the call. Every accepted answer receives a
deterministic atomic share, and cancellation or account deletion returns the
exact unused remainder to the original payer through a payout claim. A
zero-price call keeps the explicitly labelled sandbox path because there is no
token transfer to settle.

The seeded corpus has no real author wallets, so
`OPENSHELF_DEFAULT_RECEIVER` is its demo beneficiary. User-authored documents
snapshot the verified wallet saved on that author's profile. Multi-document
transfers land in `OPENSHELF_BUNDLE_RECEIVER`; the contributor Memory screen
shows the corresponding escrow claim separately from sandbox and direct-chain
balances.

If a browser loses the response after settlement, the client reconciles the
query with Rust, recovers passages that are already proven paid, and retries
only unpaid handles. The query recovery token is scoped to the original query,
expires after 24 hours,
and payer-sensitive recovery APIs; it is also required for paid-evidence
synthesis and is never a general document-access credential.

## The three screens the meeting locked

| Route | Screen | What it does |
| --- | --- | --- |
| `/` | **Chat** (01) | The front door. Ask, and SHELF-1 searches the shelves. If nothing matches it offers to commission the answer. |
| `/dashboard` | **Dashboard** (02) | The answerer's side. Open calls arrive with a price per answer; pick one, answer, get paid. |
| `/memory` | **My memory** (03) | Everything you have answered. The thicker it gets, the better auto-match sticks. |
| `/shelf` | Shelves | Browsable catalogue of the database — 24 shelves, 10 categories. |
| `/pricing` `/shelf-1` `/terms` `/privacy` `/login` | | Per-open pricing, the agent launch post, legal, auth. |

## The one thing that had to be built new

Step 4 of the question lifecycle — the hit/miss branch — is the project's only
invention, so `src/pages/Chat.tsx` implements it as a state machine that speaks
the exact dialogue the meeting settled on:

```
ask → search the shelves → rank by similarity → HIT or MISS
  HIT  → open N docs → one exact bundle quote → one x402 approval → author claims
  MISS → "Nobody has covered this yet. Want me to ask people?"
       → "How many people?"  → "What do you want to pay per answer?"
       → call posted → dashboard
```

The browser-wallet path confirms every spend before opening anything. Phantom
signs once for the exact set: one document is direct-to-author, while two or
more use the bundle escrow and beneficiary ledger. The preview shows KRW,
estimated Devnet USDC, approval count, network, and the token mint. A question that already
has enough matching documents skips the call entirely and offers to settle on
the spot — the inverted order the meeting called out. Seeded opens cost ₩5–₩25;
the five-document Seongsu example currently resolves to ₩50 (about 0.03704
Devnet USDC at the default conversion rate).

Matching, ranking, budget filtering, author deduplication, and the hit/miss
decision now run in the Rust service. It combines deterministic 768-dimensional
hash embeddings, word/character n-grams, entity anchors, trust, freshness, and
topic-personalized PageRank over curator-verified independent evidence edges.
Paid, self-owned, inferred, and raw UGC edges cannot buy authority. The search
response contains handles and prices but never paid passages.

## AI supplies liquidity; people create the asset

When human coverage is empty or thin, Gemini on Vertex AI may provide a free **AI general
baseline** so a questioner does not hit a blank screen. That baseline lives in
`ai_baselines`, never `documents`: it has zero price, expires, cannot be resold,
earns no authority, cannot satisfy an open-call slot, and is never used by the
contributor Memory agent. Its structured output is limited to stable
orientation and decision criteria, then explicitly lists the current,
firsthand gaps that still require people. If enough human documents exist—even
when the buyer's budget is too low—the server refuses to generate a baseline.

The opposite cold start is explicit too. A contributor can ask Gemini on Vertex AI for
three **Shelf starter** interview prompts based only on broad fields they
agreed to answer in. The UI states that no buyer is waiting and no upfront
reward is guaranteed. A prompt has no price or evidence status; only the
contributor's quality-checked firsthand answer becomes a sellable human
document. Gemini on Vertex AI supplies demand-side context, supply-side interviewing, and
post-purchase synthesis without ever becoming a marketplace author.

## Canvases

`src/components/GlitterWrap.tsx` — the hero starfield, ported from the
Originkit/Framer component. Algorithm kept verbatim (framerate-independent trail
decay, cached colour strings, per-star speed jitter); the Framer plumbing was
stripped and the preset baked in as defaults. Stars composite additively, so the
hero panel carries a deep base colour for them to read against.

`src/components/PointField.tsx` — every other point field (shelf ticker, the MD
lattice, the use-case carousel, the footer wordmark), on the 2D canvas. Two
distributions: `nebula` (filament random walks) and `mask` (a lattice sampled
through an SVG or rasterised text). Both pause off-screen and honour
`prefers-reduced-motion`.

## Implemented product boundary

The frontend now uses server-issued, HttpOnly session cookies; client-supplied
`userId` values are not accepted. Registration creates ₩100,000 of explicitly
labelled sandbox credit and requires explicit confirmation that the user is at
least 14. A paid open call reserves its full maximum budget in a
SQLite ledger, accepted answers release one unit to the contributor, and
cancellation refunds every unused unit. Open-call answers are readable only by
the owner of the originating `chatId`. They are delivered back into that chat
and can also be reloaded from “Posted by me” after a browser or device change.

Age, region, household, and field bands can be selected in the composer. The
same filters are enforced during document search and when an answerer tries to
pick up a call; accepted documents snapshot the contributor's bands for the
buyer. Low-quality answers remain voided when a dispute is submitted. Only an
authenticated admin review can approve or reject the case; approval restores
the document, slot, and escrow payment in one transaction.

Authenticated account deletion refunds unused reservations, revokes all
sessions, deletes profile, memory, and document text, and anonymizes the minimal
append-only financial audit rows.

Accepted memories carry a SHA-256 content hash, immutable version, reliability
and importance scores, lock state, and access count. Corrections create a new
version and lock the superseded passage. Contributors can export their private
memory/access log, while public contributor and document manifests expose only
matching metadata (including profile demographic bands), hashes, versions,
prices, and x402 links. Those bands therefore require an explicit disclosure
and consent treatment before a public launch.

## Honest gaps

Carried over from the meeting, and stated in the FAQ rather than smoothed over:

1. **How the shelves get filled at launch.** The biggest open problem. An empty
   shelf leaves the librarian nothing to do. The dashboard ships with seeded
   open calls so a demo has something to show.
2. **Voice vs chat collection.** Undecided; v1 uses the open-call answer flow.
3. **Cold-start authority.** Relevance exploration works, but production
   calibration and Sybil-resistant identity are still required before graph
   authority can be treated as mature.
4. **Low-effort answers.** ID-verified identity is out of scope for v1.

Profiles, payout wallets, auto-match preferences, open calls, answers, memory,
query quotes, disputes, and append-only settlement/accrual events persist in
SQLite. The server also enforces the two-strike auto-match/payout hold and the
three-strike suspension. Chat transcripts remain tab-session local in backend
mode (durable local storage is reserved for the offline demo); authenticated
account, money, memory, and authorization state are server-owned.

The KRW signup balance and zero-price calls remain a clearly labelled sandbox
ledger; they are not fiat. Paid document opens and paid open-call budgets use
actual x402 exact/SVM settlement on Solana Devnet.
The official Pay.sh YAML is a separate static localnet compatibility path; it
is not proof of Devnet settlement. See [`docs/PAY-SH.md`](./docs/PAY-SH.md).
Mainnet operation is intentionally out of scope. A public Devnet service still
needs a managed RPC, durable multi-instance queue/database, distributed rate
limits, email verification, KMS secret management, and an external identity
provider if social login is desired. Password reset/recovery is implemented via
the email outbox and revokes all sessions. The agent-payment policy evaluator is
implemented and tested, but unattended signing remains disabled until a
reviewed non-custodial Solana delegation standard is selected; no proprietary
custody key is created. See
[`docs/agent-payment-threat-model.md`](./docs/agent-payment-threat-model.md).
Browser settlement reconciliation is implemented;
paid handles are recovered before any retry.

Contributor question delivery now includes server-ranked recommendations, a
durable in-app inbox, five-second browser refresh with optional system alerts,
opt-in email outbox delivery, and ten-minute answer-slot reservations. The
contributor memory agent is deliberately narrower than a generative responder:
it reuses the exact original paid answer only for an opted-in, 82%+
near-identical call that still meets targeting, pricing, lock, and conduct
rules. Every other call still requires the person to answer.
See `SCENARIO-AUDIT.md` for the Chrome-verified scenarios and prioritized gaps,
[`docs/CODE-REVIEW.md`](./docs/CODE-REVIEW.md) for the PR #2/#9 consolidation
and production audit, and `backend/README.md` for the exact backend boundary.

`BRIEF.md` holds the source-of-truth product brief the copy was written against.
