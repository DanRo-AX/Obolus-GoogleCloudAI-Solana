# 데모데이 질문 대본 (8/21)

리허설·발표 중 화면에 띄워놓고 그대로 따라 하는 문서다. 질문 문구는 검증에 쓰인 것과
동일해야 하므로 코드블록에서 그대로 복사한다.

## ① 초기화 절차

데모 직전 또는 리허설 재시작 시 새 DB로 백엔드를 단독 기동한다. 시드는 기동 시 자동으로
들어간다 — 별도 시드 명령이 없다.

```bash
rm -f backend/openshelf.db backend/openshelf.db-shm backend/openshelf.db-wal
cd backend && cargo run
```

`healthz` 응답으로 기동을 확인한다.

```bash
curl -s http://127.0.0.1:8787/healthz
```

`{"status":"ok"}` 가 나오면 준비된 것이다.

## ② 데모 질문 4개

각 질문은 `POST /api/v1/questions/resolve` (`requestedDocuments:5, budgetKrw:2500`) 호출
기준으로 검증됐다. 실측치 출처는 `task-3-report.md`.

### HIT-1 — 성수동 점심

```
성수동 직장인은 평일 점심을 어디서 먹나요?
```

기대 흐름: HIT → 랭킹 5건 → 결제 프리뷰.

실측: `decision: hit`, `reason: coverage_ready`, `candidateCount: 5`, 견적 ₩50.

| 순위 | 핸들 | 단가 |
|---|---|---|
| 1 | KOLUNCH_5 | ₩10 |
| 2 | KOLUNCH_2 | ₩10 |
| 3 | KOLUNCH_1 | ₩10 |
| 4 | KOLUNCH_3 | ₩10 |
| 5 | KOLUNCH_4 | ₩10 |

5/5 `KOLUNCH_*`.

### HIT-2 — 파리 저녁

```
파리에 사는 사람들은 평일 저녁에 실제로 뭘 먹나요?
```

기대 흐름: HIT → 랭킹 5건 → 결제 프리뷰.

실측: `decision: hit`, `reason: coverage_ready`, `candidateCount: 8`, 견적 ₩75.

| 순위 | 핸들 | 단가 |
|---|---|---|
| 1 | KOPARIS_2 | ₩15 |
| 2 | KOPARIS_5 | ₩15 |
| 3 | KOPARIS_3 | ₩15 |
| 4 | KOPARIS_4 | ₩15 |
| 5 | KOPARIS_1 | ₩15 |

5/5 `KOPARIS_*` — 영어 시드(`PARISR_12`) 섞임 없음.

### HIT-3 — 초등학교 입학

```
초등학교 입학 준비에서 진짜 돈이 드는 게 뭔가요?
```

기대 흐름: HIT → 랭킹 5건 → 결제 프리뷰.

실측: `decision: hit`, `reason: coverage_ready`, `candidateCount: 5`, 견적 ₩100.

| 순위 | 핸들 | 단가 |
|---|---|---|
| 1 | KOSCHOOL_3 | ₩20 |
| 2 | KOSCHOOL_5 | ₩20 |
| 3 | KOSCHOOL_4 | ₩20 |
| 4 | KOSCHOOL_1 | ₩20 |
| 5 | KOSCHOOL_2 | ₩20 |

5/5 `KOSCHOOL_*`.

### MISS — 제주 겨울 한 달 살기

```
제주에서 겨울 한 달 살기 비용은 실제로 얼마나 드나요?
```

기대 흐름: MISS → "답을 의뢰하겠냐"는 되물음 → 인원 → 단가 → 모집 발주.

실측: `decision: miss`, `reason: insufficient_coverage`, `candidateCount: 1`(관련 없는
잡음 1건, 제주 언급 문서 없음). `openCall` 제안:

```json
{
  "targetAnswers": 5,
  "existingMatches": 1,
  "answersNeeded": 4,
  "suggestedUnitPriceKrw": 20,
  "suggestedBudgetKrw": 80
}
```

인원 4명, 답당 ₩20, 총 ₩80으로 이어지는 흐름을 그대로 보여주면 된다.

## ③ 답변자 데모 동선

답변 모집 보드(오픈 콜)에 한국어 모집 5건이 이미 떠 있다 — 별도 조작 없이 바로 보여줄 수
있다. 워밍업은 그중 4건(성수동/초등 입학/가게 운영/파리)이 서가 맞춤형으로 나오고, 나머지
1건(온콜 인프라)만 기본 워밍업으로 뜬다.

## ④ 주의사항

Phantom 지갑은 Devnet USDC를 이름 없는 토큰으로 인식해 "Unknown"으로 표시할 수 있다.
결제 화면(결제 카드)에 민트 주소가 항상 같이 뜨므로, 승인 전 그 안내를 그대로 읽고
지갑에 뜬 토큰과 민트를 대조하도록 안내한다 — Phantom 라벨이 아니라 민트 일치 여부로
판단한다.
