# Research payment threat model

## Security boundary

The browser proves wallet ownership once and signs only balance refills with
Phantom. OPENSHELF never receives a user private key, seed phrase, SPL delegate,
or token-account authority. A revocable 30-day capability can spend only the
verified wallet's OPENSHELF prepaid ledger balance.

A local agent has no browser prepaid session. For two or more documents it must
declare `exact-agent-bundle-v1`; the resulting one-shot x402 amount equals the
immutable job budget. The finalized chain payer is bound to the job, no prepaid
account is credited, and an unspent remainder is refunded on chain to that same
payer.

Protected assets are private human passages, the query capability, the service
wallet balance, verified owner recipients, and the original payer's refundable
remainder.

## Enforced invariants

- Search metadata is free; a Pay.sh callback can read only the immutable quoted
  passage into the private collector's buffered response. The public proxy
  releases that body only after attaching a receipt for the exact prepared
  transaction to the durable ledger.
  or an exactly matched x402 settlement.
- A job commits unique handles, content hashes, versions, consent versions,
  recipients, and prices before balance reservation.
- Balance check and reservation are atomic, so concurrent questions cannot
  overspend one wallet.
- Browser-prepaid and agent-direct bundle preparation are explicit, mutually
  exclusive contracts. The query row serializes creation, and an active or
  completed identical purchase on one contract blocks the other. Agent mode
  rejects every top-up, requires deposit = minimum deposit = research budget,
  and repeated preparation recovers the same quote across process restarts.
- Before presenting an agent approval, the local runtime fetches the canonical
  agent-direct quote from Rust over a query-capability path independent of the
  gateway. Every economic field and ordered handle must match; the one-shot
  amount, budget, and minimum deposit must be equal and available prepaid credit
  must be zero. Caller-provided `resourceUrl` is ignored and rebuilt from the
  configured gateway origin plus the canonical resource path, so a compromised
  gateway cannot consistently inflate both responses or redirect approval to a
  different host.
- A refill is credited only after exact on-chain settlement; the job budget is
  the sum of per-DB atomic charges.
- Before Phantom sees a refill request, the browser independently fetches the
  canonical bundle from Rust with both the query capability and prepaid wallet
  session. The gateway copy must match that quote, the original ordered handles,
  and the refill calculated from the browser's requested top-up and the
  immutable minimum deposit captured at quote creation. A concurrent balance
  change is not used to reinterpret an old quote. Only then does it accept an
  x402 requirement matching the
  canonical scheme, network, mint, atomic amount, recipient, bounded timeout,
  and deterministic quote memo. A gateway cannot inflate both bundle creation
  and its later `402`, and a hostile list of alternatives cannot steer wallet
  selection. A bundle already covered by prepaid credit bypasses wallet setup;
  a second tab that sees the first tab's durable `settling` fence recovers it
  without registering another payment policy.
- The gateway will not create or expose a payable research bundle unless the
  research orchestrator reports ready within a finite deadline. This couples
  acceptance of new custodial funding to the worker that must consume and
  recover it; an unavailable or redirecting dependency fails before signing.
  Simultaneous readiness callers share one bounded probe, and failures are
  briefly negative-cached so an outage cannot become a KMS probe storm.
- After signature verification, one durable database record fences the quote before the
  facilitator can settle it. Competing gateway instances cannot start a second
  transfer, and the public quote becomes recovery-only `settling` state. Its
  reconciliation deadline never re-opens payment automatically.
- Managed x402 claims, Pay.sh credential preparations, and payout preparations
  also write a create-only, byte-stable intent outside the database after the
  local commit and before the API returns transport permission. An unavailable
  or conflicting audit object returns `503`; an exact retry recovers the same
  fence. This evidence survives a Cloud SQL rollback but does not itself permit
  resumption: the sweep first installs a global recovery-window hold, then a
  separate hold for every missing or mismatched intent. Readiness and DB
  triggers keep new effects stopped, including writes from a stale revision,
  until external receipts are reconciled and the incident is explicitly
  resolved with an evidence reference.
- The same independent pre-transport record covers externally billed Vertex
  calls. It stores only the artifact kind, scope, canonical input hash, provider
  policy/model fence, and budget window. Prompt text, paid evidence, profiles,
  and generated output are excluded. A failed audit write safely releases the
  provider budget because transport has not begun; any failure after transport
  retains the attempt as potentially charged.
- A query/document purchase is atomically reserved for exactly one payment rail
  when its first resource is prepared. The query row serializes concurrent quote
  creation, a partial unique index permits only one reserved quote per purchase,
  and database triggers reject Pay.sh records on x402 purchases (and vice versa),
  including writes from a rolling old API revision.
- The outer research budget and the standalone document products share that
  same purchase boundary. Every active or completed bundle document is reserved
  to its job; public direct quote creation and pre-charge preparation reject it,
  while research planning carries the exact owning job id. Conversely, an
  independently rail-bound, in-flight, or delivered document blocks creation of
  a new aggregate budget. Quote expiry never changes products within the same
  query; the caller must use a fresh search unless the old aggregate budget has
  reached an explicit released state. Query-row locking makes the check
  serializable on PostgreSQL, and database bundle-document, attempt, and
  settlement triggers stop older revisions that bypass the application check.
- Research and direct Pay.sh attempts claim one database-wide quote fence rather
  than relying on their separate job and quote indexes. The fence is inserted
  before a signed credential can reach the collector, remains through ambiguous
  recovery, and is released only by proven cancellation or terminal settlement.
  Attempt identity is immutable. Callbacks require the matching fence, and
  startup/readiness fail closed on an orphan, a missing reverse edge, an invalid
  quote state, or a pre-existing bundle/direct purchase collision.
- Account deletion locks the same document, bundle, and open-call quote rows as
  payment preparation. If an exact external-payment fence already exists,
  deletion fails closed until settlement or proven cancellation. If deletion
  wins first, every unused quote is tombstoned before its document disappears,
  so a copied x402 or Pay.sh URL is rejected before collection. Completed chain
  receipts remain for accounting, but operational passage snapshots, handles,
  bundle copies, feedback, and funded-call request bodies are scrubbed and are
  no longer available through recovery endpoints.
- Buyer deletion and prepaid spending also share the active user-row lock.
  Every prepaid-session read requires that still-live user and keeps the lock
  through bundle creation; deletion locks all of that wallet's bundle quotes
  and prepaid account rows. An unfenced `quoted` bundle becomes `deleted`,
  while a funded or ambiguous job blocks deletion. Thus a session and payment
  URL copied just before deletion cannot later accept funds into an ownerless
  prepaid account.
- Prepaid wallet ownership follows the most recent live prepaid session, not an
  ambiguous `COALESCE` between login and payout wallets. Only one wallet may
  carry live prepaid value or research work for a user: switching wallets is
  rejected while the old wallet has balance or an in-flight job, and its
  unfenced quotes are tombstoned when switching is safe. A pending withdrawal
  remains bound to the old recipient snapshot. Account deletion enumerates
  every historical prepaid-session wallet so an older secondary wallet cannot
  leave value or a payable URL behind.
- A canonical `prepaid_wallet_owners` row prevents one Solana wallet from
  backing custodial ledgers for two application accounts, even if the same
  controller attaches that wallet as another profile's payout address.
  Migration fails on historical multi-owner sessions or ownerless positive
  balances, session validation joins the canonical owner, and deletion ignores
  a profile wallet canonically owned by somebody else.
- Every Vertex call first consumes a durable, scope-bounded generation budget
  and claims the hash of the server-owned canonical input. Concurrent API
  instances cannot both contact the provider for the same input. If the process
  disappears after the provider accepts the request, the ambiguous `started`
  row remains fenced for that exact input even across the daily-window boundary
  or clock skew, and paid synthesis returns the already-opened evidence as a
  clearly labelled fallback. The separate daily budget caps novel input hashes.
  Completed synthesis is persisted before delivery and replayed without
  provider spend. A fallback never records zero-score contributions, so a
  provider outage cannot lower a human seller's reliability. Vertex response
  bytes and accepted output fields are bounded before database persistence.
  Each synthesis fence maps its source handles to their authors while holding
  the same ordered document locks as account deletion. A recent in-flight call
  blocks deletion; after the bounded HTTP lifetime, deletion removes the
  attempt, all source mappings, and any derived response before deleting the
  document. Completion from a late stale worker then fails against the missing
  fence rather than recreating deleted content.
- Only version 2 Pay.sh document paths are metered by the checked-in proxy
  configuration. Version 1 callbacks return `410 Gone` by default, so a URL
  issued before rail binding cannot be charged after the v1 meter is retired.
- The browser's verified SVM transaction is only partially signed: the
  facilitator-controlled fee-payer signature is absent. A protected handler
  failure can therefore release its pre-settlement fence, while a settlement
  timeout keeps the fence because its chain outcome is ambiguous.
- Settlement reconciliation uses the exact pre-settlement quote even if its TTL
  passes while the facilitator is working. One transaction signature can enter
  only one direct, bundle, or open-call ledger. Database triggers enforce the
  global registry even for a rolling old API writer. The signed transfer carries
  a deterministic quote memo, and a callback cannot clear a different active
  payment-attempt id.
- Due payment attempts are selected from the durable fence independently of a
  mutable quote status. New attempts persist the exact payer-signed transaction,
  payer, and recent blockhash before settlement. Recovery accepts only the same
  finalized bytes with the facilitator's formerly empty fee-payer signature
  filled, and every configured independent RPC origin must report the same
  signature. An unavailable, contradictory, or body-omitting provider keeps the
  fence. Legacy attempts without exact evidence may be positively recovered by
  memo, mint, recipient ATA, amount, payer, and reconstructed attempt hash, but
  are never automatically released.
- An x402 attempt can be released only when at least two independent RPC origins
  completely scan its exact payer history, find either no transaction or the
  exact finalized failed transaction, and all report the recent blockhash
  invalid. Rust persists the first unanimous observation and requires a second
  pass at least five minutes later. A single empty view, timeout, page limit, or
  malformed extra missing-signature slot can never authorize another payment.
- Outer settlement only funds a job; it never records owner earnings.
- Each Pay.sh callback must match its job, query, handle, quote, price, owner,
  network, asset, exchange rate, and internal service token.
- Before the orchestrator invokes a paid Pay.sh request, it durably binds one
  random attempt id and exact quote to the job and removes the job from the
  runnable queue. The callback must present that exact pair but performs no
  settlement, earning, access-event, or attempt-state mutation. The public proxy
  validates the final fee-payer receipt against the prepared bytes and only then
  commits delivery plus fence release atomically. A process death at either
  boundary therefore leaves the job fenced instead of allowing another worker
  to charge the quote again.
- PayKit's MPP Authorization request is intercepted before transport. The exact
  challenge id, external id, recent blockhash, KMS payer address, and
  platform recipient snapshot and payer-signed transaction are committed to the durable attempt before the
  request may leave the process.
- Recovery uses that immutable recipient snapshot instead of the current
  operator-wallet environment. A wallet rotation cannot reinterpret an
  in-flight transfer; a legacy attempt without the snapshot remains fenced for
  manual review.
  Fully signed transactions are recovered by their exact transaction id;
  fee-payer-partial transactions require a byte-identical finalized transaction
  with changes only in previously zero signature slots.
- The official Pay.sh collector is not an agent-facing origin. Its nginx front
  requires a separate proxy-only secret before the request reaches the payment
  verifier. The public gateway strips caller-supplied internal/front/attempt
  headers, validates the real MPP challenge and signed Solana envelope, and
  atomically inserts one active `direct_pay_sh_attempts` row before forwarding.
  The same transaction verifies the query capability against its server-side
  expiry. A stale URL, invalid query capability, or competing signed transaction
  therefore fails before external collection.
- The signed envelope is decoded independently of the challenge. It must have
  the expected unsigned service fee-payer slot and authentic buyer signature,
  then pay the exact USDC source/destination ATAs and platform/owner amounts
  with `TransferChecked`, carry the exact resource memo, and contain no program
  outside the pinned payment template. Thus a genuine signed USDC transaction
  redirected to an attacker cannot be planted as later recovery evidence even
  when its challenge fields claim the correct quote.
- Immediately before durable direct-attempt preparation, the public proxy asks
  the Pay.sh-network RPC for the exact quote mint/owner associated token account
  and requires that account to belong to the SPL Token Program. A fresh owner
  wallet without USDC support, a wrong-network RPC, or an unavailable RPC fails
  before collection. This check has its own `PAY_SH_RPC_URL` because the official
  sandbox and the co-hosted x402 facilitator intentionally use different networks.
- Direct and research Pay.sh callbacks require the official gate's internal
  token and their proxy-injected attempt identity. A callback cannot invent the
  final fee-payer receipt and leaves the durable attempt and economic ledger
  unchanged. Receipt attachment or exact finalized-chain recovery completes the
  delivery, earning, access event, and global transaction registry entry in one
  transaction.
  Receipt attachment decodes the standard `Payment-Receipt`, requires a Solana
  success and rejects a mismatched optional external id. Its transaction
  signature must cryptographically verify against the exact durable message and
  fee-payer key, every already-present payer signature is reverified, and every
  configured independent Pay.sh RPC must reproduce the resulting byte-identical
  transaction as `finalized` before the receipt can reach Rust settlement.
- The scheduled official-sandbox E2E kills the public gateway at both sides of
  the external side effect. Death after durable prepare must leave one prepared
  attempt, no settlement, and reject a newly signed retry after restart. Death
  after collection and callback but before receipt handling must also leave one
  prepared attempt and no settlement or content-access event; a newly signed
  retry is rejected while the original exact transaction remains available to
  finalized-chain recovery. These are real process deaths and official
  collector calls, not thrown exceptions around a mocked transport.
- Rolling old research workers are rejected before polling or planning through
  an explicit durable-MPP protocol header. Sharing the internal token is not
  enough to receive a paid resource from the new API revision.
- Rolling old x402 gateways are likewise rejected from claim, cancellation,
  and reconciliation control endpoints unless they present `exact-chain-v1`.
  Settlement recording remains backward compatible so an already-landed
  transfer can finish during cutover, but an old failure handler cannot clear
  a new ambiguous fence merely because it still knows the internal token.
- A single empty RPC view never releases a prepared Pay.sh attempt. Each absence
  pass requires complete agreement from at least two distinct RPC origins.
  Positive recovery also requires every configured origin to return the same
  exact finalized transaction, and the worker locally verifies every Ed25519
  signature over its immutable message before crediting it. The challenge's
  claimed blockhash must equal the signed transaction lifetime token before
  collection, and the scanner rechecks that durable equality before absence can
  be considered. The first
  unanimous finalized absence plus invalid blockhash is persisted, and Rust
  requires a later pass after a safety interval before accepting release. RPC
  errors, unavailable transaction bodies, page exhaustion, and non-finalized
  statuses only defer reconciliation.
- RPC transaction metadata must explicitly contain execution status. `meta: null`,
  a missing `err` field, a malformed signature-history entry, or a
  disagreement between history and transaction metadata is inconclusive and
  cannot create a settlement. Recovery also re-decodes the durable transaction
  and repeats the signature, ATA, amount, recipient, and memo checks before any
  RPC result can be credited.
- After a paid request starts, an unproven transport or upstream result moves
  the existing fence from `payment_in_progress` to `payment_reconciliation` and
  keeps its budget reserved; it is neither repaid nor refunded automatically.
- Status exposes citations only for the exact job-linked quote marked delivered.
- Paid synthesis reads the immutable direct or bundle snapshot committed before
  funding, never the seller's current document row. A legacy aggregate
  `delivered` flag grants no entitlement without its matching chain receipt, so
  a stale writer or corrupt status update cannot expose private content. If a
  seller locks or corrects a document after payment, recovery still returns the
  purchased version.
- Completed and balance-refunded jobs are idempotently recovered, not re-quoted.
- Partial browser failure restores only undelivered document amounts to prepaid
  credit. Partial agent-direct failure creates an exact on-chain refund claim
  to the finalized outer payer and never creates prepaid credit.
- A confirmed agent-direct refund and its parent job complete in one database
  transaction. The claim becomes `confirmed` exactly as the job becomes
  `balance_refunded`; a restart backfills that exact confirmed legacy/torn state,
  while readiness fails if claim identity, recipient parent reference, or job
  status disagree.
- Refunds use durable prepared transactions and signature replay protection.
  Completion requires every configured independent RPC origin to report the
  exact signature finalized. A `confirmed` fork is inconclusive. Expiry/failure
  releases the prepared bytes only after two unanimous finalized observations
  separated by the server-side hold interval.
- Payout liability remains bound to the escrow wallet that originally funded
  it. The orchestrator queries the wallet/network backlog during reconciliation
  and readiness; a replacement KMS signer returns `503` until the old signer has
  drained every unconfirmed row. Malformed counts and exhausted claims also fail
  readiness closed.
- Failures before a transaction can be prepared also consume the bounded payout
  attempt budget. After ten persistent KMS/mint/funding failures the row leaves
  the hot lease loop and becomes a blocked readiness liability instead of
  retrying forever while the service advertises healthy.
- Before KMS acts, the worker revalidates the row's exact signer, Devnet network,
  USDC mint, canonical positive amount, status, memo-safe claim id, and all-or-
  none prepared evidence. Every payout carries `openshelf:payout:<claim-id>`.
  A torn prepared row is not leased for re-signing and remains a blocked
  readiness liability because its missing bytes do not prove that it never left
  the original process.
- Every RPC/control-plane/challenge call has a finite abort deadline. A provider
  that accepts a connection and never sends a response is inconclusive evidence,
  not an indefinitely held lease or a reason to release a payment fence.
- Managed deployment parsing is fail-closed across Rust and Node. Staging gets
  the same secret, PostgreSQL, RPC-origin, and browser-origin guards as
  production; unknown environment names, malformed booleans, out-of-range
  intervals, and timer-overflow integers stop startup. The production API image
  has no SQLite fallback. A PostgreSQL session killed between operations is
  re-established before the next operation, never halfway through a transaction.
- Query ids that parent payment capabilities contain 128 bits of operating-
  system entropy and have no process-local timestamp/counter collision domain.
  Rust refuses an implausibly old startup clock and clamps later in-process
  rollback to its highest prior observation, so expiration and lease checks do
  not move backward. A rolling writer that predates the immutable bundle-deficit
  column is treated conservatively from its already durable deposit amount.

## Residual risks

- A database point-in-time restore can remove the only durable attempt or
  payout fence while its external Pay.sh or chain transfer remains final. It
  can likewise erase a model-generation fence after the provider has billed
  the call, so model traffic must remain stopped during the same rollback audit.
  Readiness validates rows that exist; it cannot infer a missing row from an
  irreversible side effect that happened after the restored snapshot. Traffic
  must remain stopped after any restore until the exact rollback interval is
  reconciled against an independent receipt/chain history. A create-only audit,
  restored-ledger sweep, and durable recovery hold now fail closed around that
  work, but external Solana/Pay.sh/payout/provider receipt comparison and a real
  retained-GCS/PostgreSQL restore drill are not automated or proven. PITR is
  therefore still not an approved payment recovery path.
- The service wallet and prepaid ledger are custodial. Keep KMS IAM scope small,
  reconcile chain balance against the ledger, and separate production projects.
- A stolen web session can spend its prepaid balance, but cannot access Phantom
  or other wallet funds. CSP/XSS controls and session revocation remain required.
- The exact durable Pay.sh attempt fence serializes paid calls across
  orchestrator instances. Refund polling uses durable payout claim leases; key
  rotation additionally requires an explicit old-wallet drain because a new key
  cannot move funds owned by the old address.
- A Pay.sh/facilitator or RPC outage delays completion/refund; it does not grant
  content access.
- A Pay.sh recipient-ATA preflight RPC outage also rejects the paid retry before
  durable prepare or collection. Availability therefore depends on a managed
  RPC with monitored capacity, while safety does not depend on optimistic reads.
  The public preflight makes one bounded request and never amplifies a provider
  stall or throttle through same-origin retries.
- Pay.sh ambiguous-payment holds now have exact finalized-chain recovery. A
  prolonged RPC outage, missing transaction body, or an exceptionally busy
  partial-signature payer can still delay completion, but cannot authorize a
  new payment. Recovery does not compare validator `blockTime` with application
  wall-clock time; exact signed bytes and bounded pagination remain authoritative
  when either clock jumps or lags.
- Pay.sh still charges before the Rust callback, so bypass resistance depends on
  keeping the independent front token out of clients and exposing only the
  authorization proxy origin. Secret rotation must deploy the proxy and Pay
  front as one coordinated cutover; a revision mismatch fails closed with no
  charge but makes direct payments temporarily unavailable.
- Devnet assets have no production value or finality guarantees.
- Query answers can still be inaccurate; payment proves provenance/access, not truth.
