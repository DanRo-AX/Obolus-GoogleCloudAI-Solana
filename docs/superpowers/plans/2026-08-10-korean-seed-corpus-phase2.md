# 시드 한국어화 Phase 2 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 한국어 데모 질문 3개가 HIT(각 5문서), 1개가 MISS로 떨어지는 한국어 시드 코퍼스와 데모 질문 문서를 만든다.

**Architecture:** 영어 시드는 **삭제하지 않는다** — `backend/src/search.rs`의 테스트 5개(`Resolver::new(seed::documents())`)가 영어 질문↔영어 시드에 묶여 있다. 한국어 코퍼스를 `seed.rs`에 병행 추가하고, 대시보드·내 서가용 시드(`store.rs`의 `seed_open_calls`/`seed_memory`)는 한국어로 교체한다(테스트 비의존 — 개수·구조만 유지). Phase 1 게이트 학습 반영: 검색은 한국어를 매칭하지만 (a) 질문당 서로 다른 저자의 관련 문서 ≥ requestedDocuments(5)가 필요하고(저자 중복 제거 있음), (b) 서가명·태그 같은 메타데이터도 한국어로 써서 교차언어 점수 오염을 줄인다.

**Tech Stack:** Rust (시드 데이터만 — 검색·랭킹 로직 무변경) · SQLite · 검증은 cargo test + 실백엔드 resolve 호출

## Global Constraints

- 브랜치 `feat/korean-seed-corpus` (base: feat/demo-day-uiux). 커밋은 로컬만, push는 Dan 승인 후.
- 커밋 메시지: 명령형 문장(대문자 시작), prefix 없음, 마지막에 빈 줄 + `Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>`
- 한국어 문서 본문 레지스터: **합니다체**, 생활 수준의 구체 정보(숫자·시간·장소), 과장 금지 (BRIEF.md 톤 조항)
- `backend/src/search.rs`·랭킹 로직 무변경. 영어 시드 문서 20건(SEONGS_KO1/KO2 포함) 무삭제·무수정.
- 검증 게이트: `cargo test --manifest-path backend/Cargo.toml` 전부 통과 + 실백엔드 스모크(아래 데모 질문 4개 전부 기대 결과 일치)
- 데모 질문 4개(확정 — 이 문장 그대로 검증에 사용):
  - HIT-1 `성수동 직장인은 평일 점심을 어디서 먹나요?`
  - HIT-2 `파리에 사는 사람들은 평일 저녁에 실제로 뭘 먹나요?`
  - HIT-3 `초등학교 입학 준비에서 진짜 돈이 드는 게 뭔가요?`
  - MISS `제주에서 겨울 한 달 살기 비용은 실제로 얼마나 드나요?`

---

### Task 1: 한국어 문서 코퍼스 (seed.rs)

**Files:**
- Modify: `backend/src/seed.rs` (기존 `documents()` 벡터 끝에 추가)

**Interfaces:**
- Produces: 한국어 문서 15건+ — HIT-1/2/3 각각에 대해 **서로 다른 저자의 관련 문서 5건 이상**. Task 3의 스모크가 이 커버리지를 소비한다.

- [ ] **Step 1: 서가 3개를 한국어 이름으로 신설하고 문서를 작성한다**

| 서가 id | 서가명(한국어) | 카테고리 | 대응 질문 | 문서 수 | 핸들 규칙 |
|---|---|---|---|---|---|
| `seongsu-lunch-ko` | `성수동에서 먹고 삽니다` | life | HIT-1 | 5 | `KOLUNCH_1`~`_5` |
| `paris-dinner-ko` | `파리에 삽니다` | travel | HIT-2 | 5 | `KOPARIS_1`~`_5` |
| `first-grade-ko` | `초등 입학 준비` | family | HIT-3 | 5 | `KOSCHOOL_1`~`_5` |

- 저자는 문서마다 다르게: `author_2XX` 연번(기존 author_107/108과 미충돌 확인 후 시작 번호 선택), 같은 서가 안에서도 전부 다른 저자.
- 본문 작성 규칙: 각 문서는 해당 질문에 실제로 답이 되는 생활 정보 2~3문장, 합니다체, 구체 숫자 1개 이상 포함(가격·시간·횟수). 질문의 핵심 명사(점심/저녁/입학 등)가 본문에 자연히 등장해야 검색 term coverage가 잡힌다.
- 가격은 기존 시드 분포에 맞춰 ₩5~₩20.
- tags·shelf 표기도 한국어로 (게이트 관찰: 영어 메타데이터가 교차언어 점수를 만든다).
- MISS 질문(제주 겨울 한 달 살기)과 겹치는 문서는 만들지 않는다 — "제주"가 본문에 들어가면 안 된다.

- [ ] **Step 2: cargo test로 기존 테스트 무파손 확인**

Run: `cargo test --manifest-path backend/Cargo.toml`
Expected: 전부 통과 (영어 시드 무수정이므로 search.rs 테스트 영향 없음. 실패 시 원인 보고 — 임의 수정 금지)

- [ ] **Step 3: Commit**

```bash
git add backend/src/seed.rs
git commit -m "Seed a Korean corpus for the three demo questions"
```

### Task 2: 대시보드·내 서가 시드 한국어화 (store.rs)

**Files:**
- Modify: `backend/src/store.rs` — `seed_open_calls`(17684행 부근, 5건)와 `seed_memory`의 문자열만

**Interfaces:**
- Consumes: 없음. Produces: 대시보드 공개 모집 카드 5건·내 서가 항목이 한국어로 렌더.

- [ ] **Step 1: 공개 모집 5건의 shelf/question 문자열을 한국어로 교체**

구조(개수·단가·target·answered·aged_hours)는 그대로 두고 문자열만 바꾼다. 각 모집의 주제는 기존 영어 버전의 번역이 아니라 같은 취지의 자연스러운 한국어 질문으로 재작성한다(BRIEF 재작성 원칙). 예: call_seed_1 → shelf `성수동에서 먹고 삽니다`, question `성수동에서 줄 안 서고 15분 안에 끝나는 평일 점심, 실제로 어디로 가시나요?`. 나머지 4건도 같은 요령(육아/사업/개발/여행 등 기존 카테고리 유지).

- [ ] **Step 2: seed_memory의 question/answer 문자열도 한국어로 교체** (구조·earned 값 유지)

- [ ] **Step 3: cargo test 통과 확인 후 Commit**

```bash
cargo test --manifest-path backend/Cargo.toml
git add backend/src/store.rs
git commit -m "Speak Korean on the seeded call board and memory shelf"
```

### Task 3: 데모 질문 스모크 (검증 전용)

**Files:**
- Create: 없음 (검증; 실패 시 Task 1 문서 보강 후 재실행)

- [ ] **Step 1: 새 DB로 백엔드 단독 기동**

```bash
rm -f backend/openshelf.db backend/openshelf.db-shm backend/openshelf.db-wal
cd backend && cargo run   # 백그라운드, healthz ok 대기
```

- [ ] **Step 2: 데모 질문 4개를 resolve로 전부 확인**

각 질문을 `POST /api/v1/questions/resolve` (`requestedDocuments:5, budgetKrw:2500`)로 호출.
Expected: HIT-1/2/3 → `"decision":"hit"` + matches 5건 전부 해당 KO 핸들(교차 오염으로 영어 핸들이 끼면 문서 본문/서가 보강으로 해결하고 재실행) · MISS → `"decision":"miss"` (+ openCall 제안 필드 확인)

- [ ] **Step 3: 기존 영어 질문 회귀 1건** (`Where do Seongsu residents eat lunch when the queue is long?` → hit, 상위 핸들이 영어 시드 유지)

- [ ] **Step 4: 백엔드 종료, 결과(4질문 × decision·핸들·점수)를 리포트에 기록**

### Task 4: 데모 질문 문서화

**Files:**
- Create: `docs/DEMO-DAY-QUESTIONS.ko.md`

- [ ] **Step 1: 데모 대본용 문서 작성** — 질문 4개(그대로 복사 가능한 형태), 각각의 기대 흐름(HIT→결제 프리뷰 / MISS→모집 발주 대화), Task 3에서 실측한 핸들·가격, 리허설 시 초기화 명령(`rm -f backend/openshelf.db*` 후 재기동) 포함. 산출물 문서이므로 ~다체.

- [ ] **Step 2: Commit**

```bash
git add docs/DEMO-DAY-QUESTIONS.ko.md
git commit -m "Write the Korean demo question script with measured expectations"
```

## Self-Review 결과

- 스펙 커버리지: Phase 2 항목(한국어 재작성·데모 질문 세트·cargo test·실검증) 전부 매핑. "재작성"은 테스트 결합 때문에 문서=병행 추가, 대시보드·메모리=교체로 분해 — 스펙 의도(한국어 시연 화면) 충족.
- 플레이스홀더: 문서 본문은 Task 1의 작성 규칙(합니다체·구체 숫자·핵심 명사 포함·저자 분리)이 수용 기준이고 Task 3 스모크가 기계 검증한다.
- 이름 일관성: 핸들 `KOLUNCH_/KOPARIS_/KOSCHOOL_`, 서가 id 3종은 Task 1·3·4에서 동일.
