# Obulus 대화 내역 및 작업 인계 문서

- 내보낸 날짜: 2026-08-11
- 저장소: `/Users/yuchanlee/openshelf`
- 현재 브랜치: `main`
- 문서 목적: 지금까지의 요청, 제품 의도, 주요 결정, 구현 상태와 남은 작업을 다음 작업 세션에서 그대로 이어가기 위한 대화 내역 정리

> 이 문서는 채팅 서비스의 원시 로그 파일이 아니라, 현재 세션에서 확인 가능한 대화와 작업 결과를 시간순으로 재구성한 구조화된 내보내기다. 반복된 화면 피드백은 최종 요구사항 중심으로 통합했다.

## 1. 제품명과 핵심 정의

기존 제품명 `OPENSHELF`는 `Obulus`로 변경되었다. 기존 코드와 문서에 남은 `OPENSHELF`, `SHELF-1`은 리브랜딩 잔여 항목이다.

Obulus의 핵심 정의는 다음과 같다.

> Obulus는 실제 사람이 제공한 경험 데이터를 개인별 메모리 DB로 축적하고, AI 에이전트가 질문에 필요한 인간 DB를 검색한 뒤 실제로 연 근거에만 마이크로페이먼트를 실행하는 인간 경험 검색·결제 네트워크다.

제품을 다음과 같이 설명하면 안 된다.

- 단순 설문조사 앱
- 합성 페르소나 생성기
- 사람을 복제하는 AI
- 개인정보를 무단 판매하는 플랫폼
- ChatGPT에 코인 결제를 붙인 서비스
- 모든 데이터를 블록체인에 저장하는 서비스

제품이 제공하려는 새로운 생태계는 다음과 같다.

1. 범용 LLM이 알 수 없는 지역별·직군별·도메인별 실제 경험을 검색한다.
2. 한 사람의 응답이 메모리 로직에 따라 장기 DB로 축적된다.
3. 다음 질문에서 같은 경험이 다시 필요하면 원문 근거를 재사용한다.
4. 실제로 근거가 열릴 때마다 데이터 소유자에게 보상한다.
5. 기존 DB에 근거가 부족하면 Open Call을 열어 필요한 사람과 새로운 데이터를 모집한다.
6. 수요가 새로운 공급을 만들고, 새 데이터가 다음 검색의 정확도와 커버리지를 높인다.

## 2. 제품이 해결하는 문제

사용자가 반복해서 강조한 문제의식은 다음과 같다.

- Simile과 같은 소셜 월드모델 기업들은 실제 사람의 설문·인터뷰 데이터를 비싼 비용으로 수집한다.
- 이 데이터는 집단의 선택과 반응을 학습·검증하고 소셜 월드모델을 만드는 데 사용된다.
- 기존 구조에서는 중앙 기업이 수집비와 반복 사용 가치를 대부분 보유한다.
- 응답자는 한 번 답하고 한 번만 보상받는다.
- 동일하거나 유사한 질문이 생길 때마다 새로운 패널을 다시 모집한다.
- 일반 LLM은 공개 웹에 없는 최신 지역 선호, 실제 선택, 가격, 실패 경험과 같은 firsthand evidence를 알기 어렵다.
- 합성 페르소나는 평균적인 답을 만들 수 있지만 실제 사람의 모순, 구체적 사건, 시간에 따른 변화를 보존하기 어렵다.

Obulus의 중요한 사업적 전환은 다음과 같다.

```text
일회성 설문 노동
→ 동의와 버전을 가진 인간 경험 문서
→ 개인 메모리 DB에 축적
→ 질문별 검색·랭킹
→ 유료 열람
→ 데이터 소유자 반복 수익
```

## 3. 핵심 사용자 흐름

### 인간 근거가 이미 있는 경우

```text
사용자가 자연어 질문
→ 지역·대상·분야·최신성·예산 구조화
→ 공개 가능한 메타데이터 무료 검색
→ 관련성·신뢰도·최신성·다양성·가격으로 랭킹
→ 최소 독립 근거 집합 선택
→ 정확한 총액 제시
→ 제한된 예산 승인
→ 문서별 x402/MPP 결제
→ 결제된 passage만 공개
→ Gemini가 인용과 함께 합성
→ 데이터 소유자에게 USDC 정산
```

핵심 경제 원칙은 다음과 같다.

> 검색과 비교는 무료이며, 실제 인간 원문을 열 때만 지불한다.

### 인간 근거가 부족한 경우

```text
검색 결과 부족
→ 부족한 대상·인원·경험 조건 식별
→ 구매자가 보상과 마감을 설정한 Open Call 게시
→ 적합한 사람들이 참여
→ 인터뷰 에이전트가 구체적인 경험을 묻는 후속 질문
→ 품질을 통과한 답변 채택 및 보상
→ 개인 메모리 DB에 적재
→ 현재 질문 해결
→ 이후 유사 질문에서 다시 검색·정산
```

검색 MISS는 단순 실패가 아니라 새로운 데이터 수요를 구체화하는 신호다.

## 4. Google 웹 검색 구조의 재해석

Obulus는 초기 Google이 웹페이지를 주소화하고, 인덱싱하고, 링크·관련성·스팸 신호로 순위를 정했던 구조에서 영감을 받았다.

정확한 대응 관계는 다음과 같다.

| 웹 검색 | Obulus |
|---|---|
| 웹사이트 | 한 사람이 관리하는 개인 경험 DB |
| 웹페이지 | 한 개의 버전형 인간 경험 문서 |
| URL | 결제 가능한 안정적 리소스 주소 |
| 검색 인덱스 | 원문이 없는 무료 메타데이터 인덱스 |
| 링크·권위 | 독립 근거 간 corroboration과 provenance 관계 |
| 검색 결과 클릭 | 결제 후 원문 열람 |
| 광고 수익 | 데이터 소유자 직접 수익 |
| 검색 결과 없음 | Open Call로 신규 인간 데이터 생성 |

중요한 원칙은 다음과 같다.

- 전역 인기가 높은 사람을 고르는 것이 아니다.
- 질문마다 관련성과 권위를 다시 계산한다.
- 유료 링크, 자기 추천, 복사 관계가 권위를 구매할 수 없어야 한다.
- 여러 문서를 무조건 많이 파는 것이 아니라 최소한의 독립 근거 집합을 선택한다.

## 5. 검색·랭킹 구현에서 중요하게 다룬 내용

현재 Rust 프로토타입의 검색 흐름은 다음을 결합한다.

1. 지역, 연령대, 분야, 가격, 동의 상태 등의 구조화 필터
2. 질문과 문서의 텍스트 관련성
3. 핵심 개체와 희귀 단어 일치
4. 질문별 personalized PageRank authority
5. 작성자 신뢰도
6. freshness 감쇠
7. 동일 작성자 중복 제거
8. 문서 간 중복도 감점
9. 예산 안에서 근거 묶음을 고르는 최적화

PageRank를 그대로 복사한 것이 아니라, 인간 근거 네트워크에 맞게 다음 관계만 긍정 권위에 반영한다.

- organic
- admin verified
- outcome verified
- 독립적으로 corroborate된 관계

다음 관계는 긍정 권위를 만들지 못한다.

- paid
- sponsored
- self-reference
- copied/derived
- agent-inferred
- unresolved dispute

결제는 실제 사용 이력을 만들지만 권위를 직접 구매하지는 못한다.

## 6. 개인 메모리 DB 구조

한 사람의 DB는 고정된 인구통계 프로필이 아니라 시간에 따라 축적·수정되는 경험 원장이다.

주요 계층은 다음과 같다.

- Observation: 실제 질문에 대한 사람의 원문 답변
- Episode: 같은 사건이나 주제에 관한 관찰 묶음
- Reflection: 여러 관찰에서 파생된 패턴. 원본 source ID를 유지하며 직접 발화처럼 판매하지 않음
- Persona state: 시간에 따라 갱신되는 선호·관심·생활 조건·전문성
- Provenance and consent: 수집 목적, 공개 범위, 버전, 사용 이력, 철회 상태

문서가 판매되기 전에 결합되는 정보는 다음과 같다.

- 콘텐츠 해시
- 불변 버전
- 동의 버전
- 작성자와 검증된 수취인
- 가격
- 잠금 상태
- 접근·수익 이력

사용자가 답변을 수정하면 과거 문서를 조용히 덮어쓰지 않고 새 버전을 생성한다. 과거 구매자가 열었던 근거는 당시 스냅샷으로 추적할 수 있어야 한다.

Auto-match는 사용자를 흉내 내서 새 답을 생성하는 기능이 아니다. 충분히 비슷한 질문에서 사용자가 과거에 실제로 제공한 동일 원문을 재사용하는 기능이다.

## 7. 답변 품질·스팸 방어

현재 구현은 다음 계층을 조합한다.

- 최소 길이와 의미 있는 단어 수
- 장소, 시간, 가격, 수치, 실제 사건과 같은 구체성
- 질문을 그대로 반복하는 답변 탐지
- 문장 내부 반복 탐지
- 과거 답변과의 near-duplicate 검사
- 이메일·전화번호 등 직접 식별자 탐지
- 작성자의 accepted/voided 이력
- 실제 결제한 구매자의 helpful/report 피드백
- strike, 지급 보류, dispute, suspension

이 시스템은 진실을 완전히 증명하지 않는다. 출처, 버전, 독립성, 반복 유용성, 실제 결과 검증을 축적하여 신뢰도를 개선하는 구조다.

## 8. Gemini와 Google Cloud AI의 역할

Gemini는 인간을 대체하거나 사람의 경험을 지어내지 않는다.

세 가지 역할만 담당한다.

1. 검색 결과가 부족할 때 일반적 baseline과 부족한 인간 근거 식별
2. 공급자에게 시간·장소·가격·이유·구체적 사건을 묻는 인터뷰 후속 질문 생성
3. 결제되고 검증된 passage만 사용한 근거 기반 합성

동의, 문서 버전, 가격, 수취인, 결제 여부와 공개 권한은 결정론적 백엔드가 통제한다. Gemini에게 전달되는 citation은 allowlist로 제한하고, passage 안의 지시문은 명령이 아니라 신뢰할 수 없는 데이터로 처리한다.

Google Cloud 구성 요소는 다음과 같다.

- Vertex AI / Gemini
- Cloud Run
- Cloud KMS 비수출형 Solana 운영 키
- Secret Manager
- Cloud Build
- IAM
- 구조화 로그와 결제 복구 워커

## 9. x402, MPP, Pay.sh, Solana

각 프로토콜의 역할은 구분해야 한다.

- x402: HTTP 리소스의 결제 요구와 결제 증명 재요청 구조
- MPP: Pay.sh가 지원하는 Machine Payments Protocol
- Pay.sh: 402 챌린지를 감지하고 로컬 또는 서버 키에 승인을 요청한 뒤 결제 증명을 붙여 요청을 재시도하는 도구
- Solana USDC: 여러 독립 데이터 소유자에게 문서 단위로 정산하는 결제 레일

결제는 내용이 진실임을 증명하지 않는다. 어떤 버전의 문서가 열렸고, 누구에게 얼마를 지급했으며, 어떤 근거가 최종 답변에 허용되었는지를 증명한다.

## 10. 기존 중앙 결제 버전과 새 로컬 버전

대화 후반에 두 구조를 명확히 분리했다.

### Obulus Web — 기존 중앙 결제 버전

```text
브라우저
→ Phantom으로 지갑 소유 증명 및 선불 잔액 충전
→ Rust 백엔드가 질문별 예산 예약
→ Cloud Run Pay.sh 오케스트레이터
→ GCP KMS 운영 지갑으로 문서별 결제
→ 데이터 소유자에게 USDC 정산
```

장점:

- 사용자가 Pay.sh를 설치하지 않아도 됨
- 웹에서 바로 시작 가능
- 데모와 일반 사용자 UX가 간단함

남는 위험:

- 중앙 선불 원장
- KMS 운영 지갑과 결제 워커 의존
- 서비스 장애와 운영 정책 의존

서버가 사용자의 Phantom 개인키를 보관하는 구조는 아니다.

### Obulus Desktop / MCP — 새 로컬 결제 버전

```text
Desktop 또는 Claude/Codex
→ Obulus MCP로 검색·견적
→ 사용자 컴퓨터의 Pay.sh
→ Touch ID 또는 OS 승인
→ 로컬 Pay 계정으로 직접 결제
→ 결제된 근거 반환
```

장점:

- Phantom 불필요
- 중앙 KMS 결제 지갑 불필요
- 사용자 결제 키가 OS 보안 저장소에 유지
- 중앙서버의 지갑·사용자 계정 의존 축소

중요한 정리:

- MCP만 만든다고 중앙 위험이 없어지는 것은 아니다.
- 실제 키와 서명 과정이 사용자 장치로 이동해야 한다.
- MCP 전용 사용자는 Pay CLI가 로컬에 필요하다.
- Desktop 앱은 검증된 Pay.sh 바이너리를 앱에 포함하여 별도 수동 설치를 없앨 수 있다.

권장 제품 구성:

```text
Obulus Web      설치 없는 기존 중앙 결제 버전
Obulus Desktop  Pay.sh를 내장한 로컬 GUI 버전
Obulus MCP      Claude/Codex용 에이전트 인터페이스
```

Desktop과 MCP는 하나의 `Obulus Local Core`를 공유해야 한다.

## 11. Pay.sh 코드 분석 결과

공식 Pay.sh 저장소와 설치된 바이너리를 직접 대조했다.

현재 확인 상태:

- 전역 CLI: `pay 0.26.0`
- 프로젝트 패키지: `@solana/pay@1.0.26`
- npm 최신 버전: `1.0.26`
- 공식 저장소에는 `pay-v0.27.0` 태그가 있으나 npm `1.0.27`은 아직 없음
- MCP 2025-06-18 stdio 초기화 정상
- Pay 계정 사용 가능
- Obulus Local Agent doctor 정상
- 로컬 에이전트 테스트 15/15 통과

공식 `pay mcp`가 노출하는 도구:

1. `curl`
2. `search_catalog`
3. `list_catalog`
4. `get_catalog_entry`
5. `get_balance`
6. `topup`
7. `create_skill`

`pay claude`와 `pay codex`는 에이전트를 실행하면서 공식 Pay MCP를 임시 주입한다. 결제가 필요한 경우 MPP/x402/SIWX 챌린지를 분석하고 OS 보안 저장소의 Pay 계정에 승인을 요청한 뒤 요청을 재시도한다.

공식 Pay MCP의 `curl`은 URL, method, headers, body를 받을 수 있는 범용 도구다. 따라서 Obulus의 확정 문서·금액·수취인·버전·동의 상태를 단독으로 보장하지는 않는다.

## 12. 현재 Obulus Local Agent 구현

현재 별도 폴더는 `apps/obulus-local-agent`다.

주요 구성:

- `mcp.mjs`: 계정 없는 구매자용 Obulus MCP
- `tools.mjs`: 검색, baseline, 결제 준비, 복구, 합성, 로컬 삭제 도구
- `pay-mcp.mjs`: `pay_approved_intent(intentId)` 한 개만 노출
- `payment-broker.mjs`: 확정 intent를 프로젝트에 고정된 Pay.sh의 `pay fetch`로 실행
- `approval.mjs`: 실제 터미널에서 정확한 문구를 입력하는 일회성 승인
- `state.mjs`: mode-0600 로컬 capability와 결제 intent 저장
- `privacy.mjs`: 직접 식별자 차단·로컬 삭제
- `quotes.mjs`: 네트워크, mint, 금액, 수취인, 견적 binding 검증

현재 안전장치:

- 모델이 임의 URL·method·header·body·금액·수취인을 전달할 수 없음
- 한 번 준비된 exact intent만 결제 가능
- 결제 결과가 승인된 문서와 일치하는지 영수증 재검증
- 응답 유실 시 자동 재결제하지 않고 ambiguous 상태로 전환
- 결제 상태를 먼저 복구한 뒤 다음 행동 결정
- 로컬 Pay.sh 패키지가 없으면 실패하고 PATH 또는 최신 npx로 자동 대체하지 않음

현재 로컬 앱의 `pay` MCP는 공식 `pay mcp`가 아니라 위 제한형 결제 브로커다. Antigravity 플러그인에는 공식 `pay mcp`를 프록시하는 별도 경로가 있으나, Obulus Local Agent에는 통합되지 않았다.

## 13. Pay.sh 통합에서 발견된 남은 문제

1. Claude 사용자 설정에 공식 Pay MCP가 영구 등록되어 있지 않다.
2. Codex 사용자 설정에도 공식 Pay MCP가 영구 등록되어 있지 않다.
3. `pay claude`, `pay codex`는 실행 중 임시 주입만 수행한다.
4. Local Agent의 `pay`라는 서버명이 공식 Pay MCP처럼 보이지만 실제로는 제한형 브로커다.
5. Obulus가 공식 Pay 카탈로그에 provider로 등록되어 있지 않다.
6. `pay/paywall.gcloud.yml`을 provider 파일로 변환하면 이름이 `paywall.gcloud`가 되어 FQN 규칙을 위반한다.
7. provider 필수 필드 `use_case`가 없다.
8. OPENSHELF 레거시 이름이 남아 있다.
9. 공개 카탈로그에서 사용할 고정 HTTPS service URL과 실제 유료 endpoint 검증이 필요하다.
10. 현재 로컬 앱은 `.app` GUI가 아니라 headless Node.js CLI/MCP다.

## 14. 권장 Pay.sh 통합 방향

보안과 범용 Pay 기능을 모두 살리기 위한 권장 구조:

```text
Claude / Codex / Desktop
├── Obulus MCP
│   ├── 무료 검색
│   ├── 랭킹
│   ├── 확정 견적
│   ├── 복구
│   └── 결제된 근거 합성
├── Obulus Secure Pay MCP
│   └── 승인된 exact intent만 실행
└── Official Pay MCP
    ├── Pay 카탈로그
    ├── 잔액
    ├── 충전
    └── 범용 유료 API
```

Obulus 구매에는 제한형 결제 도구를 유지하고, 공식 Pay MCP는 범용 Pay 기능과 카탈로그 발견을 위해 별도로 제공한다.

향후 더 깊게 통합할 경우 제한형 MCP의 외부 인터페이스는 `intentId`만 유지하되, 내부 실행을 `pay fetch`가 아니라 공식 `pay mcp`의 결제 경로로 위임하는 방안을 검토할 수 있다. 다만 Touch ID와 MCP elicitation 전달 구조를 보존해야 한다.

## 15. 상용화 전 보안 리스크

완전히 무위험한 구조는 아니다.

### 낮아지는 위험

- 중앙서버가 사용자 개인키를 보유하는 위험
- Phantom 세션과 브라우저 확장 프로그램 의존
- 언어 모델에게 raw private key가 노출되는 위험
- 임의 금액과 수취인으로 결제가 변조되는 위험

### 여전히 남는 위험

- 공식 Pay MCP 범용 `curl`의 임의 유료 URL 호출 가능성
- 사용자가 잘못된 결제 프롬프트를 승인할 가능성
- 로컬 컴퓨터 또는 앱 배포 바이너리가 침해될 가능성
- Solana에 지갑 주소, 거래 금액, 시점이 공개되는 문제
- 구매 질문과 선택 문서가 중앙 Obulus 서버를 통과하는 문제
- 현재 기여자 원문 데이터가 중앙 저장소에 존재하는 문제
- 피싱 endpoint, 악성 provider, 공급망 공격

필수 보완:

- Pay.sh 바이너리 코드 서명과 체크섬 검증
- 버전 고정과 안전한 업데이트
- Obulus gateway allowlist
- 질문별 최대 예산
- 결제 전 금액·문서 수·수취인·네트워크 표시
- 무제한 자동승인 금지
- idempotency와 결제 복구
- 로컬 암호화 저장
- 로그에서 질문·capability·지갑 주소 최소화
- 장기적으로 기여자 self-hosted node 또는 federated storage

## 16. 피치덱 관련 주요 피드백

사용자는 Obulus 소개 자료가 기술 백서처럼 과도하게 복잡하거나, 반대로 중요한 기술 사상이 빠진 얇은 자료가 되는 것을 모두 원하지 않았다.

필수 방향:

- 누구나 첫 3장 안에 문제와 당위성을 이해해야 함
- 소셜 월드모델을 설명 없이 갑자기 제시하면 안 됨
- 파리 거주자의 실제 음식 선택처럼 구체적인 질문을 중심으로 설명
- 추상적 카피보다 실제 기업의 조사 비용과 데이터 재사용 문제를 명확히 설명
- 기술 슬라이드는 반드시 어떤 사업적 효과를 만드는지 연결
- 블랙앤화이트, 실리콘밸리 B2B 인프라 스타일
- 모든 슬라이드는 16:9 규격
- 큰 제목이 어색하게 한 글자씩 줄바꿈되지 않도록 고정 폭·폰트 크기 검수
- 작은 캡처 이미지를 억지로 넣지 말고 읽을 수 있는 크기로 크롭
- 로그인 화면보다 실제 채팅 HIT/MISS, 가격, 결제, 메모리, CLI 화면 우선
- 기술 다이어그램은 Transformer 구조도나 정식 sequence diagram 수준의 밀도로 제작
- 내용이 중구난방으로 분산되지 않도록 한 슬라이드당 하나의 주장
- 건방지거나 과도하게 선언적인 표현 금지
- “기술은 구현됐습니다”, “실제 거래로 경제성을 증명합니다” 같은 과장 금지
- Devnet 구현 완료 상태와 Mainnet 다음 단계를 정확히 구분

피치덱에 반드시 포함할 내용:

- 타깃 기관과 기업
- 해결 문제
- 수익 모델
- 도입 시나리오
- TAM/SAM/SOM과 근거
- 마이크로페이 중심 가격 구조
- Google 웹 검색을 재해석한 랭킹
- 메모리 스트림 적재 구조
- Gemini/Google Cloud 역할
- x402/MPP/Pay.sh/Solana 결제 sequence
- 전체 기술 아키텍처
- 온체인·오프체인 데이터 경계
- 실제 코드·테스트·Devnet 근거

월 구독을 핵심 수익원으로 잡지 않는다. Obulus의 핵심 수익은 마이크로페이 기반 거래 수수료다.

## 17. 해커톤 결선 평가 기준

사용자가 제공한 결선 기준:

1. AI 기술 자율성 30%
   - Gemini/Vertex AI 기반 다단계 계획과 도구 선택
   - A2A 또는 준하는 자율 의사결정 구조
2. 비즈니스 가치 및 UX 30%
   - 실질적 시장 수요
   - Passkey/Gasless 등 Web3 진입장벽 감소
3. GCP 인프라 확장성 15%
   - 프로덕션 수준의 클라우드 네이티브 배포·운영
4. 솔라나 온체인 결제 15%
   - 에이전트 주도 Pay.sh·에스크로 등 안정적 트랜잭션
5. 발표력 10%
   - 문제와 솔루션의 명확성
   - 목업이 아닌 라이브 데모

코드 구현과 평가 준비에서는 발표력 자체를 제외한 나머지 평가 영역을 최대한 보완하기로 했다.

## 18. 현재 저장소 상태와 검증

현재 세션 마지막 확인:

- 브랜치: `main`
- 원격과 동기화 상태
- 작업 트리: 이 내보내기 파일을 만들기 전에는 깨끗함
- Obulus Local Agent: 설치 완료
- 기본 Pay 계정: 사용 가능
- Local Agent doctor: 정상
- Local Agent 테스트: 15/15 통과
- 공식 Pay MCP 초기화 및 tools/list: 정상

앞선 전체 저장소 검증에서는 다음이 통과한 상태였다.

- 프론트엔드 build/lint/typecheck
- Rust test/clippy
- payment gateway
- Pay.sh orchestrator
- agent/CLI
- finalist-specific tests

이 수치는 새 변경 후에는 반드시 다시 실행해 갱신해야 한다.

## 19. 다음 작업 우선순위

### P0 — 다음 구현 단계

1. 기존 Hosted Web 결제 구조를 변경하지 않고 유지
2. `apps/obulus-local-core`로 로컬 공통 로직 분리 여부 검토
3. `apps/obulus-mcp`와 `apps/obulus-desktop`이 공통 코어를 사용하도록 구조화
4. Desktop 앱에 공식 Pay.sh 바이너리 번들 및 서명·체크섬 검증
5. 공식 Pay MCP와 Obulus MCP를 Claude/Codex에 안전하게 동시 등록하는 installer 작성
6. Local Agent의 제한형 payment MCP 이름을 `obulus-pay`처럼 명확히 변경
7. Pay provider metadata를 Obulus 브랜드와 유효한 FQN/use_case/service URL로 작성
8. 공식 `create_skill` 검증 통과
9. 실제 provider endpoint probe 및 Devnet 결제
10. 설치 후 앱을 실제로 열어 검색→견적→Touch ID→결제→근거 반환을 검증

### P1 — 상용화 보완

- Mainnet
- 코드 서명 및 notarization
- 자동 업데이트 서명
- encrypted local database
- wallet/account recovery UX
- gasless/fee payer 정책
- user-level spending policy
- GCP managed database와 durable queue
- contributor data encryption 및 federated/self-hosted node
- enterprise privacy and audit controls

## 20. 다음 세션에 전달할 핵심 문장

> 기존 Obulus Web은 설치가 없는 중앙 Pay.sh/KMS 결제 버전으로 유지한다. 별도로 만드는 Obulus Desktop/MCP는 Pay.sh와 결제 키를 사용자 장치로 이동하여 Phantom과 중앙 운영 지갑 의존을 줄인다. Desktop에는 Pay.sh를 번들해 별도 수동 설치를 없애고, MCP는 Claude/Codex에 Obulus 검색 도구와 공식 Pay 기능을 함께 연결한다. Obulus 구매에는 모델이 금액·URL·수취인을 바꿀 수 없는 exact-intent 결제 경계를 유지한다.

## 21. 주요 참고 파일

- `apps/obulus-local-agent/README.md`
- `apps/obulus-local-agent/mcp_config.json`
- `apps/obulus-local-agent/src/mcp.mjs`
- `apps/obulus-local-agent/src/pay-mcp.mjs`
- `apps/obulus-local-agent/src/payment-broker.mjs`
- `apps/obulus-local-agent/src/approval.mjs`
- `apps/obulus-local-agent/src/pay-sh.mjs`
- `integrations/antigravity/openshelf/runtime/pay-compat.mjs`
- `pay/paywall.gcloud.yml`
- `docs/PAY-SH.md`
- `docs/agent-payment-threat-model.md`
- `docs/PERSONA-WEB-RANKING.md`
- `docs/FINALIST-ENGINEERING-READINESS.ko.md`
- `docs/FINALIST-EVIDENCE-RUNBOOK.ko.md`
- `docs/OBULUS-PITCH-DECK-PLAN-KO.md`
- `docs/Obulus-Pitch-Deck.pdf`
