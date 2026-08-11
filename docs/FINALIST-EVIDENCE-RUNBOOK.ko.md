# 결선 인프라·AI·Devnet 증거 실행 가이드

이 도구들은 배포나 트래픽을 바꾸지 않는다. 현재 서빙 중인 Cloud Run 리비전과
운영 리소스를 읽어서 결선 시연 전에 반드시 만족해야 할 조건을 **실패 폐쇄**
방식으로 검사한다. 실제 AI trace와 Devnet 실행 결과는 질문 원문·유료 passage·
세션 capability·RPC URL·개인키 없이 제출 가능한 JSON으로 정리한다. JSON은
재현 가능한 판정 기록이지 외부 시스템의 서명된 증명은 아니므로, 마지막 절의
독립 provenance 확인과 함께 사용한다.

## 1. 단위 테스트

```bash
npm run test:finalist-evidence
```

다음 회귀를 자동으로 막는다.

- `obolus-gateway`의 최신 리비전에 `obolus/pay` 이미지가 잘못 배치되는 문제
- 서빙 리비전이 전용 서비스 계정 대신 공유 계정을 사용하는 문제
- 결제 최종성을 한 RPC에서만 확인하는 문제
- 결제 재시도에서 중복 정산이 생기거나, 환불 증거가 없는 실행을 완료로 표시하는 문제
- AI trace가 실제 Vertex function call 없이 fallback인데도 라이브 자율성 증거로 표시되는 문제
- AI가 결제·본문 열람 도구를 선택하거나 사용자 승인 경계를 건너는 문제
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

## 4. 실제 AI 자율성 실행 증거 기록

로그인한 지갑 세션에서 현재 서빙 origin의 `/api/v1/questions/resolve`를 한 번
실행한다. 브라우저 개발자 도구의 Network 패널에서 응답 JSON을 다른 사용자가
읽을 수 없는 임시 디렉터리에 저장하고 파일 권한을 `0600`으로 제한한다. 익명
요청은 비용 통제를 위해 Vertex를 호출하지 않으므로 라이브 자율성 증거가 될 수
없다. 원본에는 `paymentAccessToken`이 있을 수 있으므로 레코더 성공 직후 폐기한다.

```bash
npm run finalist:record-autonomy -- \
  --input /secure-runtime-output/resolve-response.json \
  --output artifacts/finalist-evidence/autonomy.json \
  --project sweetspot-ax
```

레코더는 다음을 실패 폐쇄 방식으로 확인한다.

- `gemini-*` 모델의 검색 전·후 provider-backed 함수 호출 2회 mode와 deterministic guard
- `research_planner → retrieval_agent → coverage_agent`의 순서 있는 3단계 trace
- 검색·랭킹·구매 제안·hybrid·Open Call·무료 baseline·무구매 종료만 허용하는 비결제 tool allowlist
- HIT/PARTIAL/MISS 관찰 결과와 다음 행동의 일치
- 최대 20개인 사용자 문서 수 한도와 선택 개수
- 구매·hybrid·Open Call이 `awaiting_user_approval`에서 멈추는지
- HIT의 선택 문서 수와 exact KRW quote의 일치

출력에는 query/run ID, 모델, mode, 역할·도구·상태, 개수와 quote 합계만 남는다.
질문, 검색 handle, paid passage, step summary, prompt/model response,
`paymentAccessToken`, cookie는 복사하지 않는다. 모든 항목을 만족해야
`summary.ready=true`가 된다. CLI는 기존 출력을 `0600` 임시 파일로 쓴 뒤 원자적으로
교체하고, input과 output이 같으면 거부한다. exit `0`은 schema-ready, exit `1`은
보고서 생성 후 gate 실패, exit `2`는 입력·변환·쓰기 오류다.

`autonomy.json`은 API 응답뿐 아니라 같은 run ID·query ID·API revision을 가진 Cloud
Run application log를 `gcloud logging read`로 조회해 v2 provenance에 묶는다. 이는
배포 run 상관관계는 강화하지만 독립 Vertex Data Access audit 자체는 아니다. 최종
시연에는 가능하면 같은 시각의 Vertex 감사 또는 요청 로그도 함께 제시하며, 없으면
“Cloud Run 배포 run과 두 provider success를 연결했다”까지만 주장한다.

## 5. 실제 Devnet 실행 증거 기록

Hosted E2E는 저장소의 fixture나 하드코딩 1인칭 답변을 제출하지 않는다. `--run` 전에
실제 작성자가 전용 임시 state directory 안에 mode `0600` JSON을 만들고 다음 필드를
직접 채운다.

- 실제 `question`, `shelf`, 지원 category·filter, hosted Pay.sh price band, refund를 남길 `target >= 2`
- 작성자 본인의 demographic band profile과 지원 분야
- 80자 이상의 사실 기반 `answer`와 1~4개 `interviewResponses`
- 운영자가 작성자의 사실성 확인을 받았다고 선언하는 `authorAttestation: true`
- 운영자가 Devnet 유료 열람·저장·인덱싱·발표 사용 동의를 받았다고 선언하는 `usageConsent: true`

파일이 state directory 밖에 있거나 symlink·권한 과다·선언 누락·지원하지 않는 band면
스크립트는 자금 이동 전에 실패한다. 그러나 이 두 boolean은 작성자 신원이나 서명을
암호학적으로 증명하지 않는다. 실제 발표에서는 별도의 서명된 작성자 허가 기록과
본문 version hash를 보관하고, 그것이 없으면 consented live inventory로 세지 않는다.

```bash
finalist_state_dir="$(mktemp -d -t obolus-finalist.XXXXXXXX)"
chmod 700 "$finalist_state_dir"
npm run finalist:hosted-devnet -- --prepare --state-dir "$finalist_state_dir"

# 작성자가 $finalist_state_dir/contribution.json을 직접 작성하고 사실성·사용 동의를 확인
chmod 600 "$finalist_state_dir/contribution.json"
npm run finalist:hosted-devnet -- --run \
  --state-dir "$finalist_state_dir" \
  --contribution-file "$finalist_state_dir/contribution.json"
```

먼저 기존 E2E/운영 콘솔에서 실제 실행 결과를 JSON으로 내보낸다. 입력 구조 예시는
[`scripts/fixtures/finalist-devnet-run.example.json`](../scripts/fixtures/finalist-devnet-run.example.json)에
있다. 예시의 signature는 형식 테스트용이며 실제 거래 증거가 아니다.

필수 입력:

- `network`, `runId`, `activityKind=open_call_lifecycle`, `activityId`, `activityStatus=cancelled_refunded`
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

- Open Call activity와 quote의 비민감 식별자·상태
- atomic amount와 Devnet USDC mint
- transaction signature와 자동 생성된 Solana Explorer Devnet URL
- owner/payer token delta
- finality provider 수, retry 수, duplicate settlement 수
- refund receipt

질문, 인터뷰 응답, paid passage, API 응답 본문, RPC URL, Secret 이름·값, wallet
private key는 allowlist 밖이므로 출력에 포함되지 않는다. 모든 항목을 갖춰야
`summary.ready=true`가 된다.

`devnet.json`도 운영 입력을 allowlist로 직렬화한 기록이지 체인 자체의 서명된
attestation은 아니다. 제출 직전 각 Explorer URL을 열고, 서로 다른 두 RPC
origin에서 같은 finalized transaction bytes와 mint·amount·recipient를 다시
조회한다. 이 독립 재조회가 없으면 실제 온체인 결제는 미검증 blocker로 표시한다.

## 6. 결선 제출 직전 판정

다음 세 파일이 모두 최신 schema의 `summary.ready=true`여야 한다. 인프라와 autonomy는
같은 API serving revision에 연결되고 세 파일은 24시간 이내에 생성되며 생성 시각
범위가 2시간 이내여야 한다. Devnet 파일은 별도의 Open Call lifecycle capability다.

- `infrastructure.json`: 현재 서빙 revision과 GCP 안전 경계
- `autonomy.json`: 로그인된 실제 질문의 Vertex 함수 호출 1 → Rust 검색 → Vertex 함수 호출 2·3단계 역할 trace·승인 경계·Cloud Run log provenance
- `devnet.json`: 실제 Open Call의 funding → 한 답변 payout → 미사용액 refund, exact mint·quote/transaction delta·2-RPC finality·중복 방지 receipt bundle

Explorer URL, Cloud Run revision/digest, 소유자 잔액 증가, 중복 지급 0을 데모 화면에
함께 보여준다. 이 세 gate만으로 HIT 구매·인용 합성까지 한 run으로 증명했다고 말하지
않는다. 그 주장은 별도 consented document로 resolve → quote → open → payout → paid-only
synthesis를 연결한 통합 run bundle이 있을 때만 허용한다. 예시 fixture, sandbox 영수증,
서빙하지 않는 tagged revision은 실제 운영 증거로 사용하지 않는다.
