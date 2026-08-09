# Pay.sh research-payment architecture

## One flow for the website and autonomous agents

1. Search and ranking are free. The Rust API commits the exact document set,
   recipients, prices, hashes, mint, network, and per-document rounded atomic
   amounts into a durable research job.
2. The user proves current wallet possession with a fresh Phantom `signMessage`.
   OPENSHELF issues a revocable 30-day prepaid spending capability scoped only
   to that verified wallet's internal balance; a previously saved payout wallet
   is not sufficient by itself.
3. If the balance is low, Phantom signs an x402 USDC refill to the bounded GCP
   KMS service wallet. Rust credits the confirmed atomic amount and reserves
   the exact question budget in one database transaction. Later questions skip
   Phantom while the balance is sufficient.
4. The Cloud Run orchestrator loads only funded jobs and uses
   `@solana/pay-kit/client` with a GCP KMS signer to satisfy each official
   Pay.sh MPP challenge independently.
5. Pay.sh sends the document share directly to its verified owner and proxies
   the paid request to Rust. Only this callback marks that exact quote delivered
   and returns its citation.
6. All documents paid means `completed`. A failure proven to occur before a
   paid request restores the unpaid atomic remainder to prepaid balance; legacy
   direct-deposit jobs still use an on-chain refund claim. A failure after the
   paid request begins is held for reconciliation and is never auto-retried or
   auto-refunded.

Immediately before PayKit sends its paid Authorization request, the
orchestrator persists the exact MPP challenge, external id, recent blockhash,
KMS payer address, platform recipient, and payer-signed transaction. A finalized-chain worker then recovers a lost
callback from that exact transaction. A missing transaction is not enough to
retry: the worker records one durable absence observation and requires a later
finalized pass after the blockhash is invalid before releasing the fence. Each
absence pass requires complete agreement from at least two distinct RPC origins;
settlement likewise requires every configured origin to return the same exact
finalized signature, followed by local Ed25519 verification of all transaction
signers. One provider can neither grant content nor authorize a retry alone.
The orchestrator refuses to start unless the primary and reconciliation RPC
URLs resolve to at least two distinct origins.
Recovery uses the platform recipient snapshotted before collection, not the
current deployment environment. Rotating the operator wallet therefore cannot
orphan an already collected payment. A legacy attempt without this snapshot
stays fenced for manual review rather than guessing from the new wallet.

The query token is never stored in plaintext. Internal Pay.sh delivery is bound
to `(research job, query, document, quote)` and also requires the shared internal
service credential injected by the Pay.sh proxy.

For direct agent purchases, the x402 gateway is also the public Pay.sh
authorization proxy. It forwards free requests and 402 challenges, but persists
the exact payer-signed MPP transaction before forwarding a paid credential to
the official gate. The official gate container rejects requests without the
proxy-only front token, and Rust rejects callbacks without the proxy-injected
attempt id. After a paid call starts, use the free `recoveryPath`; a different
credential for the same quote is rejected before collection.

## Key custody

- Phantom key: remains in the browser extension and signs wallet proof/refills.
- Prepaid session: an expiring OPENSHELF capability; it can reserve only the
  verified wallet's deposited balance and has no Solana signing authority.
- User withdrawal/delegate authority: none is granted to OPENSHELF.
- Service key: an Ed25519 key in Google Cloud KMS. Cloud Run receives only a
  signing API through IAM; it cannot export the private key.
- DB owner key: never used by OPENSHELF; the owner only publishes a verified
  receiving address.

## Antigravity and Pay MCP on Devnet

The OpenShelf Antigravity plugin keeps quote creation and wallet signing in
separate MCP trust boundaries. An `openshelf` tool prepares a short-lived exact
payment URL and returns `approval_required`. After the model shows the exact
intent, the user approves one aggregate payment. Only then may the agent call
Pay's `curl` MCP tool, which signs locally and retries the same x402 URL.

Install and verify:

```bash
agy plugin install ./integrations/antigravity/openshelf
npm run agent:doctor
agy plugin validate ./integrations/antigravity/openshelf
```

Pay supports named local accounts. Use `pay account list` and
`pay account default NAME`, or set `OPENSHELF_PAY_ACCOUNT=NAME` for the plugin.
Google login, OpenShelf marketplace sessions, and Pay wallet accounts remain
independent; see [`ACCOUNT-LINKING.md`](./ACCOUNT-LINKING.md).

The KMS wallet is intentionally bounded: fund it with only operating SOL plus
prepaid deposits. Each job reserves the sum of independently rounded Pay.sh
atomic charges, preventing per-document rounding underfunding or overspending.

## Crash and replay behavior

- The browser stores the job id before Phantom opens for a required refill.
- The outer x402 gateway enqueues settled transactions in Cloud Tasks in
  `asia-northeast3` before attempting the synchronous ledger write. The Rust
  settlement endpoints are idempotent, so queued replay is safe across process
  and Cloud Run instance restarts.
- The orchestrator polls `funded` and `processing` jobs, so the browser may close.
- Challenge/preflight failures may retry because no paid call began. After
  challenge verification, the worker first commits an exact quote/attempt fence
  and only then calls PayKit. PayKit's real Authorization credential is captured
  at the transport boundary and its exact signed transaction is committed before
  the HTTP request may leave. `payment_in_progress` is excluded from polling, so
  a process death cannot reissue the paid URL. The callback atomically records
  delivery and returns the job to `processing`; otherwise finalized-chain
  reconciliation settles the exact transaction or releases it only after two
  separated absence proofs.
- Refund transfers use the existing prepare/broadcast/finalize payout ledger, so
  a worker crash replays the same signed transaction instead of creating a new
  payment. Both the KMS worker and the local recovery worker require two
  independent RPC origins to report the exact signature `finalized`; two
  `confirmed` views are still treated as a reversible fork. An expired prepared
  transaction is cleared only after two unanimous passes separated by the
  durable server interval.
- `/readyz` also reads the payout backlog grouped by escrow wallet and network.
  A KMS-key rotation is not ready while the old wallet owns any unconfirmed
  claim, or while this signer has an exhausted/invalid claim. The old revision
  must drain to zero before the new signer is promoted.
- The worker validates signer, network, USDC mint, canonical amount, status, and
  complete prepared evidence before KMS/RPC use, and adds the claim id as an
  on-chain memo. A partially persisted prepared row is blocked for operator
  reconciliation rather than re-signed. All external calls have finite abort
  deadlines; a socket that never returns keeps evidence inconclusive but cannot
  freeze every later reconciliation forever.
- Cloud Run is deployed with one warm instance and always-allocated CPU to keep
  job and refund polling alive after the browser closes. Exact DB payment fences
  prevent a second orchestrator instance from owning the same paid call.

## Local verification

```bash
npm run build
npm --prefix payment-gateway test
npm --prefix agent-orchestrator test
cargo test --manifest-path backend/Cargo.toml
```

The full test starts the Rust backend, the pinned official Pay sandbox, and the
public authorization gateway, makes a real sandbox payment, and verifies that
delivery and free recovery converge on one settlement:

```bash
npm run pay:sandbox:e2e
```

The scheduled `Pay sandbox E2E` workflow also runs the inverse case with a
fresh recipient that has no USDC associated token account. That payment must
fail before durable prepare or external collection, with zero settlements and
zero content-access events. This is a real compatibility limit, not a synthetic
malformed-input check: production onboarding must initialize or verify the
recipient's USDC token account before Pay.sh sales are enabled. The gateway
rechecks the exact mint/owner ATA through `PAY_SH_RPC_URL` before every paid
credential is allowed to reach the collector.

It also performs two process-death drills against the real three-process stack:

```bash
npm run pay:sandbox:e2e:crash-after-prepare
npm run pay:sandbox:e2e:crash-after-collection
```

The first sends `SIGKILL` after the exact signed credential is committed but
before the collector is called, restarts the gateway, retries the original paid
URL with the official CLI, and requires zero settlements plus one blocked
attempt. The second sends `SIGKILL` after the collector and Rust callback finish
and the gateway validates the exact receipt, but before finality and ledger
commit. It then requires free recovery of the same single settlement and access
event after restart. A bounded startup retry
is permitted only for the public sandbox's own RPC funding transport failures;
application and configuration errors are never retried.
The hosted sandbox exposes one simulator RPC, so that drill proves exact-byte
transaction discovery and end-to-end ledger convergence from one real view; it
does not masquerade the same simulator as two independent providers. Production
settlement and all automatic absence release still require two distinct RPC
origins, enforced by startup policy and disagreement tests.

## Google Cloud deployment

The same KMS public key must be configured as:

- `OPENSHELF_BUNDLE_RECEIVER` on Rust;
- `OPENSHELF_PAY_GCP_KMS_PUBKEY` on Pay.sh and the orchestrator;
- the funded Devnet USDC/SOL wallet.

Deploy Pay.sh with `pay/cloudbuild.yaml`, then deploy the worker with
`agent-orchestrator/cloudbuild.yaml`. Its service account needs KMS public-key
read and asymmetric-sign permissions. Secrets are injected from Secret Manager;
no keypair file is required.

Changing `OPENSHELF_PAY_GCP_KMS_KEY_NAME` or its public key is a fund-ownership
cutover, not an ordinary image rollout. Stop creation of new payout liabilities,
keep the old signer running until `GET /internal/v1/payout-claims/backlog` has no
row for its wallet, and only then promote the new revision. A new revision with
old-wallet work deliberately fails `/readyz`; do not bypass that failure by
removing rows or changing their `escrow_wallet` snapshot.

An actual Devnet transfer additionally requires the configured KMS key, IAM,
managed RPC, SOL fees, and Devnet USDC. Unit/integration tests do not fabricate
an on-chain success when those external resources are absent.

## Public direct-payment boundary

The official Pay.sh gate still collects before its Rust upstream callback, so it
is never exposed as the agent-facing origin. The public payment gateway parses
the real MPP credential, validates its quote, amount, network, split, fee payer,
expiry, and resource nonce. It also verifies the buyer's Ed25519 signature and
decodes the transaction itself: the fee-payer slot, USDC mint and decimals,
buyer source ATA, platform/owner destination ATAs, exact two transfer amounts,
resource memo, and allowed instruction programs must all match before it commits
`direct_pay_sh_attempts` or starts transport. The official gate is
fronted by nginx and requires `OPENSHELF_PAY_FRONT_TOKEN`; caller-supplied front,
internal, and attempt headers are stripped.

A callback without a final receipt leaves the direct attempt `ambiguous`. The
same two-provider finalized scanner used by funded jobs recovers the exact
transaction and atomically commits delivery, earnings, and the global chain
registry. A successful callback followed by a lost receipt is also scanned; it
does not authorize another payment. Recovery repeats the same transfer-semantic
and signature checks against the durable bytes, and a finalized RPC response
without an explicit execution status is inconclusive rather than successful.

Direct document purchases and funded research jobs must be rolled out as one
payment schema. They share `pay_sh_quote_fences` and the query/document bundle
reservation triggers; do not run a migration that adds one without the other.
Startup deliberately fails if historical rows show an active bundle overlapping
an x402/direct attempt, a direct Pay.sh credential, or a delivered quote that has
no settled attempt for its owning research job. Stop payment writes and reconcile
that buyer purchase before retrying the revision. Deleting the conflicting row
or bypassing `/readyz` is not a cutover procedure because either transfer may
already have reached the external collector.
