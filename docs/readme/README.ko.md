<h1 align="center">
  <img src="../../public/OBOLUS-MARK.svg" alt="Obolus" width="56" valign="middle" /> Obolus
</h1>

<p align="center">
  <a href="https://github.com/DanRo-AX/Obolus-GoogleCloudAI-Solana"><img src="https://img.shields.io/github/stars/DanRo-AX/Obolus-GoogleCloudAI-Solana?style=flat&amp;label=%E2%98%85&amp;color=08C" alt="GitHub 스타" /></a>
  <a href="https://github.com/DanRo-AX/Obolus-GoogleCloudAI-Solana/actions/workflows/ci.yml"><img src="https://github.com/DanRo-AX/Obolus-GoogleCloudAI-Solana/actions/workflows/ci.yml/badge.svg" alt="CI" /></a>
  <img src="https://img.shields.io/badge/Solana-Devnet-9945FF?style=flat" alt="솔라나 Devnet 정산" />
  <img src="https://img.shields.io/badge/x402-v2%20exact%2FSVM-08C?style=flat" alt="x402 v2, exact 스킴, SVM" />
  <img src="https://img.shields.io/badge/React%2019%20%C2%B7%20Rust%201.89%20%C2%B7%20Node%2024-4493F8?style=flat" alt="React 19, Rust 1.89, Node 24" />
</p>

<p align="center">
  <sub><a href="../../README.md">English</a></sub>
</p>

<p align="center">
  <strong>인터넷을 데이터베이스로. 값은 문서 한 건 단위로.</strong><br/>
  SHELF는 웹 말고 사람이 쓴 글을 검색합니다. 문서 하나 여는 데 ₩5~₩20,<br/>
  그 돈은 쓴 사람 지갑으로 바로 갑니다. 승인 창도, 구독료도 없습니다.
</p>

<h3 align="center"><a href="#로컬에서-실행하기"><ins>로컬에서 실행하기</ins></a></h3>

<p align="center">
  <img src="../assets/hero.png" alt="Obolus 랜딩 페이지의 질문 입력창" width="960" />
</p>

## 기능

<table>
<tr>
<td width="50%" valign="middle">

### 웹이 아니라 사람을 검색합니다

일반 모델은 빈칸을 가장 그럴듯한 문장으로 채웁니다. Obolus는 거기 실제로 사는 네 사람에게 가서, 각자가 쓴 문단에 값을 치릅니다.

검색과 랭킹은 공짜입니다. 실제로 인용된 문서에만 값이 붙습니다.

</td>
<td width="50%">
  <img src="../assets/feature-thesis.png" alt="무료 일반 모델의 뻔한 답변과, 파리에 사는 네 사람의 유료 문단 비교" width="100%" />
</td>
</tr>
<tr>
<td width="50%" valign="middle">

### 없으면 공고가 됩니다

서가에 맞는 게 없을 때 “검색 결과 없음”으로 끝나지 않습니다. 답변 하나에 얼마를 매길지 정하면, 그 질문이 알 만한 사람들에게 유료 공고로 나갑니다.

분야 11개, 세로 레일, 단가·적합도·남은 자리 필터.

</td>
<td width="50%">
  <img src="../assets/feature-board.png" alt="분야 레일과 단가 필터가 있는 답변 모집 보드" width="100%" />
</td>
</tr>
<tr>
<td width="50%" valign="middle">

### 기계끼리 값을 치릅니다

HTTP에는 이미 이걸 위한 상태 코드가 있습니다. 서버가 `402`와 가격을 돌려주고, 지갑이 값을 치르고, 문서가 열립니다. ₩12를 승인하라고 사람을 부르지 않습니다.

가격을 원으로 읽는 건 서가에 있는 사람들이 원으로 생각하기 때문입니다. 솔라나 위에서 실제로 움직이는 건 USDC입니다.

</td>
<td width="50%">
  <img src="../assets/feature-settlement.png" alt="문서 4건을 열어 총 ₩38이 나간 정산 영수증 예시" width="100%" />
</td>
</tr>
<tr>
<td width="50%" valign="middle">

### 지갑이 곧 계정입니다

이메일도, 비밀번호도, 이름도 없습니다. 연결하면 공개 주소만 읽습니다. 질문자에게 보이는 건 핸들뿐입니다.

지갑을 연결하기 전에도 Devnet SOL·USDC faucet 링크가 로그인 화면에 있습니다.

</td>
<td width="50%">
  <img src="../assets/feature-login.png" alt="질문 한 건의 흐름이 옆에 놓인 지갑 전용 로그인 화면" width="100%" />
</td>
</tr>
<tr>
<td width="50%" valign="middle">

### 한 갑이 아니라 한 개비로 팝니다

사람이 아는 건 여태 통짜로만 거래됐습니다. 패널 조사, 연간 라이선스, 삼백 명의 삶을 보고서 한 편으로 눌러 담은 것.

여기서 단위는 문서 하나, 열람 한 번, 답변 하나입니다. 답변은 계속 본인 것이고, 계속 법니다.

</td>
<td width="50%">
  <img src="../assets/feature-panel.png" alt="설문 패널과 Obolus를 항목별로 비교한 표" width="100%" />
</td>
</tr>
<tr>
<td width="50%" valign="middle">

### 조건을 약관에 숨기지 않습니다

무엇을 넘기고 무엇은 절대 안 가져가는지, 아무도 안 여는 정책 문서가 아니라 랜딩 페이지에 나란히 적어 뒀습니다.

서가를 지우면 소각됩니다. 쓴 문서는 즉시 검색에서 빠지고 파기됩니다.

</td>
<td width="50%">
  <img src="../assets/feature-deal.png" alt="넘기는 것과 절대 가져가지 않는 것" width="100%" />
</td>
</tr>
<tr>
<td width="50%" valign="middle">

### 빈 곳은 공개합니다

문서 300건 아래에서는 서가가 믿을 만한 답을 못 냅니다. 그 사실을 인덱스가 그대로 보여 줍니다. 문서 자체는 못 훑어봅니다 — 그러라고 여는 겁니다.

공개되는 건 질문이 빈손으로 돌아오는 자리, 그리고 그걸 채우겠다고 이미 붙은 값입니다.

</td>
<td width="50%">
  <img src="../assets/feature-coverage.png" alt="무료 탐색, 질의별 권위, 유료 경계를 설명하는 빈 곳 페이지" width="100%" />
</td>
</tr>
<tr>
<td width="50%" valign="middle">

### 한국어와 영어, 둘 다 1급입니다

번역 레이어를 나중에 얹은 게 아닙니다. 한국어에는 자체 서체 스택과 굵기·자간, `word-break: keep-all`이 걸려 있고, 문장은 화면마다 다시 썼습니다. 한 문장씩 옮긴 게 아닙니다.

사이드바 하단에서 전환하고, 선택은 새로고침해도 남습니다.

</td>
<td width="50%">
  <img src="../assets/feature-korean.png" alt="한국어로 렌더링된 같은 랜딩 페이지" width="100%" />
</td>
</tr>
</table>

**함께 들어 있는 것:**

- **[Antigravity 플러그인](../../integrations/antigravity/openshelf/README.md)** — 질문자·기여자 전체 흐름이 `openshelf` MCP 툴 23개로. 공식 Pay.sh MCP 지갑도 얇은 핸드셰이크 어댑터를 통해 함께 붙습니다.
- **선불 크레딧과 복구** — 지갑 소유는 한 번만 증명하고, 잔액이 적을 때만 충전합니다. 브라우저가 응답을 잃으면 서버와 대조해 이미 결제된 건은 되찾고, 결제 안 된 핸들만 재시도합니다.
- **공고 에스크로** — 유료 공고는 최대 예산을 먼저 잡아 둡니다. 채택된 답변마다 한 몫씩 풀리고, 취소하거나 계정을 지우면 안 쓴 나머지가 정확히 그대로 지급 청구로 돌아갑니다.
- **가입 전에 밝히는 3진 아웃** — 허위 사실이나 질 낮은 답변은 경고 1회, 경고 3회면 계정 정지. 약관이 아니라 온보딩 화면에 있습니다.
- **AI는 유동성만, 저자는 아닙니다** — 사람이 쓴 문서가 성길 때 Vertex AI의 Gemini가 무료 기준선을 줄 수 있습니다. 이건 `ai_baselines`에 남고 가격이 없으며, 재판매도 권위 획득도 안 되고 공고 자리를 채울 수도 없습니다.
- **기여자 메모리 에이전트는 일부러 좁습니다** — 동의한 사람에 한해, 82% 이상 거의 같은 공고이고 타깃·가격·잠금·행동 규칙까지 통과할 때만 기존 유료 답변을 재사용합니다. 나머지는 전부 사람이 직접 답해야 합니다.
- **영수증** — 대화, 구매한 문서, 트랜잭션 링크가 한곳에.

---

## 질문 하나가 지나가는 길

```text
질문 → 서가 탐색 → 유사도 랭킹 → 있음 / 없음
  있음 → 선불 크레딧 예약 → 저자 N명에게 지급 → 인용 붙은 답변 + 영수증
  없음 → "이건 아직 아무도 안 썼네요. 물어볼까요?"
       → "몇 명한테요?"  → "답변당 얼마 붙일까요?"
       → 공고 게시 → 답변 모집 보드
```

이 분기가 이 프로젝트가 새로 만들어야 했던 유일한 부분입니다. 그래서
`src/pages/Chat.tsx`는 저 대화를 그대로 말하는 상태 기계로 구현돼 있습니다.
조건에 맞는 문서가 이미 충분하면 순서가 뒤집힙니다. 공고 없이 “값은 얼마입니다,
결제하시겠습니까?”로 바로 갑니다.

매칭, 랭킹, 예산 필터, 저자 중복 제거, 있음/없음 판정은 전부 Rust 서비스에서
돕니다. 768차원 해시 임베딩, 단어·문자 n-gram, 개체 앵커, 신뢰도, 신선도, 그리고
큐레이터가 검증한 근거 간선 위의 토픽 개인화 PageRank를 씁니다. 유료·자기소유·추론·
가공 전 UGC 간선으로는 권위를 살 수 없습니다. 검색 응답에는 핸들과 가격만 담기고,
구절은 절대 담기지 않습니다.

<details>
<summary><strong>정산 경로 두 가지, 전체</strong></summary>

**에이전트 경로 — 공식 Pay.sh 게이트웨이.** 자율 에이전트의 기본 경로입니다.

1. 무료 검색이 결제에 안전한 핸들과 질의 범위 복구 토큰을 돌려줍니다.
2. 에이전트가 무료 복구 URL을 확인한 뒤, 아직 안 연 핸들마다 질의에 묶인 Pay.sh 리소스를 하나씩 준비합니다.
3. `pay curl`이 HTTP 402/MPP 교환을 처리합니다. Pay.sh는 USDC 원자 단위 1을 뺀 전액을 검증된 기여자 지갑으로 바로 분배합니다.
4. Rust가 불변 견적, 가격 대역, 자산, 네트워크, 질의, 핸들, 런타임 수취인을 다시 검증한 뒤에야 스냅샷을 내줍니다.
5. 응답을 잃어버리면 무료로 복구되고, 재시도해도 두 번 적립되지 않습니다.

**브라우저 경로 — 팬텀과 선불 크레딧.** 별도 프로세스도, 별도 설치도 없습니다.

1. Rust가 비공개 문서를 검색해 안전한 핸들과 원화 가격만 돌려줍니다.
2. 정확한 핸들, 콘텐츠 해시, 수취 지갑, 문서별 원자 가격, 총액, 민트, 네트워크, 만료를 작업 하나에 확정해 넣습니다.
3. 검증된 선불 크레딧에서 작업 비용을 원자적으로 예약합니다. 잔액이 모자라면 미결제 충전 리소스가 x402 v2 `402 Payment Required`를 반환하고, 팬텀이 한 번 충전합니다.
4. 확인된 충전은 원장에 반영돼 작업 자금이 됩니다. 구절을 공개하지도, 수익으로 적립되지도 않습니다.
5. 서버 에이전트가 문서마다 Pay.sh/MPP를 돌리고, Rust는 결제된 그 스냅샷만 멱등하게 내보냅니다.
6. Rust가 서버에서 결제가 증명된 구절만 다시 읽고, Vertex AI의 Gemini가 인용 붙은 종합을 씁니다. 제공자가 설정돼 있지 않으면 답을 지어내는 대신 근거만 있는 결과를 그대로 보여 줍니다.
7. 영구 부분 실패가 나면 결제되지 않은 원자 잔액이 정확히 그대로 선불 크레딧으로 복원됩니다.

사용자 개인키도, 브라우저 보조 키도, SPL 위임도 Rust·게이트웨이·Cloud Run에
닿지 않습니다. 서비스 지갑은 GCP KMS를 통해 서명합니다.
[`docs/agent-payment-threat-model.md`](../agent-payment-threat-model.md)를 보세요.

</details>

구현 다이어그램: **[시스템 아키텍처와 ERD](../../architecture.html)**.

---

## 스택

<p>
  <kbd>React&nbsp;19</kbd> &nbsp; <kbd>TypeScript&nbsp;5.9</kbd> &nbsp; <kbd>Vite&nbsp;8</kbd> &nbsp; <kbd>Tailwind&nbsp;v4</kbd> &nbsp; <kbd>React&nbsp;Router&nbsp;7</kbd> &nbsp; <kbd>three.js</kbd> &nbsp;
  <kbd>Rust&nbsp;1.89&nbsp;/&nbsp;Axum</kbd> &nbsp; <kbd>SQLite</kbd> &nbsp;
  <kbd>x402&nbsp;v2&nbsp;—&nbsp;exact&nbsp;/&nbsp;SVM</kbd> &nbsp; <kbd>Solana&nbsp;Devnet</kbd> &nbsp; <kbd>USDC</kbd> &nbsp; <kbd>Phantom</kbd> &nbsp;
  <kbd>Pay.sh&nbsp;+&nbsp;MPP</kbd> &nbsp; <kbd>GCP&nbsp;KMS</kbd> &nbsp; <kbd>Cloud&nbsp;Run</kbd> &nbsp; <kbd>Gemini&nbsp;on&nbsp;Vertex&nbsp;AI</kbd>
</p>

---

## 로컬에서 실행하기

```bash
npm ci
npm --prefix payment-gateway ci
npm --prefix agent-orchestrator ci

cp .env.example .env             # KMS 서비스 지갑 공개키와 Devnet RPC 설정
gcloud auth application-default login   # 로컬 Vertex AI ADC — API 키 불필요
                                 # .env에 GOOGLE_CLOUD_PROJECT 설정, 해당 프로젝트에 Vertex AI API 활성화

npm run dev:stack                # 프런트엔드 · Rust API · x402 게이트웨이 동시 기동
```

| 프로세스 | 포트 | 기동 명령 |
| --- | --- | --- |
| 프런트엔드 (Vite) | `4319` | `npm run dev:stack` |
| Rust API (Axum) | `8787` | `npm run dev:stack` |
| x402 게이트웨이 | `1402` | `npm run dev:stack` |
| Pay.sh 게이트웨이 (샌드박스) | `3402` | `npm run pay:gateway:sandbox` |

선택 사항:

```bash
npm run pay:gateway:sandbox      # 공식 Pay.sh 게이트웨이, 로컬 샌드박스
npm run x402:devnet:smoke        # 자금이 든 지갑으로 정산 검증
```

유료 경로가 기본값입니다. 예전 샌드박스 원장 경로를 일부러 쓰고 싶을 때만
`VITE_X402_ENABLED=false`, 완전 정적 폴백은 `VITE_BACKEND_ENABLED=false`로 두세요.

### 에이전트 — Antigravity와 일반 MCP

```bash
agy plugin install ./integrations/antigravity/openshelf
npm run agent:doctor
node integrations/antigravity/openshelf/runtime/server.mjs auth login --email YOU@example.com
agy
```

`/mcp`로 `openshelf`와 `pay`가 둘 다 붙었는지 확인하세요. 무료 검색과 AI 기준선은
Pay 계정이 없어도 됩니다. 첫 유료 동작 전에 로컬에서 보호되는 이름 있는 Pay 계정을
만들거나 고르고, Pay 기본값과 달라야 하면 `OPENSHELF_PAY_ACCOUNT=NAME`을 설정하세요.
**플러그인은 Pay를 호출하기 전에 Devnet 합산 금액을 정확히 제시하고 명시적 승인을
받습니다.**

Antigravity 없이도 같은 서비스를 씁니다.

```bash
npm run agent:tools                          # 명령 23개 전체 보기
npm run agent:tools -- ask_people            # 입력 스키마 하나만 정확히
npm run agent:call -- ask_people --json \
  '{"question":"What do people living in Paris actually eat on weeknights?","requestedDocuments":3}'
```

인증이 필요한 기여자 명령은 `auth login`이 만든 로컬 세션을 그대로 씁니다. 유료
명령은 개인키를 받는 대신 별도 Pay MCP에 넘길 정확한 URL과 금액을 돌려줍니다.

Cloud Run + GCP KMS 배포는
[`integrations/antigravity/openshelf/README.md`](../../integrations/antigravity/openshelf/README.md),
[`docs/ACCOUNT-LINKING.md`](../ACCOUNT-LINKING.md), [`pay/PAY.md`](../../pay/PAY.md),
[`docs/PAY-SH.md`](../PAY-SH.md)를 보세요.

---

## 검증

```bash
npm run build                    # tsc -b && vite build
npm run lint                     # oxlint
npm run check:all                # 전 워크스페이스: 빌드 · 린트 · 타입체크 · 테스트 · clippy
```

`check:all`은 `backend/`에 `cargo test`와 `cargo clippy -D warnings`를 돌리기 때문에
Rust 툴체인이 필요합니다(`rust-toolchain.toml`이 1.89.0으로 고정). CI는 프런트엔드,
agent-orchestrator, payment-gateway, 백엔드를 각각 잡으로 돌립니다 —
[`.github/workflows/ci.yml`](../../.github/workflows/ci.yml).

---

## 화면

| 경로 | 화면 | 하는 일 |
| --- | --- | --- |
| `/` | **질문하기** | 정문. 물어보면 SHELF가 서가를 뒤지고, 없으면 공고로 넘어갑니다. |
| `/chat/:id` | 대화 | 질문 한 건의 스레드. 있음/없음 대화와 결제 미리보기까지. |
| `/dashboard` | **답변 모집** | 답변자의 보드. 답변당 단가가 붙은 공고가 뜨고, 골라서 답하고 받아 갑니다. |
| `/memory` | **내 서가** | 여태 답한 게 쌓이는 곳. 쌓일수록 자동 매칭이 잘 붙습니다. |
| `/archive` | 내 질문 | 대화, 구매한 문서, 트랜잭션 링크. |
| `/coverage` | 빈 곳 | 질문이 빈손으로 돌아오는 자리와, 그걸 채우겠다고 붙은 값. |
| `/answer/:orderId` | 답변 | 한 화면에 질문 하나. 앞에 몸풀기 몇 개. |
| `/onboarding` | 설정 | 핸들, 구간, 분야, 정산 지갑, 그리고 3진 아웃 규칙. |
| `/whitepaper` | 왜 만들었나 | 이걸 왜 만드는지에 대한 긴 글. |
| `/login` `/terms` `/privacy` `/admin/disputes` | | 지갑 로그인, 법적 고지, 관리자 분쟁 검토. |

---

## 저장소 구조

| 경로 | 들어 있는 것 |
| --- | --- |
| `src/` | React 앱 — 페이지, 컴포넌트, `i18n/`, 그리고 랜딩에서 예시라고 표시하는 `data/` 픽스처. |
| `backend/` | Rust/Axum 서비스: 검색, 랭킹, 원장, 에스크로, 분쟁, 세션. 정확한 경계는 [`backend/README.md`](../../backend/README.md). |
| `payment-gateway/` | x402 v2 게이트웨이 — 견적, verify/settle 위임, 지급·에스크로 워커. |
| `agent-orchestrator/` | 문서마다 Pay.sh 챌린지를 치르는 Cloud Run 에이전트. |
| `pay/` | Pay.sh 페이월 정의, Dockerfile, Cloud Build + GCP KMS 배포. |
| `integrations/antigravity/openshelf/` | 플러그인: MCP 툴 23개, 스킬, Pay 핸드셰이크 어댑터. |
| `docs/` | 위협 모델, 계정 연동, Pay.sh 배포, 코드 리뷰, 랭킹 노트. |
| `architecture.html` | 시스템 아키텍처와 ERD. 파일 하나로 열립니다. |

---

## 무엇이 진짜고 무엇이 아닌가

코드를 읽는 사람에게는 이 구분이 중요해서, 매끄럽게 덮지 않고 그대로 적습니다.

**진짜.** 유료 문서 열람과 유료 공고 예산은 솔라나 Devnet에서 실제 x402 exact/SVM
정산을 씁니다. 세션은 서버가 발급하는 HttpOnly 쿠키이고, 클라이언트가 보낸
`userId`는 받지 않습니다. 에스크로 예약, 답변당 결정적 지급, 취소·계정 삭제 시
정확한 환불이 모두 구현돼 있습니다. 계정 삭제는 모든 세션을 폐기하고 프로필·메모리·
문서 본문을 삭제하며, 추가만 가능한 금전 감사 기록은 익명화합니다. 콘텐츠 해시,
불변 버전, 수정 시 이전 구절 잠금, 비공개 내보내기 로그, 그리고 매칭 메타데이터만
노출하는 공개 매니페스트도 실제로 동작합니다. 2진 자동매칭·지급 보류와 3진 계정
정지는 서버가 강제합니다.

**샌드박스라고 표시된 것.** 가입 시 ₩100,000 잔액과 0원 공고는 명확히 표시된
원장이고 법정화폐가 아닙니다. 로컬 Pay.sh 샌드박스는 402/전달/복구 계약 전체를
증명하는 것이지 Devnet 전송을 증명하지 않습니다. 자금이 실린 Devnet 영수증에는
여전히 팀의 외부 Pay 계정, KMS IAM 주체, Devnet USDC가 필요합니다.

**범위 밖.** 메인넷. 공개 Devnet 서비스를 열려면 관리형 RPC, 다중 인스턴스용 내구
큐와 데이터베이스, 분산 레이트 리밋, 이메일 인증, KMS 시크릿 관리, 소셜 로그인을
쓴다면 외부 신원 제공자까지 더 필요합니다.

**아직 안 정해진 것.** 최초 회의에서 넘어온 그대로이고, 감추는 대신 제품 FAQ에서도
솔직하게 다룹니다.

1. **초기에 서가를 어떻게 채우나.** 가장 큰 난제입니다. 서가가 비면 사서가 할 일이 없습니다.
2. **음성이냐 채팅이냐.** 미정. v1은 공고 답변 방식입니다.
3. **콜드 스타트 권위.** 관련성 탐색은 되지만, 그래프 권위를 신뢰하려면 실서비스 보정과 시빌 저항 신원이 먼저 필요합니다.
4. **불성실한 답변.** 신분증 기반 실명 인증은 v1 범위 밖입니다.

더 읽을 것: 크롬으로 검증한 시나리오와 우선순위 갭은
[`SCENARIO-AUDIT.md`](../../SCENARIO-AUDIT.md), 프로덕션 감사는
[`docs/CODE-REVIEW.md`](../CODE-REVIEW.md), 그리고 모든 카피가 기준으로 삼은
원본 제품 브리프는 [`BRIEF.md`](../../BRIEF.md)에 있습니다.

---

## 라이선스

아직 `LICENSE` 파일이 없습니다. 따라서 기본 저작권이 적용됩니다 — 모든 권리 유보.
특정 용도로 쓸 조건이 필요하면 이슈를 열어 주세요.
