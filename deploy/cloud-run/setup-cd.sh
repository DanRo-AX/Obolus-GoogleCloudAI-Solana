#!/usr/bin/env bash
# One-time, idempotent GCP setup for .github/workflows/deploy.yml.
# Registry: consumer `obolus-deploy-cd` in finance-ax/governance/data_access_registry.json.
# Update and validate that declaration before changing a grant below.
set -euo pipefail

PROJECT=${PROJECT:-sweetspot-ax}
REGION=${REGION:-asia-northeast3}
REPOSITORY=${REPOSITORY:-obolus}
GITHUB_REPO=${GITHUB_REPO:-DanRo-AX/Obolus-GoogleCloudAI-Solana}
POOL=github-cd
PROVIDER=github
SOURCE_BUCKET=${SOURCE_BUCKET:-${PROJECT}-obolus-cloudbuild-source}
DEPLOY_SA_ID=obolus-deploy
DEPLOY_SA="${DEPLOY_SA_ID}@${PROJECT}.iam.gserviceaccount.com"
BUILD_SA_ID=obolus-build
BUILD_SA="${BUILD_SA_ID}@${PROJECT}.iam.gserviceaccount.com"

PROJECT_NUMBER=$(gcloud projects describe "${PROJECT}" --format='value(projectNumber)')
[[ "${PROJECT_NUMBER}" =~ ^[0-9]+$ ]]

echo "== keyless deploy identity"
gcloud iam service-accounts describe "${DEPLOY_SA}" --project "${PROJECT}" >/dev/null 2>&1 ||
  gcloud iam service-accounts create "${DEPLOY_SA_ID}" --project "${PROJECT}" \
    --display-name "Obolus GitHub CD (keyless WIF)"
gcloud iam service-accounts describe "${BUILD_SA}" --project "${PROJECT}" >/dev/null 2>&1 ||
  gcloud iam service-accounts create "${BUILD_SA_ID}" --project "${PROJECT}" \
    --display-name "Obolus Cloud Build (images only)"

for service_account in "${DEPLOY_SA}" "${BUILD_SA}"; do
  observed=false
  for _ in $(seq 1 15); do
    if gcloud iam service-accounts describe "${service_account}" \
        --project "${PROJECT}" >/dev/null 2>&1; then
      observed=true
      break
    fi
    sleep 2
  done
  [[ "${observed}" == true ]]
  keys=$(gcloud iam service-accounts keys list \
    --iam-account "${service_account}" --project "${PROJECT}" \
    --managed-by user --format='value(name)')
  if [[ -n "${keys}" ]]; then
    echo "refusing CD setup: ${service_account} has a user-managed key" >&2
    exit 1
  fi
done

echo "== GitHub OIDC provider restricted to canonical stateful release workflow"
gcloud iam workload-identity-pools describe "${POOL}" \
  --location global --project "${PROJECT}" >/dev/null 2>&1 ||
  gcloud iam workload-identity-pools create "${POOL}" \
    --location global --project "${PROJECT}" --display-name "GitHub Actions CD"

if gcloud iam workload-identity-pools providers describe "${PROVIDER}" \
    --workload-identity-pool "${POOL}" --location global --project "${PROJECT}" \
    >/dev/null 2>&1; then
  gcloud iam workload-identity-pools providers update-oidc "${PROVIDER}" \
    --workload-identity-pool "${POOL}" --location global --project "${PROJECT}" \
    --issuer-uri "https://token.actions.githubusercontent.com" \
    --attribute-mapping "google.subject=assertion.sub,attribute.repository=assertion.repository,attribute.ref=assertion.ref,attribute.environment=assertion.environment,attribute.workflow_ref=assertion.workflow_ref" \
    --attribute-condition "assertion.repository == '${GITHUB_REPO}' && assertion.ref == 'refs/heads/main' && assertion.environment == 'production' && assertion.workflow_ref == '${GITHUB_REPO}/.github/workflows/deploy-cloud-run.yml@refs/heads/main'" \
    >/dev/null
else
  gcloud iam workload-identity-pools providers create-oidc "${PROVIDER}" \
    --workload-identity-pool "${POOL}" --location global --project "${PROJECT}" \
    --display-name "GitHub OIDC" \
    --issuer-uri "https://token.actions.githubusercontent.com" \
    --attribute-mapping "google.subject=assertion.sub,attribute.repository=assertion.repository,attribute.ref=assertion.ref,attribute.environment=assertion.environment,attribute.workflow_ref=assertion.workflow_ref" \
    --attribute-condition "assertion.repository == '${GITHUB_REPO}' && assertion.ref == 'refs/heads/main' && assertion.environment == 'production' && assertion.workflow_ref == '${GITHUB_REPO}/.github/workflows/deploy-cloud-run.yml@refs/heads/main'" \
    >/dev/null
fi

gcloud iam service-accounts add-iam-policy-binding "${DEPLOY_SA}" \
  --project "${PROJECT}" \
  --role roles/iam.workloadIdentityUser \
  --member "principalSet://iam.googleapis.com/projects/${PROJECT_NUMBER}/locations/global/workloadIdentityPools/${POOL}/attribute.repository/${GITHUB_REPO}" \
  --condition None >/dev/null

echo "== build submission, source staging, and repository-scoped image writes"
gcloud projects add-iam-policy-binding "${PROJECT}" \
  --member "serviceAccount:${DEPLOY_SA}" \
  --role roles/cloudbuild.builds.editor --condition None >/dev/null
gcloud storage buckets describe "gs://${SOURCE_BUCKET}" >/dev/null 2>&1 ||
  gcloud storage buckets create "gs://${SOURCE_BUCKET}" \
    --project "${PROJECT}" --location "${REGION}" \
    --uniform-bucket-level-access --public-access-prevention
gcloud storage buckets update "gs://${SOURCE_BUCKET}" \
  --uniform-bucket-level-access --public-access-prevention \
  --update-labels initiative=kr2,kr=kr2,owner=ax,item=obolus >/dev/null
gcloud storage buckets add-iam-policy-binding "gs://${SOURCE_BUCKET}" \
  --member "user:juneyoon@sweetspot.co.kr" \
  --role roles/storage.admin >/dev/null
gcloud storage buckets add-iam-policy-binding "gs://${SOURCE_BUCKET}" \
  --member "serviceAccount:${DEPLOY_SA}" \
  --role roles/storage.objectCreator >/dev/null
gcloud storage buckets add-iam-policy-binding "gs://${SOURCE_BUCKET}" \
  --member "serviceAccount:${DEPLOY_SA}" \
  --role roles/storage.legacyBucketReader >/dev/null
gcloud artifacts repositories add-iam-policy-binding "${REPOSITORY}" \
  --project "${PROJECT}" --location "${REGION}" \
  --member "serviceAccount:${DEPLOY_SA}" \
  --role roles/artifactregistry.reader --condition None >/dev/null

# Retire the broader legacy reader after the repository-scoped replacement is
# present. Ignore only the already-absent case so the setup stays idempotent.
if gcloud projects get-iam-policy "${PROJECT}" --format=json |
    jq -e --arg member "serviceAccount:${DEPLOY_SA}" '
      any(.bindings[]?;
        .role == "roles/artifactregistry.reader" and
        any(.members[]?; . == $member))' >/dev/null; then
  gcloud projects remove-iam-policy-binding "${PROJECT}" \
    --member "serviceAccount:${DEPLOY_SA}" \
    --role roles/artifactregistry.reader --condition None >/dev/null
fi

echo "== build-only identity"
gcloud artifacts repositories add-iam-policy-binding "${REPOSITORY}" \
  --project "${PROJECT}" --location "${REGION}" \
  --member "serviceAccount:${BUILD_SA}" \
  --role roles/artifactregistry.writer --condition None >/dev/null
gcloud storage buckets add-iam-policy-binding "gs://${SOURCE_BUCKET}" \
  --member "serviceAccount:${BUILD_SA}" \
  --role roles/storage.objectViewer >/dev/null

# Uniform access plus workload grants replace the broad project primitive
# members that a newly-created bucket may inherit.
for project_binding in \
    "projectViewer:${PROJECT}:roles/storage.legacyBucketReader" \
    "projectViewer:${PROJECT}:roles/storage.legacyObjectReader" \
    "projectEditor:${PROJECT}:roles/storage.legacyBucketOwner" \
    "projectEditor:${PROJECT}:roles/storage.legacyObjectOwner" \
    "projectOwner:${PROJECT}:roles/storage.legacyBucketOwner" \
    "projectOwner:${PROJECT}:roles/storage.legacyObjectOwner"; do
  member=${project_binding%:roles/*}
  role="roles/${project_binding##*:roles/}"
  if gcloud storage buckets get-iam-policy "gs://${SOURCE_BUCKET}" --format=json |
      jq -e --arg member "${member}" --arg role "${role}" '
        any(.bindings[]?; .role == $role and any(.members[]?; . == $member))' >/dev/null; then
    gcloud storage buckets remove-iam-policy-binding "gs://${SOURCE_BUCKET}" \
      --member "${member}" --role "${role}" >/dev/null
  fi
done

# Retire access to the shared source bucket only after the dedicated bucket is
# ready. These checks avoid treating an already-absent binding as an error.
for member_role in \
    "${DEPLOY_SA}:roles/storage.objectAdmin" \
    "${BUILD_SA}:roles/storage.objectViewer"; do
  member=${member_role%%:*}
  role=${member_role#*:}
  if gcloud storage buckets get-iam-policy "gs://${PROJECT}_cloudbuild" --format=json |
      jq -e --arg member "serviceAccount:${member}" --arg role "${role}" '
        any(.bindings[]?; .role == $role and any(.members[]?; . == $member))' >/dev/null; then
    gcloud storage buckets remove-iam-policy-binding "gs://${PROJECT}_cloudbuild" \
      --member "serviceAccount:${member}" --role "${role}" >/dev/null
  fi
done
gcloud projects add-iam-policy-binding "${PROJECT}" \
  --member "serviceAccount:${BUILD_SA}" \
  --role roles/logging.logWriter --condition None >/dev/null

gcloud iam service-accounts add-iam-policy-binding "${BUILD_SA}" \
  --project "${PROJECT}" \
  --member "serviceAccount:${DEPLOY_SA}" \
  --role roles/iam.serviceAccountUser --condition None >/dev/null

# Cloud Build's service agent mints the short-lived credential used by workers.
CLOUD_BUILD_AGENT="service-${PROJECT_NUMBER}@gcp-sa-cloudbuild.iam.gserviceaccount.com"
gcloud iam service-accounts add-iam-policy-binding "${BUILD_SA}" \
  --project "${PROJECT}" \
  --member "serviceAccount:${CLOUD_BUILD_AGENT}" \
  --role roles/iam.serviceAccountTokenCreator --condition None >/dev/null

echo "== service-scoped deploy and exact runtime actAs"
for binding in \
    obolus-api:obolus-api-run \
    obolus-gateway:obolus-gateway-run \
    obolus-orchestrator:obolus-orchestrator-run \
    obolus-pay:obolus-pay; do
  service=${binding%%:*}
  expected_runtime_id=${binding##*:}
  expected_runtime_sa="${expected_runtime_id}@${PROJECT}.iam.gserviceaccount.com"
  gcloud run services add-iam-policy-binding "${service}" \
    --project "${PROJECT}" --region "${REGION}" \
    --member "serviceAccount:${DEPLOY_SA}" --role roles/run.admin >/dev/null

  runtime_sa=$(gcloud run services describe "${service}" \
    --project "${PROJECT}" --region "${REGION}" \
    --format='value(spec.template.spec.serviceAccountName)')
  [[ "${runtime_sa}" == "${expected_runtime_sa}" ]]
  gcloud iam service-accounts add-iam-policy-binding "${expected_runtime_sa}" \
    --project "${PROJECT}" \
    --member "serviceAccount:${DEPLOY_SA}" \
    --role roles/iam.serviceAccountUser --condition None >/dev/null

done

for secret in obolus-rpc-url ax-apps-obolus-reconciliation-rpc-urls; do
  gcloud secrets add-iam-policy-binding "${secret}" \
    --project "${PROJECT}" \
    --member "serviceAccount:${DEPLOY_SA}" \
    --role roles/secretmanager.secretAccessor --condition None >/dev/null
done

echo "== immutable release tags"
gcloud artifacts repositories update "${REPOSITORY}" \
  --project "${PROJECT}" --location "${REGION}" --immutable-tags >/dev/null

echo "== observed configuration"
printf 'GCP_WIF_PROVIDER=projects/%s/locations/global/workloadIdentityPools/%s/providers/%s\n' \
  "${PROJECT_NUMBER}" "${POOL}" "${PROVIDER}"
printf 'GCP_DEPLOY_SA=%s\n' "${DEPLOY_SA}"
printf 'GCP_BUILD_SA=%s\n' "${BUILD_SA}"
printf 'user-managed service-account keys: deploy=0 build=0\n'
