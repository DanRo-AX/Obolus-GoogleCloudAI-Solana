# OPENSHELF consolidation and production review

Reviewed: 2026-08-08

Scope: PR #2 at `e94ff00`, draft PR #9 at `1655b46`, and the follow-up
consolidation changes on `agent/rust-x402-backend`.

## Merge graph verdict

PR #2 and PR #9 are sibling branches. They share `15462fd` as their merge base;
neither head contains the other. A green PR #2 therefore did not, by ancestry
alone, prove that PR #9 was included.

The implementations overlap heavily. PR #2 contains the PR #9 concepts in a
newer form and also adds query-scoped payment recovery, payout-wallet ownership
proof, buyer feedback, admin feedback review, partial-payment recovery, and the
final browser x402 fixes. Cherry-picking PR #9 wholesale would reintroduce older
versions of the same Rust, TypeScript, schema, and gateway code.

The safe consolidation strategy is to keep PR #2 as the merge candidate and
port only useful PR #9-only contracts and documentation.

| PR #9 area | PR #2 disposition |
| --- | --- |
| Versioned memory, correction, locking, reflection, access log | Present and extended |
| Topic-personalized PageRank and evidence provenance | Present in `authority.rs` and `search.rs` |
| Paid-evidence Gemini on Vertex AI orchestration | Present; now guarded by the query capability |
| Dynamic x402 quote and settlement mirror | Present and extended with recovery and stable SVM requirements |
| Persona public manifest URLs | Preserved as compatibility aliases; contributor URLs remain canonical |
| Devnet smoke path and Pay.sh note | Present in newer form |
| Old function-level review | Replaced by this review because several old PASS claims no longer matched the current tree |

## Fixed in the consolidation pass

- Managed x402, Pay.sh, and payout prepare endpoints now create a byte-stable
  GCS intent before returning external-transport permission. Exact retries
  recover after a DB-commit/audit outage; changed credentials conflict. Launch
  includes a rollback-horizon sweep that fails on missing or changed
  PostgreSQL evidence. The sweep first installs a global recovery hold and then
  object-specific holds; readiness and DB triggers stop new external effects
  while existing recovery remains live. Launch remains blocked until the
  governed retained bucket, external-receipt reconciliation, and isolated
  restore drill exist and pass.
- Payout audit v2 binds the signature derived from exact fully signed bytes.
  Pay.sh v2 binds its partial credential, challenge, and external ID. x402 v3
  binds the actual pre-facilitator payload with a zero fee-payer signature and
  present buyer signatures, then snapshots that same payload into settlement
  history before clearing the attempt. Separate create-only prefixes avoid
  rolling collisions; the sweep reads all prior versions conservatively and
  refuses to let same-quote economics hide different prepared bytes.
- Externally billed Vertex calls share the rollback-audit boundary without
  exporting prompts or paid evidence. A pre-transport audit outage releases the
  unused model budget, while the operator sweep flags a provider fence erased
  by PITR just like a missing payment attempt.
- Paid synthesis now requires the secret query payment token. Previously a
  query ID plus settled handles could trigger model spend and reload paid
  evidence without that capability.
- Replaying synthesis no longer compounds the same model contribution into a
  document's reliability score.
- Model-provider spend now has a PostgreSQL/SQLite durable fence. Baselines and
  shelf starters permit one novel provider input per scope/day, while paid
  synthesis permits at most three distinct canonical evidence inputs per
  query/day. An exact input is claimed only once even across a UTC budget-window
  boundary or clock skew; the hash includes the prompt-policy version and
  configured model so an intentional model/policy migration does not inherit an
  unrelated old failure. A process death after the provider accepts a request
  leaves that input fenced; retries receive the evidence-only fallback instead
  of buying the same generation again. A
  successful synthesis response is stored before it is returned and reused
  across API instances. Provider failure/fallback no longer writes zero-score
  contributions or lowers a seller's reliability, and both provider HTTP bodies
  and parsed synthesis fields are bounded before persistence. Synthesis fences
  also record every source document and author under the same document-row lock
  used by account deletion: deletion waits for a bounded active provider call,
  then removes completed/failed derived responses and mappings before removing
  the source. A late pre-deletion worker cannot recreate that cache afterward.
- Server-backed paid chats and query tokens moved from durable `localStorage`
  to tab-session storage; older durable copies are removed.
- Backend mode no longer substitutes fake seeded calls or memories when a
  server request fails.
- Private responses default to `Cache-Control: no-store`; public manifests
  opt into a short explicit cache lifetime.
- Production refuses demo-open bypass, demo database seeding, insecure session
  cookies, an existing demo-seeded database, short/default internal tokens,
  insecure frontend origins, and the public Devnet RPC fallback.
- A non-loopback Rust bind requires a strong internal token. The default bind
  is loopback.
- The gateway and backend now derive production mode and shared network/origin
  defaults consistently.
- The restricted browser RPC proxy has a per-process rate-limit safety net and
  rejects non-configured browser origins in production.
- A user's real demo receiver address was removed from the regression fixture.
- Multi-document HITs now commit an exact bundle and require one x402 wallet
  approval. Rust records one immutable chain receipt plus one claimable earning
  per document/beneficiary; progress, response-loss recovery, synthesis, and
  buyer feedback accept both direct and bundle entitlements.
- Paid open calls now commit and settle one exact Devnet budget before becoming
  visible. Answer shares and unused refunds allocate every atomic unit exactly.
- Escrow claims now have a crash-safe Devnet payout worker: lease, persist signed
  bytes before broadcast, resume/replay, require two independent finalized RPC
  views, and expose the signature. A first unanimous expired-blockhash view only
  records durable absence; a later pass may release the exact transaction.
- Query recovery capabilities expire after 24 hours. The deferred email-auth
  implementation keeps one-hour, single-use, enumeration-safe reset tokens that
  revoke every session, but those routes are not mounted in wallet-only mode.
- Paid synthesis now uses the immutable bundle/document snapshot rather than
  the mutable live document. A seller lock or correction immediately after
  settlement cannot strand a paid answer, and a legacy bundle status flag is
  not accepted as payment evidence unless its chain receipt exists. The
  regression test mutates the live passage after a real recorded bundle
  settlement and separately proves a forged `delivered` update unlocks
  nothing and makes readiness fail.
- Closed the buyer-deletion/prepaid-session race. Account deletion and every
  prepaid session/bundle operation now serialize on the active user row;
  deletion locks the wallet's quote and account rows, blocks ambiguous or
  funded work, and tombstones unfenced quotes before returning. The PostgreSQL
  contract holds the deletion lock in one real session while another tries to
  spend a copied capability, then proves the request waits and fails after the
  deletion boundary instead of leaving a payable ownerless bundle.
- Closed prepaid ownership drift between a wallet-login identity and a separate
  verified payout wallet. The active prepaid session is now canonical; wallet
  rotation is blocked while the old wallet holds value or an in-flight job,
  requires a durable withdrawal reservation first, tombstones old unfenced
  quotes, and revokes all prior spending sessions. The regression exercises a
  real bundle funding, prepaid refund, withdrawal, stale quote, and signed
  Ed25519 wallet rotation end to end rather than mutating a balance flag.
- Added one canonical prepaid-wallet owner across login identities, payout
  profiles, historical sessions, balances, and bundle work. Previously the
  same signed wallet could be attached to two accounts and both could address
  the same wallet-keyed custodial balance; deleting either account could then
  act on the other's funds. Startup/readiness now reject multi-owner history or
  ownerless positive value, and the regression proves a secondary profile can
  neither spend/read nor delete the first account's prepaid state.
- Local SQLite files are forced to mode 0600; deployed state uses a
  Seoul-region Cloud SQL PostgreSQL instance with backups and point-in-time
  recovery. API responses carry restrictive security headers, and
  administrators can audit AI liquidity without granting AI output any
  priced-document or authority path.
- The backend runtime image now declares `OPENSHELF_ENV=production` itself.
  A forgotten deployment variable can no longer silently enable insecure
  cookies, demo paid-content opening, or demo-database seeding in Cloud Run;
  local containers must opt into development explicitly.

## Payment recovery hardening loop — 2026-08-07

The executable gate for this loop was: one quote may move funds at most once,
and every retry after verification must recover or wait without constructing a
new transfer. The canonical invariants now live in
[`agent-payment-threat-model.md`](agent-payment-threat-model.md).

- Replaced post-settlement quote re-fetching with the exact quote captured
  before settlement. Quote expiry now gates initiation, not durable recording
  after the facilitator has already moved funds.
- Added a durable database-backed payment-attempt fence with a one-minute
  finalized-chain reconciliation deadline. A competing claim
  for the same direct, bundle, or open-call quote returns `409` before the
  facilitator can settle; quote reads expose `settling` and recovery paths wait
  instead of opening Phantom again. Timeout alone never removes the fence;
  only a verified pre-settlement cancellation or recorded settlement does.
- Added one transaction-signature registry across all three settlement ledgers.
  Startup now fails loudly if historical ledgers already reuse a signature,
  rather than hiding the collision during backfill. Database triggers also
  register and reject writes from a rolling old API revision, closing the gap
  between backfill and traffic promotion.
- Bound each signed SVM transfer to a deterministic quote memo and carried the
  payment-attempt id through Cloud Tasks and Rust recording. A late callback
  cannot erase a newer fence, and missing process memory can reload the durable
  attempt before constructing the receipt.
- Added a finalized-chain recovery worker for callbacks lost before either
  durable handoff. It scans the quote recipient's Token and Token-2022 ATAs and
  records a settlement only after memo, mint, destination, amount, payer, and
  reconstructed pre-settlement transaction hash all match the durable attempt.
  A memo collision alone cannot recover or credit a quote. Empty or failed
  scans retain the fence and defer the next durable attempt by five minutes.
- New x402 attempts now persist the exact payer-signed bytes and blockhash before
  facilitator settlement. Managed startup requires a second-provider RPC origin;
  callback-loss recovery needs unanimous byte-identical finalized evidence, and
  automatic release needs two unanimous invalid-blockhash/absence passes at
  least five minutes apart. Provider split-brain, missing bodies, page exhaustion,
  and an unexpected extra missing signer all remain fenced.
- Closed the direct-document Pay.sh/x402 split-brain path. The first resource
  preparation now reserves the query/document purchase for one rail under a
  database row lock; a partial unique index prevents legacy duplicate quote
  rows from reserving the same purchase, and SQLite/PostgreSQL triggers reject
  opposite-rail attempt and settlement writes from rolling old revisions.
  Reconciliation now enumerates every durable attempt even if a stale writer
  changed the quote status, so that mutable status cannot hide a landed transfer.
- Closed the higher-level document-versus-bundle split-brain path. An active or
  completed aggregate job now reserves every included query/document purchase;
  a direct Pay.sh or x402 quote cannot be prepared against it, and an already
  rail-bound or delivered direct quote prevents creation of a second outer
  budget. Expiry does not switch products inside the same query; an abandoned
  quote requires a fresh search or an explicit terminal refund/delete state.
  A bundle-document insert trigger also rejects overlapping outer budgets from
  rolling writers. Research planning is the sole explicit owner exception.
  Direct and research Pay.sh attempts claim one shared `pay_sh_quote_fences` row, so
  their formerly separate partial indexes cannot authorize two external MPP
  credentials for one quote. SQLite/PostgreSQL triggers protect rolling old
  writers, while migration and readiness reject missing, orphaned, mutated, or
  historically overlapping fences instead of silently serving traffic.
- Versioned the charged Pay.sh document surface to v2 and removed v1 metering
  from both checked-in proxy configurations. The backend retires v1 callbacks
  with `410 Gone` by default; a temporary explicit cutover flag exists only for
  the staged interval before the v1 meter is removed.
- Added a durable Pay.sh fence before every paid call. It binds a random attempt
  id to the exact job/quote, removes the job from the runnable queue before
  PayKit can move funds, and clears only in the same transaction that records
  delivery. An ambiguous result keeps that fence as `payment_reconciliation`
  instead of risking a second MPP charge or refunding funds that may have moved.
- Closed the remaining process-death window inside PayKit itself. The worker now
  intercepts the real MPP Authorization credential, persists its exact challenge
  and signed Solana transaction, and only then permits the paid HTTP request to
  leave. A real PayKit/Ed25519 integration test exercises this transport boundary.
- Added independent Pay.sh finalized-chain recovery. Fully signed KMS
  transactions are queried by their exact transaction id; partial fee-payer
  signatures fall back to byte-identical address-history matching. Automatic
  release requires two distinct RPC origins to complete their scans and agree
  that the blockhash is invalid, followed by a second later unanimous pass. A
  single lagging provider can no longer turn an omitted transaction into a
  second charge. Positive recovery now also requires unanimous provider
  agreement on one signature plus local Ed25519 verification of every signer;
  a single provider cannot fabricate finality or fill a zero signature slot.
  The pre-charge proxy and recovery worker also derive the lifetime blockhash
  from the signed transaction itself, preventing a mismatched challenge field
  from expiring early and authorizing release of a still-live transaction.
- Pay.sh receipt attachment no longer accepts a base58-shaped reference alone.
  The fee-payer receipt signature and every persisted payer signature must
  verify over the exact durable transaction message before Rust records it.
- Fixed a liveness defect found by running the full payment scenario rather
  than trusting its assertions: the durable absence update retained the Store
  connection mutex and then tried to load through the same mutex. The suite
  hung indefinitely. The guard is now released before reload, and the same
  end-to-end test finishes deterministically.
- Replaced a false partial-signature recovery fixture with the actual payer
  contract. The backend had exposed the bundle deposit receiver as the address
  to scan, while the on-chain Pay.sh transaction is signed by the KMS payer.
  Preparation now persists that exact payer through the transport fence and the
  integration test proves it differs from the deposit receiver. Without this,
  a future two-signature PayKit transaction could land under the KMS address,
  be missed at the unrelated receiver, and eventually be paid again.
- Added a rolling-deployment protocol fence. Job polling, plan issuance, and
  payment claims now require `durable-mpp-v2`; an old worker sharing the same
  internal token receives `426` before it can obtain a v2 paid URL. This closes
  the otherwise catastrophic overlap where a new API rejects an old worker's
  post-charge callback because that worker never persisted the MPP credential.
- Added the corresponding `exact-chain-v1` control-plane fence for x402.
  Old gateway revisions may still record an already-landed settlement during
  cutover, but cannot claim, cancel, list, defer, or release exact-evidence
  attempts with obsolete timeout semantics.
- Added an `exact-payout-v1` control-plane fence and an escrow-signer backlog
  readiness contract. A new KMS revision returns `503` while any unconfirmed
  payout still belongs to the old wallet/network or has exhausted its work
  state. This makes silent key-rotation orphaning visible and forces the old
  signer to drain before traffic promotion. The production KMS worker and local
  keypair worker both require two distinct RPC origins and finalized, rather
  than merely `confirmed`, agreement for payout completion; release requires a
  second durable absence pass. Pre-signing failures now consume the same bounded
  work budget, so a permanently broken KMS/mint/funding condition becomes an
  explicit blocked-readiness liability instead of an infinite hot retry loop.
  The KMS worker also rejects a mismatched escrow signer, network, mint,
  non-canonical amount, unsafe memo id, or partial prepared evidence before any
  RPC or signing operation, and includes the claim id in an on-chain memo.
  Torn prepared rows are excluded from leasing and counted as blocked rather
  than being "repaired" with a potentially second transaction. The PostgreSQL
  contract injects that exact torn-write state and proves the production query
  remains fail-closed.
- Bounded every recovery RPC call, backend control-plane call, challenge probe,
  private Pay.sh request, and service health probe with an abort deadline. Tests
  use a transport that accepts a request but never closes its socket and prove
  payout recovery returns `inconclusive` in finite time; a hung provider can no
  longer monopolize the singleton reconciliation promise forever.
- Added a PostgreSQL concurrency contract to CI. Two independent production-
  engine connections are released through a barrier to claim the same document
  quote at once; the test requires exactly one winner and a fail-closed loser.
  The same test then races two different real MPP transaction envelopes through
  the direct Pay.sh attempt ledger and again requires one external-charge owner.
  It now also races direct Pay.sh URL issuance against aggregate bundle creation
  for the same purchase, then sends raw rolling-version direct and research
  attempt inserts from separate sessions to the shared quote fence. Exactly one
  buyer product and the bundle-owned research attempt may survive. This covers
  the multi-instance races that the in-memory SQLite mutex cannot simulate. CI
  also has explicit job timeouts so a future database deadlock is reported
  instead of consuming the default six-hour Actions window.
- Re-synchronized the local install to the lockfile before the final build; it
  had silently been testing React Router 7.11.0 while CI would install 7.18.2.
  Production dependency audits are otherwise clean. npm currently flags
  [`GHSA-qwww-vcr4-c8h2`](https://github.com/remix-run/react-router/security/advisories/GHSA-qwww-vcr4-c8h2)
  against 7.18.2, but the upstream advisory says the 7.x
  patch is 7.18.2 and applicability is limited to unstable RSC APIs; this Vite
  application uses only `BrowserRouter` SPA mode. Do not force-downgrade to the
  audit tool's suggested 7.11.0. Recheck the advisory database when a newer
  registry release is available.
- Verified the real internal HTTP surface: first claim `200`, competing claim
  `409`, quote state `settling`, and exact-attempt release succeeds. The full
  frontend, agent adapter, gateway, orchestrator, Rust test, contract, and
  Clippy suite also passes.
- Verified the wire assumptions against the installed x402 SVM client and live
  Devnet RPC: the client payload has two signature slots, the facilitator slot
  is zero while the payer slot is signed, finalized base64 re-hashing succeeds,
  and indexed memo responses normalize from `[length] openshelf:...` to the
  exact signed memo.
- Added the missing public direct-payment boundary. Agents now address the x402
  gateway, which passes through free requests and 402 challenges but durably
  commits the exact signed MPP transaction before the official Pay.sh transport.
  The Pay container has a pre-gate nginx front-token check, Rust callbacks
  require the proxy-injected attempt id, and caller-supplied internal/front/
  attempt headers are stripped. Tests cover an expired copied URL, two different
  credentials racing one quote, process death immediately after prepare,
  byte-identical resume, missing receipt, and callback-loss chain recovery.
- Exercised the real pinned Pay sandbox as a three-process system instead of
  trusting hand-built MPP fixtures. That run found and fixed three false local
  contracts: sandbox Pay uses `localnet` while the co-hosted x402 facilitator
  cannot, MPP `currency` is the actual mint address rather than the string
  `USDC`, and the chain signature arrives in the standard encoded
  `Payment-Receipt` header rather than a guessed receipt URL. A scheduled E2E
  now performs an actual sandbox charge, callback delivery, receipt attachment,
  and free recovery, then asserts one settlement and one access event in SQLite.
- Added real process-death E2Es at both sides of external collection. One
  `SIGKILL`s the public gateway after durable prepare and proves a restart plus
  a newly signed retry cannot reach a second charge. The other `SIGKILL`s it
  after Pay collection, callback, and exact receipt validation but before
  finality/ledger commit. After restart it proves a newly signed retry remains
  blocked, discovers the byte-identical finalized transaction, and converges on
  exactly one settlement and access event. Both use the pinned official Pay
  sandbox, not a mocked collector.
- Closed a recovery-authentication gap that byte identity alone could not solve.
  A public caller could previously present a challenge that described the quote
  while its validly signed transaction moved different funds, let the official
  gate reject it, broadcast those bytes independently, and have the exact-byte
  scanner mistake that unrelated success for payment. The proxy and both Pay.sh
  and x402 recovery paths now independently verify signer slots and Ed25519
  signatures, exact USDC source/destination ATAs, amounts, recipients, memo, and
  the pinned instruction-program set. Tests use authentic versioned/legacy
  transactions whose owner transfer is redirected to an attacker and prove no
  durable prepare, upstream call, RPC scan, or settlement occurs.
- Hardened RPC response interpretation. A fully signed transaction with
  `meta: null`, a signature-history row without `err`, or disagreement between
  history and transaction status is now inconclusive. Legacy x402 recovery also
  requires all configured independent providers to return the same signature
  instead of consulting one primary RPC.
- Removed an Authorization parser-differential bypass. Any Authorization header
  on a paid Pay.sh route must decode and pass the complete MPP validation; an
  unrecognized or malformed scheme is never forwarded to the private collector.
- Added a real missing-recipient-ATA inverse E2E. The official collector cannot
  transfer to a new owner wallet whose USDC associated token account is absent.
  The public proxy now queries the exact owner/mint ATA through a separate
  `PAY_SH_RPC_URL` and requires an SPL Token Program account before durable
  prepare or collection. The test proves zero attempts, settlements, and access
  events. This unauthenticated preflight makes one size- and time-bounded RPC
  call with no hidden retry, so throttling or a hung provider fails closed before
  funds can move without multiplying public-request work.
- Removed application/validator wall-clock ordering from both exact and legacy
  chain scans. A real hosted sandbox exposed validator `blockTime` roughly one
  hour behind the application clock even though the exact transfer was
  finalized. Recovery now trusts exact signed bytes and bounded pagination, not
  advisory wall-clock data. Regression tests make both scanners recover that
  deliberately skewed transaction; the prior code fails those tests.
- Replaced the direct receipt guess with strict MPP receipt decoding. A receipt
  must be a successful Solana receipt, its optional external id must match the
  prepared credential, its fee-payer signature must cryptographically verify
  over the exact durable message, and every payer signature is reverified.
  Missing, forged, malformed, or cross-resource receipts stay in recovery
  instead of attaching an unrelated chain transaction.
- Removed a receipt-ordering asymmetry between direct and funded-research
  Pay.sh. The private callback now only reads the immutable quote snapshot into
  a response buffered by the public proxy. It cannot mark a quote delivered,
  credit an earning, create an access event, or settle an attempt. The proxy
  applies the same cryptographic receipt check to both rails, requires every
  configured independent Pay.sh RPC to reproduce the exact completed
  transaction as `finalized`, and commits the durable settlement before
  returning the body. Tests reproduce a successful callback with a missing
  receipt, one optimistic RPC against a disagreeing peer, and a valid receipt
  whose Rust commit response is lost; none exposes the buffered content or
  creates a false ledger success.
- Closed two database races missed by SQLite-only tests. The callback and chain
  scanner now converge through a partial unique Pay.sh settlement index and an
  insert-or-reload path, so concurrent PostgreSQL transactions can create only
  one settlement, earning, and access event. The production-engine contract
  releases both paths through a barrier and checks those exact cardinalities.
- Pinned the hash of the exact query capability in every direct attempt. Once a
  valid credential is durably prepared, a simultaneous token-expiry cleanup
  cannot make the post-charge callback fail; a different token still cannot use
  that attempt. Invalid capabilities are rejected inside the prepare transaction
  before the collector is called.
- Closed account-deletion/payment races across document x402, direct Pay.sh,
  funded research, and paid open calls. Deletion and payment preparation now
  lock the same PostgreSQL quote rows. A prepared or ambiguous transfer blocks
  deletion; a deletion that wins first tombstones copied payment URLs before
  external collection. Historical passage/bundle snapshots and handles are
  scrubbed, while transaction signatures and monetary audit rows remain under
  a deleted tombstone identity. The production-engine contract races deletion
  against facilitator claim on separate PostgreSQL connections.
- Replaced process-local timestamp/counter entity ids with 128 bits from the OS
  CSPRNG. The old generator could collide when two Cloud Run processes started
  in the same millisecond with the same counter. A parallel generation contract
  verifies the new fixed random shape and uniqueness.
- Closed wallet-only account creation gaps. Both historical synthetic email
  suffixes are reserved from public registration and password reset, unknown
  login names still execute an Argon2 verification, and user/balance/signup-
  credit/wallet binding now commit in one transaction. Concurrent signed-login
  retries converge on one identity in both the unit contract and the real
  two-connection PostgreSQL contract; a process death can no longer leave a
  funded but unbound synthetic user that permanently locks out the wallet.
- Made notification email delivery multi-instance safe. PostgreSQL leases one
  outbox row to one API instance, a crashed instance loses completion authority
  after lease expiry, every provider call carries the stable outbox id as its
  idempotency key, and a successful row erases recipient, subject, and body.
  A real loopback HTTP server test releases two API instances at once and sees
  one request with the exact durable key; the PostgreSQL contract repeats the
  ownership race on independent connections. Delivery remains effectively-once
  only when the configured provider honors that idempotency key. Five failed
  leases now produce an explicit error log and `exhausted` row whose recipient,
  subject, and reset-token body are erased instead of leaving sensitive data in
  an invisible `retry` row forever.
- Serialized concurrent schema startup. PostgreSQL migrations take one
  transaction-scoped advisory lock and SQLite cold starts use bounded WAL/lock
  retries inside one migration transaction. Four simultaneous file-backed
  SQLite opens must all become ready with one valid seed corpus; the production
  contract compiles and, in CI, runs the same four-start barrier against
  PostgreSQL. The blocking adapter is also exercised inside a current-thread
  Tokio runtime instead of assuming a multi-thread runtime.
- Bound wallet login signatures to the exact configured frontend origin and
  challenge id. A signature over a lookalike origin is rejected without
  consuming the challenge, while the exact message can still complete. Every
  service base that carries an internal token, payment state, or signed bytes
  is now an exact origin and requires HTTPS off loopback; path, query,
  credential, and plaintext-remote variants fail startup.
- Closed open-call last-slot and dispute races. Answer submission and
  cancellation lock the call row and use conditional capacity/escrow updates;
  two PostgreSQL contributors racing a zero-price final slot can create only
  one memory, document, and earning. Dispute review locks the dispute and call,
  cannot restore into a cancelled or filled call, and follows the original
  funding rail. A funded restoration decrements atomic escrow and creates one
  `open_call_dispute_restored` payout claim without touching sandbox balances.
  Unit tests execute the full quote→chain settlement→void→approve path and a
  replay, while the PostgreSQL contract races two administrators against a
  call that deliberately still has spare capacity.
- Made recovery liveness part of traffic readiness instead of informational
  JSON. The x402 gateway stays unready until its chain reconciler has completed
  successfully and recently. The Pay.sh orchestrator independently requires a
  fresh research-job poll, refund pass, and payment-recovery pass. Per-attempt
  reconciliation failures poison the gateway cycle rather than being erased by
  a successful list call. RPC disagreement, incomplete transaction evidence,
  and an unavailable finalized-blockhash view remain safe defers but now mark
  the cycle degraded, so “the fence stayed closed” is not confused with “the
  recovery system is healthy.” Monotonic time is used so wall-clock rollback
  cannot make a dead loop appear fresh.
- Closed two silent-backlog states. Recovery readiness now rejects active
  chain, research Pay.sh, direct Pay.sh, payout, and email work whose retry or
  lease timestamp is farther in the future than any legitimate writer can
  create, as well as research ownership rows that the due-scan join could never
  return. Tests begin with real signed/fenced attempts, corrupt only the clock,
  prove the worker sees an empty list, then prove `/readyz` is `503` and that
  resetting only the schedule makes the exact work visible again. Production
  refuses to start without the complete email provider configuration only when
  `OPENSHELF_EMAIL_PASSWORD_AUTH_ENABLED=true`; wallet-only mode does not mount
  password-reset routes and therefore cannot return a false `204`.
- Closed the standalone payout worker's remaining half-open-network path. Its
  secret-bearing Rust base is validated as an exact secure origin, Rust JSON
  calls and Solana mint/blockhash/broadcast calls have abort deadlines, and a
  real TCP test sends HTTP 200 plus half a JSON body then holds the socket open.
  The call aborts in finite time; a broadcast timeout leaves the already
  persisted signed transaction for exact-signature recovery rather than
  constructing a replacement transfer.
- Removed the final root runtime from the payment boundary. The production Pay
  image now runs both the official verifier and nginx as `www-data`, uses only
  `/tmp` for nginx pid/body/proxy scratch files, and the image boundary CI both
  asserts the configured user and exercises wrong/correct front-token requests
  through the final container configuration.
- Removed the production database escape hatch. Managed Rust processes now
  require an explicit PostgreSQL target and the production image embeds no
  `/data` SQLite default. A PostgreSQL 16 contract kills the live application
  session with `pg_terminate_backend` and proves the next top-level store
  operation reconnects on a new PID; reconnection is deliberately forbidden
  inside a query or transaction so a ledger mutation cannot be split across
  sessions.
- Unified fail-closed environment parsing across Rust, gateway, and
  orchestrator. Staging aliases receive every managed safeguard, typos and
  malformed booleans/numbers abort startup, and timer, batch, page, rate, port,
  quote-TTL, and conversion bounds reject operationally dangerous values. Tests
  include Node's greater-than-32-bit timer overflow, which otherwise becomes a
  one-millisecond retry loop rather than a long delay.
- Bound wallet approval to both the durable quote and the original browser
  intent rather than trusting a returned `402`. The browser refetches the quote
  from a separate Rust route using its query and wallet capabilities, compares
  the gateway copy, ordered handles, and quote-time immutable minimum deposit,
  and only then registers the wallet policy. One test mixes an inflated amount, redirected
  recipient, fake mint, wrong network, and wrong memo; another makes gateway
  creation and `402` consistently request a tenfold top-up and proves intent
  comparison still rejects it. This pass also found and fixed the inverse edge:
  a fully prepaid zero-refill bundle previously reached the positive-amount
  policy and failed before research could start. Another reproduces two tabs:
  the second sees the first tab's `settling` fence and follows recovery without
  signing again, even though mutable prepaid balance has since changed.
- Refused new funded research when its consumer is unhealthy. Bundle creation,
  quote exposure, and gateway readiness now require the orchestrator to answer
  `/readyz` within five seconds with no redirect. A real half-open dependency
  test proves an upstream that never returns cannot leave the request hanging
  or accept more custodial funding. One hundred concurrent health callers are
  then collapsed into one upstream probe, and an outage receives a 250ms
  negative cache instead of multiplying KMS checks.
- Made browser and agent configuration failures explicit at their true money
  boundaries. USDC top-up decimals are converted exactly to atomic units and
  reject NaN, Infinity, clamping, excess precision, and out-of-range values;
  the production KRW preview must equal Rust/Pay.sh's 1350 policy. AI baseline
  TTLs are bounded to prevent a zero-TTL Vertex request loop. The Antigravity
  HTTP client now aborts both connection stalls and HTTP 200 bodies that stop
  halfway through JSON; its real socket test proves a finite timeout. Local
  query capabilities are now merged under a cross-process profile lock: 100
  concurrent updates preserve all 100 recovery tokens, and a real stale lock
  carrying a dead PID is reclaimed without erasing the session.
- Removed the last process-local identity and wall-clock panic assumptions.
  Query capability parents now use 128 bits of OS entropy instead of
  nanoseconds plus a per-process counter. Startup rejects a pre-2024 clock, and
  expiration/lease time never moves backward within a running Rust process, so
  an NTP rollback cannot silently extend a token. The bundle migration is also
  safe under a rolling old writer: a row that knows `deposit_atomic` but not the
  new immutable minimum-deposit column is interpreted conservatively from its
  durable deposit rather than becoming payable under a guessed current balance.
- Replaced a deceptive multi-document agent test with the production contract
  it claimed to exercise. The agent previously omitted the required browser
  wallet session, while its fake gateway returned `201` anyway; production
  returned `401`, so aggregate evidence purchase was unusable. Agents now opt
  into `exact-agent-bundle-v1`, which creates a one-shot quote for exactly the
  research budget without prepaid credit. Query-row locking fences the same
  purchase against the browser-prepaid rail, settlement binds the real chain
  payer, and failure queues the exact unspent amount back to that payer. The
  regression test checks idempotent preparation before and after settlement,
  a cross-rail collision, an underpayment, zero prepaid rows, and the final
  refund recipient and amount rather than merely accepting a mocked HTTP call.
  Confirming that on-chain refund now atomically moves the parent job from
  `refund_pending` to `balance_refunded`; startup repairs the exact older torn
  state, and readiness rejects a confirmed claim whose parent still disagrees.
  A restart that finds the quote already non-payable now returns
  `recovery_required` without a payment URL; a query-scoped status tool resumes
  the same job instead of presenting another approval prompt. Agent approval
  also now cross-checks every gateway field against an independently fetched
  Rust canonical quote and reconstructs the URL from the configured origin;
  the regression fixture deliberately returns an attacker-controlled
  `resourceUrl` and a separately tested inflated amount. A real child gateway
  process, real HTTP sockets, and fake Rust/orchestrator services also verify
  that the public mode header reaches only the new internal agent endpoint,
  carries no wallet session/top-up, and that a missing mode reaches no money
  boundary. The PostgreSQL 16 CI
  contract also races browser-prepaid and agent-direct creation from two real
  application connections and requires one quote, one funding source, one
  winner, and one conflict; the SQLite mutex is not treated as concurrency
  evidence.

The retired anti-pattern is “look up whatever quote is current after payment”
or “let two payment systems independently authorize the same quote.”
The crash window after facilitator success is now closed by independent
finalized-chain discovery. The normal response path also calls the facilitator
exactly once inside a fail-closed before-settle gate and releases the buffered
body only when two independent RPC origins reproduce the same exact finalized
transaction. A facilitator timeout, false success, provider disagreement, or
missing transaction body leaves the durable fence for recovery. The remaining
recovery limitation is intentionally fail-closed: absence from the bounded scan
never deletes a fence, so an RPC outage or exceptionally busy recipient may
require operator reconciliation but cannot make the payer sign again.

## Hard-coded policy and deployment values

These values are acceptable for the hackathon Devnet build but must not be
mistaken for production configuration.

| Value | Current location | Risk / required change |
| --- | --- | --- |
| Solana Devnet CAIP-2 ID and Circle Devnet USDC mint | Rust, gateway, browser | Mainnet requires one validated, server-delivered payment config rather than three build/runtime copies. |
| ₩1,350 per USDC | Rust/Pay.sh quote policy and browser preview | Managed startup now rejects drift, but the value is still copied across build/runtime boundaries. Return one signed or authenticated active conversion policy, or display only the canonical atomic quote. |
| Seed prices, personas, calls, and content | `seed.rs`, frontend offline data | Demo-only. Production database seeding is now off by default. |
| ₩100,000 signup credit | `store.rs` | Sandbox accounting policy, not money. Make tenant/product policy explicit before launch. |
| 14-day hold, two-strike auto-match cutoff, three-strike suspension | `store.rs` and frontend copy | Centralize as versioned server policy; the UI should render server values. |
| 30-day session, quote TTL, login lock window | Rust constants/env | Operational policy needs rotation, cleanup jobs, and documented incident overrides. |
| `gemini-2.5-flash` | orchestrator default | Pin an approved model/config and record provider/data-processing changes. |
| localhost API/gateway URLs | dev fallbacks | Production builds must supply deployment URLs and HTTPS reverse-proxy rules. |

## Blocking gaps before a real public-value launch

1. **Settlement recovery operations.** Finalized-chain verification and the
   crash-window worker are implemented. Production still needs managed-RPC
   capacity tests, alerts for overdue fenced attempts, an operator path for
   proving non-landing, and a rehearsed recovery runbook.
   Immediate x402 body release no longer trusts the facilitator callback alone:
   it waits up to the bounded finality deadline for every configured independent
   RPC origin to return the facilitator-declared signature with byte-identical
   finalized transaction evidence. A real launch drill must still prove this
   deadline against managed-RPC latency/capacity and verify that disagreement
   returns a recoverable failure while the durable fence remains active.
   The first rail-binding rollout must follow the versioned Pay.sh cutover in
   the deployment guide; do not enable x402 until v1 metering is fully removed.
   Exact Pay.sh receipt/chain reconciliation and the public pre-charge
   authorization proxy are implemented. CI builds the final Pay image and
   proves that missing or incorrect front tokens return `404` without touching
   the private upstream, while the correct token is stripped before forwarding.
   The weekly official-sandbox E2E now kills the proxy after durable prepare and
   after Pay collection and proves restart behavior at exact database
   cardinalities. Production still needs alerts, managed-RPC capacity tests, a
   Cloud Run/Devnet instance-loss rehearsal, and a two-independent-RPC
   absence/release rehearsal; the local sandbox drill does not prove those
   deployment and provider properties. Database PITR is also not a safe money
   recovery mechanism yet: restoring to before durable prepare can erase the
   only local fence while the Pay.sh or chain transfer remains final. The
   create-only rollback audit, restored-ledger sweep, and durable PostgreSQL
   hold now discover erased rows and stop current or stale revisions from
   starting new payment/model effects. The remaining load-bearing gap is real
   external-receipt comparison: hold resolution is an explicit, audited
   operator assertion, not an automatic proof from Solana, Pay.sh, payout, and
   provider billing systems. Until an isolated PostgreSQL/GCS restore drill
   proves every transfer in the rollback interval is rediscovered, reconciled,
   and held before traffic resumes, PITR remains a launch blocker rather than
   an operator recovery path.
2. **Escrow signer operations.** Aggregate purchases and open calls use the
   GCP KMS-backed Devnet payout executor. Exact prepared bytes, two-provider
   finality, two-pass absence, and fail-closed key-rotation backlog detection are
   implemented. A public service still needs isolated production IAM, an actual
   old-key drain/recovery drill, fee policy, balance-to-ledger reconciliation,
   alerts, and an operator runbook; the checked-in worker intentionally refuses
   non-Devnet claims.
   The Pay gate and orchestrator also still default to one shared runtime
   service account and have no consumer declaration in the global data-access
   registry. Split the workload identities and register their exact KMS,
   secret, backend API, and Cloud Run invoker contracts before any IAM change.
3. **Mainnet operations.** Managed RPC/facilitator, mainnet mint/network,
   allowlists, KMS/secrets rotation, monitoring, alerts, and incident runbooks
   remain absent. The current verified path is Devnet.
4. **Sensitive-data controls.** Persona passages and interview context are
   application-readable PostgreSQL rows. Operational account deletion now
   scrubs payment and funded-call snapshots as well as primary document rows,
   but field-level encryption, retention workers, staff authorization/audit
   logs, backup-erasure evidence, and redaction operations are still missing.
5. **Legal truthfulness.** The checked-in privacy policy says operational
   backups and legally required records may expire on separate schedules, but
   no concrete retention schedule or deletion-evidence process is implemented.
   The named processor controls, TLS deployment evidence, and in-service
   contact channel also remain incomplete. The policy should additionally make
   the paid-synthesis Vertex AI path and free demographic matching metadata
   unmistakable before public launch.
6. **Abuse controls.** Login has email-keyed throttling and the RPC proxy has a
   local safety limit. Model calls now have a durable per-scope daily budget and
   exact-input concurrency fence, but registration, resolve, gateway quotes,
   open calls, and wallet identities still need distributed IP/account/wallet
   limits and Sybil controls at the edge. Provider quotas and billing alerts
   remain necessary defense in depth.
7. **Account operations.** Password reset/recovery now exists. Email
   verification, admin bootstrap/rotation, reviewer staffing, service contact,
   exhausted-outbox alerting, and broader audit tooling are still missing.
   Provider-side idempotency support is required for effectively-once email
   delivery after the provider accepts a request but its response is lost.
8. **Buyer capability lifecycle.** Query tokens are random, scoped, and expire
   after 24 hours, but still lack explicit revocation and server-owned buyer chat
   history. Add authenticated or wallet-proven cross-device recovery.
9. **Open-call money.** Paid calls now use Devnet USDC escrow; zero-price calls
   and signup credit remain `KRW_SANDBOX`. Neither is fiat or mainnet value.
10. **Frontend and supply-chain delivery security.** Add CSP, HSTS, frame
    policy, SBOM/advisory scanning for Rust, x402 browser-bundle regression
    coverage, and an explicit failure state instead of treating a backend
    outage as a signed-out session. Node CI and deploy images now agree on Node
    24, all three npm graphs have a high-severity audit gate, and clean
    lockfile installs pass the exercised payment paths. Container base tags and
    GitHub Actions are not digest/SHA pinned. The current PayKit graph also has
    an upstream peer-metadata conflict: its Token-2022 zk-proof dependency
    declares Solana Kit 5 while PayKit requires Kit 6. The classic SPL-USDC path
    is covered and does not import that proof program, but do not enable
    Token-2022 proof flows until upstream publishes one Kit-compatible graph.

## Merge recommendation

After the consolidation commit passes the complete CI suite, PR #2 is the one
merge candidate for the hackathon/Devnet application. Do not merge PR #9 on top
of it. Close PR #9 as superseded with a link to PR #2.

That recommendation is not a production-launch approval. Mainnet or a public
service handling real user data/value remains blocked by the items above.
