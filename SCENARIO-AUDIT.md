# Obolus user scenarios

Updated: 2026-08-11

## User types

| User | Primary job | Required state | Server-owned guarantees | UI entry |
| --- | --- | --- | --- | --- |
| Visitor | Search public shelf metadata | None | Cannot read memory, profile, balance, disputes, or another user's chats | Home, chat, coverage |
| Buyer | Buy existing passages or commission missing coverage | Wallet-authenticated account; prepaid Devnet balance or funded call escrow | Exact question budget reserved; one unit released per accepted answer; unused amount refundable; returned answers scoped to owned `chatId` | Chat, “Posted by me”, balance |
| Contributor | Receive and answer matching calls, then build reusable memory | Authenticated account and completed profile | Ranked in-app delivery, optional browser/email alerts, ten-minute slot hold; cannot answer own/full/cancelled call, answer twice, or bypass targeting | Dashboard, answer flow, My memory |
| Memory-agent contributor | Reuse a previously paid answer without fabricating a new experience | Contributor with auto-match and Memory agent explicitly enabled | Exact old answer only; 82%+ question similarity, category/target match, unlocked document, price floor, and conduct limits are server-enforced | Dashboard preferences, My memory |
| Restricted contributor | Continue after one or two quality failures | Same as contributor | 2 strikes remove auto-match and hold new earnings for 14 days; 3 strikes suspend new answers | Dashboard warning, memory ledger |
| Disputant | Challenge one voided answer | One unused dispute | Submission remains pending and unpaid; submitter cannot approve it | My memory |
| Reviewer | Approve or reject a pending dispute | Authenticated `admin` role | Approval restores document, slot, and escrow payment atomically; rejection changes none of them; decision cannot be replayed | `/admin/disputes` |
| Departing user | Remove their account | Authenticated session | Open reservations refunded, sessions revoked, profile/memory/document text deleted, financial rows anonymized | My memory → Delete account |
| Browser-wallet buyer | Inspect and pay for existing passages | Phantom ownership proof and prepaid Devnet USDC balance | Exact query budget is reserved; the KMS-backed agent pays each committed DB independently through Pay.sh; passages stay closed until their individual settlement | Chat payment preview |
| Hosted autonomous buyer agent | Open documents without a wallet popup for every question | Fresh Phantom ownership proof plus a funded, revocable prepaid balance | Rust reserves only the exact committed question budget; the KMS-backed Cloud Run agent pays each selected DB through Pay.sh, and unused partial-failure credit is restored | Chat prepaid payment flow |
| Local CLI buyer agent | Search, commission, contribute, and open evidence from Antigravity or another MCP client | Local OpenShelf session; Pay account only for paid actions | OpenShelf exposes no private key; exact Devnet payment intent is shown before Pay requests local wallet authorization | Antigravity plugin / MCP |
| Buyer before human supply | Get immediate orientation without mistaking AI for experience | A question with zero/thin human coverage | General baseline is zero-price, expiring, non-sellable, excluded from human HIT/authority/Memory; human gaps stay open | Chat → AI general baseline → Ask people |
| Contributor before buyer demand | Build useful supply without a fake buyer or fake bounty | Authenticated contributor profile | Gemini creates prompts only; no buyer/upfront reward is represented; only the quality-checked human answer becomes a priced document | Dashboard → Shelf starters |

## Scenario checks

### Visitor and authentication

- A fresh, one-time Ed25519 challenge proves control of a Solana wallet. The
  signed message is not a token transfer or an allowance.
- Server sessions are random, SHA-256 hashed at rest, expire after 30 days, and
  are delivered in an HttpOnly SameSite cookie.
- Private routes ignore spoofed `userId` query parameters and derive identity
  only from the session.
- Only an explicit `401 Unauthorized` clears authenticated UI state. A network
  outage or server error preserves local session state and exposes a retry path.
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

1. A hit stops at a preview of the exact committed DB set and maximum question
   budget before any prepaid credit is reserved.
2. A fresh Phantom `signMessage` proves wallet possession and creates a
   revocable 30-day service session with no private key or token allowance.
3. Rust reserves the exact question budget atomically. Phantom appears for one
   bounded Devnet USDC refill only when available prepaid credit is too low.
4. The Cloud Run worker uses the KMS service signer and Pay.sh to settle each DB
   independently. Only each successfully paid immutable snapshot is returned.
5. A lost response is recovered from the durable job ledger without paying the
   same DB twice. A permanent partial failure restores the unopened remainder
   to prepaid credit, which the user can withdraw.
6. Paid open calls remain a separate one-approval Devnet escrow flow because
   their beneficiary set does not exist until contributors answer.
7. Helpful/not-helpful/report feedback is accepted only for a document the same
   payer actually settled in that query. Reports enter the admin review queue.

### Wallet and account identity

- The Obolus account, anonymous profile handle, browser-wallet public key, saved
  payout address, verification state, and Devnet network are labelled separately.
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
- A paid reuse is stored as a `reuse` receipt, not a new `observation`. It can
  prove fulfillment and earnings without increasing author reliability,
  triggering reflections, or becoming another auto-match source.

### AI market liquidity

- Human documents are searched first. Human candidate count alone produces
  `ai_liquidity_only`, `hybrid_coverage`, or `human_covered`.
- A human-covered query cannot call the baseline endpoint, including when a low
  buyer budget prevents purchase. AI cannot undercut available human supply.
- A thin query can request a token-scoped Gemini baseline. It contains general
  orientation, neutral decision factors, explicit firsthand gaps, and questions
  for people; it contains no shelf passages and creates no `documents` row.
- Baselines are cached for a bounded lifetime in `ai_baselines`, fixed at ₩0,
  and marked non-sellable/non-covering in the response contract.
- Contributor Shelf starters are explicitly generated interview prompts, not
  open calls. They state `buyerWaiting=false` and `guaranteedRewardKrw=0`.
- Publishing a starter runs the normal human specificity, identifier,
  duplicate, profile, and conduct checks. Only the accepted human answer enters
  `documents`; it starts with zero earned and can earn on future opens.

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
email-outbox creation, strict Memory-agent reuse, AI-baseline isolation and
human-coverage shutoff, AI-interview prompt validation, Shelf-starter human
publication, plus exact bundle creation, query-token rejection, quote
idempotency, one-signature settlement, multi-document recovery, per-document
feedback, and per-beneficiary claim accounting. Frontend verification consists of TypeScript production build,
Oxlint, and end-to-end Chrome walkthroughs of wallet sign-in, onboarding, explicit
payout-address opt-in, profile eligibility refresh, MISS-to-open-call creation,
the four-step private interview, an accepted ₩300 answer and earnings ledger,
and buyer retrieval of that returned answer after a wallet/account switch removed
the original local chat. The latest legacy live Devnet pass completed the ₩50/5-approval
HIT across a response-loss recovery boundary, proved that failed attempts did not
create chain settlements, and finalized all five legacy direct x402/SVM
transfers. The hosted-agent integration verifies exact prepaid reservation,
independent Pay.sh resource validation, lost-response idempotency, and
partial-failure refund accounting. Legacy bundle tests remain for
compatibility, while the default browser path pays every selected DB
independently. Earlier
passes covered Phantom reconnect, signed-out route guards, desktop and 390px
mobile payment previews, and mobile navigation overlap. The contributor-delivery
pass verified the Dashboard alert controls/inbox/recommendation copy, direct
notification deep links, a visible ten-minute slot hold, SPA and hard-navigation
release, and a clean browser console after reload.

## Explicit production boundaries

- `KRW_SANDBOX` is an application ledger, not custody of fiat or tokens.
- Mainnet settlement remains deliberately disabled. The current payment and
  payout workers enforce Solana Devnet USDC, exact quote binding, idempotent
  recovery, and KMS-backed signing.
- Abuse rate limits, observability, backups, an optional production email
  provider, and a separately staffed review operation remain deployment work.
- Chat transcripts are tab-session local; money, identity, authorization, calls,
  answers, and memory are server-owned.

## Remaining product and production work, in priority order

1. **Production policy storage.** Hosted automatic purchases are implemented
   for the hackathon Devnet path with a revocable prepaid session and exact
   per-query reservation. A public-value launch still needs durable multi-node
   policy storage, rate limits, operational revocation tooling, and audited
   KMS/IAM controls.
2. **Payout operations.** Durable per-beneficiary claims, KMS signing,
   broadcast, multi-RPC reconciliation, replay, refund, and recovery are
   implemented for Devnet. Mainnet launch still requires funded production
   wallets, operational monitoring, and audited signer rotation.
3. **Mainnet operations.** Managed RPC/facilitator, KMS-backed secrets, durable
   reconciliation queue, monitoring, alerts, rate limits, backups, abuse
   controls, and incident runbooks are required before real value.
4. **Commercial model.** Obolus is usage-based: discovery is free and each
   opened passage or accepted Open Call answer is a micropayment. There is no
   monthly subscription in the current product. Mainnet custody, compliance,
   tax, and the platform fee policy still need commercial validation.
5. **Quality and moderation operations.** Paid-buyer feedback,
   report intake, admin adjudication, Bayesian reliability updates, and automatic
   locking after repeated upheld reports are implemented end to end. Review SLAs,
   provenance checks, and privacy/redaction operations remain production work.
