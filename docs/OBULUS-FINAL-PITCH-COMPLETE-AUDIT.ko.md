# Obulus 결선 발표 완전 감사·5분 대본·시연·Q&A 통합 문서

> 기준일: 2026-08-21 KST<br>
> 감사 대상: `/Users/yuchanlee/Downloads/Obolus___인간_경험을_위한_유료_검색_인프라_20260819202854.pdf`<br>
> 목적: 처음 보는 심사위원이 5분 안에 문제·제품·AI 자율성·GCP·Solana 결제·비즈니스 가치를 이해하고, 이어지는 시연에서 실제 구현을 믿게 만드는 단일 기준 문서<br>
> 원칙: **현재 구현, 해커톤 데모 정책, 상용화 로드맵을 절대 섞지 않는다.**
> 다이어그램 정본: [`OBULUS-PITCH-DIAGRAM-BRIEF.ko.md`](OBULUS-PITCH-DIAGRAM-BRIEF.ko.md) — D0~D9의 노드·화살표·범례·Mermaid 원본<br>
> 발표용 다이어그램 문안·그리기 명세: [`OBULUS-PITCH-DIAGRAM-SPEC.ko.md`](OBULUS-PITCH-DIAGRAM-SPEC.ko.md) — 본편 13개와 Appendix 7개의 화면 문구, 연결 관계, 발표 멘트, 금지 표현<br>
> 화이트 HTML 발표본: [`obulus-pitch-deck-white.html`](obulus-pitch-deck-white.html) — 현재 정본은 16:9 본편 7장 + Appendix 10장, 키보드 이동·PDF 인쇄 지원<br>
> 시각 품질 평가표: [`OBULUS-PITCH-DESIGN-SCORECARD.ko.md`](OBULUS-PITCH-DESIGN-SCORECARD.ko.md) — 스토리·다이어그램·진실성·가독성 100점 기준<br>
> 페이지별 비주얼·4K 캡처 정본: [`OBULUS-PITCH-VISUAL-SHOTLIST.ko.md`](OBULUS-PITCH-VISUAL-SHOTLIST.ko.md) — 본편 8장·어펜딕스 12장의 사진/다이어그램 배치, 기존 원본, 재촬영 합격 조건<br>
> 무대 시간 정본: [`FINAL-PITCH-RUNBOOK.ko.md`](FINAL-PITCH-RUNBOOK.ko.md) — 본편 7장 + 90초 라이브 데모. 이 문서 안의 과거 8장·20장 설계 기록보다 런북을 우선한다.

---

## 0. 결론부터

### 발표 전체를 관통할 한 문장

> **Obulus는 공개 웹에 없는 사람의 실제 경험을 검색하고, 필요한 근거 문서만 Agent가 열어 본 뒤 그 사람에게 자동 정산하는 인간 근거 시장입니다.**

### 관객이 반드시 기억해야 할 세 문장

1. **검색은 무료입니다.** 사람의 비공개 원문을 실제로 열 때만 지불합니다.
2. **빈칸만 사람에게 묻습니다.** 이미 있는 근거를 다시 모집하지 않습니다.
3. **결제 내역과 열린 문서 버전은 영수증으로 남습니다.** 결제는 접근 권한을 증명하고, 데이터의 진실성은 별도의 신뢰 그래프가 평가합니다.

### 현재 덱의 가장 큰 장점

- “사람의 경험을 검색한다”는 문제 정의가 독창적이고 한 문장으로 전달된다.
- 질문 → 무료 검색 → 부족분 공개 모집 → 원문 재사용 → 소유자 반복 정산이라는 폐루프가 있다.
- Gemini, Rust, GCP, x402, Pay.sh, Solana가 단순 로고 모음이 아니라 각기 다른 책임을 가진다.
- 구매자는 문서 전체를 미리 보지 않고도 가격·독립 저자 수·버전·근거 범위를 확인할 수 있다.
- 결제 후 문서가 다시 검색 가능해져 공급 측 네트워크 효과가 생긴다.

### 기존 제출본에서 발견했고 현재 발표본에서 보완한 약점

- 현재 화이트 HTML은 누락 없는 13장 본편과 근거 확인용 Appendix 7장으로 정리했고, 5분 무대에서는 runbook의 핵심 전환만 선택해 사용한다.
- “Agent가 실제로 무엇을 자율 결정하는가”가 선명하지 않았던 문제는 D3의 `planner → policy → retrieval → observation → decider → validator` 경계로 분리했다.
- GCP 검증 증거가 작은 그림에 묻혔던 문제는 D6의 독립 실행 rail과 A2 확대 구조로 분리했다.
- **fee payer와 결제 자산이 다른 Solana 구조**가 없던 문제는 D4에서 `facilitator = network fee payer`, `buyer = USDC evidence price`로 분리했다. 이로써 사용자가 SOL 없이 결제되는 이유를 설명한다.
- 영수증의 증명 범위가 모호했던 문제는 D4에서 결제·문서 버전·수취인·finality와 답변 진실성 평가를 서로 다른 rail로 분리했다.
- PageRank의 개인 DB 적용 원리가 빠졌던 문제는 D5에서 원문 포인터, 독립 저자, 채택·인용 edge, 질문별 teleport seed와 차단 edge를 함께 표시했다.
- 현재 메모리와 미래 reflection 설계가 섞였던 문제는 D5와 A1에서 현재 L0·feature hashing·freshness decay와 향후 임계치 150·최근 100개 재귀 reflection을 다른 상태 라벨로 분리했다.
- 시장 규모가 고객 증거처럼 보이던 문제는 슬라이드 7의 D9에서 타깃별 구매 단위와 6주 PoC 성공 지표를 붙이고, SOM은 미검증 시나리오로 명시했다.
- 메인넷 에스크로가 완성된 것처럼 들리던 문제는 D4에 `DEVNET · hosted service wallet` 상태를 고정하고 감사된 trustless escrow는 로드맵으로만 분리했다.

### 확정 구조

- 본 발표: **표지 포함 8장 + 중간 90초 라이브 시연, 총 5분 45초**
- 버퍼: **15초**
- 보조 12장: 질의응답용으로만 유지
- 기술 세부·공격 모델·공식 근거·상용화 과제: 어펜딕스
- 정확한 전환 순서: [`FINAL-PITCH-RUNBOOK.ko.md`](FINAL-PITCH-RUNBOOK.ko.md)

---

## 0-A. 주최 측 자유 형식 요청에 대한 시각 답변

주최 측의 요청은 “예쁜 기술 그림”이 아니라 **누가 왜 도입하고, 질문 하나가 어떤
시스템과 경제 흐름을 통과하는지 한눈에 설명하라**는 뜻으로 해석한다. 따라서 본편은
아래 네 개의 핵심 다이어그램을 중심으로 구성하고, 기술 세부는 여섯 개의 보조
다이어그램으로 증명한다. 실제 HTML 발표본에는 D0·D1·D2·D3·D4·D7·D8·D9가
독립 시각물로 들어가며, D5·D6은 D7 안의 Evidence·GCP rail과 어펜딕스 확대판으로
들어간다.

### 핵심 다이어그램 1 · D1 — 타깃 기관·기업·개인과 해결 문제

**이 그림이 답하는 질문:** 누가 돈을 내고, 누가 데이터를 제공하며, 현재 무엇이
낭비되는가?

```text
[은행·보험]  [소비재·F&B]  [프로덕트·리서치 기관]
        └────────────┬────────────┘
                     ▼
          [반복 설문·인터뷰·A/B 테스트]
                     ▼
       [평균 보고서에 고립 / 다음 질문에서 재검색 불가]
                     │
              Obulus 도입 후
                     ▼
       [기존 인간 근거를 먼저 검색하고 빈칸만 모집]
                     │
      ┌──────────────┴──────────────┐
      ▼                             ▼
[기업: 조사비·시간 절감]   [개인: 채택·재사용 때마다 정산]
```

- 기관·기업은 반복 모집비, 응답비, 분석비를 줄인다.
- 개인은 동의된 원문·맥락·버전을 제공하고 채택·재사용 수익과 철회·정정 권한을
  가진다.
- 핵심 문제는 데이터 부족 그 자체가 아니라 **이미 돈을 주고 얻은 답이 다음
  질문에서 검색되지 않는 구조**다.

### 핵심 다이어그램 2 · D2 — 실제 도입 시나리오와 이해관계 폐루프

**이 그림이 답하는 질문:** 기업 질문 한 건이 어떻게 검색·추가 모집·결제·재사용으로
이어지는가?

```text
[질문·대상 조건·최대 예산]
              ▼
[무료 metadata 검색: 가격·독립 저자 수·버전만 공개]
              ▼
[관련성·동의·가격·저자 중복 검증]
              ▼
      [HIT / PARTIAL / MISS]
        │       │       └─ 무료 baseline 또는 종료
        │       └─ 기존 근거 + 부족한 cohort만 Open Call
        └─ 질문에 필요한 최소 독립 문서 bundle
              ▼
[선택 문서만 x402/Pay.sh로 열기]
        ┌─────┴─────┐
        ▼           ▼
[기업: 근거+영수증] [개인: 문서별 USDC 정산]
        └─────┬─────┘
              ▼
[채택 답변을 versioned evidence로 재색인 → 다음 질문의 HIT 증가]
```

대표 은행 도입 예시는 “첫 월급을 받은 20대가 적금 가입을 포기한 실제 이유”다.
Obulus는 먼저 해당 연령·시점·상품 경험이 맞는 독립 근거를 찾고, 부족한 인원만
공개 모집한다. 최종 산출물은 단순 요약이 아니라 **인용 가능한 선택 이유·반례·문서별
영수증**이다.

### 핵심 다이어그램 3 · D7 — 도입 시나리오와 전체 아키텍처

**이 그림이 답하는 질문:** 제품의 약속을 AI·GCP·검색·결제가 어떻게 함께 지키는가?

```text
① Clients
[기업 Web] [Gemini·Codex MCP] [기여자 UI]
                       │ 질문·대상·예산
                       ▼
② Agent control
[Vertex Gemini planner] → [Rust policy·retrieval]
                                      → [Vertex coverage decider]
                       │ 허용된 action만 실행
                       ▼
③ Evidence
[동의 L0 원문] → [근거 포인터가 있는 L1~L5 추상화]
              → [Hybrid search] → [Personalized PageRank]
                       │ 선택된 문서 version
                       ▼
④ Settlement
[scoped capability] → [x402 gateway] → [Pay.sh + Cloud KMS]
                                            → [Solana USDC]
                                            → [2-RPC finality]
                                            → [canonical receipt]
                       │
                       ▼
⑤ Closed loop
[채택 답변] → [기여자 정산] → [versioned evidence 재색인]
                              → [다음 질문 비용 감소]
```

이 그림에는 세 종류의 흐름을 색으로 분리한다.

- **데이터 rail(teal):** 질문 → 원문/추상화 → 검색 → 인용 답변 → 재색인
- **판단·권한 rail(violet/gray):** Gemini의 계획·다음 행동 선택과 Rust의
  동의·가격·예산·상태 전이 강제
- **돈 rail(amber):** quote → scoped capability → USDC 정산 → finality → 영수증

GCP group box 안에서는 `Obulus API`, `Agent orchestrator`, `x402 gateway`,
`Pay service`를 독립 Cloud Run 서비스로 분리하고, `Cloud SQL`은 내구 상태,
`Cloud Tasks`는 재시도, `Cloud KMS`는 non-exportable signer, `Vertex AI`는 두 번의
bounded 판단을 담당한다고 표시한다.

### 핵심 다이어그램 4 · D4 — 자동 결제와 사기 방지·청구서

**이 그림이 답하는 질문:** 사용자가 매번 Phantom 승인하지 않아도 왜 임의 결제가
불가능하며, 사후에 무엇을 검증할 수 있는가?

```text
[Phantom: 로그인 signMessage / refill 때만 USDC 승인]
                         ▼
[선불 잔액 + scope·expiry·budget capability]
                         ▼
[Rust가 quote·recipient·mint·amount·document version 재검증]
                         ▼
[x402 402 quote] → [Pay.sh + KMS signer] → [Solana Devnet USDC]
                                                  ▼
                                      [서로 다른 RPC 2곳 finalized]
                                                  ▼
[canonical receipt: 문서 ID·version·hash·금액·수취인·signature·slot]
                                                  ▼
                                   [정확한 passage 범위만 unlock]
```

- 서버와 모델은 Phantom private key를 받지 않는다.
- Gemini는 검색과 허용된 다음 행동만 선택하고 수취인·금액·transaction bytes를
  만들거나 바꾸지 못한다.
- 영수증은 **누가 어떤 문서 버전에 얼마를 지불했고 어떤 접근이 열렸는지**를
  증명한다. 답변 내용의 진실 자체는 provenance·독립 저자·신뢰 그래프가 별도로
  평가한다.
- 현재 구조는 `DEVNET · hosted service wallet`이며, 감사된 mainnet trustless
  escrow처럼 표현하지 않는다.

### 보조 다이어그램 6종

| ID | 제목 | 본편에서 증명하는 한 문장 | 배치 |
|---|---|---|---|
| D0 | 질문→검색→결제→인용 | 제품이 무엇인지 5초 안에 이해한다. | 표지 |
| D3 | Gemini와 Rust의 실행 경계 | Gemini는 계획·다음 행동을 고르고 Rust는 경제·권한을 잠근다. | 슬라이드 4 |
| D5 | 메모리 추상화+Personalized PageRank | 원문은 근거 포인터를 유지하고 질문별 권위로 검색된다. | 슬라이드 6 요약, A1 확대 |
| D6 | GCP 운영·확장 구조 | API·Agent·결제·정산은 독립 확장되고 상태·재시도·키가 분리된다. | 슬라이드 4·6 rail, A2 확대 |
| D8 | 평가 주장→실행 증거 | 구현·인프라·AI·Devnet 증거가 같은 실행 창에서 연결돼야 LIVE다. | 마지막 장 |
| D9 | 타깃별 도입 small multiples | 은행·소비재·리서치 기관·개인은 같은 제품을 다른 질문과 KPI로 도입한다. | 슬라이드 7 |

### 다이어그램 제작·발표 규칙

- 모든 주 경로는 왼쪽→오른쪽, 조건 분기는 위→아래로 읽힌다.
- 한 그림의 주 경로는 7개 노드 이하로 하고, 서비스 세부는 group box에 넣는다.
- 실선은 현재 구현, 점선은 조건부 경로, 얇은 외곽선은 로드맵이다.
- 각 그림에 `CURRENT`, `DEVNET`, `TARGET POLICY`, `P1` 상태를 표시해 구현과
  계획을 섞지 않는다.
- 로고를 나열하지 않고 각 기술이 맡는 책임을 노드 제목으로 쓴다.
- 시연에서는 동일 request ID가 D3의 노드를 순차 점등하고 하단 terminal에 필요한
  trace만 쌓이는 장면을 보여 준다.
- 전체 노드·화살표 문구, Mermaid 원본, 슬라이드별 발표 멘트는
  [`OBULUS-PITCH-DIAGRAM-BRIEF.ko.md`](OBULUS-PITCH-DIAGRAM-BRIEF.ko.md)를
  정본으로 사용한다.

### 주최 측에 그대로 제출할 수 있는 다이어그램 중심 구성 설명

아래 문안은 “타깃 기관/기업/개인, 해결 문제, 도입 시나리오+아키텍처
다이어그램을 중심으로 자유롭게 구성해 달라”는 요청에 대한 제출용 답변이다.

> Obulus의 발표는 기술 로고를 나열하는 대신, **누가 어떤 문제 때문에 이 제품을
> 도입하고, 질문 한 건이 어떤 데이터·판단·결제 흐름을 거쳐 다시 쓸 수 있는 인간
> 근거가 되는지**를 다이어그램으로 설명합니다. 구매자는 은행·보험, 소비재·F&B,
> 프로덕트·리서치 조직처럼 고객 선호와 실제 행동을 반복 조사하는 기관과
> 기업입니다. 데이터 제공자는 자신의 경험을 동의된 범위에서 제공하고, 채택과
> 재사용 때마다 정산받는 개인입니다. Obulus는 기존 답변을 먼저 검색하고,
> 비어 있는 집단만 새로 모집해 반복 조사비와 응답 낭비를 동시에 줄입니다.
>
> 발표의 핵심 시각물은 다섯 장입니다. 첫째, **타깃·문제 지도**는 기업이 같은
> 집단을 반복 모집하고 답변이 평균 보고서 안에서 사라지는 현재 구조를 보여
> 줍니다. 둘째, **도입 시나리오 폐루프**는 질문·대상·예산 입력에서 무료 후보
> 검색, HIT/PARTIAL/MISS 판단, 필요한 근거만 구매하거나 빈 집단만 모집하는
> 흐름을 보여 줍니다. 셋째, **Agent 실행 경계도**는 Vertex AI의 Gemini가 검색
> 계획과 다음 행동을 선택하고 Rust가 동의·가격·예산·중복·상태 전이를
> 결정론적으로 검증하는 구조를 보여 줍니다. 넷째, **결제·영수증 sequence**는
> x402, Pay.sh, Cloud KMS, Solana USDC와 두 RPC finality가 정확한 문서 버전·금액·
> 수취인을 canonical receipt로 묶는 과정을 보여 줍니다. 다섯째, **전체
> 아키텍처**는 Web/MCP에서 시작한 질문이 Agent control, Evidence graph,
> Settlement를 지나 채택 답변·기여자 정산·재색인으로 닫히는 전체 경로를 한
> 장에 담습니다.
>
> 기술 상세는 보조 다이어그램으로 증명합니다. **메모리·PageRank 그림**에서는
> L0 원문이 정확한 child pointer를 가진 상위 추상화로 자라고, 질문 자체를
> teleport seed로 넣은 Personalized PageRank가 독립 근거를 추천하는 방식을
> 보여 줍니다. **GCP 운영 그림**에서는 Cloud Run의 API·Agent·x402·Pay 서비스를
> 분리하고 Cloud SQL, Cloud Tasks, Cloud KMS, Vertex AI가 각각 상태·재시도·키·
> 판단을 맡는 이유를 보여 줍니다. 마지막으로 **평가 증거 지도**는 코드 테스트,
> 배포 인프라, 실제 Vertex 실행, Solana Devnet 정산을 각각 별도의 검증 산출물과
> 연결해 구현과 계획을 섞지 않습니다.

### 제출본에서 실제로 보여 줄 10개 다이어그램

| ID | 그림 제목 | 화면에 그릴 노드와 화살표 | 관객이 가져갈 결론 | 본편/어펜딕스 |
|---|---|---|---|---|
| D0 | 질문→검색→결제→인용 | `질문 → 인간 DB 검색 → 선택 근거 결제 → 인용 답변` | Obulus가 무엇인지 5초 안에 이해한다. | 표지 |
| D1 | 타깃·문제 지도 | `은행·보험 / 소비재·F&B / 리서치 조직 → 반복 모집·분석 → 보고서에 고립`, 그리고 `개인 ↔ Obulus`의 동의·정산 | 기업은 같은 인간 경험을 반복 구매하지만 답변은 다음 질문에 재사용되지 않는다. | 본편 2 |
| D2 | 도입 시나리오 폐루프 | `질문·대상·예산 → 무료 metadata → 관련성·동의·가격·저자 검증 → HIT/PARTIAL/MISS → 최소 구매/부족분 모집 → 영수증·정산 → 재색인` | 먼저 찾고, 비어 있는 집단만 다시 묻는다. | 본편 3 |
| D3 | Gemini·Rust 실행 경계 | `Vertex planner → Rust policy → Hybrid retrieval·PPR → Vertex decider → server validator` | Gemini는 다음 행동을 고르고 Rust는 경제·권한 경계를 잠근다. | 본편 4 |
| D4 | 자동 결제·canonical receipt | `scoped capability → Rust reserve → x402 quote → Pay.sh·KMS → Solana USDC → 2-RPC finality → receipt → exact version unlock` | 매번 Phantom 승인하지 않아도 모든 결제는 문서·수취인·금액 단위로 설명 가능하다. | 본편 5 |
| D5 | 원문 보존 추상화·PageRank | `L0 원문 → L1 패턴 → L2 규칙 → L3 성향`, 각 단계의 child pointer, 그리고 `질문 seed → 후보 그래프 → PPR → 독립 bundle` | 추상화가 원문과 끊어지지 않고 질문별 권위로 검색된다. | 본편 6 요약 / A1 확대 |
| D6 | GCP 운영·확장 | `Web/MCP → Cloud Run API·Agent·x402·Pay`, 하단에 `Cloud SQL·Tasks·KMS·Vertex`, 우측에 `Solana` | 판단·결제·상태·키가 분리돼 서비스별로 확장하고 실패를 격리한다. | 본편 4·6 rail / A2 확대 |
| D7 | 도입 시나리오+전체 아키텍처 | `Clients → Agent control → Evidence → Settlement → Closed loop`의 5개 plane과 데이터·권한·돈 3개 rail | 질문 한 건이 검색·판단·결제·정산·재사용으로 닫힌다. | 본편 6 / A0 확대 |
| D8 | 평가 주장→실행 증거 | `AI→autonomy.json`, `UX→제품 E2E`, `GCP→infrastructure.json`, `Solana→devnet.json` | 실제 artifact가 확인될 때만 LIVE라고 말한다. | 본편 8 |
| D9 | 타깃별 도입 small multiples | 은행·보험, 소비재·F&B, 연구기관·AI 팀, 개인 각각의 `시작 질문 → 기존 검색 → 부족분 모집 → 근거·영수증·KPI` | 같은 제품 루프를 반복 조사비가 큰 조직부터 도입한다. | 본편 7 |

### 핵심 도입 시나리오를 한 장으로 읽는 순서

```text
은행 인사이트 팀
  “첫 월급을 받은 20대가 적금 가입을 포기한 실제 이유는?”
        │ 질문·연령·경험·최대 예산
        ▼
Obulus 무료 검색
  원문 비공개 · 후보 수 · 독립 저자 수 · 정확한 총가격만 공개
        │
        ▼
Gemini 계획 + Rust 검증
  관련성 · 동의 버전 · 가격 · 예산 · 동일 저자 중복 · 상태 전이
        │
        ├─ HIT ─────▶ 필요한 독립 근거만 구매
        ├─ PARTIAL ─▶ 기존 근거 구매 + 비어 있는 cohort만 Open Call
        └─ MISS ────▶ 무료 baseline 또는 종료
        │
        ▼
x402 / Pay.sh / Cloud KMS / Solana USDC
  정확한 문서 version·수취인·금액으로 정산
        │
        ▼
인용 답변 + canonical receipt
  선택 이유 · 반례 · passage citation · 문서별 결제 증명
        │
        ▼
versioned evidence 재색인
  다음 질문의 HIT 증가 · 신규 모집 인원 감소 · 기여자 재사용 수익 증가
```

이 도입 시나리오는 D2에서 제품 경험으로, D7에서 기술 아키텍처로, D9에서 고객별
PoC로 같은 구조를 세 번 다른 해상도로 보여 준다. 따라서 관객은 새 개념을 매번
배우는 대신 한 질문이 점점 더 구체적인 시스템으로 들어가는 경험을 하게 된다.

---

## 1. 심사 기준에 대한 승리 조건

제공된 네 항목 합계는 90%다. 남은 10%의 공식 기준은 제공되지 않았으므로 임의로 만들지 않는다. 발표에서는 네 항목을 모두 증명하되 심사표를 읽어 주는 방식이 아니라 하나의 제품 서사 속에 자연스럽게 넣는다.

| 평가 항목 | 비중 | 심사위원이 한 문장으로 이해해야 할 것 | 본편 위치 | 시연 증거 |
|---|---:|---|---|---|
| AI 기술 자율성 | 30% | Gemini가 검색 조건을 계획하고 검색 결과를 관찰해 다음 도구를 고르며, Rust가 예산·권한·결제 경계를 강제한다. | 슬라이드 4 | MCP 질문 1건이 planner → Rust retrieval → next action을 통과하는 trace |
| 비즈니스 가치·UX | 30% | 기업은 이미 있는 경험을 다시 설문하지 않고 부족한 부분만 모집하며, 사용자는 SOL 없이 정해진 선불 잔액 안에서 근거를 연다. | 슬라이드 2·3 | 무료 후보 검색 → 정확한 가격 → 필요한 문서만 열기 |
| GCP 확장성 | 15% | API·x402 gateway·Agent orchestrator·Pay service가 독립 Cloud Run 서비스로 배포되고, SQL·Tasks·KMS가 상태·재시도·키를 분리한다. | 슬라이드 4·6·8 | Admin Test 실시간 경로 또는 77/77 인프라 검증 캡처 |
| Solana 온체인 결제 | 15% | x402/Pay.sh가 문서별 정확한 USDC 결제를 만들고 facilitator가 네트워크 수수료를 후원하며 두 RPC로 finalized를 검증한다. | 슬라이드 5 | Devnet 영수증, signature, mint, amount, recipient, finality |

### 만점 방어를 위한 역감사

만점형 발표는 “우리가 한 것”을 많이 나열하는 발표가 아니다. **평가 항목마다 주장 하나, 다이어그램 하나, 실제 증거 하나**가 10초 안에 연결돼야 한다. 아래 네 줄이 본편과 시연에서 모두 보일 때만 만점 주장을 방어한다.

| 평가 항목 | 만점형 핵심 주장 | 반드시 보여 줄 다이어그램 | 실제 증거 | 마지막 감점 위험 |
|---|---|---|---|---|
| AI 기술 자율성 30% | Gemini가 질문을 해석해 검색 도구와 다음 action을 선택하고, 검색 결과를 다시 관찰해 행동을 바꾼다. Rust는 경제·권한 경계를 고정한다. | D3 planner → policy → retrieval → observation → decider → validator | 동일 UI에서 HIT·PARTIAL·MISS 중 하나의 request ID가 실제 노드를 순차 점등하는 trace, timeout 시 deterministic fallback | 두 번의 LLM 호출을 단순 요약처럼 설명하거나, 표준 A2A를 구현했다고 과장하는 것 |
| 비즈니스 가치·UX 30% | 반복 조사의 기존 답을 먼저 검색하고 빈칸만 모집해 구매자 비용과 기여자 반복 수익을 동시에 만든다. | D1 타깃·문제 지도 + D2 이해관계 폐루프 | 무료 metadata 검색, 정확한 총액·독립 저자 수, SOL 없는 scoped auto-pay, 별도 영수증, 6주 PoC의 pass/fail 지표 | 시장 규모만 말하고 실제 구매 단위·첫 cohort·콜드 스타트·Phantom 한계를 숨기는 것 |
| GCP 확장성 15% | API·Agent·x402·정산을 독립 Cloud Run 경계로 분리하고 SQL·Tasks·KMS·Vertex가 상태·재시도·키·판단을 각각 맡는다. | D6 GCP 운영 아키텍처 | 같은 시각의 project·region·revision·service account·image digest와 `77/77`, queue·KMS·SQL 보호 상태 | 오래된 verifier 결과를 현재 live처럼 보이거나 서비스 이름만 나열하는 것 |
| Solana 온체인 결제 15% | 문서 version에 묶인 exact USDC quote를 x402/Pay.sh가 실행하고 facilitator fee payer와 두 RPC finality, canonical receipt가 결과를 증명한다. | D4 결제·신뢰 sequence | 실제 Devnet signature·mint·atomic amount·recipient·slot·finality·document version/hash·idempotency가 한 영수증에 표시 | 빈 원장·예시 signature를 실제 거래로 보이거나 hosted wallet을 감사된 trustless escrow라고 부르는 것 |

### 평가자에게 보이는 4개 체크 순간

1. 슬라이드 3에서 `40 → 5 → 독립 저자 4 → ₩60`을 보고 **비즈니스 구매 단위와 UX**를 체크한다.
2. 슬라이드 4와 Admin Test 점등 trace를 보고 **Agent의 관찰 기반 의사결정**을 체크한다.
3. 슬라이드 5의 실제 canonical receipt를 보고 **Solana 결제의 안정성과 설명 가능성**을 체크한다.
4. 슬라이드 6의 D7 전체 구조와 슬라이드 8의 verifier timestamp를 보고 **GCP 운영 분리와 확장성**을 체크한다.

현재 구현량은 네 항목을 모두 방어할 만큼 넓다. 다만 **비어 있는 receipt ledger와 실제가 아닌 transaction 값은 구현량을 점수로 바꾸지 못한다.** 발표 직전 실거래 영수증 한 건과 동일 시각의 인프라 verifier 결과를 캡처하는 것을 최종 hard gate로 둔다.

---

## 2. 기존 PDF 19페이지 전수 감사

### 1페이지 — 제목

현재 메시지: “사람의 경험을 검색하고, 사용한 만큼 지불.”

- 장점: 가장 좋은 한 줄이다.
- 부족: “누가 누구에게 왜 지불하는지”가 없다.
- 수정: 부제에 **“공개 웹의 빈칸을 실제 인간 근거로 채우는 Agent 결제 인프라”**를 넣는다.
- 본편 유지: 예.

### 2페이지 — 시장

- `$142B`는 ESOMAR의 2024년 보고서가 집계한 **2023년 글로벌 insights industry 매출**이다. “설문 시장”이나 “Obulus의 즉시 획득 가능한 TAM”으로 부르지 않고 산업 전체 맥락으로만 쓴다.
- `$29.106B`는 U.S. Census Bureau Service Annual Survey의 **2022년 미국 시장조사·여론조사 employer firms 매출**이며 FRED series `REVEF54191ALLEST`로 확인한다. 최신 연도처럼 표현하지 않고 초기 시장의 지리적 대용치로만 쓴다.
- 시장 크기보다 더 중요한 것은 첫 타깃이다.
- 권장 타깃: **은행·소비재·프로덕트 팀처럼 A/B 테스트와 선호 조사를 반복하는 리서치 집약 조직**.
- 첫 wedge는 더 좁혀야 한다. 예: “출시 전 소비자 의사결정을 검증하는 국내 프로덕트·인사이트 팀.”
- 본편에서 가장 크게 남기는 숫자는 하나다: “2023년 글로벌 인사이트 산업 $142B.” 미국 `$29.1B`는 슬라이드 7의 초기 시장 대용치로만 작게 보인다.

### 3페이지 — Obulus 루프

- 제품의 핵심 슬라이드다.
- 현재는 질문자와 기여자의 이해관계가 한눈에 보이지 않는다.
- 질문자: 이미 있는 근거를 싸고 빨리 찾음 → 빈칸만 새로 모집.
- 기여자: 한 번 쓴 답이 여러 질문에 재사용될 때마다 정산.
- Obulus: 검색·품질·정산을 연결하고 10% 목표 수수료를 얻음.
- 반드시 “무료 후보 검색”과 “유료 원문 열기” 사이에 명확한 경계를 그린다.

### 4페이지 — 40 → 5 → 4 → ₩60 예시

- 가장 강한 wow point다. 본편에 크게 유지한다.
- `₩60`은 현재 seeded demo price 예시이지 검증된 시장가격이 아니다.
- 표현: “데모 가격 기준 4개 독립 근거, 총 ₩60.”
- 한 줄 추가: “40개 전체를 사는 것이 아니라, 질문에 맞는 독립 저자의 문서만 산다.”

### 5페이지 — 개인 Agent·버전·동의

- 중요한 내용이지만 5분 본편에서는 루프와 중복된다.
- 본편 슬라이드 6의 메모리·신뢰 그래프로 합친다.
- 원본·버전·동의·철회·포인터 구조는 어펜딕스에서 설명한다.

### 6페이지 — PageRank와 검색 점수

- 아이디어는 좋지만 관객이 갑자기 수학 슬라이드를 만난다.
- 본편에서는 공식 대신 비유만 사용한다.
  - 웹사이트 → 개인 DB/근거 문서
  - 링크 → 검증된 인용·교차 확인·실제 결과
  - teleport → 현재 질문과 가까운 근거
- `60/12/13/10/5` 공식은 어펜딕스에 둔다.
- “벡터 임베딩”이라고 말하지 않는다. 현재 768차원 표현은 학습 모델이 아니라 단어·문자 n-gram feature hashing이다.

### 7페이지 — x402·Pay.sh·Solana

- 로고가 많아 시스템의 핵심이 오히려 약해진다.
- 공식 로고는 최대 3개만 두고, 거래 순서를 크게 그린다.
- 반드시 말할 것: “구매자는 Devnet USDC만 필요하고 SOL은 필요 없다. facilitator가 fee-payer 서명을 채우고 네트워크 수수료를 후원한다.”
- 주의: facilitator는 사용자의 데이터 가격을 대신 내는 것이 아니다. **네트워크 실행 수수료**를 부담한다.
- 본편 유지: 슬라이드 5로 재구성.

### 8페이지 — GCP 파이프라인

- 실제로 매우 강한 증거인데 현재 너무 작다.
- 4개 Cloud Run 서비스의 독립 책임을 보여준다.
  - API: 동의·메모리·quote·원장
  - gateway: x402 challenge·settlement ingress
  - orchestrator: Agent job·Pay.sh 구매
  - pay: 결제 수집·복구
- Cloud SQL, Tasks, KMS, Secret Manager는 “왜 필요한가”를 한 단어로 붙인다: 상태, 내구 재시도, 비수출 키, 비밀.
- 본편 슬라이드 4의 실행 rail과 슬라이드 6의 전체 아키텍처에 나누어 배치하고,
  어펜딕스 A2에서 서비스 경계를 확대한다.

### 9페이지 — 분리된 권한·영수증

- 신뢰의 핵심이므로 삭제하지 말고 Solana 결제 슬라이드와 합친다.
- “서버가 사기를 못 친다”는 절대 표현은 금지한다.
- 정확한 표현: “사용자 서명·capability 범위를 넘는 결제는 승인되지 않으며, 서비스 키는 KMS에서 반출할 수 없다. 단, 현재 hosted service wallet은 완전한 trustless escrow가 아니므로 IAM·감사로그·원장·두 RPC 검증이 필요하다.”

### 10페이지 — Gemini → Rust → HIT/PARTIAL/MISS

- AI 자율성 30%를 얻는 핵심 슬라이드다.
- 현재 그림의 역할을 명확히 구분한다.
  - Gemini 1: 질문을 해석하고 허용된 검색 도구 인자를 선택.
  - Rust: 권한·동의·가격·중복·PageRank·상태 전이를 결정적으로 검증.
  - Gemini 2: aggregate 결과를 보고 구매 제안·hybrid·open call·무료 baseline·종료 중 하나 선택.
  - 서버: 모델 선택이 실제 HIT/PARTIAL/MISS와 맞는지 재검증.
- A2A라고 부르지 않는다. “두 단계 역할 분리 Agent loop”라고 부른다.

### 11페이지 — 비즈니스 모델

- 90/10은 목표 정책이다. 현재 hosted Devnet receipt가 한 거래에서 완전한 90/10 split을 항상 보여 주는 것은 아니다.
- `50,000 questions/month`는 traction이 아니라 시나리오다.
- 본편에서는 시장 매출 표 대신 PoC 설계를 보여 주는 편이 강하다.
  - 20~50개 실제 구매 질문
  - 30~100명 동의 기여자
  - usable evidence당 비용·시간 절감·재사용률·분쟁률 측정
- 수익 시나리오 표는 어펜딕스.

### 12페이지 — 미래

- 방향은 좋다.
- 추상적 문구보다 처음의 한 문장으로 닫아야 한다.
- 권장 마지막 멘트: “AI가 사람의 경험을 필요로 하는 순간, Obulus가 그 경험을 검색하고 사용한 사람에게 바로 돌려줍니다.”

### 13페이지 — 콜드 스타트

- 어펜딕스 유지.
- Instagram·X·LinkedIn OAuth, Obsidian, mem0, local skill을 검토한 decision matrix로 바꾼다. “안 했다”가 아니라 API 단위경제·OAuth token 보안·provenance·삭제 책임 때문에 순서를 늦췄다고 설명한다.
- 좁은 cohort, 검증된 starter prompt, 부분 HIT에서의 Open Call, 초기 디자인 파트너로 해결한다.

### 14페이지 — Open Call

- 어펜딕스 유지.
- 기존 근거가 부족할 때만 발동하는 **보완 경로**임을 강조한다.
- MISS마다 자동 유료 모집을 만들지 않는다. 완전 MISS는 무료 baseline 또는 종료가 기본이다.

### 15페이지 — 스팸 규칙

- 어펜딕스 유지.
- paid/self/UGC/agent-inferred edge가 authority 0점이라는 현재 규칙을 넣는다.
- reciprocal organic edge는 20%만 인정한다.

### 16페이지 — Devnet 거래 순서

- 어펜딕스 유지.
- fee payer, payer, asset mint, recipient, exact atomic amount, memo, finality가 보이도록 수정한다.

### 17페이지 — 공격 시나리오

- 어펜딕스 유지.
- 중앙서버 위조, replay, RPC 불일치, KMS 권한 오용, 중복 정산, 데이터 철회, 출처 담합을 포함한다.

### 18페이지 — 시장 시나리오

- 어펜딕스 유지.
- TAM·SAM·SOM과 수익 시나리오를 구분하고 모든 가정을 표기한다.

### 19페이지 — 생태계

- 로고 모음은 축소한다.
- 기술별 “왜”를 한 줄로 대응한다.
  - Gemini/Vertex: 계획·다음 행동 선택
  - Rust: 결정적 정책·성능·Solana 친화 타입
  - Cloud Run/SQL/Tasks/KMS: 확장·상태·재시도·키
  - Solana/x402/Pay.sh: 작은 USDC 거래·Agent 결제 표준·가스 후원

---

## 3. 발표 전 반드시 지켜야 할 진실성 원장

| 주장 | 현재 사실 | 발표에서 허용되는 문구 | 금지 문구 |
|---|---|---|---|
| Gemini 자율성 | 두 번의 bounded Vertex function call이 검색 조건과 다음 행동을 선택 | “Gemini가 계획하고 결과를 관찰해 다음 도구를 고릅니다.” | “Gemini가 결제 금액과 지갑을 마음대로 정합니다.” |
| A2A | 표준 A2A 프로토콜은 없음 | “역할 분리된 두 단계 Agent loop와 결정적 코어가 협업합니다.” | “A2A 프로토콜을 구현했습니다.” |
| 결제 승인 | 결제 제안은 사용자 승인 또는 사전 설정 capability 범위에서만 진행 | “Agent는 승인된 잔액과 정확한 quote 안에서만 결제합니다.” | “Agent가 사용자 몰래 자동 결제합니다.” |
| Passkey | 구현되지 않음 | “현재는 Phantom signMessage와 gas sponsorship으로 단계를 줄였습니다. Passkey는 P1입니다.” | “Passkey 로그인입니다.” |
| Gasless UX | Devnet x402 경로에서 facilitator가 fee-payer 역할과 네트워크 fee 후원 | “구매자는 SOL 없이 Devnet USDC로 결제합니다.” | “모든 네트워크와 모든 거래가 영구적으로 무료입니다.” |
| Pay.sh | official client와 KMS signer를 사용하는 hosted 경로 및 MCP/CLI 직접 경로 존재 | “Pay.sh challenge를 공식 client로 처리합니다.” | “Pay.sh가 우리 중앙서버를 완전히 제거했습니다.” |
| 90/10 | UI·settlement preview는 1,000bps 정책과 문서별 atomic ceiling 반올림을 사용한다. 현재 hosted Pay.sh/MPP 직접 경로는 소유자 몫과 1 atomic 플랫폼 이전을 별도로 검증하므로 실제 receipt와 동일한 90/10이라고 주장할 수 없다. | “상용 목표 정책은 소유자 약 90%, 프로토콜 10%이며 atomic 반올림과 실제 배분은 영수증에 표시합니다.” | “모든 현재 거래가 어떤 원자 단위에서도 온체인에서 정확히 90/10으로 한 번에 분배됩니다.” |
| Open Call escrow | 현재 backend ledger + KMS service wallet이며 지급·환불 불변조건은 코드와 자동화 테스트로 검증한다. 최신 발표용 실거래 증거는 별도 hard gate다. | “현재 Devnet 원장·서비스 지갑 경로를 구현했고, 실제 지급·환불은 발표용 receipt가 통과한 경우에만 live로 보여줍니다.” | “감사된 mainnet PDA escrow가 배포됐습니다.” |
| 스마트컨트랙트 | 결제·영수증 검증 로직과 Solana transaction policy는 있음. 별도 감사된 escrow program은 없음 | “정확한 거래 메시지와 영수증 정책을 검증합니다.” | “개발자도 접근 불가능한 완전 고정 스마트컨트랙트 지갑입니다.” |
| 영수증 | 승인, quote, 문서 버전, 금액, 수취인, tx/finality를 증명 | “무엇을 얼마에 열었는지 검증합니다.” | “답변 내용이 진실임을 블록체인이 증명합니다.” |
| Learned embedding | 없음. 768차원 feature-hashed lexical/character representation | “어휘·문자 유사도와 그래프 권위를 함께 씁니다.” | “Vertex embedding/학습형 semantic embedding을 사용합니다.” |
| PageRank | query-personalized PageRank, damping .85, 40회 반복, positive authority edge만 사용 | “질문에 가까운 근거에서 시작해 독립 검증 관계를 따라 권위를 전파합니다.” | “Google 검색 알고리즘을 그대로 복제했습니다.” |
| 자동 망각 | 검색 freshness는 90일 반감·최저 .2. 원문 자동 삭제는 없음 | “오래된 문서는 검색 순위에서 감쇠합니다.” | “오래된 개인 데이터가 자동 삭제되고 추상화만 남습니다.” |
| 추상화 | 정산 관측 3개마다 L1, reflection 3개마다 L2…L5. exact child pointer 유지. 현재 deterministic keyword/template | “원문 포인터를 유지하며 L1~L5로 재귀 추상화합니다.” | “현재 Gemini가 importance 1~10을 매번 채점하고 threshold 150에서 reflection합니다.” |
| GCP | 4 Cloud Run 서비스, Cloud SQL 16, Cloud Tasks, KMS, Secret Manager; `2026-08-20T02:28:11.900Z` 검증 77/77 | “2026-08-20 11:28 KST 배포 상태를 읽기 전용 검증기로 77개 항목 확인했습니다.” | “무한 확장·무장애가 보장됩니다.” |
| 메인넷 | 현재 핵심 경로는 Devnet에 구현되어 있고 transaction/finality/reconciliation 자동화 테스트를 통과한다. 최신 발표용 실제 Devnet receipt bundle은 아직 없다. | “Devnet 경로를 구현했고, 최신 실거래 증거가 통과한 경우에만 signature와 finality를 live로 보여줍니다.” | “Mainnet에서 상용 운영 중입니다.” |
| 비즈니스 traction | seeded 가격과 데모 거래, PoC 설계. 실제 반복 매출 증거는 아직 없음 | “가격·정산 메커니즘을 검증했고 다음은 WTP PoC입니다.” | “시장 수요와 단위경제가 이미 검증됐습니다.” |

---

## 4. 최종 본편 — 표지 포함 8장 + 90초 라이브 데모

실제 제출·발표 정본은 `docs/obulus-pitch-deck.html?mode=final`의 8장 경로다.
이 절의 뒤쪽에 남아 있는 7개 상세 블록은 **슬라이드 번호가 아니라 콘텐츠 비트**다.
한 비트가 두 프레임에 나뉘거나 여러 비트가 한 프레임에 합쳐질 수 있으며, 무대의
정확한 전환·대본·중단 기준은 [`FINAL-PITCH-RUNBOOK.ko.md`](FINAL-PITCH-RUNBOOK.ko.md)를
단일 정본으로 사용한다.

### 시간표

| 화면 | 시간 | 누적 | 핵심 질문 |
|---|---:|---:|---|
| 1. 표지 | 0:20 | 0:20 | 왜 필요한가? |
| 2. AI가 모르는 인간 데이터 | 0:25 | 0:45 | 누가 어떤 문제를 겪는가? |
| 3. 제품 해결책 | 0:23 | 1:08 | 검색·구매·빈칸 모집이 어떻게 연결되는가? |
| 라이브 제품 | 1:30 | 2:38 | 한 질문이 실제 실행으로 이어지는가? |
| 4. Gemini와 Google Cloud | 0:27 | 3:05 | AI가 무엇을 자율적으로 하고 무엇을 못 하는가? |
| 5. 유료 URL과 결제 | 0:30 | 3:35 | 왜 Solana·x402·Pay.sh이며 어떻게 믿는가? |
| 6. 전체 아키텍처 | 0:28 | 4:03 | 데이터·권한·돈이 어떤 경계를 지나는가? |
| 7. 목표 고객과 진입 시장 | 0:32 | 4:35 | 누가 먼저 도입하고 무엇으로 검증하는가? |
| 8. 증거와 비전 | 1:10 | 5:45 | 구현·운영 증거와 다음 시장은 무엇인가? |
| 버퍼 | 0:15 | 6:00 | 화면 전환·질의 전환 |

### 8개 프레임과 7개 콘텐츠 비트의 대응

| 콘텐츠 비트 | 실제 프레임 |
|---|---|
| Hook | 1 표지 + 2 인간 데이터 |
| Target·Problem | 2 인간 데이터 + 7 목표 고객 |
| Product loop·Example | 3 제품 해결책 + 라이브 제품 |
| AI autonomy | 4 Gemini와 Google Cloud |
| Solana·Trust·Receipt | 5 유료 URL과 결제 |
| PageRank·Memory moat | 3 제품 해결책의 검색선 + 6 전체 아키텍처 + A1 |
| GCP·Business·Close | 6 전체 아키텍처 + 7 목표 고객 + 8 증거와 비전 |

아래의 `슬라이드 1~7` 표기는 원고를 추적하기 위한 과거 콘텐츠 비트명이다. 최종
HTML의 프레임 번호로 읽지 않는다.

---

### 슬라이드 1 — AI가 못 찾는 마지막 데이터

#### 화면 문구

> **AI는 웹을 검색합니다.**<br>
> **Obulus는 사람의 실제 경험을 검색합니다.**

작은 부제:

> 검색은 무료 · 열린 근거만 유료 · 사용한 사람에게 정산

#### 화면 구성

- 왼쪽: “파리에서 1년 산 사람이 실제로 다시 가는 저녁 식당은?”
- 오른쪽: 일반 검색 결과의 공백 → 사람 원문 4개가 나타나는 단일 전환 애니메이션
- 로고 나열 금지.

#### 발표 대본 — 25초

“AI는 공개 웹을 아주 잘 검색합니다. 하지만 ‘파리에서 1년 산 사람이 실제로 다시 가는 식당’처럼 경험을 묻는 순간, 검색 결과는 광고와 일반론으로 바뀝니다. Obulus는 이 빈칸을 사람의 검증 가능한 경험으로 채웁니다. 후보 검색은 무료이고, Agent가 실제 원문을 열 때만 그 사람에게 지불합니다.”

#### 심사 포인트

- 문제와 차별점이 첫 20초에 완성된다.
- “설문 앱”이 아니라 “human evidence search infrastructure”로 프레이밍된다.

---

### 슬라이드 2 — 반복해서 같은 경험을 다시 사는 기업

#### 화면 문구

> **리서치 집약 기업은 같은 사람의 경험을 매번 다시 삽니다.**

- A/B 테스트·선호 조사·출시 전 검증
- 결과는 보고서에 갇히고 다음 질문에 재사용되지 않음
- 글로벌 insights industry: **$142B, 2023** — ESOMAR Global Market Research 2024가 집계한 2023년 매출

#### 화면 구성

- 거대한 숫자 하나 `$142B`.
- 그 아래 **D1 타깃·문제 지도**로 “한 번 묻고 사라지는 답변”과 “다시 검색되고 다시 정산되는 근거”를 대비.
- 은행·소비재·제품팀 아이콘은 최대 3개.

#### 발표 대본 — 35초

“첫 고객은 은행, 소비재, 프로덕트 팀처럼 A/B 테스트와 선호 조사를 반복하는 조직입니다. 이들은 큰돈을 써서 답을 얻지만, 답은 보고서에 갇혀 다음 질문에서 다시 쓸 수 없습니다. ESOMAR의 Global Market Research 2024 보고서가 집계한 2023년 글로벌 insights industry 매출은 1,420억 달러입니다. Obulus의 첫 목표는 이 시장 전체가 아니라, 출시 전 소비자 결정을 반복 검증하는 팀의 ‘다시 묻는 비용’을 줄이는 것입니다.”

#### 증거와 주의

- 출처: ESOMAR/Research World 링크는 어펜딕스에 표기.
- `$142B`를 Obulus의 즉시 획득 가능한 TAM으로 단정하지 않는다.

---

### 슬라이드 3 — 무료로 찾고, 필요한 근거만 연다

#### 화면 문구

> 질문 1개 → 후보 40개 → 관련 근거 5개 → 독립 저자 4명 → **₩60**

세 단계:

1. 무료 후보 검색
2. 독립 저자·가격·버전 확인
3. 필요한 원문만 열고 소유자에게 정산

하단:

> 없으면 전체 설문이 아니라 **빈칸만 Open Call**

#### 화면 구성

- 기존 덱의 40→5→4 예시를 가장 크게 사용.
- 하단 30%에 **D2 도입 시나리오·이해관계 루프**를 두고 질문자, 기여자, Obulus의 돈·데이터 방향을 표시.
- 가격 옆에 “데모 가격” 작은 표기.

#### 발표 대본 — 45초

“질문이 들어오면 Obulus는 먼저 무료로 후보를 찾습니다. 이 예시에서는 40개를 전부 사지 않고 관련성이 있는 5개를 찾고, 중복 저자를 제거해 4명의 독립 경험만 고릅니다. 데모 가격으로 총 60원입니다. 근거가 충분하면 여기서 끝납니다. 일부만 있으면 있는 답을 재사용하고 빈칸만 사람에게 공개 모집합니다. 그래서 질문자는 같은 설문을 반복하지 않고, 기여자는 한 번 쓴 답이 다시 쓰일 때마다 수익을 얻습니다.”

#### Wow point

숫자 변화 하나로 “검색 비용 절감, 중복 제거, 사람에게 정산”을 동시에 보여 준다.

---

### 슬라이드 4 — Gemini가 계획하고 Rust가 경계를 지킨다

#### 화면 문구

> **Plan → Retrieve → Observe → Choose next action**

1. Gemini planner: 질문 해석·검색 필터·문서 수 선택
2. Rust policy core: 동의·가격·중복·PageRank·상태 검증
3. Gemini coverage agent: 구매 제안 / hybrid / open call / 무료 baseline / 종료
4. Server: 실제 HIT·PARTIAL·MISS와 재검증

강조:

> **모델 schema에는 지갑·수취인·가격·예산 변경 권한이 없습니다.**

#### 화면 구성

- **D3 Agent 실행 경로**를 Admin Test의 일렬 노드와 강한 점등 애니메이션으로 표현.
- 역할별 색은 2색만 사용: AI 판단, 결정적 검증.
- A2A 로고 금지.

#### 발표 대본 — 45초

“여기서 Gemini는 단순 답변 생성기가 아닙니다. 첫 번째 Vertex function call이 질문을 해석해 허용된 검색 도구와 필터를 선택합니다. Rust 코어가 동의, 가격, 중복, PageRank와 상태 전이를 결정적으로 계산합니다. 두 번째 Gemini call은 그 결과만 보고 구매 제안, 일부 근거와 Open Call 결합, 무료 일반 답변, 또는 종료 중 다음 행동을 고릅니다. 하지만 모델의 schema에는 지갑, 수취인, 가격, 예산 변경 권한이 아예 없습니다. 자율성은 열어 두되 돈의 경계는 코드로 닫았습니다.”

#### 심사 포인트

- Gemini/Vertex 기반 다단계 계획과 도구 선택.
- A2A 대신 역할 분리와 정책 검증으로 준하는 자율적 의사결정 구조.
- 모델 장애 시 5초 timeout 후 deterministic fallback.

---

### 슬라이드 5 — ₩10을 매번 승인하지 않아도, 모든 거래는 설명 가능하다

#### 화면 문구

> **SOL 없이 USDC로, 승인된 잔액 안에서, 문서별로 정산**

흐름:

Phantom 서명 → 30일 scoped capability → x402 challenge → Pay.sh/KMS signer → Solana Devnet → 두 RPC finalized → 영수증

영수증 큰 필드:

- 문서 ID·버전·content hash
- payer·recipient·mint·atomic amount
- quote expiry·nonce·idempotency key
- transaction signature·finality·refund/dispute status

#### 화면 구성

- 왼쪽: **D4 결제·신뢰·영수증 sequence**.
- 오른쪽: 실제 영수증 UI 확대.
- facilitator가 “network fee payer”라는 라벨을 transaction 위에 붙인다.

#### 발표 대본 — 50초

“마이크로 결제를 매번 Phantom에서 승인하면 제품이 아닙니다. 사용자는 처음에 지갑으로 로그인하고 정해진 잔액과 기간에만 유효한 capability를 만듭니다. 잔액이 부족할 때만 USDC refill을 서명합니다. x402 facilitator가 fee-payer 서명을 채우고 Devnet 네트워크 수수료를 후원하기 때문에 구매자는 SOL이 필요 없습니다. Pay.sh는 KMS의 비수출 서비스 키로 문서별 거래를 만들고, 서로 다른 두 RPC가 finalized 상태에 합의해야 문서를 엽니다. 영수증은 무엇을, 어떤 버전으로, 얼마에, 누구에게 지불했는지 증명합니다. 다만 답변의 진실성은 블록체인이 아니라 다음 슬라이드의 신뢰 그래프가 판단합니다.”

#### 핵심 정직성

- facilitator는 evidence 가격이 아니라 네트워크 fee를 부담.
- 현재 Devnet 실증임을 화면에 표기.
- 현재 Open Call은 감사된 mainnet PDA escrow가 아님.

---

### 슬라이드 6 — 웹의 PageRank를 사람의 근거 그래프로

#### 화면 문구

> 웹 페이지가 아니라 **버전된 인간 근거 문서**가 노드가 됩니다.

- teleport: 현재 질문과 가까운 근거
- positive edge: 독립 인용·교차 확인·검증된 실제 결과
- zero authority: 결제·자기 인용·UGC·Agent 추론
- reciprocal organic edge: 20%만 인정

하단 메모리:

> L0 원문 → L1 패턴 → L2 규칙 → L3 성향 … L5 상위 통찰<br>
> 모든 상위 통찰은 하위 원문 포인터를 유지

#### 화면 구성

- **D5 메모리 추상화·Personalized PageRank**에서 질문 seed가 근거 그래프 일부를 밝히고 권위가 흐르는 한 장의 애니메이션.
- 아래에 3개 원문이 한 패턴으로 쌓이고 다시 3개 패턴이 규칙으로 올라가는 짧은 트리.
- 수식은 어펜딕스.

#### 발표 대본 — 45초

“블록체인은 결제를 설명하지만 데이터 품질은 설명하지 못합니다. 그래서 웹의 PageRank를 개인 근거 DB에 맞게 바꿨습니다. 웹페이지 대신 버전된 인간 문서가 노드이고, 링크 대신 독립 인용, 교차 확인, 실제 결과가 권위를 전달합니다. 돈을 냈다는 링크, 자기 인용, raw UGC, Agent 추론은 권위가 0점입니다. 서로 주고받은 링크도 20%만 인정합니다. 한편 원문 3개가 쌓이면 L1 패턴, 패턴 3개가 쌓이면 L2 규칙으로 재귀 추상화되고, 모든 상위 통찰은 원문까지 내려가는 포인터를 유지합니다. 오래된 문서는 현재 90일 반감으로 검색 순위가 낮아지며, 자동 삭제 정책은 상용화 과제입니다.”

#### Wow point

“Google의 링크 권위”와 “사람 경험의 근거 관계”가 한 장에서 대응된다.

---

### 슬라이드 7 — 데모가 아니라 운영 가능한 분리 구조

#### 화면 문구

> **4 Cloud Run services · Cloud SQL 16 · Cloud Tasks · Cloud KMS · Vertex AI**

Live infrastructure verification:

- 77 / 77 checks passed
- verified 2026-08-20 11:28 KST · `sweetspot-ax` · `asia-northeast3`
- service-specific revisions·service accounts·image repositories
- PostgreSQL 16 backup·PITR·ENCRYPTED_ONLY
- settlement queue: retry·concurrency·dispatch limits
- non-exportable Ed25519 KMS signer

비즈니스 다음 단계:

> 6주 PoC · 20~50 buyer questions · 30~100 consented contributors

마지막 문장:

> **AI가 사람의 경험을 필요로 하는 순간, Obulus가 검색하고 그 사람에게 돌려줍니다.**

#### 화면 구성

- **D6 GCP 운영 아키텍처**와 실제 검증 결과를 한 화면에 둔다.
- 하단은 PoC 지표 3개만: time-to-evidence, usable evidence cost, reuse/payout rate.

#### 발표 대본 — 40초

“이 흐름은 하나의 데모 서버에 묶여 있지 않습니다. Web과 MCP 요청 뒤에서 Rust API, x402 gateway, Agent orchestrator, Pay service가 독립 Cloud Run revision과 service account로 배포돼 있고, Cloud SQL이 상태를, Cloud Tasks가 정산 재시도를, KMS가 반출 불가능한 Solana 키를 담당합니다. 오늘 읽기 전용 검증기는 77개 항목을 모두 통과했습니다. 다음 6주에는 20~50개 실제 구매 질문과 30~100명 동의 기여자로 근거 확보 시간, usable evidence당 비용, 재사용 정산률을 검증하겠습니다. AI가 사람의 경험을 필요로 하는 순간, Obulus가 그 경험을 검색하고 사용한 사람에게 돌려줍니다.”

---

## 5. 5분 전체 연속 대본

“AI는 공개 웹을 아주 잘 검색합니다. 하지만 ‘파리에서 1년 산 사람이 실제로 다시 가는 식당’처럼 경험을 묻는 순간, 검색 결과는 광고와 일반론으로 바뀝니다. Obulus는 이 빈칸을 사람의 검증 가능한 경험으로 채웁니다. 후보 검색은 무료이고, Agent가 실제 원문을 열 때만 그 사람에게 지불합니다.

첫 고객은 은행, 소비재, 프로덕트 팀처럼 A/B 테스트와 선호 조사를 반복하는 조직입니다. 이들은 큰돈을 써서 답을 얻지만, 답은 보고서에 갇혀 다음 질문에서 다시 쓸 수 없습니다. ESOMAR의 Global Market Research 2024 보고서가 집계한 2023년 글로벌 insights industry 매출은 1,420억 달러입니다. Obulus의 첫 목표는 이 시장 전체가 아니라, 출시 전 소비자 결정을 반복 검증하는 팀의 ‘다시 묻는 비용’을 줄이는 것입니다.

질문이 들어오면 Obulus는 먼저 무료로 후보를 찾습니다. 이 예시에서는 40개를 전부 사지 않고 관련성이 있는 5개를 찾고, 중복 저자를 제거해 4명의 독립 경험만 고릅니다. 데모 가격으로 총 60원입니다. 근거가 충분하면 여기서 끝납니다. 일부만 있으면 있는 답을 재사용하고 빈칸만 사람에게 공개 모집합니다. 그래서 질문자는 같은 설문을 반복하지 않고, 기여자는 한 번 쓴 답이 다시 쓰일 때마다 수익을 얻습니다.

여기서 Gemini는 단순 답변 생성기가 아닙니다. 첫 번째 Vertex function call이 질문을 해석해 허용된 검색 도구와 필터를 선택합니다. Rust 코어가 동의, 가격, 중복, PageRank와 상태 전이를 결정적으로 계산합니다. 두 번째 Gemini call은 그 결과만 보고 구매 제안, 일부 근거와 Open Call 결합, 무료 일반 답변, 또는 종료 중 다음 행동을 고릅니다. 하지만 모델의 schema에는 지갑, 수취인, 가격, 예산 변경 권한이 아예 없습니다. 자율성은 열어 두되 돈의 경계는 코드로 닫았습니다.

마이크로 결제를 매번 Phantom에서 승인하면 제품이 아닙니다. 사용자는 처음에 지갑으로 로그인하고 정해진 잔액과 기간에만 유효한 capability를 만듭니다. 잔액이 부족할 때만 USDC refill을 서명합니다. x402 facilitator가 fee-payer 서명을 채우고 Devnet 네트워크 수수료를 후원하기 때문에 구매자는 SOL이 필요 없습니다. Pay.sh는 KMS의 비수출 서비스 키로 문서별 거래를 만들고, 서로 다른 두 RPC가 finalized 상태에 합의해야 문서를 엽니다. 영수증은 무엇을, 어떤 버전으로, 얼마에, 누구에게 지불했는지 증명합니다. 다만 답변의 진실성은 블록체인이 아니라 신뢰 그래프가 판단합니다.

그래서 웹의 PageRank를 개인 근거 DB에 맞게 바꿨습니다. 웹페이지 대신 버전된 인간 문서가 노드이고, 링크 대신 독립 인용, 교차 확인, 실제 결과가 권위를 전달합니다. 돈을 냈다는 링크, 자기 인용, raw UGC, Agent 추론은 권위가 0점입니다. 서로 주고받은 링크도 20%만 인정합니다. 한편 원문 3개가 쌓이면 L1 패턴, 패턴 3개가 쌓이면 L2 규칙으로 재귀 추상화되고, 모든 상위 통찰은 원문까지 내려가는 포인터를 유지합니다. 오래된 문서는 현재 90일 반감으로 검색 순위가 낮아지며, 자동 삭제 정책은 상용화 과제입니다.

이 흐름은 하나의 데모 서버에 묶여 있지 않습니다. Web과 MCP 요청 뒤에서 Rust API, x402 gateway, Agent orchestrator, Pay service가 독립 Cloud Run revision과 service account로 배포돼 있고, Cloud SQL이 상태를, Cloud Tasks가 정산 재시도를, KMS가 반출 불가능한 Solana 키를 담당합니다. 오늘 읽기 전용 검증기는 77개 항목을 모두 통과했습니다. 다음 6주에는 20~50개 실제 구매 질문과 30~100명 동의 기여자로 근거 확보 시간, usable evidence당 비용, 재사용 정산률을 검증하겠습니다. AI가 사람의 경험을 필요로 하는 순간, Obulus가 그 경험을 검색하고 사용한 사람에게 돌려줍니다.”

---

## 6. 발표 직후 라이브 시연 — 2분 30초~3분

### 시연의 목적

시연은 기능 목록을 둘러보는 시간이 아니다. 다음 네 주장만 증명한다.

1. MCP/앱의 질문이 실제 Agent 실행으로 들어간다.
2. Gemini와 Rust가 역할을 나눠 후보를 찾고 다음 행동을 고른다.
3. 결제 전에 문서·가격·독립 저자·총액이 고정된다.
4. 결제 후 영수증과 실행 trace가 남는다.

### 성공 경로

#### 0:00~0:15 — 질문 입력

권장 질문:

> “성수동에서 실제로 일하는 사람들은 평일 점심시간을 어떻게 보내나요?”

말할 문장:

> “이 질문은 검색 엔진의 장소 목록보다 실제 생활자의 경험이 필요한 질문입니다.”

#### 0:15~0:45 — Admin Test 실행 trace

보여 줄 노드:

1. Web·MCP·Agent 요청
2. Cloud Run gateway
3. Rust policy core
4. L0→L3 추상화 stack/evidence index
5. hybrid candidate search
6. Personalized PageRank
7. 조회·추천 결과

말할 문장:

> “화면 밖 MCP 요청 하나가 들어왔고, 각 점등은 실제 observatory event를 재생합니다. Gemini가 허용된 도구를 고른 뒤 Rust가 후보와 권한을 다시 계산합니다.”

주의:

- MCP 명령창은 영상이나 무대 화면에 보여 줄 필요가 없다.
- Admin Test 화면에 임의로 움직이는 mock animation을 넣지 않는다. 실제 event가 없으면 점등하지 않는다.
- 현재 확보한 백업 영상: `artifacts/obulus-admin-test-live.mp4`.

#### 0:45~1:20 — 무료 후보와 정확한 quote

보여 줄 항목:

- selected document count
- independent author count
- 문서별 가격
- total price
- quote expiry
- HIT / PARTIAL / MISS 결과

말할 문장:

> “이 단계까지는 무료입니다. 원문은 보이지 않지만 몇 개의 독립 근거가 있고 얼마인지 확인할 수 있습니다. Agent가 가격을 정한 것이 아니라 서버가 고정한 문서 버전과 가격을 그대로 제안합니다.”

#### 1:20~2:05 — 승인된 범위 안의 결제

보여 줄 항목:

- prepaid capability 또는 명시적 승인 상태
- x402 challenge
- transaction signature
- mint와 atomic amount
- fee payer와 recipient
- two-RPC finalized

말할 문장:

> “사용자는 SOL을 준비하지 않습니다. facilitator가 네트워크 fee를 후원하고, 사용자의 USDC만 정확한 문서 금액으로 이동합니다. 이미 승인한 capability 범위를 벗어나면 이 경로는 진행되지 않습니다.”

#### 2:05~2:35 — 영수증과 열린 문서

보여 줄 항목:

- 문서 handle·version·content hash
- 정산 문서 수
- tx signature/finality
- owner/protocol 정책 표시
- replay 시 추가 청구 0

말할 문장:

> “열린 문서와 transaction은 같은 영수증에 묶입니다. 재시도되더라도 같은 quote와 attempt는 다시 청구되지 않습니다.”

#### 2:35~2:55 — 메모리 재사용

보여 줄 항목:

- 기여자 문서가 shelf에 남음
- L0 원문과 상위 reflection의 pointer
- 다음 질문 검색 대상이 됨

말할 문장:

> “이 답은 한 번의 설문 결과로 사라지지 않습니다. 동의 범위 안에서 다시 검색되고 다시 열릴 때 소유자에게 새로운 수익이 생깁니다.”

### 데모 중단 기준

다음 중 하나가 나타나면 8초 이상 복구를 시도하지 않고 백업 영상으로 전환한다.

- Vertex function call이 timeout되어 fallback만 보이는 경우
- quote와 selected document set의 fingerprint가 불일치하는 경우
- 두 RPC가 finalized에 합의하지 않는 경우
- KMS readiness 또는 Cloud Tasks readiness가 false인 경우
- 영수증에 signature·mint·amount·recipient 중 하나가 빠진 경우

전환 멘트:

> “돈과 근거가 연결되는 경로라 실패를 숨기지 않고 fail closed하도록 만들었습니다. 동일한 live path를 녹화한 검증 영상을 보여 드리겠습니다.”

### 무대 직전 체크리스트

- [ ] 발표용 브라우저 zoom과 화면 비율 고정
- [ ] `/readyz` API·gateway·orchestrator/pay 확인
- [ ] Vertex quota와 ADC 확인
- [ ] KMS active version·service account signer 권한 확인
- [ ] 두 개의 독립 Solana RPC origin 확인
- [ ] Devnet USDC 잔액·운영 SOL 잔액 확인
- [ ] 테스트 질문이 현재 DB에서 HIT 또는 PARTIAL이 되는지 확인
- [ ] 영수증 drawer가 화면에서 잘리는지 확인
- [ ] `artifacts/obulus-admin-test-live.mp4` 로컬 재생 확인
- [ ] Solana Explorer 링크를 새 탭에 미리 열어 둠

---

## 7. AI 기술 자율성 — 코드 수준 설명

### 실제 의사결정 구조

```text
사용자 질문
  ↓
Gemini research_planner
  - search_human_evidence 함수 정확히 1회 선택
  - requestedDocuments와 허용 enum filter만 제안
  - 5초 timeout, temperature 0
  ↓
Rust deterministic retrieval
  - consent / locked state / budget ceiling
  - lexical-character representation
  - relevance gate / duplicate author removal
  - Personalized PageRank / price / quote fingerprint
  ↓
aggregate observation only
  - HIT/PARTIAL/MISS
  - candidate count / selected count / quote available
  ↓
Gemini coverage_agent
  - purchase 제안
  - hybrid research 제안
  - open call 제안
  - 무료 general baseline
  - 구매 없이 종료
  ↓
Rust policy revalidation
  - 실제 coverage 상태와 허용 action 일치 확인
  - 결제 제안은 awaiting approval
```

### 왜 자율성이라고 부를 수 있는가

- 모델은 단순 문장 생성이 아니라 **tool schema 안에서 실행 경로를 선택**한다.
- 첫 모델 호출의 결과가 deterministic retrieval이라는 실제 도구 실행을 바꾼다.
- 두 번째 모델 호출은 첫 도구의 관측을 받아 다음 행동을 선택한다.
- provider 장애나 schema 위반 시 서버가 deterministic fallback을 선택한다.
- 모델과 코어가 역할을 나눠 다단계 상태 전이를 만든다.

### 왜 완전 자율·A2A라고 부르면 안 되는가

- 표준 Agent-to-Agent 프로토콜을 구현한 것이 아니다.
- Gemini 인스턴스끼리 자유 메시지를 교환하는 구조가 아니다.
- tool allowlist와 action policy가 서버에 고정돼 있다.
- 의도적으로 가격·수취인·지갑·결제 실행 권한을 모델에 주지 않았다.

### 발표에서 가장 좋은 표현

> “두 개의 역할 분리 Gemini Agent가 검색 전 계획과 검색 후 행동을 선택하고, Rust 코어가 두 단계 사이의 권한·가격·상태를 결정적으로 검증합니다.”

### 안전 경계

- 모델 입력의 사용자 질문은 untrusted JSON으로 감싼다.
- 함수 이름은 allowlist다.
- 요청 문서 수는 사용자가 준 ceiling을 넘지 못한다.
- inferred filter는 enum만 허용한다.
- 기존 budget을 복사하며 모델이 확대하지 못한다.
- paid synthesis에는 실제로 열린 citation만 전달한다.
- private evidence 내용은 도구 선택 단계에 노출하지 않는다.

### 코드 근거

- `backend/src/orchestrator.rs:223` — 검색 계획
- `backend/src/orchestrator.rs:270` — 다음 행동 계획
- `backend/src/orchestrator.rs:336` — planner system instruction
- `backend/src/orchestrator.rs:392` — purchase는 execute가 아니라 propose
- `backend/tests/agent_autonomy_contract.rs` — allowlist·fallback·approval fingerprint 계약

---

## 8. 왜 Solana 해커톤에서 Rust 코어를 고집했는가

### 한 문장 답변

> **Agent는 확률적으로 판단해도 되지만, 돈·권한·동의·중복 정산은 같은 입력에 항상 같은 결과를 내야 하기 때문에 Rust 코어가 필요했습니다.**

### 이유 1 — Solana와 같은 타입·정수 모델

- Solana 프로그램 생태계의 표준 언어가 Rust다.
- mint, public key, signature, instruction, atomic amount를 문자열 추측이 아니라 명확한 타입과 정수로 다룰 수 있다.
- KRW 표시값과 USDC atomic amount 사이의 부동소수점 오류를 피할 수 있다.

### 이유 2 — 모델과 돈의 경계를 컴파일 가능한 정책으로

- Gemini는 relevance와 next action을 계획할 수 있다.
- budget ceiling, recipient, mint, decimals, allowed program, exact split은 Rust가 검증한다.
- 모델 output을 직접 transaction으로 연결하지 않는다.

### 이유 3 — 동시성·재시도·중복 청구 방지

- Cloud Run instance가 재시작되거나 Cloud Tasks가 재시도해도 quote/attempt/idempotency 상태가 하나의 결정 규칙을 따라야 한다.
- reserve → prepare → sign → submit → finalized → open 단계를 명시적으로 관리한다.
- crash window와 replay를 테스트하기 쉽다.

### 이유 4 — 성능보다 중요한 예측 가능성

- 검색과 PageRank가 빠른 것도 장점이지만 주된 이유는 아니다.
- 심사위원에게 “Rust라서 빠릅니다”만 말하면 약하다.
- 더 강한 표현은 “확률적 Agent 바깥에 결정적 경제 코어를 둔다”다.

### 발표용 20초 답변

> “Solana가 Rust를 쓰기 때문만은 아닙니다. Gemini는 어떤 근거가 필요한지 판단하지만, 누가 얼마를 받고 어떤 문서가 열리는지는 결정적이어야 합니다. 같은 atomic amount와 public key 타입을 Agent부터 Solana 거래까지 유지하고, 재시도에도 중복 청구가 없도록 Rust를 경제 코어로 뒀습니다.”

---

## 9. GCP 인프라와 확장성 — 무엇을 얼마나 잘 썼는가

### 2026-08-20 읽기 전용 재검증 결과

검증 명령:

```bash
npm run finalist:verify-infra -- --project sweetspot-ax --region asia-northeast3
```

결과:

- **77 / 77 checks passed**
- `summary.ready=true`
- 활성 프로젝트: `sweetspot-ax`
- 리전: `asia-northeast3`
- 생성 시각: `2026-08-20T02:28:11.900Z` = 2026-08-20 11:28 KST

### Cloud Run 서비스 분리

| 서비스 | 책임 | 분리 이유 |
|---|---|---|
| Obulus API | 동의·메모리·검색·quote·원장 | 개인정보와 경제 상태의 authoritative API |
| x402 gateway | HTTP 402·SIWX·settlement ingress | 외부 결제 경계와 앱 API 격리 |
| Agent orchestrator | funded job·Pay.sh client·KMS signer | Agent 실행과 결제 실행 권한 최소화 |
| Pay service | 수집·정산·복구 worker | crash/retry recovery와 지급 경로 분리 |

현재 각 서비스는 별도 revision, service account, image repository를 사용하며 serving traffic이 활성 revision에 100% 연결돼 있음을 verifier가 확인했다.

### Cloud SQL PostgreSQL 16

- instance: `ax-apps-db`
- 상태: RUNNABLE
- PostgreSQL 16
- backup 활성
- point-in-time recovery 활성
- transaction log 7일 보존
- connection encryption: `ENCRYPTED_ONLY`
- API가 Cloud SQL을 mount하고 DB URL은 Secret Manager에서 주입

왜 필요한가:

- 결제 시도, quote, capability, consent, memory, agent run, idempotency fence를 하나의 내구 원장으로 관리한다.
- 단, PITR은 돈의 상태를 과거로 되돌릴 수 있어 무조건적인 복구 버튼이 아니다. chain reconciliation과 함께 복구해야 한다.

### Cloud Tasks

- queue: `obolus-settlements`
- 상태: RUNNING
- max attempts: 100
- max retry: 604,800초
- max concurrent dispatches: 20
- max dispatches per second: 20

왜 필요한가:

- gateway가 응답을 잃거나 Cloud Run instance가 재시작돼도 settlement work를 잃지 않는다.
- at-least-once delivery를 idempotent Rust state machine과 결합한다.
- 무한 재시도가 아니라 bounded retry와 dead/backlog 관측이 가능하다.

### Cloud KMS

- key: `solana-service-wallet`
- algorithm: Ed25519 `ASYMMETRIC_SIGN`
- active version: 1
- private key export 불가
- orchestrator와 pay service account에 좁은 signer/verifier 권한

왜 필요한가:

- raw private key나 service-account JSON key를 container에 넣지 않는다.
- key rotation과 IAM audit가 가능하다.
- 그러나 KMS는 “잘못된 transaction을 절대 서명하지 않는다”는 뜻이 아니다. signer 호출 전에 Rust transaction policy 검증과 IAM 최소 권한이 필요하다.

### Vertex AI

- 모델 기본값: `gemini-2.5-flash`
- 공식 Vertex `generateContent`
- ADC 기반 인증
- planner와 next-action decider로 사용
- timeout·allowlist·deterministic fallback 적용

### 현재 확장성의 진짜 강점

- stateless compute는 Cloud Run이 독립적으로 scale한다.
- state는 Cloud SQL로 분리돼 있다.
- 느리고 재시도 가능한 정산은 Cloud Tasks가 흡수한다.
- private key는 KMS에 고정돼 instance 수와 무관하다.
- API·gateway·orchestrator·pay의 권한이 서비스별로 다르다.

### 아직 프로덕션 완성이라고 하면 안 되는 이유

- 실제 트래픽에 맞춘 Cloud SQL HA·connection pool·private IP/VPC 검증이 더 필요하다.
- SLO, alert, incident drill, restore drill, KMS rotation drill이 남아 있다.
- queue 20/s는 검증된 현재 설정이지 최종 처리량 보장이 아니다.
- mainnet RPC·수수료·재조정 정책이 없다.

### 발표용 20초 답변

> “Cloud Run만 썼다는 이야기가 아닙니다. 4개 실행 권한을 4서비스로 분리하고, SQL은 내구 상태, Tasks는 settlement 재시도, KMS는 비수출 서명키를 담당합니다. 오늘 실제 프로젝트를 읽기 전용으로 검사해 77개 인프라 조건을 모두 통과했습니다.”

---

## 10. Solana·x402·Pay.sh 결제의 정확한 작동 방식

### 앱 사용자 경로

```text
1. Phantom connect + login challenge signMessage
2. 사용자가 기간·한도·scope가 있는 prepaid capability 승인
3. Agent가 무료 후보를 찾고 server-owned quote 생성
4. 잔액 부족 시 Phantom이 Devnet USDC refill payload 서명
5. x402 facilitator가 fee-payer signature를 채우고 network fee 후원
6. confirmed atomic amount만 내부 balance에 credit
7. 문서별 amount reserve
8. Pay.sh challenge에 KMS signer로 응답
9. transaction policy decode·검증
10. 두 독립 RPC가 finalized에 합의
11. 문서 open + 영수증 commit
```

### 외부 Agent·MCP 경로

- `apps/obulus-mcp`가 Obulus 검색·quote·질문·문서 열기 도구를 제공한다.
- 외부 Agent는 x402/Pay.sh 경로를 통해 자기 결제 권한 안에서 요청한다.
- Obulus 중앙서버가 외부 Agent의 private key를 받지 않는다.
- hosted app 사용자와 local Agent 사용자를 같은 데이터·quote 규칙으로 연결한다.

### facilitator가 부담하는 것

- Solana transaction의 network fee payer 역할.
- 거래 제출과 confirmation monitoring.
- Devnet 테스트 경로의 네트워크 fee sponsorship.

### facilitator가 부담하지 않는 것

- 구매하는 evidence의 USDC 가격.
- contributor payout.
- 사용자의 잔액 부족.
- 잘못된 quote에 대한 사업상 책임 전체.

### “SOL이 없어도 된다”의 정확한 의미

Solana transaction은 fee payer 계정에서 실행 수수료를 먼저 차감한다. x402 facilitator가 fee payer가 되므로 구매자는 SOL을 보유하지 않고 Devnet USDC만 서명할 수 있다. 이 UX가 gasless다. 사용자가 어떤 자산도 없이 결제한다는 뜻은 아니다.

### Pay.sh 지갑은 요청마다 새로 생기는가

- 아니다.
- hosted 경로의 KMS service wallet은 고정된 운영 identity다.
- 요청마다 새 wallet을 생성하는 대신 quote·attempt·capability·nonce로 요청 범위를 분리한다.
- local Pay.sh 사용자는 로컬 wallet/capability를 사용한다.

### Phantom에서 무엇을 누르는가

- 최초 연결과 login challenge에 signMessage.
- capability 생성 또는 USDC refill처럼 새 권한·자금 이동이 필요할 때 서명.
- 이미 승인된 capability와 잔액 안의 문서별 결제는 매번 Phantom confirm을 요구하지 않도록 설계.

### Devnet 선례

기존 engineering evidence에는 hosted run `hosted-devnet-1786442491484`에서 다음이 기록돼 있다.

- funding: 7,408 atomic Devnet USDC
- payout: 3,704 atomic
- refund: 3,704 atomic
- two-RPC finality
- duplicate charge: 0

이 값은 과거 실증 run의 증거다. 발표 당일 freshness gate를 다시 통과하지 않았다면 “오늘 live”라고 말하지 않고 어펜딕스에 timestamp와 함께 제시한다.

---

## 11. 사기 방지·스마트컨트랙트 지갑·청구서

### 먼저 바로잡아야 할 전제

고정된 smart-contract/PDA escrow는 중앙서버가 임의로 돈을 꺼내는 위험을 크게 줄일 수 있다. 하지만 현재 Obulus Open Call은 감사된 mainnet escrow program이 아니라 backend ledger와 KMS service wallet이다. 따라서 현재 발표는 “완전 trustless”가 아니라 **서명 범위, 비수출 키, 결정적 transaction 검증, 불변에 가까운 영수증, 다중 RPC reconciliation으로 중앙 신뢰를 축소했다**고 해야 한다.

### 서버가 만들 수 없는 것

- 사용자의 Ed25519 private key 서명
- 만료되지 않은 capability의 범위 밖 권한
- 이미 고정된 quote와 다른 payer-approved transaction
- 두 독립 RPC가 모두 반환하는 finalized chain history

### 서버가 여전히 악용할 수 있는 것

- 악성 UI로 잘못된 capability 서명을 유도
- KMS signer 권한을 가진 workload가 정책 검증을 우회
- DB metadata나 quote를 조작
- contributor identity나 quality label을 부정확하게 관리
- service wallet에 과도한 잔액을 보관

따라서 “개발자도 절대 접근할 수 없다”는 문구는 현재 사용할 수 없다.

### 필수 청구서 필드

| 범주 | 필드 |
|---|---|
| 식별 | invoice ID, research job ID, query ID, agent run ID |
| 요청 | canonical query fingerprint, filters, requested document ceiling |
| 승인 | payer wallet, capability ID, scope, limit, expiry, approval fingerprint |
| 근거 | document handle, version, content hash, consent version, author/owner ID |
| 가격 | display currency, KRW quote, USDC atomic amount, decimals, conversion policy |
| 수취 | owner recipient, protocol recipient, intended split, actual transfer breakdown |
| 네트워크 | chain/network, mint, fee payer, allowed programs, recent blockhash |
| 재시도 | quote nonce, idempotency key, attempt ID, previous attempt link |
| 거래 | canonical message hash, payer signature, KMS signature, transaction signature |
| 확정 | RPC origin A/B, confirmation status, slot/block time, finalized timestamp |
| 결과 | opened document count, delivered versions, access token hash |
| 사후 | refund, void, dispute, correction, source withdrawal, reconciliation status |

### 영수증이 막는 공격

| 공격 | 통제 |
|---|---|
| 없던 거래 생성 | 사용자 signature/capability fingerprint와 canonical tx message 비교 |
| 가격 변경 | quote에 document version·amount·mint·expiry 고정 |
| 수취인 바꾸기 | exact recipient ATA와 transfer instruction decode |
| 중복 청구 | idempotency key·attempt fence·chain signature reconciliation |
| 문서 바꿔치기 | content hash·version·opened handles 영수증에 포함 |
| 미확정 거래로 문서 열기 | 서로 다른 두 RPC finalized 합의 |
| KMS 키 탈취 | private key non-exportable, service account 최소 권한, audit log |
| 서버 재시작 중 유실 | Cloud Tasks + durable attempt state + recovery worker |

### 영수증이 막지 못하는 공격

- 사람이 거짓말한 내용
- 담합한 여러 기여자가 같은 거짓을 반복
- 편향된 모집단
- 합법적이지만 오래돼 의미가 줄어든 경험
- 개인을 재식별할 수 있는 민감한 추상화

이 문제는 provenance, independent author diversity, verified outcome, dispute/correction, freshness, consent/withdrawal 정책으로 관리한다.

### 상용화를 위한 trust-minimized escrow 로드맵

1. Open Call별 program-derived address를 생성한다.
2. deposit, deadline, selection rule, refund rule, fee rule을 immutable instruction data로 고정한다.
3. backend는 winner evidence를 제안하되 program이 허용된 attestation/threshold만 집행한다.
4. upgrade authority는 timelock·multisig 또는 제거 정책을 명시한다.
5. 외부 감사를 거친 뒤 mainnet에 제한된 금액으로 시작한다.
6. UI 영수증에 program ID, PDA, instruction, upgrade authority 상태를 표시한다.

### 발표용 20초 답변

> “영수증이 데이터의 진실을 증명한다고 말하지 않습니다. 영수증은 사용자가 승인한 범위, 열린 문서 버전, 정확한 금액과 수취인, finalized 거래를 증명합니다. 현재 hosted wallet은 KMS와 원장으로 위험을 줄였고, 완전한 trust minimization이 필요한 Open Call은 감사된 PDA escrow가 다음 단계입니다.”

---

## 12. PageRank를 개인 DB 검색에 가져온 정확한 방식

### 웹 PageRank와 Obulus의 대응

| 웹 검색 | Obulus |
|---|---|
| 웹페이지 | 버전된 인간 근거 문서·개인 DB 노드 |
| hyperlink | 인용·교차 확인·검증된 결과·맥락화 관계 |
| 링크를 많이 받는 페이지 | 독립 근거가 지속적으로 지지하는 문서 |
| query-independent rank | 질문별 teleport로 개인화된 authority |
| link farm | 자기 인용·상호 담합·돈으로 산 edge |
| crawl/index | 동의된 metadata 검색·evidence index |

### 검색은 PageRank 하나로 하지 않는다

현재 최종 점수:

```text
final score =
  relevance      × 0.60
+ term coverage  × 0.12
+ authority      × 0.13
+ trust          × 0.10
+ freshness      × 0.05
```

먼저 eligibility gate를 통과해야 한다.

- relevance ≥ 0.22
- query term coverage > 0
- 핵심 anchor term 중 하나 이상 일치
- consent·locked·filter·budget 조건 통과

즉, 인기 있고 최신인 문서라도 질문과 무관하면 검색 결과에 들어오지 못한다.

### 현재 relevance 표현의 정직한 설명

- 768차원 벡터를 사용한다.
- 하지만 Vertex Embedding이나 학습형 semantic embedding은 아니다.
- 단어 feature와 2~3자 character n-gram을 FNV-1a로 feature hashing한다.
- cosine similarity로 질문과 문서의 lexical/character 근접성을 계산한다.
- 장점: local·결정적·저비용·감사 가능.
- 한계: 동의어·긴 문맥·다국어 의미 일반화가 학습형 embedding보다 약하다.

발표 문구:

> “현재는 결정적인 어휘·문자 표현으로 후보를 좁히고, 그래프 권위로 재정렬합니다. 학습형 embedding은 recall benchmark를 만든 뒤 추가할 계획입니다.”

### Personalized PageRank

```text
r(next) = (1 - d) × teleport(query)
        + d × link transition
        + d × dangling mass redistribution

d = 0.85
iterations = 40
```

- 현재 질문과 가까운 문서가 teleport seed를 받는다.
- seed 구성은 relevance², coverage, trust에 의해 만들어진다.
- positive authority edge를 따라 rank가 전달된다.
- 연결이 없는 dangling node의 mass도 query teleport에 재분배된다.

### 권위를 전달하는 edge

#### provenance 가중치

| provenance | 가중치 |
|---|---:|
| organic | 1.0 |
| admin_verified | 1.1 |
| outcome_verified | 1.3 |
| sponsored | 0 |
| paid | 0 |
| self | 0 |
| ugc | 0 |
| agent_inferred | 0 |

#### relation 가중치

| relation | 가중치 |
|---|---:|
| cites | 0.8 |
| corroborates | 1.0 |
| endorses | 0.7 |
| verified_outcome | 1.2 |
| contextualizes | 0.35 |
| derived_from | 0 |
| contradicts | 0 |
| disputes | 0 |
| paid_open | 0 |
| accepted_contribution | 0 |
| same_owner | 0 |

negative edge를 버리는 것이 아니다. 저장·감사·분쟁 classifier에는 남기되 **positive authority 전파에는 사용하지 않는다.**

### 스팸 DB와 담합을 어떻게 거르는가

1. 결제로 만들어진 edge는 권위를 전달하지 않는다.
2. 자기 인용과 같은 소유자의 edge는 0점이다.
3. raw UGC·Agent 추론은 0점이다.
4. 상호 organic link는 정상 weight의 20%만 인정한다.
5. 중복 저자를 bundle에서 제거해 한 사람이 여러 문서로 독립성을 가장하지 못한다.
6. verified outcome과 독립 corroboration은 더 높은 weight를 받는다.
7. 질문 relevance gate를 먼저 통과해야 하므로 높은 global rank만으로 무관한 질문을 점유하지 못한다.
8. source lineage와 contradiction/dispute는 별도 감사 신호로 보존한다.

### 아직 필요한 고급 스팸 방지

- 계정·지갑·기기·문체·시간 패턴을 결합한 sybil cluster 탐지
- edge 생성 속도와 reciprocal community 이상치 탐지
- stake가 아니라 검증된 outcome 중심의 신뢰 상승
- graph snapshot과 rank 변화 audit log
- 문서 철회·void 시 영향을 받은 상위 reflection과 rank의 invalidation
- red-team corpus로 precision@k, nDCG, spam infiltration rate 측정

### 왜 Google 알고리즘을 “복제했다”고 하면 안 되는가

- Google Search는 공개되지 않은 수많은 ranking signal과 learned system을 사용한다.
- Obulus는 PageRank의 **query-personalized graph authority 원리**와 spam-resistant edge 설계를 적용한 것이다.
- 발표 표현: “PageRank의 원리를 인간 근거 그래프에 맞게 재설계했다.”

### 코드 근거

- `backend/src/search.rs:522` — 60/12/13/10/5 final score
- `backend/src/search.rs:569` — 768차원 feature hashing
- `backend/src/authority.rs:5` — damping 0.85, 40 iterations
- `backend/src/authority.rs:98` — provenance/relation weight

---

## 13. 소셜 월드모델 메모리 적재·추상화·망각

### 반드시 구분할 세 구조

#### A. 2023식 재귀 reflection 개념

```text
관측 append
→ LLM importance 1~10
→ 누적합
→ >150이면 최근 100개에서 고수준 질문 3개
→ 관련 기억 검색
→ 통찰 생성 + 근거 pointer
→ 통찰도 memory로 append
→ 다음 reflection의 재료
```

장점:

- 개방형 장기 시뮬레이션에서 추상화가 계속 자란다.
- 상위 통찰이 memoized reasoning cache가 된다.
- pointer로 원문까지 내려갈 수 있다.

한계:

- 엔티티당 관측이 얇으면 추상화할 재료가 없다.
- 자율 질문 축이 사람마다 달라져 비교·검증이 어렵다.
- LLM 비용과 drift가 누적된다.

#### B. 2024식 expert reflection 개념

```text
원문 transcript 전체 보존
→ 심리·행동경제·정치·인구통계 등 고정 lens
→ 깊이 1의 전문가 통찰
→ agent context = 원문 + 통찰
```

장점:

- 축이 고정돼 사람 간 비교와 benchmark가 가능하다.
- 원본을 버리지 않아 개인의 디테일을 보존한다.
- 2시간 transcript가 context에 들어가면 retrieval loss를 줄일 수 있다.

한계:

- snapshot이라 경험이 계속 쌓이는 장기 메모리에는 약하다.
- lens 설계자의 편향이 들어간다.

#### C. 현재 Obulus 구현

```text
settled observation 3개
→ L1 reflection 1개

같은 level reflection 3개
→ 다음 level reflection
→ L2 → L3 → L4 → L5

모든 parent
→ exact child IDs 저장
→ L5에서 L0 원문까지 역추적
```

현재 특징:

- importance는 LLM 1~10이 아니라 0~1 deterministic heuristic이다.
- 답변 길이·숫자 specificity·interview depth·question depth를 사용한다.
- reflection summary도 현재 Gemini가 아니라 deterministic keyword/template다.
- L1 importance 0.8, 상위 level은 최대 0.98로 증가한다.
- paid reuse는 새 observation으로 세지 않아 구매가 가짜 인격을 만들지 못한다.
- admin observatory의 threshold 150/window100 표시는 고밀도 목표 정책이지 현재 reflection trigger가 아니다.

### 현재 구현의 가장 좋은 설명

> “Obulus는 낮은 데이터 밀도에서도 동작하도록 3개 관측 단위의 재귀 reflection을 먼저 구현했습니다. 상위 통찰은 원문을 대체하지 않고 exact pointer를 가진 검색 인덱스입니다.”

### 오래된 데이터는 현재 어떻게 처리되는가

- 검색 freshness는 `2^(-ageDays / 90)`이며 최저 0.2다.
- 따라서 90일마다 freshness component가 절반으로 감소한다.
- final score 중 freshness 비중은 5%다.
- 원문 row가 자동 삭제되지는 않는다.
- 상위 reflection만 남기고 원문을 자동 파기하지 않는다.

### 왜 “추상화만 남기면 프라이버시가 해결된다”가 아닌가

- “이 사람은 위험을 싫어한다” 같은 상위 추상화도 개인 데이터다.
- 원문 철회 후에도 상위 통찰이 그 사람을 재식별하거나 민감한 성향을 노출할 수 있다.
- 따라서 abstraction retention은 자동 면책이 아니라 별도의 consent purpose와 TTL이 필요하다.

### 상용화용 권장 lifecycle

```text
L0 원문
  - 목적·동의 version·보존기간·민감도·철회 가능성
  - 암호화·접근정책·freshness decay
  ↓ pointer
L1~L5 추상화
  - source coverage·confidence·last recomputed
  - 개인식별 가능성·사용 목적
  ↓
검색 index
  - consent filter·freshness·authority·query relevance
```

철회/삭제 시:

1. 해당 L0를 locked/void 처리한다.
2. 모든 descendant reflection을 pointer graph로 찾는다.
3. 남은 유효 source로 reflection을 재계산한다.
4. source가 임계치보다 적으면 상위 통찰도 invalid/hidden 처리한다.
5. 검색 index와 PageRank graph를 갱신한다.
6. 이미 발생한 회계 감사 영수증은 개인정보 최소화·hash 중심으로 보존한다.

### 미래 고밀도 정책

관측이 충분히 쌓인 뒤에만 2023식 threshold 정책을 켠다.

- recent window: 100
- importance sum threshold: 150
- high-level questions: 3
- expert lens와 recursive reflection을 혼합
- threshold·prompt·model version을 artifact에 기록
- LLM reflection은 raw evidence와 명확히 구분

### 발표용 20초 답변

> “현재 오래된 원문이 자동 삭제된다고 주장하지 않습니다. 검색에서는 90일 반감으로 감쇠하고, 세 관측마다 L1, 세 패턴마다 L2로 최대 L5까지 추상화합니다. 모든 상위 통찰이 원문 포인터를 유지합니다. 상용화 단계에서는 철회된 원문을 따라 상위 통찰까지 재계산하는 retention 정책을 붙여야 합니다.”

### 코드 근거

- `backend/src/store.rs:18726` — 관측 3개마다 reflection
- `backend/src/store.rs:18784` 부근 — 같은 level 3개씩 recursive reflection
- `backend/src/store.rs:19041` — deterministic importance
- `backend/src/search.rs:510` 부근 — freshness 90일 반감, floor .2

---

## 14. 비즈니스 가치·단위경제·PoC

### 누가 구매하는가

가장 넓은 target:

- 은행의 상품·CX·리서치 팀
- 소비재·F&B 브랜드의 인사이트 팀
- 프로덕트 팀의 출시 전 discovery·A/B test 팀
- 전략·리서치 조직의 전문가 인터뷰 대체/보완 수요

첫 wedge:

> **반복적으로 소비자 의사결정을 검증하지만 과거 인터뷰 답변을 재사용하지 못하는 국내 프로덕트·인사이트 팀**

### 어떤 문제에 돈을 내는가

- 새 설문을 만들고 모집하고 기다리는 시간
- 같은 세그먼트에게 같은 질문을 다시 하는 비용
- 보고서 평균값 때문에 사라지는 소수·개별 경험
- Agent가 공개 웹만으로 답해 발생하는 불확실성
- 원문 출처와 재현 가능한 인용이 없는 리서치 결과

### 구매 단위

- 질문 1개
- 선택된 evidence document 수 `D`
- 문서당 가격 `P`
- 총 GMV `D × P`

목표 정책:

```text
owner payout = GMV × 90%
protocol revenue = GMV × 10%
contribution margin = protocol revenue - variable cost
break-even price = variable cost / (D × fee rate)
```

데모 예시:

| 항목 | 값 |
|---|---:|
| 문서 수 | 8 |
| 문서당 데모 가격 | ₩15 |
| 총 GMV | ₩120 |
| 목표 owner payout 90% | ₩108 |
| 목표 protocol revenue 10% | ₩12 |

이 값은 경제 모델을 설명하는 예시이며 실제 willingness-to-pay 증거가 아니다.

### 현재 비용 항목

- 무료 discovery: Cloud Run·Cloud SQL·검색 CPU/I/O
- Gemini planner/decider: Vertex token·latency
- paid open: KMS sign, RPC read, settlement/recovery
- Cloud Tasks: 재시도·dispatch
- support: dispute·refund·content correction
- contributor acquisition·verification

### 6주 유료 PoC

| 요소 | 목표 |
|---|---|
| 디자인 파트너 | 2~3개 조직 |
| 실제 구매 질문 | 20~50개 |
| 동의 기여자 | 30~100명 |
| 좁은 분야 | 1~2개 cohort |
| 가격 실험 | 문서 bundle별 3개 price point |

핵심 지표:

1. 질문부터 usable evidence까지 걸린 시간
2. usable evidence 1개당 총 비용
3. HIT / PARTIAL / MISS 비율
4. 기존 근거 재사용률
5. 독립 저자 수와 중복 제거율
6. buyer가 실제 의사결정에 인용한 비율
7. contributor 1인당 반복 정산액
8. correction·withdrawal·dispute rate
9. P50/P95 variable cost와 margin
10. 30일 내 반복 구매율

### 비즈니스 impact를 표현하는 방식

좋은 문구:

> “같은 설문을 한 번 덜 하는 것이 아니라, 이미 존재하는 사람의 근거를 먼저 검색해 새로 물어야 할 범위를 줄입니다.”

나쁜 문구:

> “$142B 시장을 우리가 가져옵니다.”

### 성장 루프

```text
더 많은 질문
→ 어떤 근거가 부족한지 더 정확히 관찰
→ 부족한 사람에게만 Open Call
→ 새로운 동의 원문과 상위 reflection
→ 다음 질문의 HIT 증가
→ 질문자의 시간·비용 감소
→ 근거 재사용과 기여자 반복 정산 증가
```

### 방어력

- 결제 자체보다 **질문-근거-결과-정산의 반복 그래프**가 moat다.
- 원문과 상위 추상화가 pointer로 연결된다.
- 독립 저자·outcome·분쟁·철회까지 같은 evidence graph에 누적된다.
- 어떤 질문에서 어떤 문서가 실제로 유용했는지가 calibration signal이 된다.

---

## 15. Web3 UX와 콜드 스타트

### 현재 UX

- 이메일·비밀번호 없이 Phantom wallet login challenge.
- 질문 후보 검색은 무료.
- 문서 가격·총액을 결제 전에 표시.
- facilitator gas sponsorship으로 SOL 필요 없음.
- 30일 scoped prepaid capability로 매 문서마다 confirm하지 않음.
- 별도 영수증 버튼/탭에서 거래와 열린 문서 확인.

### 현재 UX의 한계

- Phantom 설치가 필요한 hosted app 경로는 여전히 비 Web3 사용자에게 장벽이다.
- Passkey가 없다.
- fiat on-ramp가 없다.
- capability가 어떤 권한을 주는지 일반 사용자가 이해하기 어렵다.
- Devnet USDC refill과 실제 돈의 차이를 명확히 표시해야 한다.

### P1 UX 개선

- WebAuthn Passkey + embedded wallet 또는 검증된 account abstraction.
- fiat-to-USDC onboarding.
- capability를 “자동 결제 한도”로 설명하고 기간·1회·총액 limit을 시각화.
- 언제든 revoke.
- 거래별 알림보다 월/한도/이상 결제 알림.
- 영수증을 blockchain explorer 지식 없이도 이해할 수 있게 번역.

### 콜드 스타트 전략

콜드 스타트의 목표를 “가능한 많은 데이터를 빨리 모으기”로 잡지 않는다. Obulus에 필요한 것은 **질문 하나를 유료로 답할 수 있을 만큼 검증된 firsthand evidence의 밀도**다. SNS·Obsidian·mem0를 처음부터 전부 가져오면 문서 수는 늘지만 provenance·동의·철회·단위경제가 함께 약해질 수 있다.

#### 현재 선택: 좁은 cohort에서 quality-adjusted density를 먼저 만든다

1. 반복 질문이 많고 경험 proof를 확인할 수 있는 첫 cohort를 한두 개로 좁힌다.
2. 공인된 public question set은 질문 schema와 benchmark starter로만 사용한다. 공개 답을 개인의 유료 근거처럼 판매하지 않는다.
3. 기여자에게 긴 범용 설문 대신 `언제·어디서·무엇을 선택했고·어떤 결과였는가`가 포함된 질문별 경험을 받는다.
4. 기존 근거가 일부 있는 `PARTIAL`에서만 정확한 빈칸을 Open Call한다. `MISS`는 기본적으로 무료 baseline 또는 종료다.
5. 디자인 파트너의 반복 질문으로 실제로 재구매되는 shelf와 문서 단위를 학습한다.
6. 초기에는 identity·experience proof·독립 저자 다양성·중복을 수동 검증하고, 그 결과를 정책 자동화의 label로 남긴다.

#### 검토했지만 지금 제외한 연결 방식

| 대안 | 기대했던 장점 | 지금 제외한 이유 | 다시 검토할 조건 |
|---|---|---|---|
| Instagram OAuth/API | 일상·관심사·경험의 빠른 초기 seed, 가입 즉시 개인 DB 생성 | API 사용료와 심사·rate limit이 ₩5~₩25 단위 마이크로페이보다 커질 수 있음. access/refresh token 중앙 보관, scope 최소화, revoke·삭제 전파, 미디어 권리와 제3자 정보 제거가 필요함 | API 비용/유효 문서가 목표 원가 이하이고, short-lived token vault·scope preview·삭제 전파·수집 전 미리보기가 완성될 때 |
| X OAuth/API | 공개 발언·관심 주제·시간 순서가 있어 provenance seed로 유용 | 읽기 API 가격과 정책 변동성이 높고, 공개 게시물이 실제 firsthand evidence나 판매 동의를 의미하지 않음. OAuth token과 재배포 권리 경계가 추가됨 | 공식 API 비용이 unit economics를 통과하고, 공개 검색용 metadata와 유료 개인 근거를 완전히 분리할 때 |
| LinkedIn OAuth/API | 경력·직무 맥락을 빠르게 확인해 B2B cohort bootstrap 가능 | 허용 scope와 데이터 사용 목적 제약이 크고, 직장·제3자 정보가 섞임. 프로필은 경험의 진실성과 독립성을 자동 증명하지 않음 | 명시적 partner access, 최소 scope, 사용 목적 동의, claim별 evidence proof가 있을 때 |
| Obsidian local vault | local-first·사용자 소유 Markdown이라 중앙 OAuth token 없이 시작 가능 | vault 전체에는 업무 비밀·타인 정보·불필요한 메모가 섞임. 폴더 전체 업로드는 과수집이고 source·작성 시점·중복 provenance가 약함 | local MCP/desktop connector가 사용자가 고른 note만 client-side redaction·preview·schema validation 후 보내고, 원문 대신 hash/pointer 선택이 가능할 때 |
| mem0 import | Agent 사용자의 기존 구조화 기억을 빠르게 가져올 수 있음 | 제3자 memory store와 Obulus 사이에 동의·retention·삭제 책임이 이중화됨. 요약 기억의 원문 provenance와 판매 권리를 보장하기 어려움 | mem0를 source of truth가 아닌 opt-in import adapter로 쓰고 external ID·source pointer·export/delete 계약을 유지할 때 |
| Claude/ChatGPT용 prompt·skill 복사 | 별도 API 발급 없이 개발자가 바로 써 볼 수 있고 도입비가 낮음 | UX가 수동이고 모델마다 정리 결과가 달라짐. prompt injection·과수집·provenance 손실을 통제하기 어려움 | signed local skill, 선택 미리보기, schema validator, 최소 범위 전송이 함께 제공될 때 |

#### SNS OAuth를 보류한 두 가지 핵심 이유

1. **단위경제:** SNS API 한 번의 수집·갱신 비용이 Obulus의 문서별 마이크로페이보다 커지면, 데이터가 늘수록 거래의 gross margin이 악화된다.
2. **보안·책임:** 중앙서버가 장기 OAuth token을 가지면 token 암호화만으로 끝나지 않는다. 최소 scope, KMS/secret 분리, refresh rotation, revoke webhook, 삭제·철회 전파, 침해 탐지, 감사 로그, 플랫폼별 ToS와 재배포 권리까지 제품 책임이 확장된다.

따라서 현재 제외는 “SNS가 쓸모없다”는 판단이 아니라, **핵심 가설을 검증하기 전에 더 큰 비용·보안·권리 문제를 끌어오지 않겠다는 sequencing 결정**이다.

#### 단계별 bootstrap

| 단계 | 범위 | 통과 기준 |
|---|---|---|
| Phase 0 — question seed | 공인 질문 20~50개와 공개 benchmark로 schema 구성 | 공개 데이터와 유료 개인 근거가 UI·원장에서 구분됨 |
| Phase 1 — narrow cohort | 30~100명 기여자, 1~2개 반복 질문 분야 | 질문당 독립 저자 3명 이상, firsthand field 완성률, 중복률 측정 |
| Phase 2 — partial Open Call | 기존 근거가 일부 있는 질문의 빈칸만 모집 | Open Call 채택률, usable evidence당 비용, 답변까지 걸린 시간 개선 |
| Phase 3 — local-first import | Obsidian·local skill connector 제한 베타 | client-side preview/redaction, source pointer, 삭제 전파, 보안 사고 0 |
| Phase 4 — OAuth connector | 비용·권리·token 보안 gate를 통과한 플랫폼만 추가 | API 비용/유효 문서, revoke SLA, token incident 0, 동의 철회 전파 검증 |

#### 콜드 스타트가 풀리고 있는지 볼 지표

- 활성 cohort당 검증된 firsthand document 수
- 질문당 독립 저자 수와 `HIT / PARTIAL / MISS` 비율
- Open Call 채택률과 usable evidence 한 건의 총비용
- 한 번 채택된 문서의 재사용률과 기여자 반복 정산액
- 중복·분쟁·철회·void 비율
- import source별 API/처리 비용 ÷ 실제 검색·구매 가능한 문서 수
- OAuth connector가 생길 경우 revoke 전파 시간과 long-lived token incident 수

### 거짓 정보 초기 방지

- claim보다 firsthand context를 요구한다: 언제·어디서·어떤 상황·어떤 결과.
- 같은 소유자의 반복 문서를 독립 근거로 세지 않는다.
- 답변의 구체성·이후 rating·accepted/voided 이력으로 reliability를 갱신한다.
- 구매·자기 추천은 authority를 올리지 않는다.
- 실제 outcome과 corroboration이 쌓일 때만 권위가 커진다.
- 분쟁과 철회가 상위 reflection과 rank로 전파돼야 한다.

---

## 16. 프라이버시·중앙서버 리스크

### 왜 중앙서버를 아직 쓰는가

- 검색 index·동의·삭제·가격·결제 상태를 낮은 latency로 조정해야 한다.
- 개인 원문을 public chain에 올리면 삭제·철회가 불가능해진다.
- Cloud SQL과 객체 저장소에서 접근 통제·암호화·retention을 적용하는 편이 낫다.

### 중앙서버에 올리면 안 되는 것

- Phantom private key/seed phrase
- 평문 장기 signing key
- public chain의 개인 원문
- 불필요한 SNS 전체 archive
- 결제와 무관한 wallet tracking metadata

### 서버가 보관하는 최소 정보

- wallet public key와 auth session
- consent version·scope·expiry
- document handle·version·content hash
- 암호화된 원문과 접근 정책
- quote·attempt·receipt·dispute state
- abstraction pointer와 reliability/provenance

### App/MCP 분리의 의미

- hosted app: 비개발자가 하나의 UI로 질문·quote·capability·영수증 사용.
- local MCP: Claude/Gemini/Codex 같은 Agent가 동일 검색·결제 도구를 직접 사용.
- local MCP는 Obulus 데이터를 사용하지만 사용자의 Agent private state 전체를 중앙서버에 복사할 필요가 없다.
- MCP가 중앙서버를 제거하는 것은 아니다. 결제·검색 API에 필요한 최소 요청만 보낸다.

### 상용화 필수 개인정보 통제

- 목적별 consent와 versioning
- row/column-level encryption 및 key separation
- access log와 user export/delete
- correction·withdrawal·descendant invalidation
- 민감정보 classifier와 금지 category
- 최소 보존기간과 회계 영수증의 개인정보 최소화
- 지역·연령 등 작은 cohort의 재식별 risk threshold
- 구매자에게 raw identity를 숨기고 검증 가능한 pseudonymous provenance 제공

---

## 17. 예상 Q&A — 20초 답변과 깊은 답변

### Q1. “그냥 설문 플랫폼 아닌가요?”

20초:

> “설문 플랫폼은 먼저 사람을 모집하고 새 답을 받습니다. Obulus는 먼저 기존 사람 근거를 무료 검색합니다. 충분하면 설문을 만들지 않고, 부족한 부분만 Open Call합니다. 그리고 답이 문서로 남아 다음 질문에서 다시 검색·정산됩니다.”

깊은 답변:

- 단위가 설문지가 아니라 질문 1개와 evidence document다.
- retrieval HIT이면 새 모집이 없다.
- PARTIAL일 때만 missing coverage를 모집한다.
- 답변은 versioned document와 provenance graph로 누적된다.

### Q2. “Gemini가 정확히 무엇을 자율적으로 합니까?”

20초:

> “첫 Gemini call이 질문을 해석해 검색 문서 수와 허용 필터를 고릅니다. Rust 검색 결과가 나오면 두 번째 call이 구매 제안, hybrid, Open Call, 무료 baseline, 종료 중 다음 도구를 고릅니다. 가격·지갑·수취인·예산은 schema에 없습니다.”

깊은 답변:

- 두 function call 사이에 실제 retrieval tool execution이 있다.
- 두 번째 모델은 aggregate observation만 본다.
- server는 모델 action을 HIT/PARTIAL/MISS와 재검증한다.
- 5초 timeout 또는 invalid output이면 deterministic fallback.

### Q3. “A2A를 구현했나요?”

20초:

> “표준 A2A 프로토콜은 아닙니다. 대신 planner와 coverage decider라는 역할 분리 Agent 단계가 Rust tool core를 통해 상태를 전달합니다. 그래서 ‘A2A에 준하는 bounded multi-stage decision loop’라고 표현합니다.”

### Q4. “사람의 답이 거짓이면 결제가 증명해 주나요?”

20초:

> “아닙니다. 결제 영수증은 어떤 버전의 문서를 얼마에 누구에게서 열었는지를 증명합니다. 진실성은 독립 저자, 교차 확인, 실제 결과, 분쟁과 freshness를 반영하는 신뢰 그래프가 평가합니다.”

### Q5. “왜 블록체인이 필요한가요? Stripe로 하면 안 되나요?”

20초:

> “큰 구독료를 받기 위해서가 아니라 Agent가 문서 하나를 열 때 수원 단위의 프로그래머블 거래를 만들고, 서로 다른 Agent와 서비스가 같은 영수증을 검증하기 위해서입니다. 개인 원문은 온체인에 두지 않고 amount·recipient·version hash만 연결합니다.”

깊은 답변:

- 전 세계 Agent가 HTTP 402를 이해하는 machine-payable interface.
- small USDC settlement와 verifiable receipt.
- 데이터는 off-chain, payment/audit anchor는 on-chain.
- 중앙 card processor를 무조건 대체한다는 주장은 아니다.

### Q6. “facilitator가 무엇을 내나요?”

20초:

> “구매자의 문서 가격을 내는 것이 아니라 Solana network fee를 냅니다. facilitator가 fee payer가 되므로 사용자는 Devnet USDC만 서명하고 SOL을 준비하지 않습니다.”

### Q7. “팬텀에서 매번 승인해야 하나요?”

20초:

> “최초 로그인과 새 capability 또는 refill에는 서명합니다. 이후에는 기간·scope·총액이 고정된 capability와 선불 잔액 안에서 문서별로 진행해 매번 confirm하지 않습니다. 한도를 벗어나면 다시 승인해야 합니다.”

### Q8. “Pay.sh 지갑이 요청마다 새로 생기나요?”

20초:

> “아닙니다. hosted 경로는 고정된 KMS service wallet을 사용하고 요청은 quote·nonce·attempt·capability로 분리합니다. local MCP 사용자는 자기 로컬 Pay.sh wallet을 사용합니다.”

### Q9. “중앙서버가 사용자 정보를 훔쳐 가짜 거래를 만들 수 있지 않나요?”

20초:

> “서버는 사용자 private key 서명을 만들 수 없고 capability 범위를 넘는 거래는 승인되지 않습니다. KMS 키도 반출되지 않으며 transaction을 exact mint·amount·recipient로 decode합니다. 다만 hosted service wallet은 완전 trustless가 아니므로 IAM·원장·두 RPC·감사 로그가 필요하고, Open Call PDA escrow는 로드맵입니다.”

### Q10. “스마트컨트랙트가 이미 있나요?”

20초:

> “문서 결제의 Solana transaction policy와 receipt 검증은 있습니다. 하지만 Open Call은 현재 backend ledger와 KMS service wallet이고, 감사된 mainnet PDA escrow program은 아직 아닙니다.”

### Q11. “왜 Rust인가요?”

20초:

> “Gemini는 확률적으로 계획해도 되지만 돈·권한·동의·재시도는 같은 입력에 같은 결과가 나와야 합니다. Rust로 atomic amount, public key, transaction state를 결정적으로 유지해 Solana 경계까지 연결했습니다.”

### Q12. “PageRank를 개인 DB에 어떻게 적용했나요?”

20초:

> “웹페이지 대신 버전된 근거 문서가 노드이고, 링크 대신 독립 인용·교차 확인·검증된 결과가 edge입니다. 현재 질문과 가까운 문서에 teleport seed를 주고 40회 personalized rank를 계산합니다.”

### Q13. “돈이 많은 사람이 PageRank를 살 수 있지 않나요?”

20초:

> “결제, sponsored, 자기 인용, raw UGC, Agent 추론 edge는 authority 0점입니다. reciprocal organic edge도 20%만 인정합니다. 구매량과 권위를 분리했습니다.”

### Q14. “벡터 임베딩도 사용하나요?”

20초:

> “현재 768차원 표현은 학습형 embedding이 아니라 local feature hashing입니다. 어휘·문자 relevance로 후보를 좁히고 PageRank로 재정렬합니다. 학습형 embedding은 benchmark에서 recall 개선을 증명한 뒤 추가할 계획입니다.”

### Q15. “오래된 개인 데이터는 자동으로 잊히나요?”

20초:

> “현재 자동 삭제는 아닙니다. 검색 freshness가 90일 반감으로 낮아지고, 관측은 L1부터 L5까지 pointer를 유지한 채 추상화됩니다. 상용화 전에는 동의 만료와 철회가 상위 통찰까지 재계산되도록 retention engine을 넣어야 합니다.”

### Q16. “추상화가 원문을 왜곡하면요?”

20초:

> “상위 통찰은 원문을 대체하지 않고 child ID를 갖는 index입니다. L3를 클릭해 L0까지 내려갈 수 있고, source가 철회되면 descendant를 찾아 재계산하는 것이 상용 정책입니다.”

### Q17. “지금 reflection은 Gemini가 하나요?”

20초:

> “현재 production code의 recursive summary와 importance는 deterministic heuristic입니다. Gemini expert reflection과 threshold 150/window100은 고밀도 데이터 단계의 정책으로 분리해 두었습니다.”

### Q18. “GCP를 그냥 배포에만 쓴 것 아닌가요?”

20초:

> “4개 Cloud Run 서비스의 권한을 분리하고 Cloud SQL이 원장, Tasks가 settlement 재시도, KMS가 비수출 Ed25519 서명, Vertex가 planner 역할을 합니다. 실제 프로젝트 77개 설정 검사를 모두 통과했습니다.”

### Q19. “얼마나 scale합니까?”

20초:

> “stateless compute는 Cloud Run이 독립 scale하고 settlement burst는 Cloud Tasks가 흡수합니다. 현재 queue는 20 concurrent·20/s로 제한했습니다. 이 숫자를 최대 처리량이라고 주장하지 않고 PoC traffic에서 SQL pool과 latency를 측정해 조정합니다.”

### Q20. “비즈니스 수요가 검증됐나요?”

20초:

> “가격·정산 메커니즘과 데모 거래는 검증했지만 willingness-to-pay는 아직입니다. 6주 동안 2~3개 디자인 파트너, 20~50개 실제 질문, 30~100명 기여자로 시간 절감·usable evidence 비용·반복 구매를 검증합니다.”

### Q21. “콜드 스타트는 어떻게 해결합니까?”

20초:

> “모든 주제를 모으지 않습니다. 반복 질문이 많은 한두 cohort에서 시작해 공인 질문으로 schema만 만들고, 기존 근거가 일부 있는 PARTIAL에서 빈칸만 Open Call합니다. 문서 수가 아니라 질문당 검증된 독립 저자 수와 재사용률을 콜드 스타트 지표로 봅니다.”

### Q22. “왜 SNS나 최신 트렌드를 넣지 않나요?”

20초:

> “Instagram·X·LinkedIn OAuth, Obsidian, mem0까지 검토했습니다. 다만 SNS API 비용은 문서별 마이크로페이보다 커질 수 있고, 중앙서버의 장기 OAuth token은 scope·rotation·revoke·삭제 전파까지 큰 보안 책임을 만듭니다. 지금 병목은 데이터 양보다 검증된 firsthand evidence의 밀도라서, 좁은 cohort와 PARTIAL Open Call을 먼저 택했습니다.”

### Q23. “개인 원문을 온체인에 저장하나요?”

20초:

> “아닙니다. 원문은 접근 통제 가능한 off-chain 저장소에 두고, 온체인에는 결제와 영수증 검증에 필요한 금액·수취인·hash만 연결합니다.”

### Q24. “현재 가장 큰 미완성은 무엇인가요?”

20초:

> “실제 willingness-to-pay, Passkey/fiat onboarding, consent 철회가 상위 reflection까지 전파되는 retention engine, 감사된 mainnet Open Call escrow입니다. 현재 데모와 상용 경계를 명확히 분리하고 있습니다.”

---

## 18. 어펜딕스 구성

본편에서 질문이 나오지 않으면 열지 않는다.

상세 제작 문구와 connector·상태 라벨은 [`OBULUS-PITCH-DIAGRAM-BRIEF.ko.md`](OBULUS-PITCH-DIAGRAM-BRIEF.ko.md)를 따른다.

### A0. 도입 시나리오+전체 아키텍처

- 타깃 기업의 질문이 Web/MCP로 들어오는 지점
- Vertex planner → Rust policy·retrieval → Vertex coverage decider
- 동의 원문 → pointer-preserving 추상화 → Evidence index → Personalized PageRank
- scoped capability → x402 → Pay.sh+KMS → Solana → two-RPC finality → canonical receipt
- 채택 답변 → 기여자 정산 → versioned evidence 재색인 → 다음 HIT 증가
- 우측 trust rail: consent, provenance, version/hash, budget cap, idempotency, receipt, dispute/withdrawal
- 한 장에서 60초 설명이 가능하도록 Clients·Agent control·Evidence·Settlement·Closed loop 다섯 plane으로 구분

### A1. Agent action schema

- planner input/output JSON
- allowed function names
- budget·wallet·recipient가 schema에 없음을 강조
- timeout/fallback

### A2. HIT/PARTIAL/MISS 정책표

| 상태 | 허용 기본 행동 | 금지 행동 |
|---|---|---|
| HIT | selected bundle 구매 제안 | 새 가격·새 수취인 생성 |
| PARTIAL | 기존 근거 + 부족분 Open Call 제안 | 전체 설문 재모집 |
| MISS | 무료 baseline 또는 종료 | 자동 funded Open Call |

### A3. 검색 점수와 Personalized PageRank

- relevance gate
- 60/12/13/10/5 공식
- damping .85·40 iterations
- teleport seed 구성

### A4. 스팸·담합 방지

- provenance/relation weight 표
- paid/self/UGC 0점
- reciprocal 20%
- independent author bundle

### A5. 메모리 현재 구현과 미래 정책

세 열로 보여 준다.

| 현재 low-density | 2023 recursive concept | 미래 hybrid |
|---|---|---|
| 3 observations → reflection | importance sum >150/window100 | density에 따라 trigger 선택 |
| deterministic summary | LLM high-level questions | expert lens + recursive |
| exact pointer | exact pointer | withdrawal recompute |

### A6. canonical invoice

- 실제 UI 캡처
- 필수 필드 12개에 annotation
- “proof of authorization/access, not truth” 표시

### A7. 공격 모델

- malicious UI
- replay/double charge
- KMS misuse
- RPC disagreement
- server metadata tampering
- sybil/collusion
- source withdrawal

### A8. Solana Devnet sequence

- payer USDC
- facilitator fee payer
- KMS signer
- recipient ATA
- exact atomic amount
- two-RPC finalized

### A9. GCP live evidence

- 77/77 verifier output
- 4 Cloud Run revisions
- service accounts
- Cloud SQL backup/PITR/encryption
- Cloud Tasks limits
- KMS key version

### A10. 단위경제·PoC

- `D × P × F`
- variable cost
- break-even
- 6주 실험과 pass/fail threshold

### A11. 프라이버시·retention

- raw data off-chain
- consent/version/TTL
- descendant invalidation
- export/delete/correction

### A12. 공식 출처

- market
- x402 facilitator
- Solana fee payer
- Pay.sh
- Cloud Run/Tasks/KMS
- PageRank research

### A13. 콜드 스타트 옵션과 제품 의사결정 기록

이 장은 “왜 기능을 더 붙이지 않았는가”를 방어하는 장이다. 검토 과정이 없어서 못 한 것이 아니라, 핵심 가설과 단위경제·보안 경계를 먼저 지키기 위해 순서를 정했다는 점을 보여 준다.

| 선택지 | 얻을 수 있는 것 | 비용·위험 | 현재 결정 |
|---|---|---|---|
| Instagram·X·LinkedIn OAuth/API | 빠른 프로필·관심·시간축 seed | API 비용, rate limit/정책 변동, 장기 token 보관, revoke·삭제·재배포 권리 | 보류 |
| Obsidian local vault | local-first 원문과 사용자 소유권 | 과수집, 업무 비밀·타인 정보, provenance·중복·redaction | local connector P1 후보 |
| mem0 import | Agent 사용자의 기존 memory bootstrap | 이중 retention·삭제 책임, 요약 provenance와 판매 권리 | opt-in adapter P1 후보 |
| prompt/skill 복사 | API 발급 없는 저비용 개발자 UX | 수동 UX, 모델별 변형, prompt injection, schema 불일치 | signed local skill로 제한 검토 |
| narrow cohort + PARTIAL Open Call | 검증된 질문별 evidence 밀도 | 초기 운영과 수동 검증 필요 | 현재 채택 |

하단에는 다음 결론만 크게 쓴다.

> **우리는 데이터 양보다 유료 질문을 답할 수 있는 검증 밀도를 먼저 최적화합니다.**

우측 작은 gate:

- API 비용/유효 문서가 목표 원가 이하
- short-lived token vault·scope preview·rotation·revoke 완성
- import 전 client-side 선택·redaction·preview
- source pointer와 판매 동의 보존
- 삭제·철회가 index와 상위 abstraction까지 전파

### A14. 4대 평가 기준 만점 증거 지도

| 평가 기준 | 본편 주장 | 다이어그램 | live artifact | 진실성 경계 |
|---|---|---|---|---|
| AI 자율성 | 관찰 기반 tool/action 선택 | D3 | request ID가 있는 Admin Test trace | 표준 A2A라고 부르지 않음 |
| Business·UX | 먼저 검색하고 빈칸만 모집 | D1·D2 | 무료 검색→가격→scoped pay→영수증 | WTP는 6주 PoC로 검증 |
| GCP | 서비스·상태·재시도·키 분리 | D6 | 같은 시각 verifier·revision·digest | 부하/SLO/mainnet 완성 주장 금지 |
| Solana | exact USDC settlement와 canonical receipt | D4 | 실제 signature·mint·amount·recipient·finality | hosted Devnet과 trustless escrow 구분 |

이 장의 목적은 심사표를 읽는 것이 아니라, 질문이 들어왔을 때 **주장→그림→실행 증거→과장 금지선**을 한 번에 찾게 하는 것이다.

---

## 19. 슬라이드 시각 디자인 감사 기준

### 전체 원칙

- 한 슬라이드에 주장 하나.
- 제목은 결론문으로 쓴다. “Technology” 같은 분류명 금지.
- 최소 35pt, 권장 본문 22pt 이상.
- 숫자는 많아도 3개.
- 로고는 기술 설명을 대신하지 않는다.
- 작은 UI screenshot 여러 개보다 실제 제품 화면 하나를 크게 쓴다.
- 배경은 black/white 두 계열과 Obulus의 teal/violet accent만 사용.
- 무늬·gradient는 정보 계층을 돕는 수준으로 제한.

### 반드시 넣을 wow visual 세 개

1. **40 → 5 → 독립 저자 4 → ₩60** 검색 축약.
2. **노드가 실제로 점등되는 Admin Test Agent trace**.
3. **문서 version과 Solana transaction이 한 장에 묶인 영수증**.

### 주최 측 자유 형식 요구에 대응하는 핵심 다이어그램 7종 + 보조 다이어그램 3종

주최 측이 요구한 “타깃 기관·기업·개인, 해결 문제, 도입 시나리오, 아키텍처”를 말로만 설명하지 않는다. 본편에는 D0~D6을 분산 배치하고, 전체 구조를 한눈에 묻는 Q&A에는 D7을 사용한다. 마지막 검증 장은 D8, 타깃별 진입 비교는 D9다. 아래 code block은 **설계 wireframe**이며 최종 슬라이드에서는 도형·아이콘·곡선 connector로 다시 그린다.

제작자에게 넘길 수 있는 슬라이드별 전체 문구·발표 멘트·화살표 라벨은 [`OBULUS-PITCH-DIAGRAM-BRIEF.ko.md`](OBULUS-PITCH-DIAGRAM-BRIEF.ko.md)에 별도로 정리했다.

#### 공통 제작 규칙

- 슬라이드 비율은 16:9, 기준 canvas는 1920×1080.
- 한 다이어그램의 주 경로는 7개 노드를 넘기지 않는다. 세부 서비스는 group box 안에 넣는다.
- 읽는 방향은 왼쪽→오른쪽, 분기는 위→아래로 고정한다.
- connector는 노드 중앙을 가로지르지 않는 완만한 곡선 또는 round elbow를 사용한다. 선 교차 금지.
- 색 의미를 전 슬라이드에서 유지한다.
  - 검정/짙은 회색: 사용자·기업·외부 시스템
  - teal: 실행 완료·검증된 데이터 경로
  - violet: Gemini의 bounded 판단
  - amber: 돈·승인·정산
  - 연한 회색: metadata·대기·fallback
- 실선은 현재 구현, 점선은 조건부 분기, 얇은 외곽선은 미래 로드맵이다.
- 로고보다 역할명을 크게 쓴다. `Gemini`, `Cloud Run`, `Solana` 로고는 각각 한 번만 허용한다.
- 각 그림 우하단에 `CURRENT`, `DEVNET`, `TARGET POLICY`, `P1` 중 해당 상태를 표시한다.

---

#### D1. 타깃 기관·기업·개인과 해결 문제 지도 — 슬라이드 2

**이 그림이 답해야 하는 질문:** 누가 어떤 일 때문에 돈을 내고, 어떤 개인이 왜 참여하는가?

```text
구매자 타깃                         지금의 반복 작업                         구조적 누수
┌ 은행·보험 제품/리서치 팀 ┐       ┌ 선호 조사·신뢰 조사·A/B 테스트 ┐       ┌ 같은 cohort를 다시 모집 ┐
├ 소비재·F&B·여행 인사이트 팀 ┤ ───▶ ├ 출시 전 사용 맥락 검증          ┤ ───▶ ├ 답이 보고서에 고립       ┤
└ 프로덕트 팀·리서치 기관     ┘       └ 세그먼트별 정성 근거 수집       ┘       └ 평균이 소수 경험을 삭제   ┘

                          오늘: 한 번 묻고 끝나는 조사비
                 ─────────────────────────────────────
                          Obulus: 먼저 검색하고 빈칸만 모집

기여자 타깃                         제공하는 것                           얻는 것
┌ 실제 경험을 가진 개인 ┐          ┌ 동의된 원문·맥락·버전 ┐             ┌ 채택 보상 + 재사용 정산 ┐
└ 특정 상황의 당사자     ┘ ────────▶ └ 철회 가능한 개인 근거 ┘ ──────────▶ └ 자신의 데이터 통제      ┘
```

**노드에 넣을 실제 문구**

| 영역 | 노드 제목 | 보조 문구 |
|---|---|---|
| 구매 기관/기업 | 은행·보험 | 금융상품 선호·신뢰·이탈 이유 |
| 구매 기업 | 소비재·F&B·여행 | 출시·메뉴·매장·실제 사용 맥락 |
| 구매 조직 | 프로덕트·인사이트·리서치 | 반복 A/B·정성 조사·의사결정 근거 |
| 개인 | 경험 기여자 | 직접 겪은 사건, 선택 이유, 결과 |
| 핵심 문제 | 답이 보고서에서 사라짐 | 다음 질문에서 검색·재사용 불가 |
| Obulus 가치 | 먼저 검색하고 빈칸만 모집 | 구매자는 반복 비용 절감, 개인은 반복 정산 |

**시각 구성**

- 왼쪽 32%에 타깃 세 그룹, 중앙 36%에 반복 조사와 누수, 오른쪽 32%에 Obulus 전환 후 결과.
- `$142B`는 좌상단의 2023년 산업 맥락 숫자로만 두고 흐름의 노드로 넣지 않는다.
- “개인”은 고객처럼 혼동되지 않도록 `동의 기여자` 라벨을 붙인다.

---

#### D2. 도입 시나리오와 이해관계 폐루프 — 슬라이드 3

**이 그림이 답해야 하는 질문:** 기업이 실제로 어떻게 도입하고, 질문자·기여자·Obulus의 이해관계가 어떻게 맞물리는가?

```text
[기업 질문 + 대상 조건 + 최대 예산]
                 │
                 ▼
[무료 metadata 후보 검색] → [Rust 관련성·동의·저자 중복·가격 검증]
                 │
                 ▼
         [HIT / PARTIAL / MISS]
          │        │        └─ MISS → 무료 baseline 또는 종료
          │        └─ PARTIAL → 기존 근거 재사용 + 빈칸만 Open Call
          ▼
[선택 문서·독립 저자·총액 제시]
                 │ 사용자 선택 또는 scoped capability
                 ▼
[정확한 문서만 x402/Pay.sh로 열기]
                 │
       ┌─────────┴─────────┐
       ▼                   ▼
[기여자 USDC 정산]     [질문자에게 근거+영수증]
       │                   │
       └─────────┬─────────┘
                 ▼
[채택 답변이 versioned evidence로 재색인]
                 │
                 └────────────── 다음 질문의 HIT 증가
```

**세 이해관계의 하단 요약**

| 참여자 | 얻는 것 | 통제·책임 |
|---|---|---|
| 질문자/구매자 | 이미 있는 근거를 먼저 사고 빈칸만 조사 | 대상·필요 수·예산·채택 조건을 정함 |
| 기여자/개인 | 한 번 쓴 근거가 다시 사용될 때 반복 정산 | 동의·버전·철회·정정 권한 유지 |
| Obulus | 검색·정산·품질 인프라의 목표 10% 수수료 | 중복·provenance·receipt·분쟁·재시도 운영 |

**화살표 라벨**

- 질문자→검색: `질문·대상·예산`
- 검색→질문자: `무료 metadata·가격·독립 저자 수`
- 질문자→결제: `선택 또는 사전 승인 한도`
- 결제→기여자: `선택 문서별 USDC`
- 기여자→서가: `동의 원문·버전·근거 포인터`
- 서가→다음 검색: `재사용 가능한 evidence`

**본편 압축 방법**

- 중앙에는 `40 → 5 → 독립 저자 4 → ₩60`을 가장 크게 둔다.
- 위 전체 루프 중 본편에서는 6개 핵심 노드만 보이고, HIT/PARTIAL/MISS 세부 분기는 A2에서 확장한다.
- MISS가 무조건 유료 Open Call로 가지 않는다는 점을 점선과 `기본: 무료 baseline/종료` 라벨로 분명히 한다.

---

#### D3. Agent 자율 의사결정 실행 경로 — 슬라이드 4

**이 그림이 답해야 하는 질문:** Gemini가 실제로 무엇을 선택하고, 어떤 권한은 Rust가 잠그는가?

```text
[Web / MCP 질문]
       │
       ▼
[Vertex Gemini planner] ── 검색 domain·filter·limit 선택
       │ function schema
       ▼
[Rust policy core] ── 동의·locked·가격·예산·저자중복·상태 전이 검증
       │
       ▼
[Hybrid retrieval + Personalized PageRank]
       │ 후보·coverage·trust·총액
       ▼
[HIT / PARTIAL / MISS 관찰]
       │
       ▼
[Vertex Gemini coverage decider]
       ├─ 구매 제안
       ├─ 기존 근거 + Open Call
       ├─ 무료 baseline
       └─ 종료
       │
       ▼
[Server 재검증] ── 관찰 상태와 다른 action이면 거부/fallback
```

**상단 작은 권한 범례**

| Gemini가 고를 수 있음 | Gemini가 바꿀 수 없음 |
|---|---|
| 검색 필터, 후보 수, 허용된 다음 action | 지갑, 수취인, 문서 가격, 예산 상향, quote, transaction bytes |

**Admin Test 애니메이션 순서**

1. Web/MCP intake 노드 점등
2. Gemini planner violet pulse
3. Rust policy teal border와 검증 check
4. retrieval·PageRank 경로의 edge 이동
5. HIT/PARTIAL/MISS 상태 노드 점등
6. coverage decider pulse
7. server validator를 통과한 action만 결과 노드에 도달

**오류·fallback 표시**

- Vertex timeout 5초: planner 옆에 `deterministic fallback` 얇은 회색 우회선.
- 허용되지 않은 action: 빨간 큰 경고 대신 해당 edge만 끊고 `schema rejected` 작은 라벨.
- `A2A`라는 단어를 넣지 않는다. 제목 아래에 `bounded two-stage agent loop`라고 쓴다.

---

#### D4. 자동 결제·신뢰 경계·canonical receipt — 슬라이드 5

**이 그림이 답해야 하는 질문:** 매번 Phantom confirm 없이도 왜 임의 결제가 불가능하고, 무엇이 증거로 남는가?

```text
구매자 Phantom                 Obulus hosted 경계                       외부 검증 경계
┌ 로그인 signMessage ┐        ┌ scoped capability·선불 원장 ┐
├ refill 때만 USDC 서명 ┤ ───▶ ├ Rust: scope·expiry·balance 검증 ┤
└ private key는 남지 않음 ┘     └──────────────┬──────────────┘
                                              ▼
                                  [x402 gateway: exact 402 quote]
                                              │
                                              ▼
                                  [Pay.sh client + KMS signer]
                                              │ exact mint·amount·recipient
                                              ▼
                                     [Solana Devnet USDC]
                                              │
                                  ┌───────────┴───────────┐
                                  ▼                       ▼
                            [RPC provider A]         [RPC provider B]
                                  └───────────┬───────────┘
                                              ▼
                                   [finalized canonical receipt]
                                              │
                                   [정확한 문서 version만 unlock]
```

**transaction 역할 라벨**

- buyer/capability: 데이터 가격의 경제적 승인 범위
- facilitator: `network fee payer`, 증거 가격을 대신 지불하지 않음
- KMS service wallet: hosted settlement signer, private key export 불가
- Solana: USDC 이동과 transaction finality
- Cloud SQL ledger: quote·reserve·attempt·idempotency·receipt 연결

**영수증 카드에 반드시 보일 필드**

| 구역 | 필드 |
|---|---|
| 구매 근거 | document ID, version, content hash, opened passage 범위 |
| 경제 조건 | quote ID, payer, recipient, USDC mint, atomic amount, displayed total |
| 재실행 방지 | expiry, nonce, idempotency key, attempt ID |
| 체인 증거 | transaction signature, slot, finalized, provider count, Explorer URL |
| 사후 처리 | refund claim/signature, dispute/correction status |

**신뢰 경계 문구**

- 그림 하단 왼쪽: `서버는 Phantom private key를 받지 않음`
- 그림 하단 중앙: `모델은 경제 필드를 생성하지 않음`
- 그림 하단 오른쪽: `영수증은 결제·접근을 증명, 내용 진실은 별도 평가`
- 현재 hosted service wallet은 완전 trustless escrow가 아니므로 `CURRENT DEVNET · hosted trust boundary`를 반드시 표기한다.

---

#### D5. 원문이 상위 개념으로 자라고 질문별 PageRank로 검색되는 과정 — 슬라이드 6

**이 그림이 답해야 하는 질문:** 대량 데이터가 어떻게 추상화되고, 왜 검색할 때마다 같은 인기 문서가 아니라 질문에 맞는 독립 근거가 추천되는가?

**상단 — 현재 메모리 추상화**

```text
[L0 원문 A] ─┐
[L0 원문 B] ─┼─ 3개 settlement observation ─▶ [L1 패턴]
[L0 원문 C] ─┘                                   │ child pointers: A·B·C

[L1 패턴 1] ─┐
[L1 패턴 2] ─┼─ 3개 reflection ───────────────▶ [L2 규칙]
[L1 패턴 3] ─┘                                   │ pointers → L1 → L0

                         같은 방식으로 L3 성향 → L4 모델 → L5 상위 통찰
```

현재 화면 라벨:

- `CURRENT: deterministic keyword/template abstraction`
- `append-only L0 + exact child pointers`
- `철회·정정 시 상위 노드 재계산 필요`

미래 연구 경로는 본편에서 섞지 않고 A5에 얇은 점선으로만 둔다.

```text
P1 연구: observation append → importance 1~10 → window sum > 150
        → 최근 100개에서 질문 3개 생성 → recursive reflection
```

**하단 — 검색과 Personalized PageRank**

```text
[사용자 질문]
      │
      ▼
[768-d local feature hashing: 단어 + 2~3자 n-gram]
      │ relevance gate ≥ .22 + anchor + consent + budget
      ▼
[후보 근거 그래프]
      │ query teleport seed
      ▼
[Personalized PageRank: damping .85 · 40 iter]
      │ positive authority edge만 전파
      ▼
[최종 점수 + 동일 저자/반복 passage 제거]
      ▼
[질문에 필요한 최소 독립 근거 추천]
```

**그래프의 시각 규칙**

- 노드 크기: 최종 질문별 score.
- 노드 외곽선 밝기: query relevance.
- incoming teal edge: 독립 인용·교차 확인·검증된 outcome.
- 회색 edge: 맥락 포인터, authority를 전달하지 않음.
- 끊긴 edge: paid/sponsored/self/raw UGC/agent-inferred, authority 0.
- reciprocal organic edge: 얇은 선과 `×0.2` 라벨.
- 질문 seed는 고정 좌상단이 아니라 검색어에 따라 다른 graph cluster로 이동하는 animation.

**A3에만 표시할 실제 최종 점수**

```text
final score = relevance×0.60 + term coverage×0.12
            + authority×0.13 + trust×0.10 + freshness×0.05
```

본편에서는 수식을 숨기고 `관련성 → 독립 권위 → 최신성 → 저자 다양성` 네 단어만 표시한다.

---

#### D6. GCP 운영·확장 아키텍처 — 슬라이드 4·6의 실행 rail, 어펜딕스 A2 확대

**이 그림이 답해야 하는 질문:** 실제 서비스가 어떤 Google Cloud 경계를 타고 확장되고, 상태·재시도·키가 왜 분리되어 있는가?

```text
외부 채널
[React Web / MCP·CLI]
          │ HTTPS
          ▼
Google Cloud Run — 서비스별 revision·service account·image
┌────────────────────────────────────────────────────────────────────┐
│ [Obulus API] ──job──▶ [Agent orchestrator] ──Pay.sh purchase──┐    │
│      │                         │                               │    │
│      │ quote·ledger            └──────────────▶ [x402 gateway] │    │
│      │                                                  │ 402  │    │
│      └──────────────────────────────────────────────▶ [Pay service]│
└──────────────────────────────────────────────────────────┬─────────┘
          │                   │                  │          │
          ▼                   ▼                  ▼          ▼
[Cloud SQL PostgreSQL 16] [Vertex AI Gemini] [Cloud Tasks] [Cloud KMS]
 quote·consent·memory·      planner/decider      retry·burst  non-export key
 attempt·receipt ledger                                    │
          ▲                                                 ▼
          └──────────────── finalized receipt ◀──── [Solana Devnet]
                                                        │          │
                                                   [RPC A]      [RPC B]

[Secret Manager] ── runtime config·RPC secret를 필요한 서비스에만 주입
```

**4개 Cloud Run 카드의 한 줄 책임**

| 서비스 | 카드 안 문구 | 아이콘 |
|---|---|---|
| Obulus API | 동의·메모리·검색·quote·원장 | database/API |
| x402 gateway | HTTP 402·SIWX·settlement ingress | gateway |
| Agent orchestrator | funded job·Vertex action·Pay.sh client | agent nodes |
| Pay service | 수집·정산·복구 worker | wallet/refresh |

**managed service 라벨**

- Cloud SQL: `내구 상태 · backup · PITR · encrypted only`
- Cloud Tasks: `at-least-once → idempotent Rust state machine`
- KMS: `Ed25519 · private key non-exportable`
- Vertex AI: `planner + next-action decider`
- Secret Manager: `keyless runtime secret injection`

**검증 badge**

다이어그램 우상단 badge는 다음 네 값이 함께 있을 때만 보인다.

```text
77/77 · summary.ready=true
sweetspot-ax · asia-northeast3
verified 2026-08-20 11:28 KST
read-only infrastructure audit
```

새 실행이 이 조건을 통과하지 못하면 badge를 `last verified …`로 낮추고 본문에서 “오늘 live”라고 말하지 않는다.

---

#### D7. 도입 시나리오+전체 아키텍처 한 장 — 슬라이드 6, 어펜딕스 A0 확대

주최 측이 요구한 `도입 시나리오+아키텍처 다이어그램`의 정본이다. 본편 6장에서는
다섯 개 plane과 주 경로를 보여주고, 어펜딕스 A0에서 서비스·상태·trust rail을 확대한다.

```text
① 수요/도입
[은행·소비재·제품팀 질문] ── 질문·대상·예산 ──▶ [Web / MCP]

② Agent control plane
[Gemini planner] → [Rust policy·retrieval] → [Gemini coverage decider]
                         │
                         ├─ HIT: 최소 근거 구매 제안
                         ├─ PARTIAL: 기존 근거 + 빈칸 Open Call
                         └─ MISS: 무료 baseline/종료

③ Evidence plane
[동의 L0 원문] → [pointer-preserving L1~L5] → [Evidence index]
                                              │
                     [feature-hash 후보] → [Personalized PageRank]

④ Payment/control plane
[scoped capability] → [x402 gateway] → [Pay.sh + KMS] → [Solana USDC]
                                                               │
                                                    [2-RPC finality]
                                                               │
                                                    [canonical receipt]

⑤ 폐루프
[채택 답변] → [기여자 정산] → [versioned evidence 재색인] → [다음 HIT 증가]
```

**group box 구조**

- `Clients`: 기업 Web, Gemini/Codex MCP, 기여자 UI
- `Agent control`: Vertex planner/decider와 Rust deterministic core
- `Evidence`: Cloud SQL ledger, memory stream, source-linked index, PageRank
- `Settlement`: x402 gateway, Pay.sh orchestrator, Cloud Tasks, KMS, Solana/RPC
- `Trust`: consent, version/hash, idempotency, receipt, dispute/withdrawal

**발표자가 이 한 장에서 말할 순서**

1. 기업이 질문·대상·예산을 보낸다.
2. Gemini가 검색 계획과 허용된 다음 행동만 선택한다.
3. Rust가 동의·가격·중복·PageRank·상태 전이를 고정한다.
4. 기존 근거가 있으면 필요한 문서만 열고, 부족한 경우에만 사람을 모집한다.
5. Pay.sh/x402가 정확한 USDC 거래를 만들고 두 RPC와 영수증이 접근을 고정한다.
6. 채택 답변은 source pointer를 유지한 새 evidence가 되어 다음 질문 비용을 낮춘다.

이 순서가 바로 Obulus의 제품 루프, AI 자율성, GCP 확장성, Solana 결제, 비즈니스 네트워크 효과를 한 번에 연결한다.

### 최종 본편 8장 이미지·다이어그램 배치표

사진을 모든 장에 채우지 않는다. 본편에서 실제 제품 캡처는 **슬라이드 4·5·7의 증거 화면**에만 쓰고, 숫자·관계·순서가 핵심인 장은 슬라이드 안에서 벡터로 직접 그린다. 작은 UI 캡처를 확대해 다이어그램처럼 사용하는 것은 금지한다.

| 슬라이드 | 사용할 시각물 | 배치 | 파일·제작 상태 | 주의 |
|---|---|---|---|---|
| 1. 표지 | Obulus 3D cutout + `질문→근거→정산` | 질문을 왼쪽 58%, cutout을 오른쪽 42%에 배치 | [`src/assets/product/coverage-hero-cutout.png`](../src/assets/product/coverage-hero-cutout.png), 1536×1024 | 장식 이미지를 traction 증거처럼 보이게 하지 않는다. |
| 2. AI가 모르는 인간 데이터 | D1 문제 지도 + `2023 · $142B` 보조 숫자 | `타깃→반복 조사→보고서 고립`과 Obulus 전환을 2열로 비교 | 슬라이드에서 벡터 제작 | 회사 로고 collage와 근거 없는 시장 막대그래프 금지. |
| 3. 제품 해결책 | D2 폐루프 + `40→5→4→₩60` | funnel 위 60%, 질문자·기여자 폐루프 아래 40% | 슬라이드에서 벡터 제작 | MISS 제품 캡처를 성공 사례처럼 사용하지 않는다. |
| 4. Gemini와 Google Cloud | D3 Agent loop + 실제 Admin Test trace | 왼쪽에 두 번의 Vertex 판단과 Rust 실행, 오른쪽에 4K trace crop | [`04b-admin-architecture-canvas.png`](pitch-final-assets/04b-admin-architecture-canvas.png), 3440×1340 / [`04-admin-live-trace-4k.png`](pitch-final-assets/04-admin-live-trace-4k.png), 3840×2160 | 노드 이름이 읽히게 crop하고 MCP 명령 입력 화면은 넣지 않는다. |
| 5. 유료 URL과 결제 | D4 sequence + canonical receipt | sequence 40%, receipt 60% | **실거래 후 재캡처 필요** | signature·mint·atomic amount·recipient·document version/hash·finality가 같은 run이어야 한다. |
| 6. 전체 아키텍처 | D7 Clients→Agent→Evidence→Settlement→폐루프 | 다섯 group box와 한 개 굵은 주 경로를 화면 전체에 배치 | 슬라이드에서 벡터 제작 | 서비스 로고 나열보다 데이터·권한·돈의 방향을 우선한다. |
| 7. 목표 고객과 진입 시장 | 은행/보험·F&B/CPG·개인 기여자 도입 small multiples | 3열로 `입력 질문→Obulus 행동→성공 지표`를 비교 | 슬라이드에서 벡터 제작 | 고객 가설과 확보 고객을 혼동하지 않는다. |
| 8. 증거와 비전 | GCP verifier badge + 세 evidence gate | `infra/autonomy/devnet` ready 상태와 남은 gate 표시 | 발표 직전 verifier 결과로 갱신 | `ready=false`를 숨기거나 live 완료로 말하지 않는다. |

### 어펜딕스 이미지 배치표

| 어펜딕스 | 권장 시각물 | 방식 |
|---|---|---|
| A0 전체 아키텍처 | D7 Clients→Agent→Evidence→Settlement→Closed loop + trust rail | 5개 group box와 1개 주 경로로 직접 제작. 작은 제품 캡처를 배경으로 쓰지 않음 |
| A1 검색·추상화 | D5 L0→L5 pointer tree + Personalized PageRank | `Evidence index → Hybrid search → PageRank`와 근거 역추적을 한 화면에 배치 |
| A2 GCP 운영 아키텍처 | D6 Cloud Run·SQL·Tasks·KMS·Vertex·Solana | 서비스 경계, 상태 저장, 재시도, 키 경계를 확대 |
| A3 Agent action schema | 실제 JSON schema 12~18줄 | 캡처가 아니라 고정폭 텍스트로 다시 조판 |
| A4 스팸·담합 방지 | organic/paid/self/reciprocal edge 그래프 | 슬라이드에서 직접 제작 |
| A5 메모리 현재·미래 | L0 원문→현재 deterministic L1~L5 / 미래 importance 150 분기 | 슬라이드에서 직접 제작. legacy UI 캡처는 `legacy` 라벨이 있을 때만 보조 사용 |
| A6 canonical invoice | 실제 receipt 상세 | 슬라이드 5와 같은 실거래를 확대하되 transaction·문서 version·접근 범위를 모두 보임 |
| A7 공격 모델 | 위협→통제→잔여 위험 3열 | native diagram |
| A8 Solana Devnet sequence | payer/facilitator/recipient/RPC sequence + Explorer 링크 | 실제 signature가 생긴 거래만 사용 |
| A9 GCP live evidence | verifier terminal 또는 Cloud Run revision 요약 | 발표 직전 read-only verifier로 새로 캡처 |
| A10 단위경제·PoC | 6주 PoC 표 + 1개 waterfall | native chart |
| A11 개인정보·retention | 수집→동의→검색→철회→삭제 lifecycle | native diagram |
| A12 공식 출처 | 로고 최대 4개 + 직접 URL | 작은 사이트 캡처 collage 금지 |
| A13 콜드 스타트 의사결정 | SNS·Obsidian·mem0·local skill·narrow cohort 비교 | `장점 / 비용·위험 / 현재 결정 / 재검토 gate` 4열 decision matrix |
| A14 평가 증거 지도 | 4대 평가 기준의 주장→다이어그램→live artifact→진실성 경계 | 4행 scorecard. 심사표 문구를 길게 복사하지 않음 |

### 현재 고해상도 캡처 판정

| 파일 | 해상도 | 판정 | 사용처 |
|---|---:|---|---|
| [`04-admin-live-trace-4k.png`](pitch-final-assets/04-admin-live-trace-4k.png) | 3840×2160 | **승인** | 슬라이드 4 전체 trace, 시연 예고, A9 보조 |
| [`04b-admin-architecture-canvas.png`](pitch-final-assets/04b-admin-architecture-canvas.png) | 3440×1340 | **승인** | 슬라이드 4 본문, A3/A5 부분 crop |
| [`01-coverage-demand-4k.png`](pitch-final-assets/01-coverage-demand-4k.png) | 3840×2160 | 조건부 | 제품 분위기·coverage UX 보조. 현재 0건·₩0이므로 수요 증거로 금지 |
| [`00-wallet-login-4k.png`](pitch-final-assets/00-wallet-login-4k.png) | 3840×2160 | 보류 | 한국어 상태 재캡처 후 A11/P1 UX에만 사용 |
| [`05-wallet-memory-4k.png`](pitch-final-assets/05-wallet-memory-4k.png) | 3840×2160 | 보류 | 빈 상태 UX 설명에만 사용. 수익·문서 증거로 금지 |
| `02-system-flow-4k.png` | 1640×1776 | 제외 | 오른쪽이 잘리고 현재 본편 구조와 맞지 않음 |
| `03-ranked-evidence-4k.png` | 3840×2160 | 제외 | MISS/general fallback 결과라 HIT 근거처럼 쓸 수 없음 |
| `06-ledger-4k.png` | 3840×2160 | 제외 | 빈 거래내역. 실제 receipt 대체 불가 |

원본 파일 관리와 재촬영 체크리스트는 [`docs/pitch-final-assets/README.ko.md`](pitch-final-assets/README.ko.md)를 단일 기준으로 사용한다.

### 빼야 할 시각 요소

- 6개 이상 회사 로고 collage.
- 가독성 낮은 전체 시스템 초대형 diagram을 본편에 넣는 것.
- 서로 다른 카드 스타일·그라데이션·그림자 혼합.
- mock 숫자가 live metric처럼 보이는 badge.
- 작은 코드·긴 수식.
- 근거 없는 시장 막대 그래프.

### 데모 화면 품질

- 16:9 또는 무대 화면 비율에 한 페이지 전체가 들어와야 한다.
- Admin Test는 일렬 주요 경로, 곡선 connector, 겹치지 않는 label.
- 하단 terminal은 실제 필요한 trace만 보여 준다.
- MCP 명령 입력 화면은 노출하지 않는다.
- 노드 점등은 실제 event에만 반응.
- 페이지에 “live”라고 쓰려면 polling source와 timestamp를 표시.

---

## 20. 발표 전 P0·P1 수정 목록

### P0 — 덱을 내기 전에 반드시

- [x] 기존 20장 저장소와 별도로 표지 포함 8장 제출·발표 경로를 고정
- [x] D0~D6을 본편 주장에 배치하고 A0에 D7 전체 아키텍처, 마지막 장에 D8, 타깃 장에 D9를 넣음 (`npm run pitch:verify`의 D0~D9 검사 통과)
- [x] `$29.1B`를 U.S. Census Bureau/FRED의 2022년 미국 시장조사·여론조사 employer-firm 매출이자 초기 시장 대용치로 라벨링
- [x] `$142B`를 ESOMAR가 집계한 “2023 global insights industry”로 라벨링
- [x] 슬라이드 4에 Gemini가 고르는 action과 못 고르는 경제 필드 표시 (`D3`: `filters·requestedDocuments`, 구매 제안·부분 조사·Open Call·무료 baseline·종료 / 지갑·수취인·가격·예산 변경 금지)
- [x] A2A·Passkey·mainnet escrow 과장 제거 (진실성 원장에서 모두 현재 미구현 또는 P1/P2로 분리)
- [x] facilitator가 network fee만 부담한다고 표시 (`D4`: 구매자 USDC 근거 가격과 network fee payer 분리)
- [x] 영수증에 “결제·접근 증명, 내용 진실 증명 아님” 표시 (`D4` footer와 영수증 진실 경계)
- [x] 90/10을 목표 정책으로 표시 (atomic 반올림 및 hosted Pay.sh 직접 경로 actual receipt 불일치 가능성 명시)
- [x] learned embedding 표현 제거 (현재 768차원 feature-hashed 어휘·문자 표현으로 라벨링)
- [x] 자동 망각 표현 제거, 90일 freshness decay로 교체 (`max(.2, 2^(-ageDays/90))`, 원문은 자동 삭제되지 않음)
- [x] 현재 reflection trigger 3개와 미래 150/window100 분리 (현재 deterministic L1~L5 / 고밀도 P1 정책)
- [x] GCP 77/77 검증 timestamp와 대상 표시 (`2026-08-20T02:28:11.900Z`, project·region·Cloud Run·SQL·Tasks·KMS·RPC·readiness)
- [x] 수익 시나리오를 traction처럼 보이지 않게 수정 (SOM은 “미검증 3년 시나리오·고객 증거 아님”)
- [x] 마지막 문장을 처음 한 문장과 연결 (“웹은 공개 정보를 검색 가능하게… Obulus는 인간 경험을 검색·허가·결제 가능하게…”)

### P0 — 데모 전에 반드시

- [ ] `npm run pitch:verify`가 `contentReady=true`, `liveReady=true`를 동시에 반환
- [ ] 동일 revision에서 API·gateway·orchestrator/pay readiness 확인
- [ ] `autonomy.json`에 같은 deployed API revision의 2-stage Vertex function call trace 기록
- [ ] `devnet.json`에 실제 signature·mint·amount·recipient·2-RPC finality·duplicate/refund proof 기록
- [ ] 두 RPC origin이 실제로 다른지 확인
- [ ] 영수증 actual split과 UI target split 불일치 여부 확인
- [ ] 백업 영상 로컬 저장·오프라인 재생 확인
- [ ] 데모 wallet에 필요한 Devnet USDC·운영 SOL만 최소 보유

### P1 — 유료 PoC 전에

- [ ] Passkey/embedded wallet 또는 대체 onboarding
- [ ] consent withdrawal → descendant reflection invalidation
- [ ] Cloud SQL HA/private IP/pool/restore drill
- [ ] KMS rotation drill과 old-wallet backlog drain
- [ ] SLO·alert·incident runbook
- [ ] learned embedding benchmark와 relevance regression test
- [ ] sybil/collusion detector
- [ ] dispute·correction·refund UX
- [ ] exact actual 90/10 settlement policy 또는 UI 정정
- [ ] 법률·세무·개인정보·제재 검토

### P2 — Mainnet 확장 전에

- [ ] 감사된 Solana PDA escrow program
- [ ] program upgrade authority 정책
- [ ] mainnet RPC·priority fee·congestion 정책
- [ ] external security audit
- [ ] mainnet treasury·accounting·tax
- [ ] data residency와 enterprise DPA

---

## 21. 최종 스토리텔링 검사

처음 보는 사람이 발표 후 다음 질문에 한 문장으로 답할 수 있어야 한다.

| 질문 | 정답 |
|---|---|
| Obulus가 무엇인가? | 공개 웹에 없는 인간 경험을 검색하고 열린 원문만 결제하는 인프라 |
| 누가 돈을 내는가? | 반복 조사를 하는 기업·제품·인사이트 팀과 그들의 Agent |
| 왜 더 나은가? | 이미 있는 답을 먼저 찾고 빈칸만 모집하기 때문 |
| AI는 무엇을 하는가? | 검색 계획과 검색 후 다음 행동을 도구 schema 안에서 선택 |
| Rust는 무엇을 하는가? | 동의·권한·가격·중복·PageRank·결제 상태를 결정적으로 검증 |
| 왜 Solana인가? | Agent가 문서별 작은 USDC 거래와 검증 가능한 영수증을 만들기 위해 |
| 왜 Pay.sh/x402인가? | HTTP 402를 Agent 결제로 연결하고 fee sponsorship과 wallet authorization을 처리하기 위해 |
| 왜 GCP인가? | compute·state·retry·key를 서비스별로 분리하고 확장하기 위해 |
| 데이터 품질은? | query relevance + 독립 근거 관계의 Personalized PageRank |
| 기여자는 왜 오는가? | 한 번 쓴 답이 다시 열릴 때 반복 정산되기 때문 |
| 지금 실제인 것은? | Devnet, 4 Cloud Run, SQL/Tasks/KMS, bounded Gemini loop, PageRank, recursive pointers |
| 아직 아닌 것은? | Passkey, mainnet audited escrow, learned embeddings, 자동 원문 삭제, 검증된 WTP |

다음 중 하나라도 관객이 답하지 못하면 해당 슬라이드는 다시 써야 한다.

---

## 22. 기술·외부 근거 원장

### 내부 구현 근거

- `backend/src/orchestrator.rs` — Gemini planner·coverage decider·allowlist·fallback
- `backend/tests/agent_autonomy_contract.rs` — autonomy contract와 approval 경계
- `backend/src/search.rs` — relevance gate·검색 점수·feature hashing·freshness
- `backend/src/authority.rs` — Personalized PageRank·spam-resistant edge weight
- `backend/src/store.rs` — memory entries·importance·L1~L5 recursive pointer
- `docs/PAY-SH.md` — hosted Pay.sh·facilitator·KMS·two-RPC·recovery
- `docs/UNIT-ECONOMICS.md` — 목표 90/10·비용·break-even
- `docs/FINALIST-ENGINEERING-READINESS.ko.md` — 현재 구현과 상용화 경계
- `scripts/verify-finalist-infra.mjs` — GCP read-only verifier
- `scripts/record-admin-test.mjs` — 화면 밖 MCP 요청과 Admin Test 녹화
- `artifacts/obulus-admin-test-live.mp4` — 실제 요청 trace 백업 영상

### 외부 공식·1차 출처

- x402 facilitator: <https://docs.x402.org/core-concepts/facilitator>
- x402 seller quickstart: <https://docs.x402.org/getting-started/quickstart-for-sellers>
- Solana fee structure: <https://solana.com/docs/core/fees/fee-structure>
- Solana agentic payments: <https://solana.com/docs/payments/agentic-payments>
- Pay.sh: <https://pay.sh/>
- Pay.sh source: <https://github.com/solana-foundation/pay>
- Cloud Run overview: <https://docs.cloud.google.com/run/docs/overview/what-is-cloud-run>
- Cloud Run autoscaling: <https://docs.cloud.google.com/run/docs/about-instance-autoscaling>
- Cloud SQL PostgreSQL 운영·backup·PITR: <https://docs.cloud.google.com/sql/docs/postgres/best-practices>
- Cloud Tasks queue limits·retry: <https://docs.cloud.google.com/tasks/docs/configuring-queues>
- Cloud KMS asymmetric signing: <https://docs.cloud.google.com/kms/docs/create-validate-signatures>
- Cloud KMS Ed25519 algorithm: <https://docs.cloud.google.com/kms/docs/algorithms>
- Google Research robust PageRank/spam: <https://research.google/pubs/robust-pagerank-and-locally-computable-spam-detection-features/>
- Google Research sensitivity-bounded Personalized PageRank: <https://research.google/pubs/differentially-private-graph-learning-via-sensitivity-bounded-personalized-pagerank/>
- ESOMAR Global Market Research 2024 — 2023 global insights industry `$142B`: <https://community.esomar.org/knowledge-center/library?publication=3019>
- U.S. Census Bureau/FRED `REVEF54191ALLEST` — 2022 U.S. market research and public opinion polling revenue `$29.106B`: <https://fred.stlouisfed.org/series/REVEF54191ALLEST>
- ESOMAR Global Users & Buyers: <https://community.esomar.org/knowledge-center/library?publication=3027>

### 2026-08-20 최종 검증 스냅샷

이 문서의 “현재 구현” 주장은 다음 검사를 다시 통과한 상태를 기준으로 한다.

| 검사 | 결과 | 증명 범위 |
|---|---:|---|
| `cargo test --manifest-path backend/Cargo.toml --test agent_autonomy_contract` | 7/7 통과 | allowlist, deterministic fallback, exact approval, unpaid passage 차단 |
| PageRank 핵심 단위 테스트 2개 | 2/2 통과 | paid/self edge 권위 0, 독립 corroboration 권위 전달 |
| Agent 경제 경계 단위 테스트 | 1/1 통과 | 모델이 spend·document authority를 확대하지 못함 |
| 메모리 핵심 단위 테스트 2개 | 2/2 통과 | paid reuse가 관측을 부풀리지 않음, L0→L2 exact pointer |
| `npm run finalist:verify-infra -- --project sweetspot-ax --region asia-northeast3` | 77/77 통과 | 실제 Cloud Run·SQL·Tasks·KMS·RPC·readiness 상태 |
| `npm run test:finalist-evidence` | 13/13 통과 | infra·autonomy·Devnet evidence schema와 fail-closed gate |
| `npm run obulus-mcp:test` | 7/7 통과 | 30개 MCP tool, Codex·Claude·Gemini 등록, 무료 검색·SIWX·invoice·recovery·withdrawal 계약 |
| `npm run pitch:verify` | contentReady=true, liveReady=false | 콘텐츠·asset·tool count는 준비. infra evidence는 ready, autonomy·Devnet evidence는 아직 없음 |

최신 인프라 검증 시각은 `2026-08-20T02:28:11.900Z`이며, 당시 `summary.ready=true`, 실패 0건이었다. 이 검사는 부하 테스트·SLO·mainnet 보안 감사를 대신하지 않는다.

현재 `pitch:verify`의 `liveReady=false`는 문서나 다이어그램 실패가 아니다. 발표 페이지가 요구하는 최신 `autonomy.json`과 `devnet.json`이 아직 생성되지 않아 infrastructure revision과 같은 2시간 evidence window로 상관관계가 성립하지 않았다는 뜻이다. 두 파일은 실제 deployed run과 실제 Devnet transaction에서만 기록하며 fixture나 예시 값으로 채우지 않는다.

### 출처 표기 원칙

- 본편 슬라이드 하단에는 짧은 출처 1개만.
- 전체 URL과 접근일은 어펜딕스.
- 제품 내부 demo number는 “demo”라고 명시.
- live infrastructure·transaction evidence는 timestamp와 revision/run ID를 함께 표시.

---

## 23. 최종 자기감사

### 사용자 요구사항별 충족 여부

| 요구사항 | 문서 위치 | 상태 |
|---|---|---|
| PDF 부족점 전수 감사 | 2장 | 완료 |
| 5분 본편 압축 | 4~5장 | 완료 |
| 시연 후 Q&A 구조 | 6·17장 | 완료 |
| AI 자율성 30% | 1·4·7장 | 완료 |
| 비즈니스·UX 30% | 1·14·15장 | 완료 |
| GCP 확장성 15% | 9장 | 완료 |
| Solana 결제 15% | 10장 | 완료 |
| facilitator gas sponsorship | 5·10·Q6 | 완료 |
| 스마트 지갑·청구서·사기 방지 | 11장 | 완료 |
| PageRank 개인 DB 적용 | 12장 | 완료 |
| 스팸 DB 방지 | 12장 | 완료 |
| Rust 코어 이유 | 8장 | 완료 |
| 소셜 월드모델의 이전 데이터·추상화·망각 | 13장 | 완료, 현재 구현과 미래 설계 분리 |
| 콜드 스타트·검증 정보와 SNS·Obsidian·mem0 대안 판단 | 15장·Q21~Q22·A13 | 완료 |
| 중앙서버/App/MCP 리스크 | 16장 | 완료 |
| 비즈니스 impact·PoC | 14장 | 완료 |
| 과장 금지선 | 3장 | 완료 |
| 어펜딕스 설계 | 18장 | 완료 |
| 타깃·문제·도입 시나리오·아키텍처 다이어그램 | 18장 A0·19장 D1~D7·D0~D9 별도 다이어그램 브리프 | 완료 |
| 4대 평가 기준 만점 증거 매핑 | 1장·A14 | 완료, 실거래 receipt는 발표 직전 hard gate |
| 시각·wow point 감사 | 19장 | 완료 |
| P0/P1/P2 실행 목록 | 20장 | 완료 |
| 공식 출처 | 22장 | 완료 |

### 최종 발표 합격 조건

- [ ] 4분 45초 안에 대본을 자연스럽게 말한다.
- [ ] “설문 플랫폼”이 아니라 “human evidence search”로 기억된다.
- [x] Gemini가 무엇을 선택하고 무엇을 절대 못 선택하는지 대본·D3에 명시했다.
- [x] facilitator가 부담하는 network fee와 구매자가 부담하는 USDC 근거 가격을 대본·D4에 분리했다.
- [x] 영수증의 결제·접근 증명과 데이터 truth를 대본·D4에서 구분했다.
- [x] 현재 Devnet과 미래 mainnet을 진실성 원장·대본에서 구분했다.
- [x] 현재 feature hashing과 미래 learned embedding을 현재·미래 표에서 구분했다.
- [x] 현재 freshness decay와 미래 retention/deletion을 현재·미래 표에서 구분했다.
- [x] GCP 77/77 상태에 `2026-08-20T02:28:11.900Z` timestamp와 검증 대상을 붙였다.
- [x] 시장 크기와 traction을 외부 proxy·미검증 SOM·현재 PoC 상태로 구분했다.
- [x] D0~D6이 본편 주장과 연결되고 A0의 D7이 전체 구조를, D8·D9가 증거와 타깃별 도입을 닫도록 배치했다.
- [x] SNS·Obsidian·mem0 보류 이유를 API 비용·OAuth 보안·provenance·삭제 책임 관점의 A13 decision matrix와 Q22에 명시했다.
- [ ] 데모가 실패하면 8초 안에 백업 영상으로 전환한다.

이 조건을 모두 만족하면 Obulus는 “기술을 많이 붙인 설문 앱”이 아니라, **Gemini가 계획하고 Rust가 검증하며 GCP가 운영하고 Solana가 문서별 경제를 정산하는 인간 근거 검색 인프라**로 보인다.
