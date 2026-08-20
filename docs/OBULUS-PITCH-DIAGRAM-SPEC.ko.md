# Obolus 발표 다이어그램 정본

이 문서는 주최 측의 요청인 **타깃 기관·기업·개인, 해결 문제, 도입 시나리오, 아키텍처**를 발표 자료에서 어떤 그림으로 설명할지 고정하는 정본이다. 다이어그램은 기술 로고를 나열하는 장식이 아니라, 각 장의 결론을 5초 안에 이해시키는 본문이다.

## 본편 13장

### 1. 표지 — 질문이 인간 근거로 바뀌는 네 단계

**화면 결론:** AI는 웹을 검색하고, Obulus는 사람의 실제 경험을 검색한다.

```text
[기업·Agent의 질문]
          → [동의된 인간 DB 검색]
          → [선택한 근거만 결제]
          → [원문 인용 답변 + 영수증]
```

- 질문: 대상, 상황, 시점, 필요한 답변 수, 최대 예산
- 검색: 원문은 닫은 채 metadata, 가격, 독립 저자 수만 비교
- 결제: 사용할 문서의 정확한 version만 구매
- 결과: 열린 passage만 인용하고 문서별 결제 근거를 함께 남김

### 2. 타깃과 문제 — 같은 사람의 경험을 계속 새로 산다

**화면 결론:** 반복 조사비는 계속 발생하지만, 답변은 다음 질문에 재사용되지 않는다.

```text
[은행·보험]  [소비재·F&B·여행]  [프로덕트·리서치]
      \              |                 /
       └────── [패널 모집] ───────────┘
                    ↓
              [설문·인터뷰]
                    ↓
              [평균 보고서]
                    ↓
          [원문·저자 맥락이 사라짐]
                    ↺
              다음 질문에서 재모집
```

하단에는 이해관계를 별도로 보인다.

```text
[실제 경험을 가진 개인] ── 동의·원문·버전 ──▶ [Obulus evidence]
[실제 경험을 가진 개인] ◀─ 채택·재사용 정산 ── [Obulus evidence]
```

### 3. 도입 시나리오 — 먼저 검색하고 빈칸만 사람에게 묻는다

**화면 결론:** 모든 질문을 설문으로 바꾸지 않고, 기존 근거의 빈칸만 신규 모집한다.

```text
[질문 + cohort + 예산]
          ↓
[무료 metadata 후보 검색]
          ↓
[관련성·동의·가격·독립 저자 검증]
          ↓
      ┌───┴───────────┐
    [HIT]          [PARTIAL]             [MISS]
  최소 bundle     기존 근거 + 부족분      무료 baseline 또는 종료
      │             Open Call                │
      └──────────────┬───────────────────────┘
                     ↓
        [열 문서·총액·저자 수 제시]
                     ↓
          [선택 문서만 x402 결제]
             ↙                     ↘
 [구매자: 인용 답변+영수증]   [기여자: USDC 정산]
             \                     /
              └── [채택 답변 재색인] ──↺
```

발표 예시는 은행 질문 하나로 통일한다.

> “첫 월급을 받은 20대가 적금 가입을 포기한 실제 이유는?”

Obulus는 기존 답변을 먼저 찾고, 부족한 20대 첫 월급 경험자만 추가 모집한다. AI가 20대를 추정하는 것이 아니라 조건에 맞는 사람의 직접 경험을 찾는 구조다.

### 4. Agent 자율성 — Gemini가 계획하고 Rust가 경계를 지킨다

**화면 결론:** 모델은 다음 행동을 고르지만, 권한·가격·예산·수취인은 바꿀 수 없다.

```text
[Web / Claude / Codex / Gemini MCP]
                  ↓
[Vertex Gemini · 계획 1]
질문 해석 · 검색 filter · limit · 허용 tool 선택
                  ↓ typed function call
[Rust policy core]
동의 · lock · 가격 · 예산 · 저자 중복 · 상태 전이 검증
                  ↓
[검색 결과 / coverage / quote]
                  ↓
[Vertex Gemini · 판단 2]
구매 제안 / PARTIAL+Open Call / 무료 일반 답변 / 종료
                  ↓
[허용된 tool 실행]
```

하단 GCP 실행 rail:

```text
Cloud Run ingress → Vertex AI → Rust API → Cloud SQL
                         │          │          │
                         └── Cloud Logging ────┘
                         Cloud Tasks → payout / recovery worker
                         Cloud KMS → Pay.sh signing request
```

### 5. 신뢰와 결제 — 자동 결제여도 영수증이 경계다

**화면 결론:** 사용자는 매 문서마다 승인하지 않아도 되지만, 사전에 정한 한도 밖으로는 결제되지 않는다.

```text
[사용자 서명]
선불 잔액 또는 제한된 capability
          ↓
[Agent가 유료 URL 요청]
          ↓
[HTTP 402 challenge]
document id · version · recipient · amount · expiry
          ↓
[Rust 재검증]
동의 · 가격 · 예산 · quote fingerprint · 중복
          ↓
[Pay.sh / Cloud KMS]
서비스 키는 export하지 않고 서명 요청만 수행
          ↓
[Solana Devnet USDC]
독립 RPC 2곳에서 finality 확인
          ↓
[canonical receipt]
문서 해시 · 버전 · 수취인 · 금액 · tx signature · finality
          ↓
[잠긴 passage 공개]
```

영수증 오른쪽에는 반드시 다음을 보인다.

- 최종 표시가격 안에 protocol fee 포함
- 의도한 정책: 근거 소유자 90%, 프로토콜 10%
- 결제·소유권·가격은 증명하지만 진실성 자체를 증명하지는 않음
- mainnet PDA escrow와 upgrade authority 고정은 상용화 단계 과제

### 6. 데이터 moat — 원문이 상위 개념으로 자라고 질문별 권위로 검색된다

**화면 결론:** 상위 통찰이 원문을 대체하지 않고, exact pointer를 가진 검색 인덱스로 쌓인다.

상단 적재·추상화:

```text
[L0 직접 관측 3개] ──▶ [L1 패턴]
[L0 직접 관측 3개] ──▶ [L1 패턴] ──┐
[L0 직접 관측 3개] ──▶ [L1 패턴] ──┼──▶ [L2 규칙] ──▶ [L3 성향]
                                      ┘
```

- 현재 구현: 3개 관측 단위의 deterministic reflection, L1~L5, exact child pointer
- 현재 importance: 0~1 deterministic heuristic
- 미래 고밀도 정책: 최근 100개, importance 합 150, Gemini expert/recursive reflection
- 원문은 자동 삭제되지 않으며 검색 freshness만 90일 반감, 최저 0.2

하단 검색·추천:

```text
[질문]
   ↓ relevance gate ≥ .22 + term coverage + anchor + consent + budget
[lexical + 768차원 local feature-hash 후보]
   ↓
[질문별 teleport seed]
   ↓
[Personalized PageRank · damping .85 · 40회]
   ↓ positive authority edge만 전파
[독립 저자·중복 passage 제거]
   ↓
[최소 근거 bundle]
```

최종 검색 점수:

```text
relevance 0.60 + term coverage 0.12 + authority 0.13
+ trust 0.10 + freshness 0.05
```

그래프 범례:

- 노드: versioned human document 또는 source-linked reflection
- 질문과 가까운 노드의 외곽선이 강해지고 teleport seed가 큼
- 독립 인용·교차 확인·verified outcome은 authority 전달
- 결제·sponsored·self·raw UGC·agent-inferred edge는 authority 0
- reciprocal organic edge는 20%만 인정

### 7. 전체 아키텍처와 확장 — 질문 하나가 다음 질문의 비용을 낮춘다

**화면 결론:** Agent, Evidence, Settlement가 분리 확장되며 결과는 다시 검색 자산이 된다.

```text
CLIENT
Web / MCP / API
        │
        ▼
AGENT & POLICY
Cloud Run ingress → Vertex Gemini → Rust policy core
        │                              │
        ▼                              ▼
EVIDENCE                         SETTLEMENT
Cloud SQL ledger                x402 gateway
memory stream                   Pay.sh + Cloud KMS
source-linked index             Solana USDC
Hybrid retrieval + PPR          payout/refund worker
        │                              │
        └───────────┬──────────────────┘
                    ▼
        인용 답변 + canonical receipt
                    │
                    └── 채택·재사용·분쟁 결과 재색인 ──↺
```

확장 포인트:

- Cloud Run: API, Agent, x402 gateway, payout worker를 독립 scale
- Cloud SQL: 거래·메모리·문서 version의 durable state
- Cloud Tasks: payout·refund·retry의 재시도와 idempotency
- Cloud KMS: 서비스 서명 키 비반출
- Vertex AI: planning과 synthesis를 분리
- Solana: 낮은 단가의 USDC settlement와 공개 검증 가능한 receipt anchor

### 8. 구체 검색 예시 — 후보 전체가 아니라 최소 독립 bundle만 연다

```text
[80개 무료 후보] → [질문별 랭킹 12개] → [독립 저자 8명] → [선택 문서만 결제]
```

각 화살표는 `relevance gate`, `dedupe`, `HTTP 402`를 표시하고, 예시 금액은 제품 흐름 설명용 가정임을 하단에 분리한다.

### 9. 개인 데이터 경계 — 원문·버전·동의 범위를 잃지 않는 재사용

좌측은 기억 원장에 남는 `origin / version / pointer / provenance`, 우측은 검색 전에 확인하는 `consent / lock / price / delete`를 한 줄씩 대응시킨다. 상위 통찰은 원문을 대신하지 않고 포인터만 더한다.

### 10. Agentic commerce — 같은 API를 사람과 Agent가 함께 사용

```text
[Claude·Codex·Gemini MCP] → [x402 가격 발견] → [Pay.sh + KMS] → [Solana USDC finality]
```

상단 브랜드 rail은 실제 Claude, Gemini, Google Cloud, Solana 마크를 절제해 사용하되 로고보다 기능 경계가 먼저 읽히게 한다.

### 11. Go-to-market — 반복 질문이 많은 팀부터 6주 PoC

소비재·F&B를 beachhead, 은행·보험을 두 번째 cohort, Research·Agent API를 확장 경로로 둔다. `1–2주 준비 → 3–4주 실제 질문 → 5–6주 검증`의 도입 sequence를 아래에서 연결한다.

### 12. 수익 모델 — 문서가 다시 열릴 때마다 소유자와 플랫폼이 나눈다

왼쪽에는 한 bundle의 표시 가격과 90/10 예시 분배를 크게, 오른쪽에는 `문서 공개 수수료 / Private panel·API / 모델·검색·정산 비용 / 환불·분쟁 / 재사용률`을 나란히 둔다.

### 13. 콜드 스타트 — 검증된 빈칸부터 공급을 만든다

```text
[공인·동의된 anchor] → [buyer-funded open call] → [verified contribution] → [reuse signal]
```

우측에는 `no hit`, `authority 0`, 저자·passage 중복 제거, dispute 반영을 넣어 허위 공급이 그래프를 키우지 못하는 이유를 설명한다.

## Appendix 확대 다이어그램

### A1. 전체 요청 sequence

질문 제출부터 검색, HIT/PARTIAL/MISS, 결제, 합성, 정산, 재색인까지 D3·D4·D7을 하나의 좌→우 sequence로 확대한다.

### A2. Personalized PageRank 계산 예시

질문 seed 3개, 후보 노드 8개, positive edge와 zero-authority edge를 색으로 분리한다. 40회 이후 상위 4개의 authority와 최종 score breakdown을 함께 보여준다.

### A3. 스팸·담합 방어

```text
유효 edge: 독립 교차 확인 · 실제 결과 · 검증된 출처
감쇠 edge: reciprocal organic × 0.2
차단 edge: paid · sponsored · self · raw UGC · agent-inferred × 0
후처리: 동일 저자 제거 · 근접 passage 중복 제거 · conduct/dispute filter
```

### A4. Agent action schema와 권한 경계

Gemini가 선택할 수 있는 필드와 Rust만 계산할 수 있는 필드를 양쪽으로 나눈다. 모델 입력에는 wallet secret, recipient rewrite, price rewrite, budget expansion 필드가 존재하지 않는 것을 보여준다.

### A5. 영수증과 공격 모델

영수증의 각 필드가 막는 공격을 1:1로 연결한다.

- document id + version → 존재하지 않던 거래·문서 바꿔치기 방지
- recipient → 수취인 바꿔치기 방지
- amount + quote fingerprint → 가격 변경·재사용 공격 방지
- tx signature + finality → 허위 정산 방지
- idempotency key → 중복 지급 방지

### A6. GCP 운영 구조

Cloud Run revision, service account, Cloud SQL, Tasks, KMS, Logging을 배포·운영 관점으로 확대한다. `live` 배지는 실제 evidence JSON이 같은 revision과 시간 창으로 상관 검증될 때만 표시한다.

### A7. PoC 성공 판정

6주 유료 PoC를 `대상·동의·기존 데이터 → 실제 질문 20~50개 → 결과 검증` 세 단계로 보이고, 검색 적중률·근거 확보 시간·재사용률·유용 평가·환불률을 결과 지표로 둔다. 목표값은 고객 증거가 아니라 검증 가정임을 표시한다.

## 공통 시각 규칙

1. 슬라이드마다 결론 문장은 하나만 둔다.
2. 화살표는 반드시 의미가 있는 동사 라벨을 가진다.
3. 선은 노드 뒤에 그리며 교차시키지 않는다.
4. 현재 구현, 목표 정책, 상용화 과제를 같은 색으로 섞지 않는다.
5. 현재 구현은 검정, 정책 경계는 청록, 미래는 연한 보라 점선으로 구분한다.
6. 한 다이어그램의 노드는 9개를 넘기지 않는다. 더 복잡한 구조는 Appendix로 보낸다.
7. Google Cloud·Solana·Pay.sh 로고보다 기능과 신뢰 경계를 먼저 읽히게 한다.
8. `LIVE`, `검증 완료`, 실제 금액·거래 수는 증거가 있을 때만 사용한다.
