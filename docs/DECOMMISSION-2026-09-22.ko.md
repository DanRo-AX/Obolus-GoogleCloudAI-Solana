# Obolus 운영 중단 기록 (2026-09-22)

## 결정

Obolus/OpenShelf의 운영 리소스를 전부 폐기한다. 이 결정에는 Cloud Run, Cloudflare
Pages, 대기열, 런타임 데이터베이스와 그 전용 자격증명·빌드 산출물·암호화 키가
포함된다. 공유 `ax-apps-db` 인스턴스 자체와 공유 `ax-apps-storage` 버킷의 Obolus
외 경로는 유지한다.

## 중단 사유와 관측

2026-08-23부터 2026-09-22까지 `obolus-api`는 Cloud Run 요청 4,610,247건을
기록했다. Cloudflare Pages의 같은 기간 웹 요청 약 15,000건과 비교해 이 수치는
사용자 웹 트래픽이 아니었다.

Cloud Run 요청 로그에서는 `node` 프로세스가 아래 내부 경로를 반복 호출한 사실을
확인했다.

- `/internal/v1/research-jobs/runnable`
- `/internal/v1/payout-claims/backlog`
- `/internal/v1/payout-claims/lease`
- `/internal/v1/*payment-attempts/reconciliation`

`obolus-orchestrator`의 `OPENSHELF_RESEARCH_POLL_MS`는 10,000ms였고, API·gateway·orchestrator·pay는 최소 인스턴스 1대를 유지했다. gateway와 orchestrator는 유휴 CPU도 계속 할당했다. 또한 과거 `rel-*` 및 `e2e-*` 태그 리비전이 API URL을 계속 수신하고 있었다.

## 폐기 범위

- Cloud Run: `obolus-api`, `obolus-gateway`, `obolus-orchestrator`, `obolus-pay`, `obolus-web`
- Cloudflare Pages: `obolus` (`obolus-9qi.pages.dev`)
- Cloud Tasks: `obolus-settlements`
- Cloud SQL: 공유 인스턴스 `ax-apps-db`의 전용 `obolus` 데이터베이스
- Artifact Registry `obolus`, 전용 Cloud Build 소스 버킷, Obolus 감사 로그 prefix
- Obolus 전용 Secret, 서비스 계정, KMS 키 버전 및 배포용 Workload Identity 권한

## 결과

2026-09-22에 다음 제거를 완료했다.

- Cloud Run 5개 서비스와 모든 이전 리비전·태그 URL
- Cloudflare Pages `obolus` 프로젝트
- `obolus-settlements` Cloud Tasks 큐
- 공유 `ax-apps-db` 인스턴스의 `obolus` 데이터베이스
- Artifact Registry `obolus`과 전용 Cloud Build source 버킷
- `gs://ax-apps-storage/obolus/` 감사 경로의 held object
- Obolus 전용 Secret 7개, 서비스 계정 7개, GitHub Workload Identity provider
- `solana-service-wallet` KMS 키 버전 1: 비활성화 후 파기 예약

Cloud Run·Pages·대기열·데이터베이스·이미지 저장소·Secret·서비스 계정·감사 경로가
조회에서 사라진 것을 재확인했다. KMS 키 버전은 복구 유예 기간 뒤 영구 파기된다.
