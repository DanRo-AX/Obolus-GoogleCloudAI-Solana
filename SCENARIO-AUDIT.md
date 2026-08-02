# OPENSHELF user scenarios

Updated: 2026-08-02

## User types

| User | Primary job | Required state | Server-owned guarantees | UI entry |
| --- | --- | --- | --- | --- |
| Visitor | Search public shelf metadata | None | Cannot read memory, profile, balance, disputes, or another user's chats | Home, chat, coverage |
| Buyer | Buy existing passages or commission missing coverage | Authenticated account; sandbox balance for a call | Full call budget reserved; one unit released per accepted answer; unused amount refundable; returned answers scoped to owned `chatId` | Chat, “Posted by me”, balance |
| Contributor | Answer matching calls and build reusable memory | Authenticated account and completed profile | Cannot answer own call, answer twice, answer a full/cancelled call, or bypass demographic/category targeting | Dashboard, answer flow, My memory |
| Restricted contributor | Continue after one or two quality failures | Same as contributor | 2 strikes remove auto-match and hold new earnings for 14 days; 3 strikes suspend new answers | Dashboard warning, memory ledger |
| Disputant | Challenge one voided answer | One unused dispute | Submission remains pending and unpaid; submitter cannot approve it | My memory |
| Reviewer | Approve or reject a pending dispute | Authenticated `admin` role | Approval restores document, slot, and escrow payment atomically; rejection changes none of them; decision cannot be replayed | `/admin/disputes` |
| Departing user | Remove their account | Authenticated session | Open reservations refunded, sessions revoked, profile/memory/document text deleted, financial rows anonymized | My memory → Delete account |
| Browser-wallet buyer | Inspect and pay for existing passages | Phantom on Solana Devnet with SOL and Devnet USDC | Exact per-document x402 quote; passage stays closed until settlement | Chat payment preview |
| Autonomous buyer agent | Open documents within a policy without repeated human approval | Policy-limited wallet or spending delegation | **Not implemented yet**; the current Phantom path is intentionally interactive | Agent-readable mode (preview only) |

## Scenario checks

### Visitor and authentication

- Registration validates email and an 8–128 character password.
- Passwords are Argon2id hashes; session tokens are random, SHA-256 hashed at
  rest, expire after 30 days, and are delivered in an HttpOnly SameSite cookie.
- Private routes ignore spoofed `userId` query parameters and derive identity
  only from the session.
- Sign-out revokes the current session and clears user-local UI state.

### Buyer

1. A question searches safe metadata first; passages remain closed.
2. A miss offers a target count and unit price.
3. Creating a call atomically moves `unit price × target` from available to
   reserved sandbox balance.
4. Each accepted answer decrements the call escrow and buyer reservation by one
   unit, credits the contributor, creates memory, and fills one slot.
5. The buyer's chat polls the owner-scoped answer endpoint and deduplicates by
   answer ID.
6. “Posted by me” can load those server-owned answers directly, so a buyer can
   sign in from another browser even when the original browser-local chat is
   unavailable.
7. Cancellation refunds the remaining reservation; paid answers stay paid.
   Cancelled calls remain visible only to their owner as refunded history.
8. Insufficient balance, overflow, wrong owner, filled calls, and repeated
   cancellation fail without partial writes.

### Browser-wallet payment

1. A hit always stops at a payment preview before Phantom is invoked.
2. The preview shows the exact KRW total, approximate Devnet USDC amount,
   number of approvals, network, and the shortened Devnet USDC mint. Phantom
   may label that test token `Unknown`; the UI explains that before approval.
3. Each document is a separate x402 resource and author payment, so the current
   browser flow asks once per document. All returned transaction signatures are
   kept in the chat receipt rather than hiding all but the first.
4. Seeded document opens are true micropayments: ₩5–₩25 each. The five-document
   Seongsu example currently resolves to ₩50, about 0.03704 USDC at
   ₩1,350/USDC.
5. A failure finishes the hit/miss trace instead of leaving Step 4 spinning.
6. The browser stores the query recovery token with the tab-session chat, asks Rust
   which handles already settled for the connected payer, recovers those paid
   passages, and retries only the unpaid remainder. A connected-wallet mismatch
   is stopped before a payment request is created.
7. Helpful/not-helpful/report feedback is accepted only for a document the same
   payer actually settled in that query. Reports enter the admin review queue.

### Wallet and account identity

- The signed-in OPENSHELF email, anonymous profile handle, browser-wallet public
  key, saved payout address, verification state, and Devnet network are labelled
  separately.
- Connecting Phantom never changes the service payout profile by itself.
  Onboarding requires an explicit “Use this as payout address” action.
- Payout ownership uses the exact server challenge through `signMessage`;
  replacing an existing payout address requires confirmation and revokes the
  old verification until the new signature succeeds.

### Contributor and targeting

- A profile and a non-suspended account are required.
- Category is always part of call eligibility. Optional age, region, household,
  and field bands are conjunctive and server-enforced.
- Accepted documents snapshot the profile bands shown to the buyer.
- Quality checks run on the server even though the UI shows a preflight warning.
- A voided answer fills no slot, creates no searchable document, and earns zero.

### Dispute and enforcement

- One dispute can be submitted per account and requires a written rationale.
- Pending and rejected cases leave memory voided and escrow reserved for a future
  valid answer.
- Approval is admin-only, single-use, and validates that the call still has a
  slot and enough escrow before restoring anything.
- Held earnings mature into available balance once their 14-day availability
  time is reached.

### Deletion

- The operation runs in one SQLite transaction.
- Remaining call reservations are refunded before the account is removed.
- Query references to authored documents are removed; memory and document text
  are deleted; wallet snapshots and user IDs in financial rows are anonymized.
- All sessions and the account row are deleted, so the old cookie cannot be
  authenticated again.

## Automated evidence

Backend tests cover session creation, spoof rejection, escrow reservation,
target mismatch, owner-only chat return, accepted payment, cancellation refund,
quality voiding, duplicate/own-answer rejection, two- and three-strike rules,
pending/approved/rejected disputes, idempotent document opens, migration, and
account deletion. Frontend verification consists of TypeScript production build,
Oxlint, and end-to-end Chrome walkthroughs of registration, onboarding, explicit
payout-address opt-in, profile eligibility refresh, MISS-to-open-call creation,
the four-step private interview, an accepted ₩300 answer and earnings ledger,
and buyer retrieval of that returned answer after a full account switch erased
the original local chat. The latest live Devnet pass completed the ₩50/5-approval
HIT across a response-loss recovery boundary, proved that failed attempts did not
create chain settlements, and finalized all five x402/SVM transfers. It also
confirmed projected subscriptions and agent payments remain disabled. Earlier
passes covered Phantom reconnect, signed-out route guards, desktop and 390px
mobile payment previews, and mobile navigation overlap.

## Explicit production boundaries

- `KRW_SANDBOX` is an application ledger, not custody of fiat or tokens.
- Mainnet x402 settlement still needs production recipient funding, a KMS-backed
  signer, confirmation/reconciliation workers, and gateway hardening.
- Social login, email verification/recovery, abuse rate limits, observability,
  backups, and a separately staffed review operation remain deployment work.
- Chat transcripts are tab-session local; money, identity, authorization, calls,
  answers, and memory are server-owned.

## Remaining product and production work, in priority order

1. **Autonomous agent wallet.** Agent mode is disabled. Add a
   policy-limited wallet/session key with per-open, per-query, and daily caps;
   expiry; allowlisted asset/network; and revocation. Until then, claims of
   “no human approval” must stay out of current-product copy. The mandatory
   controls and tests are in `docs/agent-payment-threat-model.md`.
2. **Approval batching.** The human demo currently asks once per author. A
   batch-capable signer can reduce wallet interruptions, but receipts and payout
   accounting must remain per author.
3. **Mainnet operations.** Managed RPC/facilitator, KMS-backed secrets, durable
   reconciliation queue, monitoring, alerts, rate limits, backups, abuse
   controls, and incident runbooks are required before real value.
4. **Commercial model.** Monthly top-ups on the pricing page are explicitly
   projected. Implement custody/compliance and an actual ledger-to-USDC funding
   path, or remove those plans before launch.
5. **Quality and moderation operations.** Paid-buyer feedback,
   report intake, admin adjudication, Bayesian reliability updates, and automatic
   locking after repeated upheld reports are implemented end to end. Review SLAs,
   provenance checks, and privacy/redaction operations remain production work.
