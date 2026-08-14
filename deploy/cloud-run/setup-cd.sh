#!/usr/bin/env bash
# One-time, idempotent GCP-side setup for the GitHub Actions CD pipeline
# (.github/workflows/deploy.yml). Keyless: GitHub authenticates through
# Workload Identity Federation — no service-account keys are ever created.
#
# Grants are workload-scoped on purpose:
#   - roles/run.admin only on the four obolus-* Cloud Run services (resource-level)
#   - roles/iam.serviceAccountUser only on their four runtime service accounts
#   - roles/secretmanager.secretAccessor only on the RPC-URL secrets the
#     promotion guard needs to resolve
#   - project-level roles limited to Cloud Build submission and image reads
#
# Registry: this deployer is declared as consumer `obolus-deploy-cd` in
# finance-ax/governance/data_access_registry.json. Update that entry first if
# you change any grant below.
set -euo pipefail

PROJECT=${PROJECT:-sweetspot-ax}
REGION=${REGION:-asia-northeast3}
GITHUB_REPO=${GITHUB_REPO:-DanRo-AX/Obolus-GoogleCloudAI-Solana}
POOL=github-cd
PROVIDER=github
SA_ID=obolus-deploy
SA="${SA_ID}@${PROJECT}.iam.gserviceaccount.com"

PROJECT_NUMBER=$(gcloud projects describe "${PROJECT}" --format='value(projectNumber)')

echo "== deployer service account"
gcloud iam service-accounts describe "${SA}" --project "${PROJECT}" >/dev/null 2>&1 ||
  gcloud iam service-accounts create "${SA_ID}" --project "${PROJECT}" \
    --display-name "Obolus GitHub CD (keyless, WIF only)"

echo "== workload identity pool + GitHub OIDC provider (main branch of ${GITHUB_REPO} only)"
gcloud iam workload-identity-pools describe "${POOL}" --location global --project "${PROJECT}" >/dev/null 2>&1 ||
  gcloud iam workload-identity-pools create "${POOL}" --location global --project "${PROJECT}" \
    --display-name "GitHub Actions CD"
gcloud iam workload-identity-pools providers describe "${PROVIDER}" \
  --workload-identity-pool "${POOL}" --location global --project "${PROJECT}" >/dev/null 2>&1 ||
  gcloud iam workload-identity-pools providers create-oidc "${PROVIDER}" \
    --workload-identity-pool "${POOL}" --location global --project "${PROJECT}" \
    --display-name "GitHub OIDC" \
    --issuer-uri "https://token.actions.githubusercontent.com" \
    --attribute-mapping "google.subject=assertion.sub,attribute.repository=assertion.repository,attribute.ref=assertion.ref" \
    --attribute-condition "assertion.repository == '${GITHUB_REPO}' && assertion.ref == 'refs/heads/main'"

gcloud iam service-accounts add-iam-policy-binding "${SA}" --project "${PROJECT}" \
  --role roles/iam.workloadIdentityUser \
  --member "principalSet://iam.googleapis.com/projects/${PROJECT_NUMBER}/locations/global/workloadIdentityPools/${POOL}/attribute.repository/${GITHUB_REPO}" \
  --condition None >/dev/null

echo "== project-level: submit builds, read image digests, upload build sources"
gcloud projects add-iam-policy-binding "${PROJECT}" \
  --member "serviceAccount:${SA}" --role roles/cloudbuild.builds.editor --condition None >/dev/null
gcloud projects add-iam-policy-binding "${PROJECT}" \
  --member "serviceAccount:${SA}" --role roles/artifactregistry.reader --condition None >/dev/null
gcloud storage buckets add-iam-policy-binding "gs://${PROJECT}_cloudbuild" \
  --member "serviceAccount:${SA}" --role roles/storage.objectAdmin >/dev/null

echo "== per-service: run.admin on the service, actAs its runtime identity, read its RPC secrets"
for SERVICE in obolus-api obolus-gateway obolus-orchestrator obolus-pay; do
  gcloud run services add-iam-policy-binding "${SERVICE}" \
    --project "${PROJECT}" --region "${REGION}" \
    --member "serviceAccount:${SA}" --role roles/run.admin >/dev/null
  RUNTIME_SA=$(gcloud run services describe "${SERVICE}" \
    --project "${PROJECT}" --region "${REGION}" \
    --format 'value(spec.template.spec.serviceAccountName)')
  if [[ -n "${RUNTIME_SA}" ]]; then
    gcloud iam service-accounts add-iam-policy-binding "${RUNTIME_SA}" --project "${PROJECT}" \
      --member "serviceAccount:${SA}" --role roles/iam.serviceAccountUser --condition None >/dev/null
  fi
  # The promotion guard resolves *_RPC_URL secret bindings to prove two
  # independent RPC origins; grant read on exactly those secrets.
  for SECRET in $(gcloud run services describe "${SERVICE}" \
      --project "${PROJECT}" --region "${REGION}" --format json |
      jq -r '[.spec.template.spec.containers[0].env[]? | select(.name | test("RPC")) | .valueFrom.secretKeyRef.name // empty] | unique | .[]'); do
    gcloud secrets add-iam-policy-binding "${SECRET}" --project "${PROJECT}" \
      --member "serviceAccount:${SA}" --role roles/secretmanager.secretAccessor --condition None >/dev/null
  done
  echo "   ${SERVICE}: run.admin + actAs ${RUNTIME_SA:-<none>}"
done

echo
echo "Done. Set these GitHub repository variables (Settings > Secrets and variables > Actions > Variables):"
echo "  GCP_WIF_PROVIDER = projects/${PROJECT_NUMBER}/locations/global/workloadIdentityPools/${POOL}/providers/${PROVIDER}"
echo "  GCP_DEPLOY_SA    = ${SA}"
