# OPENSHELF user scenarios

Updated: 2026-08-03

## User types

| User | Primary job | Required state | Server-owned guarantees | UI entry |
| --- | --- | --- | --- | --- |
| Visitor | Search public shelf metadata | None | Cannot read memory, profile, balance, disputes, or another user's chats | Home, chat, coverage |
| Buyer | Buy existing passages or commission missing coverage | Authenticated account; sandbox balance for a call | Full call budget reserved; one unit released per accepted answer; unused amount refundable; returned answers scoped to owned `chatId` | Chat, “Posted by me”, balance |
| Contributor | Receive and answer matching calls, then build reusable memory | Authenticated account and completed profile | Ranked in-app delivery, optional browser/email alerts, ten-minute slot hold; cannot answer own/full/cancelled call, answer twice, or bypass targeting | Dashboard, answer flow, My memory |
| Memory-agent contributor | Reuse a previously paid answer without fabricating a new experience | Contributor with auto-match and Memory agent explicitly enabled | Exact old answer only; 82%+ question similarity, category/target match, unlocked document, price floor, and conduct limits are server-enforced | Dashboard preferences, My memory |
| Restricted contributor | Continue after one or two quality failures | Same as contributor | 2 strikes remove auto-match and hold new earnings for 14 days; 3 strikes suspend new answers | Dashboard warning, memory ledger |
| Disputant | Challenge one voided answer | One unused dispute | Submission remains pending and unpaid; submitter cannot approve it | My memory |
| Reviewer | Approve or reject a pending dispute | Authenticated `admin` role | Approval restores document, slot, and escrow payment atomically; rejection changes none of them; decision cannot be replayed | `/admin/disputes` |
| Departing user | Remove their account | Authenticated session | Open reservations refunded, sessions revoked, profile/memory/document text deleted, financial rows anonymized | My memory → Delete account |
| Browser-wallet buyer | Inspect and pay for existing passages | Phantom on Solana Devnet with SOL and Devnet USDC | Exact direct quote for one document or one committed bundle for many; passages stay closed until settlement | Chat payment preview |
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
   one approval, network, and the shortened Devnet USDC mint. Phantom
   may label that test token `Unknown`; the UI explains that before approval.
3. One document stays a direct-to-author x402 resource. Two or more are bound
   into one quote by handle, content hash/version, consent version, price, and
   beneficiary wallet, so the browser signs one aggregate transfer. Rust keeps
   one chain receipt and a separate `claimable` earning row per author/document.
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
- New matching calls create a durable unread notification. Dashboard order uses
  the server recommendation score and explains profile, primary-field, shelf,
  and prior-memory reasons.
- The signed-in frontend refreshes notifications and calls every five seconds.
  Browser system alerts require explicit browser permission; email delivery is
  separately opt-in and uses a retryable SQLite outbox when a provider is configured.
- Opening an answer deep link reserves one slot for ten minutes and renews it
  every minute. Submitting, leaving through the SPA, or closing/navigating the
  page releases it; expiration is the final server-side safety net.
- Memory agent never invokes a generative model. It reuses the exact accepted
  answer only above the strict similarity and policy boundary; otherwise the
  contributor receives a fresh interview notification.

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
account deletion, active-slot contention/release, contributor notification and
email-outbox creation, strict Memory-agent reuse, plus exact bundle creation, query-token rejection, quote
idempotency, one-signature settlement, multi-document recovery, per-document
feedback, and per-beneficiary claim accounting. Frontend verification consists of TypeScript production build,
Oxlint, and end-to-end Chrome walkthroughs of registration, onboarding, explicit
payout-address opt-in, profile eligibility refresh, MISS-to-open-call creation,
the four-step private interview, an accepted ₩300 answer and earnings ledger,
and buyer retrieval of that returned answer after a full account switch erased
the original local chat. The latest legacy live Devnet pass completed the ₩50/5-approval
HIT across a response-loss recovery boundary, proved that failed attempts did not
create chain settlements, and finalized all five legacy direct x402/SVM
transfers. The new bundle gateway integration additionally verified that three
₩10 documents produce one 22,223 atomic-unit 402 requirement and one immutable
bundle hash; the final Phantom signature remains a user-run Devnet check. It also
confirmed projected subscriptions and agent payments remain disabled. Earlier
passes covered Phantom reconnect, signed-out route guards, desktop and 390px
mobile payment previews, and mobile navigation overlap. The contributor-delivery
pass verified the Dashboard alert controls/inbox/recommendation copy, direct
notification deep links, a visible ten-minute slot hold, SPA and hard-navigation
release, and a clean browser console after reload.

## Explicit production boundaries

- `KRW_SANDBOX` is an application ledger, not custody of fiat or tokens.
- Mainnet x402 settlement still needs production recipient funding, KMS-backed
  bundle payout signing, confirmation/reconciliation workers, and gateway hardening.
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
2. **Bundle payout execution.** Approval batching and per-author claim
   accounting are implemented. Funds remain in the configured escrow until a
   separately secured payout worker executes and reconciles those claims.
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
