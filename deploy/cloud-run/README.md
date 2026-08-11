# OBOLUS ax-apps deployment

The staging deployment is intentionally Devnet-only, but its application state
is durable. All stateful Google Cloud resources are in Seoul
(`asia-northeast3`) in project `sweetspot-ax`.

## Managed state

| Resource | Name | Contract |
| --- | --- | --- |
| Cloud SQL PostgreSQL 16 | `ax-apps-db` | Separate database and user `obolus`; existing `ax_metrics`, `cloudbtl`, and `feedback_to_pr` databases are out of scope |
| Secret Manager | `ax-apps-obolus-database-url` | API runtime access only; no service-account key |
| Cloud Storage | `ax-apps-storage` | Prefix `obolus/rollback-audit/**`; create/get only with a prefix IAM condition |
| Cloud Tasks | `obolus-settlements` | 100 attempts over 7 days; 5–300 second backoff |
| API service account | `obolus-api-run` | Dedicated API identity; Cloud SQL client and named-resource access only |
| Frontend | Cloudflare Pages project `obolus` | Static Vite assets plus same-origin `/api/*` and `/x402/*` Pages Functions |

Every GCP resource and Cloud Run revision created for this initiative must carry
`initiative=kr2`. Keep the observed ax-apps inventory labels `kr=kr2`,
`owner=ax`, and `item=obolus` on Cloud Run as well. The currently serving
`obolus-pg-kr2`, `obolus-runtime`, and `obolus-web` resources are legacy
deployment state; they are not the target topology and must not be deleted
until the database and frontend cutovers are verified.

The API accepts SQLite paths only in local modes. `production`, `prod`,
`staging`, and `stage` require an explicit PostgreSQL connection string and
reject `/data/*.db` or any other SQLite path; the image embeds no database
fallback. Cloud Run must receive `OPENSHELF_DATABASE` from
`ax-apps-obolus-database-url` and mount the Cloud SQL connection
`sweetspot-ax:asia-northeast3:ax-apps-db`. Do not restore `/data/*.db` in a
Cloud Run revision.

Startup also rejects a system clock earlier than 2024-01-01 UTC. After startup,
Rust expiration and lease time cannot move backward within the process. Treat a
clock-validation crash as an infrastructure incident; do not bypass it or edit
capability timestamps to make the revision ready.

Every managed API revision also requires
`OPENSHELF_ROLLBACK_AUDIT_BUCKET=ax-apps-storage` and
`OPENSHELF_ROLLBACK_AUDIT_PREFIX=obolus/rollback-audit`. Before the API returns success from an x402
claim, a direct/research Pay.sh prepare, or a payout prepare, it writes the
exact timestamp-free economic intent to that bucket with
`ifGenerationMatch=0`. A bucket or IAM outage therefore pauses payment before
external transport. After a process restart, the byte-identical DB fence and
audit object can be retried; changed economics fail closed.
Payout intent v2 commits the transaction signature derived from its exact fully
signed bytes. Pay.sh v2 commits its exact partial credential, challenge, and
external ID because preparation precedes facilitator signing. x402 v3 likewise
commits the real pre-facilitator payload: its fee-payer signature is still zero
while every buyer signature is present. Settlement snapshots that exact partial
payload before clearing the attempt, so the sweep never substitutes a
same-quote callback or unrelated transfer. Separate create-only prefixes avoid
rolling collisions; the sweep reads v1, v2, and v3 conservatively.

Externally billed Vertex calls use the same pre-transport gate. Their audit
objects contain only artifact kind, a one-way scope hash, canonical input hash, provider
policy/model fence, and budget window. Prompts, profile fields, paid passages,
and model outputs are excluded. If this audit write fails before transport, the
API safely releases the unused local provider budget; once provider transport
starts, the durable attempt remains consumed because a lost response may still
have incurred cost.

The `obolus-api-runtime` consumer, owner, purpose, database, Secret, object
prefix, and 2026-11-07 review date are recorded in the governance registry.
On 2026-08-09 the keyless `obolus-api-run` identity and all three access
contracts were applied and observed: the Secret contract was read through the
runtime identity, Cloud SQL Proxy connected to the empty PostgreSQL 16.14
`obolus` database as user `obolus`, and a GCS canary proved create/get while
list was denied. The temporary verification impersonation binding was removed
immediately and the service account has zero user-managed keys. The Cloud Run
workload and lifecycle remain planned because the serving revision still uses
the legacy identity, database, and Secret.

Keep the bucket binding limited to the conditional custom role with only
`storage.objects.create` and `storage.objects.get`; never grant delete,
overwrite, list, broad project storage roles, or service-account keys.
`ax-apps-storage` is shared and has no bucket-wide retention, versioning, or
lifecycle policy. Every Obolus rollback-audit upload therefore sets the GCS
object's `temporaryHold=true` in the same create-only multipart request and
verifies that hold when retrying or sweeping the object. The runtime identity
cannot release the hold, update metadata, overwrite, or delete an object. Hold
release is a separate operator lifecycle action that requires an approved
registry change and must remain later than the applicable Cloud SQL PITR and
payment-reconciliation window. Do not add a bucket-wide retention policy for
Obolus without a separate decision covering every consumer of the shared
bucket.

Resolve service URLs from Cloud Run before configuring a dependent service:

```bash
OBOLUS_API_URL=$(gcloud run services describe obolus-api \
  --project=sweetspot-ax --region=asia-northeast3 \
  --format='value(status.url)')
```

The payment gateway must then set:

```text
GOOGLE_CLOUD_PROJECT=sweetspot-ax
OPENSHELF_SETTLEMENT_QUEUE_LOCATION=asia-northeast3
OPENSHELF_SETTLEMENT_QUEUE=obolus-settlements
OPENSHELF_SETTLEMENT_TARGET_URL=${OBOLUS_API_URL}
PAY_SH_PRIVATE_URL=${OPENSHELF_PAY_SERVICE_URL}
OPENSHELF_PAY_FRONT_TOKEN=${SECRET_MANAGER_INJECTION}
OPENSHELF_PAY_OPERATOR_WALLET=${PAY_OPERATOR_WALLET}
OPENSHELF_PAY_GCP_KMS_PUBKEY=${PAY_KMS_PUBLIC_KEY}
X402_RPC_URL=${MANAGED_SOLANA_RPC_URL}
X402_RECONCILIATION_RPC_URLS=https://SECOND-INDEPENDENT-SOLANA-RPC
PAY_SH_RPC_URL=${MANAGED_SOLANA_RPC_URL}
PAY_SH_RECONCILIATION_RPC_URLS=https://SECOND-INDEPENDENT-SOLANA-RPC
X402_CHAIN_RECONCILIATION_INTERVAL_MS=30000
X402_CHAIN_RECONCILIATION_BATCH_SIZE=25
X402_CHAIN_RECONCILIATION_SIGNATURE_PAGES=5
X402_SETTLEMENT_FINALITY_TIMEOUT_MS=20000
X402_SETTLEMENT_FINALITY_POLL_INTERVAL_MS=500
X402_SETTLEMENT_FINALITY_RPC_TIMEOUT_MS=3000
X402_FACILITATOR_SETTLEMENT_TIMEOUT_MS=15000
```

The gateway refuses a managed-environment startup without two distinct RPC
origins for both x402 and Pay.sh finality. `PAY_SH_RPC_URL` and every
`PAY_SH_RECONCILIATION_RPC_URLS` origin must observe the byte-identical receipt
transaction as `finalized` before the private callback body or seller credit is
released. For x402, the paid response likewise stays buffered until every
configured provider reproduces the facilitator-declared signature as the exact
finalized transaction within the bounded finality deadline. A false success,
timeout, or disagreement returns a recoverable failure with the durable fence
intact. A lost callback is credited only when every provider later agrees on
that transaction.
Automatic fence release additionally needs two unanimous
invalid-blockhash/absence passes separated by five minutes. Provider
disagreement or a missing transaction body is an alertable hold, not permission
to charge again.

Gateway readiness and funded-bundle creation also require the research
orchestrator's `/readyz` to answer successfully within five seconds. This is a
fund-acceptance fence, not only a dashboard signal: do not bypass it to keep the
purchase endpoint green during an orchestrator incident. Concurrent gateway
checks share one in-flight probe with a one-second success and 250ms failure
cache, preventing public health traffic from amplifying KMS calls while keeping
the accepted health age tightly bounded.

The Pay.sh orchestrator must also receive the same operator wallet and KMS
public key as the Pay.sh gate. `PAY_SH_GATEWAY_BASE` points to the public
`obolus-gateway`, never to the official collector. It also receives:

```text
OPENSHELF_PAY_RECONCILIATION_INTERVAL_MS=30000
OPENSHELF_PAY_RECONCILIATION_BATCH_SIZE=25
OPENSHELF_PAY_RECONCILIATION_SIGNATURE_PAGES=5
OPENSHELF_PAY_RECONCILIATION_RPC_URLS=https://SECOND-INDEPENDENT-SOLANA-RPC
```

It persists the exact PayKit credential before transport. A prepared attempt is
settled only when every configured RPC origin agrees on the exact finalized
transaction and all Ed25519 signatures verify locally. It is released only
after two separated finalized scans from at least two distinct origins agree
that no exact transaction exists and its recent blockhash is invalid. With only
one origin the worker deliberately keeps the fence for manual reconciliation.
Alert on attempts that remain fenced beyond the configured scan capacity; never
clear those rows by hand based on one empty RPC response. Store credential-bearing
RPC URLs in Secret Manager, not plain
deployment arguments.

All managed gateway aliases (`production`, `prod`, `staging`, `stage`) fail at
startup when this queue configuration is absent. Unknown deployment modes and
malformed boolean/numeric settings also fail rather than degrading to local
defaults. Reconciliation intervals are limited to 5–300 seconds, batches to
1–100, and signature pages to 1–20; these limits prevent both scan starvation
and Node's timer-overflow one-millisecond hot loop. The old `X402_OUTBOX_PATH`
setting must not be used.

## Build

Build from each service directory so local `target`, `node_modules`, and secret
files are excluded by the service-level `.gcloudignore` files. The frontend is
not a Cloud Run image; `npm run build:pages` emits the Pages assets and Functions
routing files into `dist`.

```bash
OBOLUS_IMAGE_TAG=$(git rev-parse --short HEAD)

(cd backend && gcloud builds submit . \
  --project=sweetspot-ax \
  --tag=asia-northeast3-docker.pkg.dev/sweetspot-ax/obolus/api:${OBOLUS_IMAGE_TAG})

(cd payment-gateway && gcloud builds submit . \
  --project=sweetspot-ax \
  --tag=asia-northeast3-docker.pkg.dev/sweetspot-ax/obolus/gateway:${OBOLUS_IMAGE_TAG})

npm run typecheck:pages
npm run build:pages
# After the Pages project/account is verified:
npm run pages:deploy -- --branch=main --commit-hash="$(git rev-parse HEAD)"
```

The Pages Functions proxy keeps the browser session first-party: `/api/*`
preserves the API path and `/x402/*` strips only the routing prefix before
streaming to the gateway. Configure the API's
`OPENSHELF_FRONTEND_ORIGIN` to the exact production Pages/custom-domain origin.
Do not set a public `VITE_API_BASE`; doing so bypasses the same-origin proxy and
breaks the current `SameSite=Lax` session-cookie contract.

## ax-apps database cutover

Do not point the serving revision at an empty `ax-apps-db/obolus` database. The
safe cutover order is:

1. **Completed 2026-08-09:** review the registry entry, create the
   `obolus-api-run` keyless service account, and grant only the declared Cloud
   SQL, Secret, and conditional GCS-prefix access.
2. **Completed 2026-08-09:** create the empty `obolus` database and matching
   database user inside `ax-apps-db`; store its connector URL only in
   `ax-apps-obolus-database-url`. The instance-wide SSL/public-IP posture was
   deliberately left unchanged because existing workloads share the instance.
3. Stop new payment/research ingress, drain workers, and reconcile every
   prepared or ambiguous attempt. Export the legacy `obolus-pg-kr2/obolus`
   database through an authenticated Cloud SQL connection and restore it into
   `ax-apps-db/obolus`; never log or write the database password into the repo.
4. Start one no-traffic API candidate with the `ax-apps-db` connector, the new
   Secret, `ax-apps-storage`, the registered prefix, and labels
   `initiative=kr2,kr=kr2,owner=ax,item=obolus`. Let it run schema migration,
   then verify table counts, ledger sums, active-attempt sets, `/readyz`, and
   the PostgreSQL concurrency contract before adding any instance or traffic.
5. Promote the API and dependent payment services as one controlled cutover.
   Keep the legacy instance read-only and recoverable until a real authenticated
   write/read, payment recovery, and rollback-audit object have been verified.
6. Deploy Pages, verify same-origin login and payment recovery, then remove
   Cloud Run `obolus-web` traffic. Retire the old database, Secret, and shared
   runtime identity only after the rollback window and audit evidence close.

Deploy new images with `--no-traffic` and a tag first. Verify `/readyz`, an
authenticated write/read cycle, and Cloud SQL persistence before promotion.
Promote the API before the gateway so a settlement can never be routed from the
durable gateway back into the retired SQLite ledger.

Before gateway promotion, describe the candidate revision and require its image
to be `.../obolus/gateway:<immutable-tag>`. The 2026-08-09 serving
`obolus-gateway` revision was observed using `.../obolus/pay:b31edf3-20260803`;
its public `/healthz` returns the Pay front's intentional 404. Do not use that
revision as evidence that the gateway is healthy, and never promote a candidate
whose image repository is `pay`.

Cloud SQL may terminate an idle backend during maintenance. The next top-level
store operation reconnects before issuing any query; a transaction is never
resumed on a replacement session. CI proves this with PostgreSQL 16 by locating
the application's connection through a unique `application_name`, calling
`pg_terminate_backend`, and requiring readiness to recover on a different PID.

The migration advisory lock serializes new API revisions with each other; it
cannot make an already-running old binary participate. For the first rollout
that introduces this lock, drain old research/payment dispatch and stop old
writes before starting the no-traffic migration candidate. Start one candidate,
verify schema/readiness and the PostgreSQL concurrency contract, then start the
remaining candidate instances. Do not treat the advisory lock as permission to
run an unknown old writer concurrently with a backfill or trigger replacement.

The first `payment_rail` rollout is a versioned cutover because old Pay.sh URLs
do not expire and the proxy charges before the API callback:

1. Stop new research-job dispatch and drain every old orchestrator instance.
   An old instance may already hold a paid URL obtained before the new API's
   protocol check, so the header fence alone is not a substitute for draining.
2. Temporarily add the v2 paid-document endpoints alongside v1 in the deployed
   Pay.sh configuration; do not enable x402 yet.
3. Deploy the new API with `OPENSHELF_ACCEPT_LEGACY_PAY_SH_CALLBACKS=true`.
   It emits only rail-bound v2 resources while still fulfilling already-charged
   v1 callbacks during the transition. Promote the matching orchestrator only
   after this API revision is ready: it must persist an exact job/quote attempt
   through the new internal endpoint before invoking any v2 paid URL. The API
   requires `x-openshelf-research-protocol: durable-mpp-v2` on job polling,
   planning, and claim requests, so a rolling old worker is rejected with `426`
   before it can receive a paid resource.
4. After every old API revision is drained, replace the Pay.sh configuration
   with the checked-in v2-only file and verify v1 URLs are rejected before any
   MPP challenge is issued.
5. Deploy the official Pay.sh image with its nginx front and a new
   `OPENSHELF_PAY_FRONT_TOKEN`. Direct requests without that secret must return
   `404` before an MPP challenge. Configure only `obolus-gateway` with the same
   secret and the official service URL as `PAY_SH_PRIVATE_URL`.
6. Deploy the API with `OPENSHELF_ACCEPT_LEGACY_PAY_SH_CALLBACKS=false`, verify
   direct v1 callbacks return `410 Gone`, and promote public direct-agent traffic
   only through `obolus-gateway`.

Never leave the legacy callback flag enabled after v1 metering is removed.

The managed launch is explicitly wallet-only. Set
`OPENSHELF_EMAIL_PASSWORD_AUTH_ENABLED=false`; the API then does not mount
email registration, login, forgot-password, or reset-password routes and does
not require an email provider. `/readyz` must report `authMode=wallet-only`
before promotion.

Email/password accounts are a deferred launch item, not an implicit fallback.
Before setting the switch to `true`, choose and review a transactional provider,
verify its sender domain and abuse controls, add a Secret version to
`ax-apps-obolus-email-api-key`, inject `OPENSHELF_EMAIL_ENDPOINT`,
`OPENSHELF_EMAIL_API_KEY`, and `OPENSHELF_EMAIL_FROM`, and complete a real
enumeration-safe reset/replay drill. Managed startup fails closed if the switch
is enabled without all three values. The provider endpoint must be HTTPS and
must honor the stable outbox id as an idempotency key; never use a service-account
key or a pasted long-lived access token.

KMS signer rotation has a separate drain gate. A payout claim is owned by the
escrow address stored when the liability was created, and a new key cannot sign
for that address:

1. Pause creation of new paid open-call/refund liabilities and keep the old API
   payment recipient plus old orchestrator revision active.
2. Query `GET /internal/v1/payout-claims/backlog` with the internal token and
   `x-openshelf-payout-protocol: exact-payout-v1`. Wait until the old wallet has
   no unconfirmed row. Investigate blocked rows; never rewrite their wallet.
3. Deploy the new KMS key/version and public key with no traffic. Its `/readyz`
   must remain `503` if any old-wallet row reappears or if backlog JSON is
   malformed. A `200` proves only database coverage and KMS availability, so
   also perform the documented chain/balance drill before promotion.
4. Promote the new API recipient and orchestrator as one controlled cutover,
   then verify a real Devnet payout reaches `finalized` on both configured RPC
   providers and the claim signature is exposed by the API.

Do not destroy or disable the old KMS key until the retention/recovery policy
allows it and the zero-backlog evidence has been recorded. IAM authorization
for either key remains subject to the data-access registry gate below.

Cloud Run may still expose the Pay.sh service URL at the network layer, but the
container's nginx front rejects every request without the independent proxy
secret before it reaches the official payment verifier. Agents use only
`obolus-gateway`. That gateway durably commits the exact MPP credential before
forwarding, injects the callback attempt id, and attaches the final receipt to
the global transaction registry. The private callback only constructs a
buffered immutable quote response; it cannot create a settlement, earning, or
content-access event. The gateway returns that body only after the matching
receipt commits in Rust. A stale or competing credential therefore fails before
external collection, while a crash between collection and receipt handling
leaves one exact prepared attempt and no false ledger success.

Application-layer fencing does not authorize an IAM rollout. Before additionally
making Cloud Run ingress private, register separate gateway, Pay gate, and
orchestrator consumers, owners, purposes, service accounts, allowed backend/API
resources, and review dates in the global data-access registry. The current
default build substitutions reuse one `openshelf-pay` service account and the
registry has no OPENSHELF/OBOLUS entry; that remains a governance blocker. Do not
grant `run.invoker`, KMS, Secret Manager, or backend access until the registry is
reviewed, then verify actual IAM and audit logs against the declaration. Do not
create service-account keys.

Use the canonical service URLs returned by Cloud Run instead of constructing a
regional URL from the project number. Older services may not have the newer
regional alias, and an invented alias returns Google's generic 404 before the
request reaches the container:

```bash
gcloud run services describe obolus-api \
  --project=sweetspot-ax --region=asia-northeast3 \
  --format='value(status.url)'
```

For a tagged candidate, point the candidate web revision at the tagged API and
gateway URLs. The gateway candidate must likewise use the tagged web URL as
`FRONTEND_ORIGIN`, the tagged API URL as both `RUST_API_URL` and
`OPENSHELF_SETTLEMENT_TARGET_URL`, and the canonical orchestrator URL as
`RESEARCH_ORCHESTRATOR_URL`. Repoint all four values to canonical service URLs
when creating the release revision for promotion.

Never promote `latest`. A prior deployment placed a Pay.sh image under the
gateway service, so an unqualified promotion can move traffic to the wrong
runtime even when the currently serving revision is healthy. Guard the exact
candidate and then use only the revision-pinned command printed by the guard:

```bash
npm run finalist:guard-promotion -- \
  --project sweetspot-ax \
  --region asia-northeast3 \
  --role gateway \
  --revision obolus-gateway-REVISION \
  --expected-digest 0123...64-hex-digest...cdef

# Only after the guard passes:
gcloud run services update-traffic obolus-gateway \
  --project=sweetspot-ax --region=asia-northeast3 \
  --to-revisions=obolus-gateway-REVISION=100
```

Promote the API with the same role-specific guard and exact-revision rule.
Rollback uses `--to-revisions=KNOWN_GOOD_REVISION=100`, API first. Cloud SQL is
not rolled back with application traffic; use PITR only for an actual data
incident.

PITR is not safe merely because the restored database passes `/readyz`.
Restoring to a point before a Pay.sh, x402, or payout attempt removes the very
fence that tells recovery to scan for an irreversible external transfer, so
absence can look healthy while the chain still contains the payment. Before any
Cloud SQL restore, stop every payment ingress and payout worker, preserve the
pre-restore database, wait for every in-flight authorization request to drain,
then record the interval end, and reconcile that
interval against Pay.sh receipts plus every configured finalized RPC origin.
Recreate or manually hold every missing attempt, settlement, and payout claim
before traffic resumes. Do not delete the pre-restore instance until the two
ledgers balance.

The API now emits an independent create-only intent before each managed
external money movement can begin. That closes the otherwise invisible window
where both an attempt and its settlement disappear from the restored database.
It does not by itself authorize traffic after a restore. Run the ledger
coverage sweep while all payment ingress and payout workers remain stopped.
Choose a new, incident-unique restore ID; reusing the same ID only makes a
restarted sweep idempotent and must not identify a later restore:

```bash
OPENSHELF_RESTORE_SWEEP_ACK=payments-stopped-and-drained \
OPENSHELF_RESTORE_ID='cloud-sql-restore-YYYYMMDD-INCIDENT' \
OPENSHELF_DATABASE='postgresql://RESTORED-INSTANCE/obolus' \
OPENSHELF_ROLLBACK_AUDIT_BUCKET='ax-apps-storage' \
OPENSHELF_ROLLBACK_AUDIT_PREFIX='obolus/rollback-audit' \
OPENSHELF_ROLLBACK_START_MS='ROLLBACK-POINT-EPOCH-MS' \
OPENSHELF_ROLLBACK_END_MS='INGRESS-STOP-EPOCH-MS' \
cargo run --manifest-path backend/Cargo.toml \
  --bin rollback_audit_sweep
```

The interval is start-inclusive/end-exclusive and capped at 31 days. Before it
contacts GCS, the command installs a recovery-window hold in PostgreSQL. It then
prints one sanitized NDJSON record per intent and installs a separate hold for
every missing or mismatched payment/model fence. A GCS outage, malformed object,
or killed sweep therefore leaves the restored database stopped. `/readyz`
fails, and database triggers reject new chain attempts, Pay.sh preparations,
payout preparations, and model-provider fences even from an old revision that
does not know about this feature. Existing settlement, failure, and
reconciliation transitions remain allowed so recovery does not deadlock.

Exit `2` means exact restored-ledger evidence is missing or different. Exit `0`
means only that ledger coverage is complete: the recovery-window hold remains,
and the summary still says external reconciliation is required. Reconcile the
entire interval against finalized chain/Pay.sh receipts, payout signatures, and
provider billing. Then, while ingress and payout workers are still stopped,
resolve that incident's holds with a durable evidence reference:

```bash
OPENSHELF_RESTORE_RESOLVE_ACK=payments-stopped-and-external-receipts-reconciled \
OPENSHELF_RESTORE_ID='cloud-sql-restore-YYYYMMDD-INCIDENT' \
OPENSHELF_RESTORE_RESOLUTION_EVIDENCE='incident://INCIDENT/receipt-report' \
OPENSHELF_DATABASE='postgresql://RESTORED-INSTANCE/obolus' \
cargo run --manifest-path backend/Cargo.toml \
  --bin rollback_hold_resolve
```

The resolver preserves every hold row, resolution timestamp, and evidence
reference. Resume traffic only after it succeeds and API, payment reconciler,
and payout-worker readiness checks all pass.

Production approval requires an isolated restore drill using a real PostgreSQL
snapshot and official sandbox/Devnet transfers: snapshot before durable prepare,
complete payments on the source database, restore the snapshot to a separate
instance, then prove the rollback-horizon sweep finds every otherwise missing
fund movement and that no client can pay again. The repository now contains the
ledger coverage sweep and durable database holds, but it has no governed bucket
deployment, automated external-receipt comparison, or completed
retained-bucket/real-PostgreSQL restore drill. PITR therefore remains a launch
blocker rather than an available payment runbook.

## Verification

```bash
cargo test --manifest-path backend/Cargo.toml --lib
npm run test:unit
npm --prefix payment-gateway run typecheck
npm --prefix payment-gateway test
npm --prefix agent-orchestrator run typecheck
npm --prefix agent-orchestrator test

OBOLUS_GATEWAY_URL=$(gcloud run services describe obolus-gateway \
  --project=sweetspot-ax --region=asia-northeast3 \
  --format='value(status.url)')

OBOLUS_ORCHESTRATOR_URL=$(gcloud run services describe obolus-orchestrator \
  --project=sweetspot-ax --region=asia-northeast3 \
  --format='value(status.url)')

curl -fsS "${OBOLUS_API_URL}/readyz"
curl -fsS "${OBOLUS_GATEWAY_URL}/readyz"
curl -fsS "${OBOLUS_ORCHESTRATOR_URL}/readyz"
```

Expected gateway readiness includes `"durableSettlementQueue":true`, a healthy
research-orchestrator dependency, and a
`chainReconciler` object whose `lastError` remains `null`. The first completed
scan appears after startup even when there are no due attempts; readiness stays
`503` before that scan, after any failed attempt cycle, or when completion is
stale. RPC disagreement or incomplete evidence is a safe defer but still makes
the cycle operationally degraded and therefore unready. Orchestrator readiness
likewise requires fresh successful job-poll, refund, and Pay.sh recovery cycles
in addition to KMS availability and payout
wallet coverage. This deployment does not enable Solana mainnet;
`OPENSHELF_REQUIRE_MAINNET=false` and the Devnet CAIP-2 network remain explicit
until a separate launch review.
