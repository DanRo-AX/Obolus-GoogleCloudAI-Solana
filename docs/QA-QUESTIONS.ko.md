# 한국어 시드 코퍼스 QA 질문 세트

한국어 시드 코퍼스의 검색·랭킹 동작을 재현 검증하는 문서다. 질문 문구가 검증에 쓰인
것과 동일해야 하므로 코드블록에서 그대로 복사한다.

## ① 스택 기동·초기화

새 DB로 백엔드를 기동한다. 시드는 기동 시 자동으로 들어간다.

```bash
rm -f backend/openshelf.db backend/openshelf.db-shm backend/openshelf.db-wal
cd backend && cargo run
```

`curl -s http://127.0.0.1:8787/healthz` 가 `{"status":"ok"}` 면 준비된 것이다.

전체 스택(프론트엔드·API·결제 게이트웨이)은 `npm run dev:stack` 으로 기동한다
(프론트엔드 4319, API 8787, 게이트웨이 1402). 브라우저는 http://localhost:4319.

## ② 검증 질문 4개

각 질문은 `POST /api/v1/questions/resolve` (`requestedDocuments:5, budgetKrw:2500`)
호출 기준이다. 실측: 2026-08-10.

### HIT — 성수동 점심

```
성수동 직장인은 평일 점심을 어디서 먹나요?
```

기대: `decision: hit`, `coverage_ready`, 5/5 `KOLUNCH_*`, 견적 ₩50.
실측 순위: KOLUNCH_5 · 2 · 1 · 3 · 4 (각 ₩10).

### HIT — 파리 저녁

```
파리에 사는 사람들은 평일 저녁에 실제로 뭘 먹나요?
```

기대: `decision: hit`, `coverage_ready`, 5/5 `KOPARIS_*`(영어 시드 `PARISR_12` 미포함),
견적 ₩75. 실측 순위: KOPARIS_2 · 5 · 3 · 4 · 1 (각 ₩15).

### HIT — 초등학교 입학

```
초등학교 입학 준비에서 진짜 돈이 드는 게 뭔가요?
```

기대: `decision: hit`, `coverage_ready`, 5/5 `KOSCHOOL_*`, 견적 ₩100.
실측 순위: KOSCHOOL_3 · 5 · 4 · 1 · 2 (각 ₩20).

### MISS — 제주 겨울 한 달 살기

```
제주에서 겨울 한 달 살기 비용은 실제로 얼마나 드나요?
```

기대: `decision: miss`, `insufficient_coverage` → 공개 모집 제안으로 이어진다.
실측 `openCall` 제안:

```json
{
  "targetAnswers": 5,
  "existingMatches": 1,
  "answersNeeded": 4,
  "suggestedUnitPriceKrw": 20,
  "suggestedBudgetKrw": 80
}
```

## ③ 답변자 화면 확인

답변 모집 보드에 한국어 모집 5건이 시드로 떠 있다. 워밍업은 그중 4건(성수동/초등
입학/가게 운영/파리)이 서가 맞춤형, 나머지 1건(온콜 인프라)은 기본 워밍업이다.

## ④ 지갑 표시 참고

Phantom 지갑은 Devnet USDC를 이름 없는 토큰으로 인식해 "Unknown"으로 표시할 수 있다.
결제 카드에 민트 주소가 같이 뜨므로, Phantom 라벨이 아니라 민트 일치 여부로 판단한다.

시드를 늘리거나 줄이면 검색 앵커 컷오프가 바뀌어 위 결과가 조용히 달라질 수 있다
(`backend/src/seed.rs`의 패딩 문서 주석 참조). 시드 변경 후에는 이 문서의 4개 질문을
다시 돌린다.
