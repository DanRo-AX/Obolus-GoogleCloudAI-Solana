# 결선 인프라·Devnet 증거 실행 가이드

이 도구들은 배포나 트래픽을 바꾸지 않는다. 현재 서빙 중인 Cloud Run 리비전과
운영 리소스를 읽어서 결선 시연 전에 반드시 만족해야 할 조건을 **실패 폐쇄**
방식으로 검사하고, Devnet 실행 결과를 질문 원문·유료 passage·RPC URL·개인키 없이
제출 가능한 JSON으로 정리한다.

## 1. 단위 테스트

```bash
npm run test:finalist-evidence
```

다음 회귀를 자동으로 막는다.

- `obolus-gateway`의 최신 리비전에 `obolus/pay` 이미지가 잘못 배치되는 문제
- 서빙 리비전이 전용 서비스 계정 대신 공유 계정을 사용하는 문제
- 결제 최종성을 한 RPC에서만 확인하는 문제
- 결제 재시도에서 중복 정산이 생기거나, 환불 증거가 없는 실행을 완료로 표시하는 문제
- 질문 원문, 유료 passage, private key 같은 민감 필드가 제출용 evidence에 복사되는 문제

## 2. 현재 GCP 운영 상태 검증

실행 계정에는 Cloud Run·Cloud SQL·Cloud Tasks·KMS 조회 권한과 RPC Secret의
payload를 읽을 권한이 필요하다. Secret payload는 프로세스 메모리에서 두 RPC의
서로 다른 origin 수만 계산한 뒤 폐기하며 JSON에는 이름, URL, hash를 기록하지 않는다.

```bash
mkdir -p artifacts/finalist-evidence
npm run finalist:verify-infra -- \
  --project sweetspot-ax \
  --region asia-northeast3 \
  --output artifacts/finalist-evidence/infrastructure.json
```

검사 범위:

- 현재 **실제 100% 트래픽**을 받는 revision ID, digest, service account
- `latestReadyRevision`까지 각 서비스의 올바른 이미지 repository인지
- API `/readyz`, gateway `/readyz`, orchestrator `/readyz`가 `200 + status=ready`인지
- Pay.sh collector health가 public front에서 `404`로 차단되는지
- API가 `ax-apps-db` Cloud SQL을 mount하고 DB URL을 Secret Manager에서 받는지
- PostgreSQL 16, backup, PITR, 보존 기간, 암호화 강제 여부
- Cloud Tasks settlement queue의 상태, dispatch 한도, retry 기간
- gateway의 x402/Pay.sh 및 orchestrator의 Pay.sh finality가 각각 2개 이상의 독립 RPC origin을 사용하는지
- KMS asymmetric signing key와 전용 signer service account

하나라도 충족하지 못하면 보고서를 먼저 작성한 뒤 exit code `1`로 종료한다. 따라서
보고서가 생성됐다는 사실만으로 준비 완료가 아니다. `summary.ready=true`를 확인해야 한다.

릴리스 후보 digest까지 고정하려면 role별로 반복해서 넘긴다.

```bash
npm run finalist:verify-infra -- \
  --expected-digest api=0123...64자리...cdef \
  --expected-digest gateway=0123...64자리...cdef \
  --expected-digest orchestrator=0123...64자리...cdef \
  --expected-digest pay=0123...64자리...cdef
```

## 3. Cloud Run 트래픽 승격 전 가드

`--to-latest`를 사용하지 않는다. 먼저 승격할 정확한 revision을 가드에 통과시킨다.

```bash
npm run finalist:guard-promotion -- \
  --project sweetspot-ax \
  --region asia-northeast3 \
  --role gateway \
  --revision obolus-gateway-REVISION \
  --expected-digest 0123...64자리...cdef
```

이 명령은 트래픽을 변경하지 않는다. 이미지 repository, revision 소속 서비스,
Ready 상태, 전용 서비스 계정, 2중 RPC를 확인한 뒤에만 다음과 같이 revision을 정확히
지정한 수동 명령을 출력한다.

```text
gcloud run services update-traffic obolus-gateway ... --to-revisions=obolus-gateway-REVISION=100
```

특히 `obolus-gateway` revision이 `obolus/pay` 이미지를 가리키면 무조건 거부한다.

## 4. 실제 Devnet 실행 증거 기록

먼저 기존 E2E/운영 콘솔에서 실제 실행 결과를 JSON으로 내보낸다. 입력 구조 예시는
[`scripts/fixtures/finalist-devnet-run.example.json`](../scripts/fixtures/finalist-devnet-run.example.json)에
있다. 예시의 signature는 형식 테스트용이며 실제 거래 증거가 아니다.

필수 입력:

- `network`, `runId`, `queryId`, `jobId`, `jobStatus`
- 각 quote의 `id`, `kind`, `status`, `amountAtomic`, Devnet USDC `asset`
- 각 거래의 `signature`, 연결된 `quoteIds`, `status=finalized`
- 두 RPC에서 동일 거래를 재현한 수 `finalityProviderCount >= 2`
- 데이터 소유자 USDC 증가량 `ownerDeltaAtomic > 0`
- 같은 job retry 횟수와 `duplicateSettlementCount=0`
- 사용하지 않은 예약 또는 실패분의 refund claim, signature, amount, 2-RPC finality

```bash
npm run finalist:record-devnet -- \
  --input /secure-runtime-output/finalist-run.json \
  --output artifacts/finalist-evidence/devnet.json
```

출력에는 다음만 남는다.

- query/job/quote의 비민감 식별자와 상태
- atomic amount와 Devnet USDC mint
- transaction signature와 자동 생성된 Solana Explorer Devnet URL
- owner/payer token delta
- finality provider 수, retry 수, duplicate settlement 수
- refund receipt

질문, 인터뷰 응답, paid passage, API 응답 본문, RPC URL, Secret 이름·값, wallet
private key는 allowlist 밖이므로 출력에 포함되지 않는다. 모든 항목을 갖춰야
`summary.ready=true`가 된다.

## 5. 결선 제출 직전 판정

다음 두 파일이 모두 `summary.ready=true`여야 “프로덕션 구조와 실제 Devnet 결제를
검증했다”고 표현할 수 있다.

- `infrastructure.json`: 현재 서빙 revision과 GCP 안전 경계
- `devnet.json`: 실제 질문에서 지급·finality·중복 방지·refund까지 이어진 receipt bundle

Explorer URL, Cloud Run revision/digest, 소유자 잔액 증가, 중복 지급 0을 데모 화면에
함께 보여준다. 예시 fixture, sandbox 영수증, 서빙하지 않는 tagged revision은 실제
운영 증거로 사용하지 않는다.
