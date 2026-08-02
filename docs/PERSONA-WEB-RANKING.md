# OPENSHELF Persona Web: Google 링크 그래프에서 가져올 것과 버릴 것

## 결론

OPENSHELF의 개인 DB는 웹사이트, 그 안의 기억은 페이지, 검증 가능한 주장 단위는 passage로 모델링한다. 검색은 다음 네 단계를 분리해야 한다.

```text
무료 발견       권위 재정렬              유료 개방              답변·정산
metadata/     topic-sensitive          x402 per passage      evidence synthesis
lexical/vector -> graph authority -> budgeted top-k opens -> contribution bonus
```

PageRank는 질문에 답하는 모델도, 진실 판별기도 아니다. 링크 그래프에서 계산한 **query-independent authority prior**다. 현대 Google 검색도 링크 분석만 쓰지 않고 관련성, 신선도, 원본성, 신뢰성, 중복 제거, 사이트 다양성, 스팸 탐지 등 여러 시스템을 결합한다. 따라서 OPENSHELF도 임베딩을 없애는 대신 다음처럼 역할을 나눈다.

- lexical/vector retrieval: 질문과 관련 있는 후보를 싸게 찾는다.
- graph authority: 관련 후보 중 누구를 먼저 열 가치가 있는지 정한다.
- x402: 선택된 passage만 열고 소유자에게 지불한다.
- evidence orchestrator: 열린 passage가 실제 답에 기여했는지 평가하고 종합한다.
- outcome feedback: 독립적으로 확인된 유용성만 다음 검색의 권위 신호로 돌려보낸다.

이 분리가 제품의 경제성을 만든다. 모든 DB를 열어 본 뒤 고르는 구조는 개인정보와 비용 양쪽에서 실패한다.

## 1. Google이 링크를 다루는 실제 파이프라인

### 1.1 발견: 링크는 crawler의 frontier다

Googlebot은 링크, sitemap, redirect를 파싱하며 URL에서 URL로 이동한다. Google이 일반적으로 안정적으로 해석하는 링크는 `href`가 있는 `<a>` 요소이고, anchor text는 대상 페이지의 의미를 이해하는 문맥이 된다.

OPENSHELF 대응:

- 모든 Persona DB는 영구적인 `persona://{owner}` 식별자를 갖는다.
- 각 기억은 `persona://{owner}/memories/{memoryId}`라는 canonical resource ID를 갖는다.
- 공개 인덱스에는 원문이 아니라 제목, topic, 시간, 지역 band, 가격, 공개 가능한 요약, content hash만 둔다.
- memory가 다른 memory의 근거를 인용하면 typed edge를 남긴다.
- 새 resource는 sitemap에 해당하는 signed manifest/feed로 발견된다.

참고: [Google의 crawlable link 지침](https://developers.google.com/search/docs/crawling-indexing/links-crawlable), [검색 개발자 가이드](https://developers.google.com/search/docs/fundamentals/get-started-developers)

### 1.2 정규화: URL과 콘텐츠의 동일성을 먼저 정리한다

같은 콘텐츠가 여러 URL에 있으면 링크 신호와 통계가 찢어진다. Google은 redirect, `rel=canonical`, sitemap 같은 신호로 대표 URL을 선택하고 중복 URL의 신호를 canonical URL로 합친다. OPENSHELF에서는 이 단계가 더 중요하다. 한 사람이 같은 답을 조금씩 바꿔 여러 공고에 제출하면 문서 수와 링크 수를 인위적으로 늘릴 수 있기 때문이다.

OPENSHELF canonical 규칙:

1. 정규화한 원문 hash와 semantic near-duplicate 검사를 함께 쓴다.
2. 복제·수정 memory는 `derived_from`으로 원본에 연결한다.
3. 동일 소유자의 near-duplicate는 별도 권위 노드로 세지 않는다.
4. 삭제 후에도 원문은 제거하되 hash, 정산 영수증, tombstone은 감사 목적으로 남긴다.
5. 외부로 내보낸 DB 복제본은 owner signature와 canonical memory ID로 귀속을 유지한다.

참고: [Google canonical URL 문서](https://developers.google.com/search/docs/crawling-indexing/consolidate-duplicate-urls)

### 1.3 인덱싱: 본문 검색과 링크 그래프는 서로 다른 인덱스다

초기 Google 구조도 compressed repository, inverted index, document index, anchor data, links database를 분리했다. 검색 시 본문/anchor의 query relevance와 PageRank를 결합했다. 이것이 OPENSHELF에서 “임베딩 없이 PageRank만”이 잘못된 이유다. 그래프는 `Paris 음식`이라는 질문과 문서의 의미적 일치를 스스로 알지 못한다.

OPENSHELF는 최소 세 저장소를 둔다.

| 저장소 | 공개 범위 | 역할 |
| --- | --- | --- |
| Resource index | metadata만 공개 | lexical/vector candidate recall |
| Evidence graph | edge와 provenance 공개 가능 | authority, diversity, spam 분석 |
| Private passage store | x402 뒤에서 암호화 | 실제 인터뷰·memory 원문 |

참고: [Brin·Page, The Anatomy of a Large-Scale Hypertextual Web Search Engine](https://research.google.com/pubs/archive/334.pdf)

### 1.4 권위 전파: 단순 backlink 수보다 누가 링크했는지가 중요하다

고전 PageRank의 직관은 “중요한 페이지가 가리키는 페이지는 중요하다”다. 페이지 `v`의 rank는 `v`를 가리키는 페이지들의 rank를 각 페이지의 outgoing edge 수로 나눈 값을 합해 계산한다.

```text
PR(v) = (1 - d) · p(v) + d · Σ[u -> v] PR(u) · w(u,v) / Σ[x] w(u,x)
```

- `d`: 링크를 따라갈 확률. 고전적인 random-surfer 해석에서는 보통 0.85에 해당한다.
- `p(v)`: teleport/personalization 분포. 균등이면 global PageRank, 특정 topic 또는 신뢰 seed에 치우치면 personalized PageRank다.
- outgoing link가 없는 dangling node의 질량은 `p`로 다시 분배한다.
- 반복 계산이 수렴하면 장기 방문 확률을 얻는다.

원 논문은 균등한 rank source뿐 아니라 개인에 맞춘 source vector도 설명한다. Topic-Sensitive PageRank는 여러 topic-biased vector를 미리 계산하고 query 시 topic 확률로 조합한다. OPENSHELF에는 단일 global 점수보다 이 방식이 맞다. 파리 생활 경험이 높은 사람이 Solana 보안에도 자동으로 권위자가 되어서는 안 된다.

참고: [원 PageRank 논문](https://pi.math.cornell.edu/~levine/4740/2013/pagerank-original-paper-1998.pdf), [Topic-Sensitive PageRank](https://snap.stanford.edu/class/cs224w-readings/Haveliwala02Topicsenitive.pdf)

### 1.5 검색 랭킹: PageRank는 전체 점수의 한 항이다

Google은 PageRank가 현재도 core ranking systems의 일부라고 공개하지만, 링크 분석 방식은 초창기와 크게 달라졌으며 수많은 다른 신호가 함께 사용된다고 명시한다. passage 단위 관련성, freshness, original content, reliable information, site diversity, deduplication, SpamBrain 등이 별도 계층이다.

OPENSHELF의 query-time score 초안:

```text
eligibility = consent
           × filter_match
           × not_suspended
           × relevance_gate

rank = 0.55 semantic_relevance
     + 0.12 lexical_coverage
     + 0.13 topic_authority
     + 0.10 verified_reliability
     + 0.05 freshness
     + 0.05 exploration
     - spam_penalty
```

가중치는 제품 가설이지 진리가 아니다. 실제 질문 결과와 test-retest/사후 결과를 모아 calibration해야 한다. 중요한 불변식은 **relevance를 eligibility gate로 먼저 적용**한다는 점이다. 권위가 높아도 무관한 DB는 결제 후보가 될 수 없다.

참고: [Google ranking systems guide](https://developers.google.com/search/docs/appearance/ranking-systems-guide)

### 1.6 링크 자격: 모든 edge가 rank를 전달하지 않는다

Google은 광고·유료 배치는 `sponsored`, 사용자 생성 링크는 `ugc`, 관계를 보증하기 싫은 링크는 `nofollow`로 표시하도록 한다. 이 구분이 OPENSHELF의 핵심 안전장치다.

| OPENSHELF edge | 의미 | authority 전달 |
| --- | --- | --- |
| `cites` | 답변이 다른 memory를 명시적으로 근거로 사용 | 조건부 허용 |
| `corroborates` | 독립 소유자의 별도 경험이 같은 주장을 지지 | 높게 허용 |
| `verified_outcome` | 이후 실제 결과가 예측/주장을 확인 | 가장 높게 허용 |
| `endorses` | 검증된 curator가 topic 전문성을 인정 | 허용 |
| `derived_from` | 복제·요약·수정본 | 거의 전달하지 않음 |
| `contradicts` | 상충하는 독립 증거 | 양의 rank 대신 불확실성 증가 |
| `disputes` | 품질·동의·사실성 이의 제기 | penalty 후보 |
| `paid_open` | 돈을 내고 passage를 열었음 | **전달하지 않음** |
| `accepted_contribution` | 최종 답변에 실제 사용됨 | 결과 검증 전에는 약하게만 사용 |
| `same_owner` | 같은 사람/조직의 resource | **전달하지 않음** |

`paid_open`을 backlink처럼 세면 자전거래로 rank를 살 수 있다. 결제는 수요 신호와 정산 증거이지 truth/authority 신호가 아니다.

참고: [Google outbound link qualification](https://developers.google.com/search/docs/crawling-indexing/qualify-outbound-links)

### 1.7 링크 스팸: 삭제보다 신용 전달을 중화한다

Google은 돈을 주고 산 링크, 과도한 상호 링크, 자동 생성 링크, 저품질 directory 링크 등을 link spam으로 정의한다. SpamBrain 기반 link-spam update는 부자연스러운 링크가 넘긴 ranking credit을 중화한다고 설명한다. 내부 알고리즘은 공개되지 않았으므로 OPENSHELF가 “Google 스팸 알고리즘을 그대로 쓴다”고 말하면 안 된다. 가져올 수 있는 것은 원칙과 관측 가능한 패턴이다.

OPENSHELF spam 방어:

- 같은 owner/wallet/device cluster 내부 edge는 rank를 전달하지 않는다.
- 짧은 시간 안의 reciprocal cycle과 dense clique는 edge weight를 감쇠한다.
- 한 owner가 하나의 query 결과를 지배하지 못하도록 author/site diversity cap을 둔다.
- sponsored/payment edge는 별도 usage graph에만 저장한다.
- 새 persona에는 작은 exploration quota를 주되 큰 authority를 선지급하지 않는다.
- 다수결만 보지 않고 독립 소유자 수, 구체성, 시간·장소 일치, 모순을 함께 계산한다.
- 질문자의 채택 평가보다 사후 검증 가능한 outcome을 더 강한 seed로 쓴다.
- 신고와 dispute는 원문 삭제 여부, payout hold, rank penalty를 분리해 처리한다.
- answer가 구매자/평가자에게 보인 내용과 indexing agent에게 보인 내용이 다르면 cloaking으로 간주한다.

참고: [Google spam policies](https://developers.google.com/search/docs/essentials/spam-policies), [2022 link spam update](https://developers.google.com/search/blog/2022/12/december-22-link-spam-update)

## 2. Persona Web 데이터 모델

### 2.1 세 수준의 node

```text
PersonaDB (site/origin)
  └─ Memory (page/document)
       └─ Passage (x402 resource)
```

- PersonaDB: owner, consent policy, payout wallet, demographic bands, topic authority, strike 상태.
- Memory: observation/answer/reflection, timestamp, importance, topic, source event, canonical hash.
- Passage: 질문에 필요한 최소 공개 단위, 가격, disclosure policy, content hash.

권위는 persona와 memory 양쪽에 계산한다. persona rank만 쓰면 한 분야의 권위가 전 분야로 번지고, memory rank만 쓰면 새 계정을 대량 생성하는 Sybil 공격에 약하다.

### 2.2 Generative Agents memory stream과의 결합

각 개인의 내부 검색은 다음 점수로 memory를 꺼낸다.

```text
memory_retrieval = α · recency
                 + β · importance
                 + γ · relevance
                 + δ · evidence_authority
```

- observation: 인터뷰 답변과 대화에서 직접 관측한 사실.
- reflection: 여러 observation에서 도출한 상위 수준 선호·습관. 반드시 source memory IDs를 가진다.
- correction: 사용자가 잘못된 reflection을 수정하는 새 event. 과거 event를 조용히 덮어쓰지 않는다.
- access log: 어떤 query에서 후보가 됐고, 실제로 열렸고, 최종 답에 쓰였는지 단계별로 기록한다.

Reflection이 자기 observation들만 반복 인용해 PageRank를 올리지 않도록 `same_owner`/`derived_from` edge는 authority를 전달하지 않는다.

### 2.3 edge provenance

모든 edge는 최소 다음 필드를 가진다.

```json
{
  "source": "persona://alice/memories/m1",
  "target": "persona://bob/memories/m9",
  "relation": "corroborates",
  "topic": "paris.food",
  "provenance": "outcome_verified",
  "weight": 0.9,
  "actor": "agent://evidence-evaluator/v1",
  "evidenceReceipt": "solana:...",
  "createdAt": 1785600000000
}
```

edge 생성 주체와 근거가 없으면 rank에 넣지 않는다. LLM이 “비슷해 보인다”고 만든 edge는 retrieval 보조 신호일 뿐, 독립 검증 edge가 아니다.

## 3. 한 질문의 전체 오케스트레이션

```text
1. Planner
   질문 → 필요한 사람 band, topic, 신선도, 답변 수, 예산으로 분해

2. Free discovery
   공개 metadata/lexical/vector index에서 수십~수백 개 candidate recall

3. Authority rerank
   topic-personalized PageRank + 신뢰 + diversity + spam penalty

4. Budgeted selection
   동일 owner 중복 제거, marginal information gain 기준 top-k 선택

5. x402 open
   passage URL 요청 → 402 quote → USDC 결제 → 원문 반환

6. Evidence evaluation
   관련성, 구체성, 독립성, 상호 모순, 인용 가능성을 passage별 평가

7. Synthesis
   합의와 이견을 분리하고, 열린 passage handle을 문장 근거로 표시

8. Settlement
   open fee는 공개 시 확정; contribution bonus는 실제 채택 시 별도 지급

9. Feedback
   accepted_contribution/verified_outcome/dispute edge와 품질 통계를 갱신

10. Coverage fallback
   confidence/coverage가 부족하면 부족한 band만 대상으로 open call 생성
```

선택 문제는 단순 top-k보다 예산 제약 하의 submodular selection에 가깝다. 이미 선택한 문서와 거의 같은 문서는 marginal gain이 낮다.

```text
gain(d | S) = relevance(d)
            + authority(d)
            + new_demographic_coverage(d, S)
            + novelty(d, S)
            - price(d)
            - owner_concentration(d, S)
```

## 4. 정산 프로토콜

### 4.1 두 단계 지급

- open fee: 암호화된 passage를 반환한 순간 지급. 결과가 최종 답에 안 쓰여도 데이터 접근 대가다.
- contribution bonus: evaluator가 최종 답의 claim에 passage를 연결한 뒤 지급.

두 지급은 quote ID, query ID, passage ID, content hash, payer/payee, amount, evaluator version을 포함하는 idempotent receipt를 가진다. 재시도는 같은 receipt를 돌려주고 중복 지급하지 않는다.

### 4.2 chain에 올릴 것과 올리지 않을 것

Onchain:

- 결제 영수증과 amount/asset/recipient
- content hash 또는 Merkle commitment
- consent policy version hash
- dispute/rollback을 참조하는 immutable event ID

Offchain encrypted:

- 인터뷰 원문과 사적 대화
- demographic 세부값
- reflection과 개인 belief state
- evaluator의 민감한 내부 분석

블록체인은 데이터의 진실을 보증하지 않는다. 누가 어떤 버전의 데이터에 얼마를 지불했는지와 이후 변경 여부를 감사 가능하게 만든다.

## 5. 정확도와 제품 지표

검색 지표:

- recall@candidate: 돈을 내기 전에 좋은 DB를 후보에 넣었는가
- paid precision: 연 passage 중 최종 답에 기여한 비율
- cost per supported claim: 근거 있는 claim 하나당 지불액
- owner diversity / demographic coverage
- duplicate-open rate와 Sybil cluster exposure

답변 지표:

- citation entailment: passage가 실제 claim을 지지하는가
- contradiction coverage: 소수 의견과 상충 증거를 숨기지 않았는가
- calibrated confidence/Brier score
- test-retest normalized agreement
- 사후 outcome accuracy와 distribution drift

시장 지표:

- persona DB당 월 수익과 재사용률
- open call fill time/acceptance rate
- cold-start contributor의 첫 수익까지 시간
- open fee 대비 contribution bonus 비율
- dispute/void/payout hold 비율

## 6. 해커톤 구현 우선순위

### P0: 데모에서 반드시 보여야 하는 단일 루프

1. 파리 음식 질문을 입력한다.
2. metadata retrieval과 topic-authority가 후보를 정렬한다.
3. 선택된 각 passage가 독립적으로 HTTP 402를 반환한다.
4. Phantom이 Devnet USDC 결제를 서명한다.
5. Gemini orchestrator가 열린 passage만 인용해 합의/이견이 있는 답을 만든다.
6. 지급 영수증과 각 개인의 earnings가 갱신된다.
7. 없는 band를 물으면 그 gap만 채우는 open call이 생성된다.
8. contributor가 interview agent를 거쳐 답하고 memory가 검색 graph에 들어온다.

### P1: 신뢰성

- typed evidence edge와 topic-personalized PageRank
- paid/self/UGC edge의 authority 차단
- owner diversity와 near-duplicate 감쇠
- contribution bonus와 evaluator receipt
- reflection source lineage와 consent policy

### P2: 운영

- graph batch recomputation/streaming update
- drift monitoring과 stale memory decay
- encrypted per-persona storage, export/delete/tombstone
- human review와 adversarial evaluation set

## 7. 피치에서 정확히 말할 문장

> OPENSHELF turns a person's lived experience into a permissioned, paid web resource. Agents discover it for free, rank it through a provenance-aware evidence graph, and pay only for the passages they open and use.

피해야 할 표현:

- “PageRank가 진실을 판별한다.”
- “임베딩이 전혀 필요 없다.”
- “결제 기록이 신뢰도를 증명한다.”
- “Google의 현재 스팸 알고리즘을 그대로 구현했다.”
- “블록체인에 개인 데이터를 저장한다.”

정확한 표현:

- “고전 PageRank와 topic-sensitive/personalized graph ranking에서 영감을 받았다.”
- “paid/self-generated edges는 authority를 전달하지 않는 provenance-aware graph다.”
- “semantic recall, graph authority, paid disclosure, evidence synthesis를 분리했다.”
- “Solana는 micropayment와 감사 가능한 receipt layer이고 Gemini는 evidence orchestration layer다.”
