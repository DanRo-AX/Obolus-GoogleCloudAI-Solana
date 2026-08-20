# Obulus 결선 발표 고해상도 이미지 가이드

기준일: 2026-08-20 KST

이 폴더는 발표 본편과 어펜딕스에 사용할 실제 제품 캡처를 관리한다. 화면이 예쁘다는 이유만으로 증거로 쓰지 않는다. **실제 상태·수치·거래가 화면 주장과 일치할 때만** 본편 증거 컷으로 승격한다.

## 바로 사용할 파일

### 1. Admin Test 전체 trace

- 파일: [`04-admin-live-trace-4k.png`](04-admin-live-trace-4k.png)
- 해상도: 3840×2160
- 권장 위치: 본편 슬라이드 4, 어펜딕스 A9
- 보여 주는 것: Web/MCP/Agent intake, Cloud Run, Rust policy, memory abstraction, evidence index, hybrid retrieval, Personalized PageRank, 결과 노드, 실제 하단 event terminal
- crop: 브라우저 chrome과 불필요한 바깥 여백을 제거하되 timestamp와 terminal은 남긴다.

### 2. Admin Test architecture canvas

- 파일: [`04b-admin-architecture-canvas.png`](04b-admin-architecture-canvas.png)
- 해상도: 3440×1340
- 권장 위치: 본편 슬라이드 4의 중앙 시각물, 어펜딕스 A3/A5의 부분 확대
- 보여 주는 것: 정책 경계와 검색·추상화·PageRank의 연결 구조
- crop: 슬라이드 4에서는 전체 경로를, A3에서는 `Evidence index → Hybrid candidate search → Personalized PageRank → 결과`만 사용한다.

### 3. Coverage UX

- 파일: [`01-coverage-demand-4k.png`](01-coverage-demand-4k.png)
- 해상도: 3840×2160
- 권장 위치: 제품 화면 모음 또는 어펜딕스
- 제한: 현재 열린 질문과 보상 수치가 0이다. 수요·traction·실시간 운영 증거로 사용하지 않는다.

## 조건부 또는 제외 파일

| 파일 | 상태 | 이유 |
|---|---|---|
| `00-wallet-login-4k.png` | 보류 | 현재 영어 상태. 한국어 발표용으로 재촬영 필요 |
| `05-wallet-memory-4k.png` | 보류 | 문서·수익이 0인 empty state |
| `02-system-flow-4k.png` | 제외 | 잘린 세로 캡처, 본편 아키텍처와 불일치 |
| `03-ranked-evidence-4k.png` | 제외 | HIT가 아니라 MISS/general fallback |
| `06-ledger-4k.png` | 제외 | 거래·영수증이 없는 빈 원장 |

## 아직 반드시 촬영해야 하는 두 장

### A. 실제 canonical receipt

한 번의 실제 Devnet 거래 후 다음 필드가 같은 화면에 보여야 한다.

- document ID와 version/hash
- payer, recipient, USDC mint
- quote ID, nonce/idempotency key
- atomic amount와 표시 통화
- transaction signature와 Explorer Devnet 링크
- `finalized` 및 독립 RPC 확인 수
- refund/dispute 상태
- “결제·접근 증명이며 내용 진실 증명은 아님” 문구

예시 fixture나 임의 signature로 채우지 않는다.

### B. 발표 직전 GCP verifier

다음 정보가 한 화면에 읽혀야 한다.

- 실행 timestamp
- project `sweetspot-ax`
- region `asia-northeast3`
- 4개 Cloud Run 서비스와 live revision
- Cloud SQL, Tasks, KMS, Secret Manager 검증 결과
- 최종 통과 수와 `summary.ready`

`77/77`은 새 실행 결과가 실제로 77/77일 때만 표시한다.

## 캡처 규격

- 브라우저 viewport: 1920×1080
- device scale factor: 2
- 산출물: PNG 3840×2160, sRGB
- 확대: 브라우저 zoom 100%, 앱 canvas zoom은 노드 라벨이 읽히는 수준
- 언어: 본편은 한국어, 기술 고유명만 영어
- 개인정보: wallet 전체 주소, 이메일, token, secret, private endpoint는 마스킹
- 금지: fixture signature, 임의 잔액, mock badge를 live metric처럼 표시

재현 스크립트: [`../../tmp/capture-pitch-4k.mjs`](../../tmp/capture-pitch-4k.mjs)
