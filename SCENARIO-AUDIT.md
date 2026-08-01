# OPENSHELF user scenarios

Updated: 2026-08-01

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
6. Cancellation refunds the remaining reservation; paid answers stay paid.
   Cancelled calls remain visible only to their owner as refunded history.
7. Insufficient balance, overflow, wrong owner, filled calls, and repeated
   cancellation fail without partial writes.

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
Oxlint, and an end-to-end browser walkthrough of registration, onboarding, four-band
targeting, a rejected mismatch, an accepted ₩500 answer returning to the buyer chat,
partial escrow refund, cancelled-call history, account deletion/session revocation,
and an admin rejecting a pending dispute with a required rationale.

## Explicit production boundaries

- `KRW_SANDBOX` is an application ledger, not custody of fiat or tokens.
- Mainnet x402 settlement still needs production recipient funding, a KMS-backed
  signer, confirmation/reconciliation workers, and gateway hardening.
- Social login, email verification/recovery, abuse rate limits, observability,
  backups, and a separately staffed review operation remain deployment work.
- Chat transcripts are browser-local; money, identity, authorization, calls,
  answers, and memory are server-owned.
