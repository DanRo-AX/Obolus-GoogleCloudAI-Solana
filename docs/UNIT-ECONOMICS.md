# Obolus unit-economics contract

Status: measurement plan, not market validation
Baseline date: 2026-08-11

The current ₩5–₩25 seeded-document prices prove exact quoting, settlement,
recovery, payout, and refund behavior. They are not evidence of a sustainable
commercial price. No customer willingness-to-pay result exists yet.

## One query

For a query that opens `D` documents at average all-in price `P` KRW with
protocol fee rate `F`:

```text
GMV per query              = D × P
protocol revenue per query = D × P × F
contribution per query     = protocol revenue − variable cost
break-even document price  = variable cost ÷ (D × F)
```

The displayed product policy is `F = 10%`. The hosted Devnet Pay.sh rail does
not yet put that 90/10 split into one on-chain receipt, so this model describes
the intended commercial policy rather than current Devnet accounting.

### What the demo price implies

The deck's example opens eight documents at ₩15 each:

| Item | Amount |
| --- | ---: |
| Query GMV | ₩120 |
| Contributor share at intended 90% | ₩108 |
| Protocol revenue at intended 10% | **₩12** |

That ₩12 must cover the query's variable infrastructure and payment cost before
it contributes to support, compliance, fixed cloud cost, or margin. Obolus has
not measured that comparison in a representative workload, so the example must
remain labelled **demo economics**.

### Break-even sensitivity, not a cost claim

For eight opened documents and a 10% fee:

| Measured variable cost per query | Break-even average price per document |
| ---: | ---: |
| ₩10 | ₩12.50 |
| ₩50 | ₩62.50 |
| ₩100 | ₩125.00 |
| ₩500 | ₩625.00 |

These rows are algebraic scenarios, not observed Obolus costs. The PoC must
replace the left column with measured billing and usage data.

## Cost counters the PoC must capture

| Stage | Required measurement | Why it can change the economics |
| --- | --- | --- |
| Free discovery | Cloud Run CPU/memory time, Cloud SQL CPU/I/O, Pages requests | A MISS earns no document fee but still consumes search capacity. |
| Bounded AI loop | Vertex input/output tokens and calls for planning and post-retrieval action | Authenticated resolution now uses up to two billed provider calls. |
| Paid synthesis | Vertex tokens and latency for only the settled passages | Cost grows with opened passage count and length. |
| Browser prepaid | top-up transaction count, amortized opens per top-up, sponsored SOL fee | Prepaid sessions should amortize wallet friction and chain overhead. |
| Hosted Pay.sh | transactions, KMS signatures, two-RPC reads, reconciliation attempts per document | The direct rail currently has per-document payment and recovery work. |
| Open Call | funding, answer payout, refund, queue retries | A partly filled call can exercise three different settlement paths. |
| Operations | support minutes, disputes, payout holds, abuse review | Micropayment gross margin is meaningless if manual handling dominates it. |

Measure the browser-prepaid, hosted Pay.sh, and Open Call rails separately. Do
not average them into one number until their transaction shapes and failure
rates are known.

## Six-week PoC decision gates

The PoC starts with 20–50 real buyer questions and 30–100 consented
contributors. Before changing the deck from “demo price” to “commercial
price,” record:

1. HIT/PARTIAL/MISS rate and documents opened per query.
2. Buyer willingness to pay and time saved against the existing research
   workflow, collected independently of the product team.
3. Contributor acceptance, reuse, payout, correction, and retention rates.
4. P50/P95 variable cost per query by rail, including failed and recovered
   attempts.
5. Contribution margin after refunds, disputes, support, RPC disagreement, and
   Vertex fallback.

The earlier SOM assumption of 50,000 questions per organization per month is a
scenario input, not evidence. It must not drive a valuation or market-size
claim until a customer supplies comparable usage data.

## Commercial decision

Only after the PoC should the team choose among higher document prices,
minimum query fees, batched settlement, lower-cost model routing, or a different
protocol take rate. The decision must preserve the core promise: buyers see one
all-in price, contributors know their share, and retries cannot create a second
charge or payout.
