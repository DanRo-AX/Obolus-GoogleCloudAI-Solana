# Obolus 운영 배포 런북

이 문서는 이미 구성된 Obolus 운영형 Devnet의 배포 진입점이다. PR과 모든 `main`
push는 [CI](../.github/workflows/ci.yml)를 실행한다. 여섯 CI job이 모두 성공하면
[Pages workflow](../.github/workflows/deploy.yml)가 해당 SHA를 tested-main artifact로
기록한다. 마지막 성공 Cloud Run SHA 이후 backend 관련 변경이 없을 때만 Pages를
자동 승인 대기 상태로 보낸다. 공유 Cloud SQL migration과 reconciliation worker를
시작하는 Cloud Run은 자동 배포하지 않는다. 운영자가 schema·backlog·rollback을
검토한 뒤 [stateful workflow](../.github/workflows/deploy-cloud-run.yml)를 current main
SHA와 명시적 확인값으로 수동 실행한다. 성공한 Cloud Run SHA는 artifact로 기록되며
그 다음 main CI가 Pages 호환성을 다시 판정한다.

최초 리소스 생성, IAM, Secret, Cloud SQL 이전, 결제 프로토콜 전환, KMS 키 교체는
이 문서의 범위가 아니다. 해당 변경은
[`deploy/cloud-run/README.md`](../deploy/cloud-run/README.md)를 따른다. 특히 데이터,
IAM, 서비스 계정 또는 공유 리소스를 바꾸기 전에는 아래 조직 거버넌스 문서와
레지스트리를 먼저 확인하고 갱신한다. 서비스 계정 키는 만들지 않는다.

- `/Users/juneyoon/Desktop/Desktopped/finance-ax/docs/data-architecture/data-access-governance.md`
- `/Users/juneyoon/Desktop/Desktopped/finance-ax/governance/data_access_registry.json`

## 1. 대상과 배포 원칙

| 역할 | 배포 대상 | 이미지 또는 산출물 |
| --- | --- | --- |
| 브라우저 앱과 same-origin proxy | Cloudflare Pages `obolus` | `dist/`, `functions/api`, `functions/x402` |
| Rust API | Cloud Run `obolus-api` | `obolus/api` |
| x402 gateway | Cloud Run `obolus-gateway` | `obolus/gateway` |
| 결제·복구 worker | Cloud Run `obolus-orchestrator` | `obolus/orchestrator` |
| 보호된 Pay.sh front | Cloud Run `obolus-pay` | `obolus/pay` |

공통 위치는 GCP project `sweetspot-ax`, region `asia-northeast3`, Artifact
Registry repository `obolus`다. 프런트의 운영 주소는
`https://obolus-9qi.pages.dev`이며 브라우저는 Cloud Run URL 대신 상대 경로
`/api/*`, `/x402/*`만 사용한다.

릴리스에는 다음 원칙을 적용한다.

1. full commit SHA immutable tag로 이미지를 만들고 배포 시 tag가 아니라 해시 digest를 지정한다.
2. Cloud Run 후보는 `--no-traffic`으로 생성하고 정확한 revision만 승격한다.
3. `--to-latest`는 사용하지 않는다. 과거 gateway 서비스에 잘못된 이미지가 올라간
   이력이 있어 repository, service account, RPC, KMS 조건을 가드로 확인한다.
4. API의 자동 migration은 무트래픽 후보가 시작될 때도 실행된다. 기존 serving
   API와 하위 호환되지 않는 migration은 이 일상 배포 절차를 사용하지 않는다.
5. backend 변경이 있으면 Cloud Run 성공 marker 전에는 Pages를 배포하지 않는다.

## 2. CI/CD 자격증명과 실행 흐름

GitHub Actions는 장기 GCP 키를 저장하지 않는다. `obolus-deploy`는 GitHub OIDC를
Workload Identity Federation으로 교환하고, provider는 canonical repository의
`main`에서 production environment를 사용하는 `.github/workflows/deploy-cloud-run.yml`
job만 허용한다. Cloudflare job에는 `id-token: write`가 없고 GCP job에는 Cloudflare
secret이 없다. Cloud Build는
`obolus-build`를 명시적 실행 identity로 사용한다. 빌드 identity는 `obolus`
Artifact Registry write·Obolus 전용 Cloud Build source bucket read·로그 write만 갖고, Cloud Run·Secret·
KMS·DB 권한은 갖지 않는다. 배포 identity는 네 Cloud Run 서비스의 리소스 수준
`run.admin`, 정확한 runtime identity `actAs`, RPC Secret read만 갖는다. 두 서비스
계정 모두 사용자 관리 키가 0개여야 한다.

최초 한 번 조직 데이터 접근 거버넌스의 `obolus-deploy-cd`와 `obolus-build-cd`
consumer를 먼저 검토·등록한 뒤 멱등 setup을 실행한다.

```bash
./deploy/cloud-run/setup-cd.sh

gh variable set GCP_WIF_PROVIDER \
  --repo DanRo-AX/Obolus-GoogleCloudAI-Solana \
  --body 'projects/270739039690/locations/global/workloadIdentityPools/github-cd/providers/github'
gh variable set GCP_DEPLOY_SA \
  --repo DanRo-AX/Obolus-GoogleCloudAI-Solana \
  --body 'obolus-deploy@sweetspot-ax.iam.gserviceaccount.com'
gh variable set GCP_BUILD_SA \
  --repo DanRo-AX/Obolus-GoogleCloudAI-Solana \
  --body 'obolus-build@sweetspot-ax.iam.gserviceaccount.com'
gh variable set CLOUDFLARE_ACCOUNT_ID \
  --repo DanRo-AX/Obolus-GoogleCloudAI-Solana \
  --body 'c8b1012dce49cee27400734723c78c56'
```

저장소 관리자는 GitHub `production` environment를 만들고 required reviewer와
deployment branch `main`만 허용한다. 그다음 Cloudflare dashboard에서 대상 account
하나와 `Account → Cloudflare Pages → Edit`만 허용한 custom API token을 만든다. 채팅,
파일, shell history에 값을 적지 말고 아래 대화형 입력으로 environment secret에 바로
보낸다. repository secret으로 낮추지 않는다.

```bash
gh secret set CLOUDFLARE_API_TOKEN \
  --repo DanRo-AX/Obolus-GoogleCloudAI-Solana \
  --env production
```

main 자동 흐름은 `CI 6종 → tested-main 기록 → 마지막 Cloud Run 성공 SHA와 diff →
Pages credential 없는 bundle build → production 승인 → Cloudflare preflight → Pages`
다. backend 변경이 남아 있으면 Pages는 hold된다. 운영자는 GitHub Actions에서
`Release stateful Cloud Run services`를 current main full SHA와 확인값
`REVIEWED_SCHEMA_BACKLOG_AND_ROLLBACK`으로 실행한다. 해당 job은 immutable full-SHA
이미지 4개와 build provenance를 확인하고, 네 digest·revision 충돌을 전부 사전검사한
뒤에만 후보를 시작한다. 네 후보가 모두 readiness와 promotion guard를 통과하면
`api → pay → orchestrator → gateway` 순서로 승격한다. 중간 실패 시 네 서비스 트래픽을
기록한 known-good revision으로 되돌리고 candidate URL은 성공·실패 모두 제거한다.

Pages job은 OIDC 발급 권한이 없고 Cloud Run job은 Cloudflare token을 받지 않는다.
Pages token이 없거나 잘못되면 Cloudflare preflight에서 실패하며 현재 production Pages
deployment는 `pages-release-*` artifact에 기록된다. Cloud Run 성공 상태는
`cloud-run-success-*`, 시도·rollback 상태는 `cloud-run-attempt-*` artifact다.

후보 startup 자체가 DB migration과 reconciliation을 실행할 수 있으므로 수동 확인값은
형식적 승인이 아니다. 구·신 schema 호환성, payment/reconciliation backlog, rollback
revision을 실제로 검토해야 한다. 트래픽 rollback은 자동이지만 DB rollback, 결제 재전송,
불확실한 transaction 해제는 자동화하지 않는다.

## 3. 수동 배포 전 준비와 검증

배포는 별도 clean worktree 또는 clean clone에서 실행한다. 특히 Cloud Build의 Pay
이미지는 저장소 루트를 build context로 사용하므로, 커밋되지 않은 파일이 섞인
작업 디렉터리에서 제출하지 않는다.

필수 도구는 Node.js 24, npm, `rust-toolchain.toml`의 Rust 1.89, Google Cloud CLI,
`jq`, 저장소 lockfile의 Wrangler다. `npx wrangler`는 root `npm ci`로 설치된 버전을
사용한다. GCP active account와 Wrangler가 보여 주는 Cloudflare account가 이 운영
환경의 승인된 계정인지 운영자가 직접 확인한다. 아래 명령은 로그인 여부만 보여 주며
승인 권한까지 판정하지 않는다.

```bash
set -euo pipefail

test -z "$(git status --porcelain)"
git fetch origin
git switch main
git pull --ff-only origin main
test "$(git rev-parse HEAD)" = "$(git rev-parse origin/main)"
test -z "$(git status --porcelain)"

gcloud auth list --filter=status:ACTIVE
gcloud run services list \
  --project=sweetspot-ax \
  --region=asia-northeast3 \
  --filter='metadata.name~^obolus-' \
  --format='table(metadata.name,status.latestReadyRevisionName,status.url)'
npx wrangler whoami
npx wrangler pages project list
```

의존성을 lockfile 그대로 설치하고 전체 검사를 통과시킨다. 로컬 환경에 따라 약
15~30분이 걸린다.

```bash
set -euo pipefail

npm ci
npm ci --prefix payment-gateway
npm ci --prefix agent-orchestrator
npm run check:all
```

배포 직전에 현재 100% revision, digest와 Pages Production deployment를 파일로
기록한다. 이 파일은 rollback 기준이므로 저장소 밖의 접근 제한된 경로에 보관한다.
서비스별 100% revision이 정확히 하나가 아니면 스크립트가 중단된다.

```bash
set -euo pipefail

RELEASE="$(git rev-parse HEAD)"
RELEASE_STATE="${TMPDIR:-/tmp}/obolus-release-${RELEASE}"
mkdir -m 700 "${RELEASE_STATE}"

for service in obolus-api obolus-pay obolus-orchestrator obolus-gateway; do
  service_json="$(gcloud run services describe "${service}" \
    --project=sweetspot-ax \
    --region=asia-northeast3 \
    --format=json)"
  revision="$(jq -er '[.status.traffic[] | select(.percent == 100)] |
    if length == 1 and .[0].revisionName then .[0].revisionName else error("expected one 100% revision") end' \
    <<<"${service_json}")"
  digest="$(gcloud run revisions describe "${revision}" \
    --project=sweetspot-ax \
    --region=asia-northeast3 \
    --format='value(spec.containers[0].image)' | sed -n 's/.*@sha256://p')"
  [[ "${digest}" =~ ^[0-9a-f]{64}$ ]]
  jq -nc --arg service "${service}" --arg revision "${revision}" \
    --arg digest "sha256:${digest}" '{service:$service,revision:$revision,digest:$digest}'
done >"${RELEASE_STATE}/cloud-run-known-good.ndjson"

npx wrangler pages deployment list \
  --project-name=obolus \
  --environment=production \
  --json | jq -e '.[0] | select(.Environment == "Production")' \
  >"${RELEASE_STATE}/pages-known-good.json"

chmod 600 "${RELEASE_STATE}"/*
cat "${RELEASE_STATE}/cloud-run-known-good.ndjson"
jq '{Id,Environment,Branch,Source,Deployment}' "${RELEASE_STATE}/pages-known-good.json"
```

## 4. Cloud Run 이미지 빌드와 후보 배포

전체 스택 릴리스의 canonical build 파일은
[`deploy/cloud-run/cloudbuild-images.yaml`](../deploy/cloud-run/cloudbuild-images.yaml)이다.
`deploy/cloud-run/cloudbuild-web.yaml`은 과거 Cloud Run 프런트 rollback 전용이고,
`agent-orchestrator/cloudbuild.yaml`과 `pay/cloudbuild.yaml`은 이전 `openshelf-*`
서비스 기본값을 포함하므로 현재 운영 배포에 사용하지 않는다.

```bash
set -euo pipefail

PROJECT=sweetspot-ax
REGION=asia-northeast3
REPOSITORY=obolus
RELEASE="$(git rev-parse HEAD)"
TAG="release-${RELEASE}"
IMAGE_ROOT="${REGION}-docker.pkg.dev/${PROJECT}/${REPOSITORY}"

case "${RELEASE}" in
  ''|*[!0-9a-f]*) echo 'invalid release SHA' >&2; exit 1 ;;
esac
test "$(git rev-parse HEAD)" = "$(git rev-parse origin/main)"
test -z "$(git status --porcelain)"

# Upload 대상에 로컬 runtime 파일이나 secret이 섞이지 않는지 사람이 검토한다.
gcloud meta list-files-for-upload . >"${TMPDIR:-/tmp}/obolus-upload-${RELEASE}.txt"
if grep -E '(^|/)(\.env|\.secrets|\.omg|\.tmp|node_modules)(/|$)' \
  "${TMPDIR:-/tmp}/obolus-upload-${RELEASE}.txt"; then
  echo 'refusing unsafe Cloud Build upload set' >&2
  exit 1
fi

gcloud builds submit . \
  --project="${PROJECT}" \
  --region=global \
  --service-account="projects/${PROJECT}/serviceAccounts/obolus-build@${PROJECT}.iam.gserviceaccount.com" \
  --gcs-source-staging-dir="gs://sweetspot-ax-obolus-cloudbuild-source/source/${RELEASE}/manual-$(date -u +%Y%m%dT%H%M%SZ)" \
  --config=deploy/cloud-run/cloudbuild-images.yaml \
  --substitutions="_TAG=${TAG},_RELEASE_SHA=${RELEASE}"
```

빌드 후 첫 변경 전에 네 digest와 revision 충돌을 전부 검사한다. 아래 `gcloud run
deploy`는 기존 service 설정, Secret binding, Cloud SQL mount, service account를
그대로 둔 채 image만 바꾸는 기존 서비스 update다. 환경이나 IAM까지 바꿔야 한다면
중단하고 심화 Cloud Run 런북과 거버넌스 절차를 사용한다.

```bash
set -euo pipefail

PROJECT=sweetspot-ax
REGION=asia-northeast3
REPOSITORY=obolus
RELEASE="$(git rev-parse HEAD)"
TAG="release-${RELEASE}"
SUFFIX="${RELEASE:0:24}"
IMAGE_ROOT="${REGION}-docker.pkg.dev/${PROJECT}/${REPOSITORY}"
CANDIDATES="${TMPDIR:-/tmp}/obolus-candidates-${RELEASE}.ndjson"
: >"${CANDIDATES}"

# Read-only preflight: 네 서비스 모두 통과하기 전에는 Cloud Run을 변경하지 않는다.
for role in api pay orchestrator gateway; do
  image_json="$(gcloud artifacts docker images list "${IMAGE_ROOT}/${role}" \
    --project="${PROJECT}" \
    --include-tags \
    --filter="tags:${TAG}" \
    --format=json \
    --limit=2)"
  digest="$(jq -er --arg tag "${TAG}" '
    [.[] | select((.tags // []) | index($tag))] |
    if length == 1 and (.[0].version | test("^sha256:[0-9a-f]{64}$"))
    then .[0].version else error("missing or ambiguous exact tag") end' <<<"${image_json}")"
  revision="obolus-${role}-rel-${SUFFIX}"
  if gcloud run revisions describe "${revision}" \
    --project="${PROJECT}" --region="${REGION}" --format='value(metadata.name)' \
    >/dev/null 2>&1; then
    echo "revision already exists; inspect before retry: ${revision}" >&2
    exit 1
  fi
  jq -nc --arg role "${role}" --arg digest "${digest}" \
    --arg revision "${revision}" '{role:$role,digest:$digest,revision:$revision}' \
    >>"${CANDIDATES}"
done

test "$(wc -l <"${CANDIDATES}" | tr -d ' ')" = 4
chmod 600 "${CANDIDATES}"
cat "${CANDIDATES}"

# Stateful step: API 후보는 startup migration을 실행할 수 있다.
while IFS= read -r candidate; do
  role="$(jq -er '.role' <<<"${candidate}")"
  digest="$(jq -er '.digest' <<<"${candidate}")"
gcloud run services update "obolus-${role}" \
    --project="${PROJECT}" \
    --region="${REGION}" \
    --image="${IMAGE_ROOT}/${role}@${digest}" \
    --revision-suffix="rel-${SUFFIX}" \
    --update-labels="release-sha=${RELEASE}" \
    --tag="cand-${RELEASE:0:20}" \
    --no-traffic
done <"${CANDIDATES}"
```

같은 commit의 revision이 이미 존재하면 preflight가 변경 전에 중단한다. 다른 suffix로
중복 배포하지 말고 기존 revision의 digest와 상태를 조사한다. 후보 URL은 문자열로
추측하지 말고 service 상태에서 읽는다. candidate tag는 직접 접근 URL을 만들므로
테스트 중에만 유지하고 승격 후 제거한다.

```bash
set -euo pipefail

RELEASE="$(git rev-parse HEAD)"
CANDIDATE_TAG="cand-${RELEASE:0:20}"
CANDIDATE_URLS="${TMPDIR:-/tmp}/obolus-candidate-urls-${RELEASE}.ndjson"
: >"${CANDIDATE_URLS}"

for service in obolus-api obolus-pay obolus-orchestrator obolus-gateway; do
  row="$(gcloud run services describe "${service}" \
    --project=sweetspot-ax \
    --region=asia-northeast3 \
    --format=json |
    jq -cer --arg service "${service}" --arg tag "${CANDIDATE_TAG}" '
      [.status.traffic[] | select(.tag == $tag)] |
      if length == 1 and .[0].revisionName and .[0].url
      then {service:$service,revision:.[0].revisionName,url:.[0].url}
      else error("expected one candidate tag") end')"
  printf '%s\n' "${row}" >>"${CANDIDATE_URLS}"
done

test "$(wc -l <"${CANDIDATE_URLS}" | tr -d ' ')" = 4
chmod 600 "${CANDIDATE_URLS}"
cat "${CANDIDATE_URLS}"
```

후보에서 API, gateway, orchestrator의 `/readyz`는 `200`과 `status=ready`여야 한다.
Pay의 `/__402/health`는 토큰 없는 공개 요청에 의도적으로 `404`여야 한다. 서비스가
인증을 요구하면 `gcloud run services proxy SERVICE --tag="${CANDIDATE_TAG}"`로 로컬
proxy를 열어 같은 검사를 한다. Pay의 `404`만으로 올바른 이미지임을 증명할 수 없으므로
아래 promotion guard까지 함께 통과해야 한다.

```bash
set -euo pipefail

CANDIDATE_URLS="${TMPDIR:-/tmp}/obolus-candidate-urls-$(git rev-parse HEAD).ndjson"
for service in obolus-api obolus-gateway obolus-orchestrator; do
  url="$(jq -er --arg service "${service}" 'select(.service == $service) | .url' \
    "${CANDIDATE_URLS}")"
  curl -fsS "${url}/readyz" | jq -e '.status == "ready"'
done

pay_url="$(jq -er 'select(.service == "obolus-pay") | .url' "${CANDIDATE_URLS}")"
test "$(curl -sS -o /dev/null -w '%{http_code}' "${pay_url}/__402/health")" = 404
```

후보 배포가 중간에 실패하면 serving traffic은 건드리지 않는다. 이미 생긴 후보의
candidate tag는 아래 `--remove-tags` 형식으로 제거하고, API migration과
orchestrator reconciliation 로그를 먼저 확인한 뒤 같은 revision을 재사용할지 새
commit으로 다시 시작할지 결정한다. revision을 즉석에서 삭제하거나 새 suffix로
우회하지 않는다.

후보 orchestrator는 시작 즉시 운영 reconciliation backlog를 처리할 수 있고, API
후보는 startup migration을 실행할 수 있다. 따라서 schema가 구·신 API에 모두 호환되고
현재 결제·reconciliation backlog가 정상이라는 운영 콘솔 확인 없이는 후보를 만들지
않는다. 결제를 발생시키는 smoke는 승인된 저액 Devnet 시나리오와 idempotency key,
기대 receipt, cleanup 방법이 준비된 경우에만 수행한다. 이 저장소의 일반 자동 명령이
아니며, 임의 질문이나 실고객 데이터로 즉석 실행하지 않는다.

정확한 revision과 digest를 role별 가드에 넣는다. 이 가드는 읽기 전용이며 트래픽을
바꾸지 않는다. 네 role이 모두 통과한 뒤 출력된 `--to-revisions=...=100` 명령만
검토해 실행한다. 전체 릴리스의 승격 순서는 `api → pay → orchestrator → gateway`다.

```bash
npm run finalist:guard-promotion -- \
  --project sweetspot-ax \
  --region asia-northeast3 \
  --role api \
  --revision obolus-api-rel-RELEASE \
  --expected-digest sha256:64자리_DIGEST
```

위 명령을 `pay`, `orchestrator`, `gateway`에도 반복한다. `RELEASE`와 digest는 실제
값으로 치환한다. 절대로 `--to-latest`로 줄이지 않는다. 한 단계 승격 후 stable URL의
readiness, Cloud Run serving revision, 관리자 운영 콘솔의 settlement·reconciliation
상태를 확인하고 다음 단계로 간다. 중간 단계가 실패하면 이후 서비스를 승격하지 않고
known-good revision으로 되돌린다. 네 서비스 승격 후 candidate tag를 제거한다.

```bash
set -euo pipefail

RELEASE="$(git rev-parse HEAD)"
for service in obolus-api obolus-pay obolus-orchestrator obolus-gateway; do
  gcloud run services update-traffic "${service}" \
    --project=sweetspot-ax \
    --region=asia-northeast3 \
    --remove-tags="cand-${RELEASE:0:20}"
done
```

## 5. Pages 배포와 출시 확인

Cloud Run 승격 및 same-origin API smoke가 끝난 뒤 Pages를 배포한다.
[`wrangler.jsonc`](../wrangler.jsonc)의 `API_ORIGIN`, `GATEWAY_ORIGIN`은 비밀이 아닌
안정된 Cloud Run service URL이어야 한다. 사용자 키, 내부 토큰, 결제 credential은
`wrangler.jsonc`나 `VITE_*` 변수에 넣지 않는다.

```bash
set -euo pipefail

npm run typecheck:pages
npm run build:pages
npm run verify:pages-bundle
npx wrangler pages deploy dist \
  --project-name=obolus \
  --branch=main \
  --commit-hash="$(git rev-parse HEAD)"
```

배포 결과가 Production, `main`, 현재 commit인지 확인하고 공개 경계를 다시 검사한다.
Pages root만이 아니라 same-origin `/api` 경로가 API의 인증 응답을 그대로 전달하는지
확인한다.

```bash
set -euo pipefail

npx wrangler pages deployment list \
  --project-name=obolus \
  --environment=production

curl -fsS https://obolus-api-amjeodet3q-du.a.run.app/readyz | jq -e '.status == "ready"'
curl -fsS https://obolus-gateway-amjeodet3q-du.a.run.app/readyz | jq -e '.status == "ready"'
curl -fsS https://obolus-orchestrator-amjeodet3q-du.a.run.app/readyz | jq -e '.status == "ready"'
test "$(curl -sS -o /dev/null -w '%{http_code}' \
  https://obolus-pay-amjeodet3q-du.a.run.app/__402/health)" = 404
curl -fsSI https://obolus-9qi.pages.dev/

AUTH_CHECK="${TMPDIR:-/tmp}/obolus-pages-auth-me.json"
test "$(curl -sS -o "${AUTH_CHECK}" -w '%{http_code}' \
  https://obolus-9qi.pages.dev/api/v1/auth/me)" = 401
jq -e '.error.code == "unauthorized"' "${AUTH_CHECK}"

CANDIDATES="${TMPDIR:-/tmp}/obolus-candidates-$(git rev-parse HEAD).ndjson"
VERIFY_ARGS=()
while IFS= read -r candidate; do
  VERIFY_ARGS+=(--expected-digest "$(jq -er '.role + "=" + .digest' <<<"${candidate}")")
done <"${CANDIDATES}"
test "${#VERIFY_ARGS[@]}" = 4
npm run finalist:verify-infra -- "${VERIFY_ARGS[@]}"
```

마지막으로 Pages 주소에서 지갑 로그인, 검색, HIT 또는 Open Call의 실제 대상 경로,
결제 복구를 확인한다. 인프라 보고서는 생성 여부가 아니라 exit code `0`과
`summary.ready=true`를 확인한다.

발표용 evidence를 변경한 릴리스라면
[`docs/FINALIST-EVIDENCE-RUNBOOK.ko.md`](FINALIST-EVIDENCE-RUNBOOK.ko.md)에 따라
실행 증거를 새 serving revision과 다시 연결한 후 `npm run pitch:verify-live`를
통과시킨다. 이 검사는 현재 evidence가 오래되었거나 실제 provider 로그와 연결되지
않으면 실패하는 것이 정상이다. 실패한 상태에서 라이브 준비 완료를 주장하지 않는다.

## 6. Rollback과 중단 조건

Cloud Run rollback은 배포 전에 기록한 known-good revision으로 트래픽만 되돌린다.
전체 스택 rollback도 현재 계약에 따라 API부터 처리하며, 각 단계에서 settlement와
recovery backlog가 늘지 않는지 확인한다. 아래 placeholder를 추측하지 말고
`cloud-run-known-good.ndjson`에 기록된 정확한 값을 사용한다.

```bash
set -euo pipefail

gcloud run services update-traffic obolus-api \
  --project=sweetspot-ax \
  --region=asia-northeast3 \
  --to-revisions=KNOWN_GOOD_API_REVISION=100
```

같은 exact-revision 형식으로 `obolus-pay`, `obolus-orchestrator`,
`obolus-gateway`를 처리한다. 외부 Solana 전송과 이미 수납된 결제는 코드 rollback으로
취소되지 않으므로, 불확실한 attempt를 재서명하거나 재결제하지 말고 reconciliation
상태로 남겨 조사한다.

Pages는 Cloudflare dashboard의 `Workers & Pages → obolus → Deployments`에서 이전의
성공한 Production 배포를 골라 **Rollback to this deployment**를 실행한다. Preview
배포는 rollback 대상이 아니다. 배포 전에 저장한 `pages-known-good.json`의 `Id`와
`Source`를 대조하고 선택한다. 배포 목록은 아래 명령으로 먼저 확인한다.

```bash
set -euo pipefail

npx wrangler pages deployment list \
  --project-name=obolus \
  --environment=production
```

다음 상황에서는 일반 rollback을 계속하지 않고 사고 대응으로 전환한다.

- migration이 이전 binary와 하위 호환되지 않는다.
- 결제 수납, payout, refund 또는 reconciliation 상태가 불명확하다.
- Cloud SQL 데이터 손상이나 유실이 의심된다.
- RPC 두 곳의 finalized 결과가 일치하지 않는다.
- KMS signer 또는 service account 경계가 예상과 다르다.

Cloud SQL은 애플리케이션 트래픽과 함께 자동 rollback하지 않는다. PITR은 결제 fence를
지워 온체인 전송을 없는 것처럼 보이게 할 수 있으므로, 모든 결제 ingress와 worker를
중지·drain하고 체인 및 Pay.sh receipt와 대조하는 별도 데이터 사고 절차로만 수행한다.

참고 문서:

- [Cloud Run revision과 무트래픽 배포](https://cloud.google.com/run/docs/managing/revisions)
- [Cloud Run rollback과 traffic migration](https://cloud.google.com/run/docs/rollouts-rollbacks-traffic-migration)
- [Cloudflare Pages Wrangler 설정](https://developers.cloudflare.com/pages/functions/wrangler-configuration/)
- [Cloudflare Pages Direct Upload CI](https://developers.cloudflare.com/pages/how-to/use-direct-upload-with-continuous-integration/)
- [Cloud Build 사용자 지정 서비스 계정](https://cloud.google.com/build/docs/securing-builds/configure-user-specified-service-accounts)
- [Cloudflare Pages rollback](https://developers.cloudflare.com/pages/configuration/rollbacks/)
