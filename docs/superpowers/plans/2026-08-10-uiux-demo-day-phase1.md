# UI/UX 데모데이 대비 Phase 1 (+Phase 2 게이트) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 한국어 데모데이(8/21)를 위한 i18n 정합·대시보드 마찰 제거·폴리시, 그리고 한국어 검색 매칭 리스크 게이트 1회 실행.

**Architecture:** 프론트(React 19+TS, Tailwind)만 수정하고 백엔드는 Task 8의 시드 스모크만 건드린다. i18n은 "영문 키 → ko.ts 매핑" 구조이므로, 스캔 스크립트로 t() 리터럴과 ko.ts 키셋을 대조해 누락을 기계적으로 잡는다.

**Tech Stack:** Vite 8 · oxlint · Node 24 (스크립트) · Rust/Axum (Task 8 시드만) · gstack browse (시각 검증)

## Global Constraints

- 커밋은 **로컬만**, `git push` 금지 (스펙 "비가역 작업" 조항)
- 커밋 메시지는 레포 관례: 소문자 시작 명령형 문장, prefix 없음 (예: `Add a seeded mock backend and a recorded end-to-end pass`)
- ko.ts 번역 레지스터: 대화형 UI 문장은 해요체, 모노 박스·라벨은 체언 종결 (ko.ts 파일 상단 주석의 표면별 레지스터 규칙 준수)
- 사용자 카피에서 제품명은 **Obolus**, 에이전트명은 SHELF (Obulus 표기 금지)
- 프론트 검증 게이트: `npm run build` + `npm run lint` 통과 + browse 실화면 확인 (프론트 단위테스트 프레임워크 없음 — 도입하지 않는다)
- dev 스택: `npm run dev:stack` (프론트 4319 · Rust 8787 · 게이트웨이 1402), `.env`의 `VITE_API_PROXY_TARGET=http://127.0.0.1:8787` 필수

---

### Task 1: i18n 감사 스크립트

**Files:**
- Create: `scripts/i18n-audit.mjs`

**Interfaces:**
- Produces: `node scripts/i18n-audit.mjs` → stdout에 `MISSING (N)` / `UNUSED (N)` 목록, 누락 0이면 exit 0, 있으면 exit 1. Task 2·7이 이 스크립트를 사용.

- [ ] **Step 1: 스크립트 작성**

```js
// scripts/i18n-audit.mjs — t('...') 리터럴과 ko.ts 키셋 대조.
// 한계: 동적 키(t(variable))와 여러 줄에 걸친 리터럴은 잡지 못한다.
import { readFileSync, readdirSync, statSync } from 'node:fs'
import { join } from 'node:path'

const SRC = new URL('../src', import.meta.url).pathname
const KO = join(SRC, 'i18n/ko.ts')

function walk(dir) {
  return readdirSync(dir).flatMap((name) => {
    const p = join(dir, name)
    if (statSync(p).isDirectory()) return walk(p)
    return /\.(ts|tsx)$/.test(name) && !p.endsWith('ko.ts') ? [p] : []
  })
}

const LIT = /\bt\(\s*(['"])((?:\\.|(?!\1)[^\\])*)\1/g
const used = new Set()
for (const file of walk(SRC)) {
  const text = readFileSync(file, 'utf8')
  for (const m of text.matchAll(LIT)) used.add(m[2].replaceAll("\\'", "'"))
}

const KEY = /^\s{2}(['"])((?:\\.|(?!\1)[^\\])*)\1:/gm
const koText = readFileSync(KO, 'utf8')
const keys = new Set()
for (const m of koText.matchAll(KEY)) keys.add(m[2].replaceAll("\\'", "'"))

const missing = [...used].filter((k) => !keys.has(k)).sort()
const unused = [...keys].filter((k) => !used.has(k)).sort()
console.log(`MISSING (${missing.length}) — t()로 쓰였지만 ko.ts에 없음`)
for (const k of missing) console.log(`  ${k}`)
console.log(`UNUSED (${unused.length}) — ko.ts에 있지만 t() 호출 없음`)
for (const k of unused) console.log(`  ${k}`)
process.exit(missing.length ? 1 : 0)
```

- [ ] **Step 2: 실행해 현재 상태 확인**

Run: `node scripts/i18n-audit.mjs`
Expected: `MISSING (1+)` — 최소한 `Your account is ready. Name your fields, and calls in them sort to the top.` 포함, exit 1. (UNUSED는 참고용 — 이번에 지우지 않는다.)

- [ ] **Step 3: Commit**

```bash
git add scripts/i18n-audit.mjs
git commit -m "Add an i18n audit that diffs t() literals against ko.ts"
```

### Task 2: 누락 번역 키 보완

**Files:**
- Modify: `src/i18n/ko.ts` (알파벳순 위치에 삽입)

**Interfaces:**
- Consumes: Task 1의 MISSING 목록
- Produces: `node scripts/i18n-audit.mjs` exit 0

- [ ] **Step 1: MISSING 전체에 대해 ko.ts 항목 추가**

확정 1건 (나머지는 Task 1 출력을 보고 같은 요령으로, 표면별 레지스터 준수):

```ts
  'Your account is ready. Name your fields, and calls in them sort to the top.': '계정이 준비됐어요. 분야를 정하면, 그 분야 모집이 맨 위로 와요.',
```

- [ ] **Step 2: 감사 통과 확인**

Run: `node scripts/i18n-audit.mjs`
Expected: `MISSING (0)`, exit 0

- [ ] **Step 3: 빌드·린트**

Run: `npm run build && npm run lint`
Expected: 성공 (경고는 기존분만)

- [ ] **Step 4: Commit**

```bash
git add src/i18n/ko.ts
git commit -m "Fill the Korean lines the dashboard banner and friends were missing"
```

### Task 3: Archive 상대시간 번역 적용

**Files:**
- Modify: `src/pages/Archive.tsx:266-272` (module 하단 `relative()`) + 파일 내 `relative(` 호출부 전부

**Interfaces:**
- Consumes: ko.ts의 기존 키 `'m ago'` `'h ago'` `'d ago'` (이미 존재)
- Produces: 없음 (파일 내부 정리)

- [ ] **Step 1: Dashboard.tsx:982의 패턴 그대로 t를 인자로 받게 수정**

```ts
/** Not a component, so the translator arrives as an argument, not a hook. */
function relative(ts: number, t: (en: string) => string) {
  const min = Math.round((Date.now() - ts) / 60000)
  if (min < 60) return `${Math.max(1, min)}${t('m ago')}`
  const hr = Math.round(min / 60)
  if (hr < 24) return `${hr}${t('h ago')}`
  return `${Math.round(hr / 24)}${t('d ago')}`
}
```

호출부는 컴포넌트 안이므로 `relative(x)` → `relative(x, t)`로 바꾼다 (`useT()`의 t가 스코프에 있는지 확인, 없으면 해당 컴포넌트에서 `const t = useT()`).

- [ ] **Step 2: 빌드·린트**

Run: `npm run build && npm run lint`
Expected: 성공. `grep -n "m ago" src/pages/Archive.tsx` 결과가 `t('m ago')` 형태만 남음

- [ ] **Step 3: Commit**

```bash
git add src/pages/Archive.tsx
git commit -m "Let the receipts page tell time in Korean too"
```

### Task 4: 대시보드 카드 CTA 복원

**Files:**
- Modify: `src/pages/Dashboard.tsx:740-766` (모집 카드의 답변 Button)

**Interfaces:**
- Consumes: `useNavigate()` (react-router-dom, 파일에 이미 import돼 있는지 확인 후 없으면 추가)
- Produces: 없음

- [ ] **Step 1: 프로필 없음 분기를 라벨이 아니라 동작으로 옮긴다**

현재 765행: `: t('Set up profile')}` — 카드마다 같은 CTA가 반복된다. 변경:

1. 라벨 분기에서 `profile ? … : t('Set up profile')`를 제거하고, 프로필 없을 때도
   `t('Answer')`가 보이게 한다 (opening/fullyReserved/fits 분기는 그대로).
2. 해당 Button의 `onClick`에 최우선 분기를 추가: `if (!profile) { navigate('/onboarding'); return }`
   (기존 pickup 로직은 그 아래 유지).
3. `disabled` 조건에서 프로필 부재가 버튼을 죽이지 않는지 확인 — 현재 조건
   `Boolean(profile && !fits)`는 프로필 없으면 false이므로 그대로 둔다.
4. 상단 안내 배너(591행 부근, `Set up profile` CTA 포함)는 그대로 유지 — 게이트 안내는 이 1곳.

- [ ] **Step 2: 실화면 확인**

Run: dev 스택에서 프로필 없는 계정으로 `/dashboard` 접속 (browse)
Expected: 카드 버튼 라벨이 전부 `답하기`, 클릭 시 `/onboarding` 이동, 배너는 1개

- [ ] **Step 3: 빌드·린트 후 Commit**

```bash
npm run build && npm run lint
git add src/pages/Dashboard.tsx
git commit -m "Stop every call card yelling set-up-profile; the banner does that"
```

### Task 5: 모집 카드 태그 잘림 툴팁

**Files:**
- Modify: `src/pages/Dashboard.tsx:657-659`

- [ ] **Step 1: Badge에 title 부여 (Chat.tsx의 민트 축약과 같은 관례)**

```tsx
<Badge className="truncate px-1.5 py-0 uppercase tracking-[1px]" title={order.shelf}>
  {order.shelf}
</Badge>
```

- [ ] **Step 2: 빌드·린트 후 Commit**

```bash
npm run build && npm run lint
git add src/pages/Dashboard.tsx
git commit -m "Show the full shelf name on hover when the tag clips"
```

### Task 6: 온보딩 단계 표기 통일

**Files:**
- Modify: `src/pages/Onboarding.tsx:184`

- [ ] **Step 1: 0-기반 스텝 라벨을 헤더 카운터(1-기반 `{step + 1} / {TOTAL}`)와 맞춘다**

```tsx
{String(step + 1).padStart(2, '0')}
```

- [ ] **Step 2: 실화면 확인 후 Commit**

Run: browse로 `/onboarding` 1단계 확인
Expected: 본문 라벨 `01`, 헤더 `1 / 6`

```bash
npm run build && npm run lint
git add src/pages/Onboarding.tsx
git commit -m "Start the onboarding step label at 01 like the counter says"
```

### Task 7: KO 모드 전 라우트 검증 스윕

**Files:**
- Create: 없음 (검증 전용)

**Interfaces:**
- Consumes: Task 1 스크립트, dev 스택, gstack browse

- [ ] **Step 1: 감사 스크립트 최종 0 확인**

Run: `node scripts/i18n-audit.mjs`
Expected: MISSING (0)

- [ ] **Step 2: KO 모드로 라우트 순회하며 영어 누수 스팟체크**

browse로 `한국어` 토글 후 `/` `/dashboard` `/memory` `/archive` `/coverage` `/onboarding` `/login` 각각:
`$B text | grep -E "\b(ago|Your|ready|the|and) \b"` 수준의 휴리스틱 + 전체 스크린샷 1장씩 저장.
Expected: 시드 데이터(영어 질문 본문) 외의 UI 크롬에서 영어 문장 0건. 발견 시 해당 키를 Task 2 요령으로 보완하고 재실행.

- [ ] **Step 3: 스크린샷 묶음을 스크래치패드에 보관하고 결과를 보고**

### Task 8: Phase 2 리스크 게이트 — 한국어 검색 매칭 스모크

**Files:**
- Modify: `backend/src/seed.rs` (데모 문서 배열에 한국어 문서 2건 추가)

**Interfaces:**
- Produces: 게이트 판정(HIT 여부). Phase 2 본작업(시드 전면 한국어화) 진행/재설계의 입력.

- [ ] **Step 1: seed.rs의 데모 문서 정의부를 찾아 같은 구조로 한국어 문서 2건 추가**

기존 성수 시드와 같은 서가(`seongsu-living`)에, 예시 내용(합니다체·생활 수준 정보):
- 핸들 `SEONGS_KO1`: "성수동에서 평일 점심을 먹습니다. 12시 전에 가면 줄이 없고, 12시 반이면 20분 기다립니다."
- 핸들 `SEONGS_KO2`: "성수역 근처 국숫집은 포장이 빠릅니다. 자리는 좁아서 혼자 갈 때만 갑니다."

- [ ] **Step 2: 백엔드 테스트가 시드 개수를 단정하는지 확인**

Run: `cargo test --manifest-path backend/Cargo.toml`
Expected: PASS. 시드 개수 단정으로 실패하면 그 단정만 새 개수로 갱신하고 재실행.

- [ ] **Step 3: 새 DB로 스모크**

```bash
rm -f backend/openshelf.db backend/openshelf.db-shm backend/openshelf.db-wal
npm run dev:stack   # 재기동 (시드 자동)
curl -s http://127.0.0.1:8787/api/v1/questions/resolve \
  -H 'content-type: application/json' \
  -d '{"question":"성수동 직장인은 평일 점심을 어디서 먹나요?","requestedDocuments":5,"budgetKrw":2500}'
```

Expected(게이트 통과): `"decision":"hit"`이고 matches에 `SEONGS_KO1` 또는 `SEONGS_KO2`가 포함.
Expected(게이트 실패): miss이거나 한국어 문서가 매칭 안 됨 → **여기서 멈추고** 결과를 스펙의 리스크 조항에 기록, Phase 2 재설계 논의로 회부.

- [ ] **Step 4: 판정과 무관하게 결과 기록 후 Commit**

```bash
git add backend/src/seed.rs
git commit -m "Seed two Korean Seongsu documents to test the ranking gate"
```

---

## Self-Review 결과

- 스펙 커버리지: Phase 1 항목 1~4 → Task 1~6, 검증 → Task 7, Phase 2 게이트 → Task 8. Phase 2 본작업·Phase 3는 게이트 결과 이후 별도 계획(스펙의 순차 원칙).
- 플레이스홀더: 없음. Task 2의 "나머지는 출력을 보고"는 Task 1이 정확한 목록을 만들어주므로 실행 가능.
- 타입/이름 일관성: `relative(ts, t)` 시그니처는 Dashboard.tsx:982 실물과 동일. `i18n-audit.mjs` 이름은 Task 1·2·7에서 동일.
