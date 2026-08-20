# Obulus 결선 발표 페이지별 비주얼·4K 캡처 정본

기준일: 2026-08-20 KST
발표 정본: [`obulus-pitch-deck.html`](obulus-pitch-deck.html)`?mode=final`
다이어그램 정본: [`OBULUS-PITCH-DIAGRAM-BRIEF.ko.md`](OBULUS-PITCH-DIAGRAM-BRIEF.ko.md)

## 1. 먼저 정할 원칙

발표 화면을 사진으로 채우지 않는다. Obulus에서 사진과 화면 캡처는 장식이 아니라
증거여야 한다.

- **작동 원리**는 D0~D9 벡터 다이어그램으로 설명한다. 확대해도 깨지지 않고,
  발표 중 노드·화살표를 순서대로 강조할 수 있어야 한다.
- **실제 구현**은 제품 UI, Admin Test trace, GCP verifier, Devnet canonical receipt의
  실제 캡처로 증명한다.
- **시장·고객**은 스톡 사진 대신 은행·소비재·리서치·개인 아이콘과 구매 단위,
  질문 예시, PoC 지표를 사용한다. 사람 사진은 데이터 권리·동의 주장을 약하게 만든다.
- 예시 수치, fixture signature, 빈 원장, 빈 메모리 화면은 live 증거처럼 사용하지 않는다.
- 본편에서 한 프레임의 중심 비주얼은 하나만 둔다. 다이어그램과 제품 캡처를 같은
  크기로 경쟁시키지 않는다.

## 2. 최종 본편 8장 비주얼 배치

| 최종 프레임 | 중심 비주얼 | 실제 파일·상태 | 정확한 배치 | 이 화면이 증명하는 것 |
|---|---|---|---|---|
| 1. 표지 | **D0 질문→검색→결제→인용 미니 파이프라인** | HTML 벡터 정본. 보조 이미지로 [`assets/hero.png`](assets/hero.png) 사용 가능 | 왼쪽 55%에 한 문장, 오른쪽 45%에 질문창과 D0. 제품 캡처는 창 전체가 아니라 질문창만 crop | “설문 앱”이 아니라 인간 근거 검색 인프라라는 제품 정의 |
| 2. AI가 모르는 인간 데이터 | **D1 타깃·문제 지도** + `$142B` | HTML 벡터 정본. 외부 사진 불필요 | 상단 35%에 숫자, 하단 65%에 은행·소비재·제품팀→반복 조사→보고서 소멸 흐름 | 타깃, 반복 비용, 데이터 재사용 문제 |
| 3. 제품 해결책 | **D2 검색·구매·Open Call 폐루프** + 실제 HIT UI 한 장 | 현재 1440px 캡처 [`pitch-deck-assets/10-chat-hit-exact-quote.png`](pitch-deck-assets/10-chat-hit-exact-quote.png)은 구조 참고만. **한국어 4K 재촬영 필요** | 오른쪽 58%에 `40→5→4→₩60` HIT 화면, 하단 또는 왼쪽 42%에 D2. 가격 옆 `데모 가격` 표시 | 무료 후보 검색, 중복 저자 제거, 정확한 quote, 부족분만 사람에게 질문 |
| 4. Gemini와 Google Cloud | **D3 실행 경로** 또는 Admin Test 실제 trace | [`pitch-final-assets/04-admin-live-trace-4k.png`](pitch-final-assets/04-admin-live-trace-4k.png) 3840×2160 사용 가능. 구조 확대는 [`pitch-final-assets/04b-admin-architecture-canvas.png`](pitch-final-assets/04b-admin-architecture-canvas.png) | 전체 화면은 노드 rail 70%, 하단 terminal 30%. 사이드바·빈 여백은 제외하고 request ID와 node highlight는 남김 | Web/MCP→Cloud Run→Gemini/Rust→검색·PageRank→결과의 실제 실행 경계 |
| 5. 유료 URL과 결제 | **D4 x402/Pay.sh/Solana sequence** + 실제 canonical receipt | D4는 준비됨. 영수증은 **실제 Devnet 거래 후 신규 4K 캡처 필요**. [`pitch-final-assets/06-ledger-4k.png`](pitch-final-assets/06-ledger-4k.png)은 빈 원장이므로 사용 금지 | 왼쪽 52% sequence, 오른쪽 48% 영수증. signature·amount·recipient·mint·slot·finality·document hash가 동시에 보이게 함 | SOL 없는 USDC 결제, facilitator fee payer, 문서별 정산, 영수증의 증명 범위 |
| 6. 전체 아키텍처 | **D7 전체 시스템 아키텍처** | HTML 벡터 정본. 제품 사진 불필요 | 16:9 전체를 데이터 rail·AI rail·결제 rail·운영 rail 네 줄로 사용. D5 PageRank와 D6 GCP는 inset으로만 표시 | 데이터·모델·권한·돈이 분리된 전체 구조 |
| 7. 목표 고객과 진입 시장 | **D9 타깃별 도입 small multiples** | HTML 벡터 정본. 외부 기업 사진·로고 나열 불필요 | 은행·소비재/제품팀·리서치 기관을 3열로 놓고 각 열에 질문, 구매 단위, 6주 KPI 하나씩 | 누가, 어떤 질문으로, 어떤 성공 지표를 가지고 도입하는지 |
| 8. 증거와 비전 | **D8 주장→실행 증거 지도** + 검증 캡처 2장 | Admin trace는 준비됨. **발표 직전 GCP verifier 4K**와 **실제 Devnet receipt 4K**는 신규 필요 | 왼쪽 55% D8, 오른쪽 45%에 `GCP verifier`와 `Devnet receipt`를 위아래로. 미확보 시 LIVE badge를 숨김 | 구현, 배포, 자율 실행, 온체인 결제가 같은 시점의 증거로 닫힘 |

### 본편에서 쓰지 않을 사진

- 임의의 은행 본사, 회의실, 설문 참여자 스톡 사진
- Solana·Google·Gemini·Pay.sh 로고를 크게 나열한 스폰서 보드
- 데이터가 0인 Coverage, 내 문서, 원장 화면
- 영어·한국어가 섞인 오래된 UI
- Explorer 링크나 signature가 없는 “결제 성공” 예시 카드

## 3. 어펜딕스 12장 비주얼 배치

최종 모드에서 숨겨지는 12장은 Q&A에서 바로 꺼내는 증거 페이지다. 본편과 같은
이미지를 반복하기보다 본편 다이어그램의 확대·수식·실행 세부를 보여 준다.

| 전체 HTML 번호 | 제목 | 권장 비주얼 | 사진·캡처 판단 |
|---:|---|---|---|
| 3 | 한 사람의 답변이 재사용되는 방식 | 원문 문서→검색→재사용 정산→기억 누적 루프 | 실제 문서·수익이 있는 `내 문서` 4K가 확보될 때만 우측 증거 컷으로 사용. 현재 [`05-wallet-memory-4k.png`](pitch-final-assets/05-wallet-memory-4k.png)은 empty state라 제외 |
| 5 | 웹 검색의 재해석 | 웹 PageRank와 Obulus evidence graph 대응표 | 사진 불필요. 노드·edge 대응만 크게 표시 |
| 6 | 질문이 공급을 만드는 선순환 | 질문자→검색→빈칸→Open Call→기여자→재검색 causal loop | 사진 불필요. 돈·데이터 화살표 색을 분리 |
| 7 | 검색과 랭킹 | D5 Personalized PageRank 확대 + 최종 score 수식 | Admin Test에서 질문 seed에 따라 노드가 실제 점등되는 4K crop을 보조로 사용 가능 |
| 8 | 메모리 자산 | `L0 원문→L1 패턴→L2 규칙→L3 성향` 트리와 source pointer | 최소 L0 9개, L1 3개, L2 1개가 실제로 생성된 Admin Test 4K 신규 캡처 필요. 0 reflection 화면은 금지 |
| 10 | 마이크로페이 가격 구조 | 문서별 atomic price, owner target share, protocol fee, rounding 표 | 사진 불필요. `데모 가격·상용 가격 아님` 고정 |
| 12 | 제한된 자동결제 | Phantom login→scoped capability→prepaid balance→document settlement | [`00-wallet-login-4k.png`](pitch-final-assets/00-wallet-login-4k.png)은 영어라 Q&A 참고만. 한국어 capability·한도·만료·잔액 화면 재촬영 권장 |
| 13 | CLI와 MCP | MCP tools 목록, 실제 `resolve_question` request ID, Admin trace correlation | [`pitch-deck-assets/11-cli-mcp-agent-interface.png`](pitch-deck-assets/11-cli-mcp-agent-interface.png)은 1440×900 참고용. 4K terminal 재촬영 권장 |
| 16 | 시장 규모와 진입 논리 | ESOMAR `$142B`→좁은 beachhead→6주 PoC funnel | 외부 보고서 스크린샷 대신 숫자·출처·연도만 사용 |
| 17 | 경쟁 우위와 6주 도입 계획 | 기존 패널/일반 RAG/Obulus 비교표 + 6주 timeline | 사진 불필요 |
| 18 | 단위경제 | 질문 1건당 후보·열람·원가·정산 waterfall | 사진 불필요. 검증 전 수치는 scenario 라벨 |
| 19 | 3개년 사업 시나리오 | 고객·질문·기여자·재사용률 small multiples | 사진 불필요. forecast 라벨 고정 |

## 4. 지금 바로 전달 가능한 고해상도 파일

다음 파일은 원본 PNG다. 문서에 붙여 넣을 때 메신저 미리보기 이미지를 저장하지 말고
이 링크의 원본 파일을 사용한다.

| 파일 | 해상도 | 사용처 | 판정 |
|---|---:|---|---|
| [`04-admin-live-trace-4k.png`](pitch-final-assets/04-admin-live-trace-4k.png) | 3840×2160 | 본편 4, A7/A8 | 사용 가능. `local trace`로 표기 |
| [`04b-admin-architecture-canvas.png`](pitch-final-assets/04b-admin-architecture-canvas.png) | 3440×1340 | 본편 4 부분 crop, A7 | 사용 가능 |
| [`00-wallet-login-4k.png`](pitch-final-assets/00-wallet-login-4k.png) | 3840×2160 | A12 | 영어 화면이라 보류 |
| [`01-coverage-demand-4k.png`](pitch-final-assets/01-coverage-demand-4k.png) | 3840×2160 | 제품 참고 | 열린 질문·보상이 0이라 live 수요 증거로 사용 금지 |
| [`05-wallet-memory-4k.png`](pitch-final-assets/05-wallet-memory-4k.png) | 3840×2160 | A3 | 문서·수익이 0이라 재사용 증거로 사용 금지 |
| [`06-ledger-4k.png`](pitch-final-assets/06-ledger-4k.png) | 3840×2160 | 없음 | 빈 원장이므로 제외 |
| [`artifacts/obulus-observatory-final.png`](../artifacts/obulus-observatory-final.png) | 2880×1800 | Admin Test 디자인 참고 | 최신 trace 여부를 확인한 뒤에만 사용 |

## 5. 새로 촬영할 4K 산출물과 합격 조건

### R1. `10-chat-hit-exact-quote-4k.png`

- 경로: 질문 화면
- 상태: `HIT`
- 화면에 반드시 보일 것: 후보 수, 선택 문서 수, 독립 저자 수, 문서별 atomic price,
  정확한 총액, 무료 metadata와 유료 원문 경계
- 금지: `MISS`, general fallback, Open Call만 보이는 화면

### R2. `11-admin-live-request-4k.png`

- 경로: Admin Test
- 상태: 하나의 실제 Web 또는 MCP request가 진행 중이거나 방금 완료
- 화면에 반드시 보일 것: 같은 request ID, 순차 node highlight, curved edge pulse,
  하단 terminal event, final result
- 라벨: local이면 `LOCAL TRACE`, 배포 환경이면 실제 revision과 timestamp

### R3. `12-memory-abstraction-l0-l3-4k.png`

- 경로: Admin Test memory branch
- 입력 상태: 같은 주제의 source-linked L0 원문이 충분히 적재된 상태
- 화면에 반드시 보일 것: 최소 L0 9개→L1 3개→L2 1개, 각 상위 노드의 source pointer,
  importance 누적과 reflection 조건
- 미래 설계만 시각화했다면 `TARGET DESIGN` 라벨을 붙이고 live 증거로 쓰지 않는다.

### R4. `13-devnet-canonical-receipt-4k.png`

- 경로: 청구서/내역
- 실제 Devnet 결제 1건 후 촬영
- 화면에 반드시 보일 것: document ID·version/hash, payer·recipient, USDC mint,
  quote ID·nonce/idempotency, atomic amount, signature, slot, `finalized`, 두 RPC 확인,
  refund/dispute status
- 전체 지갑 주소·이메일·token은 마스킹하되 signature 검증 링크는 유지

### R5. `14-gcp-verifier-4k.png`

- 경로: 발표용 verifier 화면 또는 terminal
- 발표 직전 새로 실행
- 화면에 반드시 보일 것: timestamp, project `sweetspot-ax`, region `asia-northeast3`,
  4개 서비스 revision·service account·image digest, SQL·Tasks·KMS 상태,
  총 통과 수와 `summary.ready`
- 이전 실행 JSON을 새 실행처럼 표시하지 않는다.

### R6. `15-mcp-cli-4k.png`

- 경로: terminal
- 화면에 반드시 보일 것: Obulus MCP 연결 상태, tool 이름, 한 번의 request ID,
  실제 API 응답 요약
- API key, internal token, wallet secret은 절대 노출하지 않는다.

## 6. 캡처 규격

- viewport: 1920×1080
- device scale factor: 2
- 원본: PNG 3840×2160, sRGB
- browser zoom: 100%
- 앱 canvas zoom: 핵심 노드 label이 발표 화면에서 읽히도록 75~100%
- 한글 UI, 영어는 제품명·프로토콜·서비스명만 유지
- cursor, 브라우저 chrome, 개발자 도구, 불필요한 탭은 숨김
- wallet·token·private endpoint·이메일은 마스킹
- 캡처 직후 `sips -g pixelWidth -g pixelHeight <file>`로 3840×2160 확인
- 슬라이드 삽입 시 원본 비율을 유지하고 CSS 확대는 최대 1.15배까지만 사용

## 7. 발표장에서의 사용 순서

1. 본편 1~3장은 사진이 아니라 D0~D2로 문제와 제품을 이해시킨다.
2. 라이브 데모에서 실제 질문 화면→Admin Test trace→quote를 보여 준다.
3. 본편 4는 방금 본 trace를 D3로 해석한다.
4. 본편 5는 실제 receipt가 있을 때만 오른쪽 증거 컷을 공개한다.
5. 본편 6~7은 D7·D9로 운영 구조와 도입 시나리오를 정리한다.
6. 본편 8은 같은 실행 창의 GCP verifier와 Devnet receipt가 모두 있을 때만 `LIVE`로 닫는다.

이 순서면 스크린샷이 설명을 대신하지 않고, 앞에서 이해한 주장을 뒤에서 실제 증거로
검증하는 구조가 된다.
