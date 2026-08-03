# OBOLUS Cloud Run deployment

The staging deployment is intentionally Devnet-only, but its application state
is durable. All stateful Google Cloud resources are in Seoul
(`asia-northeast3`) in project `sweetspot-ax`.

## Managed state

| Resource | Name | Contract |
| --- | --- | --- |
| Cloud SQL PostgreSQL 16 | `obolus-pg-kr2` | Database `obolus`; backups, 7-day PITR, storage auto-growth, deletion protection |
| Secret Manager | `obolus-database-url` | User-managed replica in `asia-northeast3`; API runtime access only |
| Cloud Tasks | `obolus-settlements` | 100 attempts over 7 days; 5–300 second backoff |
| Runtime service account | `obolus-runtime` | Cloud SQL client, task enqueuer, and named-secret access |

The API accepts SQLite paths for local tests and PostgreSQL connection strings
for deployment. Cloud Run must receive `OPENSHELF_DATABASE` from
`obolus-database-url` and mount the Cloud SQL connection
`sweetspot-ax:asia-northeast3:obolus-pg-kr2`. Do not restore `/data/*.db` in a
Cloud Run revision.

The payment gateway must set:

```text
GOOGLE_CLOUD_PROJECT=sweetspot-ax
OPENSHELF_SETTLEMENT_QUEUE_LOCATION=asia-northeast3
OPENSHELF_SETTLEMENT_QUEUE=obolus-settlements
OPENSHELF_SETTLEMENT_TARGET_URL=https://obolus-api-270739039690.asia-northeast3.run.app
```

`production` and `staging` gateway processes fail at startup when this queue
configuration is absent. The old `X402_OUTBOX_PATH` setting must not be used.

## Build

Build from each service directory so local `target`, `node_modules`, and secret
files are excluded by the service-level `.gcloudignore` files.

```bash
OBOLUS_IMAGE_TAG=$(git rev-parse --short HEAD)

(cd backend && gcloud builds submit . \
  --project=sweetspot-ax \
  --tag=asia-northeast3-docker.pkg.dev/sweetspot-ax/obolus/api:${OBOLUS_IMAGE_TAG})

(cd payment-gateway && gcloud builds submit . \
  --project=sweetspot-ax \
  --tag=asia-northeast3-docker.pkg.dev/sweetspot-ax/obolus/gateway:${OBOLUS_IMAGE_TAG})
```

Deploy new images with `--no-traffic` and a tag first. Verify `/readyz`, an
authenticated write/read cycle, and Cloud SQL persistence before promotion.
Promote the API before the gateway so a settlement can never be routed from the
durable gateway back into the retired SQLite ledger.

```bash
gcloud run services update-traffic obolus-api \
  --project=sweetspot-ax --region=asia-northeast3 --to-latest

gcloud run services update-traffic obolus-gateway \
  --project=sweetspot-ax --region=asia-northeast3 --to-latest
```

Rollback reverses those two commands with `--to-revisions=REVISION=100`, API
first. Cloud SQL is not rolled back with application traffic; use PITR only for
an actual data incident.

## Verification

```bash
cargo test --manifest-path backend/Cargo.toml --lib
npm --prefix payment-gateway run typecheck
npm --prefix payment-gateway test

curl -fsS https://obolus-api-270739039690.asia-northeast3.run.app/readyz
curl -fsS https://obolus-gateway-270739039690.asia-northeast3.run.app/readyz
```

Expected gateway readiness includes `"durableSettlementQueue":true`. This
deployment does not enable Solana mainnet; `OPENSHELF_REQUIRE_MAINNET=false`
and the Devnet CAIP-2 network remain explicit until a separate launch review.
