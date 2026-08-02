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
cp .env.example .env  # set OPENSHELF_DEFAULT_RECEIVER to your Devnet wallet
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
2. The gateway asks Rust for a short-lived per-document quote: recipient,
   Devnet USDC mint, exact atomic amount, network, and expiry.
3. An unpaid resource request returns x402 v2 `402 Payment Required` with a
   `PAYMENT-REQUIRED` header.
4. The browser x402 client has Phantom sign the exact USDC transfer and retries
   with `PAYMENT-SIGNATURE`.
5. The public Devnet facilitator verifies and settles it, the gateway releases
   the purchase-time content snapshot, and Rust records the signature
   idempotently.
6. Rust reloads only server-proven opened passages, then Gemini/Vertex produces
   a cited synthesis. Without a provider, the UI shows an explicit evidence-only
   result instead of inventing an answer.
7. Direct-to-author payments are marked `onchain`; they are not added again to
   the sandbox KRW balance. Failed ledger mirrors remain in the gateway outbox
   and retry safely.

The seeded corpus has no real author wallets, so
`OPENSHELF_DEFAULT_RECEIVER` receives those demo payments. User-authored
documents pay the wallet saved on that author's profile.

If a browser loses the response after settlement, the client reconciles the
query with Rust, recovers passages that are already proven paid, and retries
only unpaid handles. The query recovery token is scoped to the original query
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
  HIT  → open N docs → quote each → x402 settlement line → accrues to authors
  MISS → "Nobody has covered this yet. Want me to ask people?"
       → "How many people?"  → "What do you want to pay per answer?"
       → call posted → dashboard
```

The browser-wallet path confirms every spend before opening anything because
Phantom signs one author payment per document. The preview shows KRW, estimated
Devnet USDC, approval count, network, and the token mint. A question that already
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

The KRW signup/open-call balance is still a clearly labelled sandbox ledger; it
models reservations and refunds but is not fiat or on-chain escrow. Paid
document opens now use actual x402 exact/SVM settlement on Solana Devnet.
The official Pay.sh YAML is a separate static localnet compatibility path; it
is not proof of Devnet settlement. See [`docs/PAY-SH.md`](./docs/PAY-SH.md).
Production still requires a mainnet facilitator credential, managed RPC,
durable outbox volume or queue, rate limiting, email verification/recovery, KMS
secret management, and an external identity provider if social login is
desired. A policy-limited agent wallet and the projected monthly top-up product
are not implemented yet. Agent payments
remain visibly disabled until the controls in
[`docs/agent-payment-threat-model.md`](./docs/agent-payment-threat-model.md) are
implemented and reviewed. Browser settlement reconciliation is implemented;
paid handles are recovered before any retry.
See `SCENARIO-AUDIT.md` for the Chrome-verified scenarios and prioritized gaps,
[`docs/CODE-REVIEW.md`](./docs/CODE-REVIEW.md) for the PR #2/#9 consolidation
and production audit, and `backend/README.md` for the exact backend boundary.

`BRIEF.md` holds the source-of-truth product brief the copy was written against.
