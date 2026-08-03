// FAQ copy. Based on the locked output of the two Ttukseom-ro 1-gil meetings
// (39 min divergent / 21 min convergent).
// Answers separate paragraphs with '\n\n'. The UI splits on that delimiter.
export type Faq = { q: string; a: string }

export const HOME_FAQ: Faq[] = [
  {
    q: 'What is OPENSHELF?',
    a: 'It turns the internet into a database, and accessing that database costs money over x402. Instead of crawling the web, the agent searches the MDs people have written.\n\nThe structure is closer to a library. One book is one MD written by one person, the stacks are the database, and the librarian is SHELF-1. A question comes in, the librarian pulls only the few books that fit, and hands back the points that matter.\n\nWe copied the shape of the internet almost exactly. One MD is one URL, the closest matches rise to the top, and only a handful of representative ones get opened. One thing is different: opening that URL pays the author.'
  },
  {
    q: 'Is this a search engine?',
    a: 'No. What makes it onto the web is the tip of the iceberg. The information worth paying for sits inside people, and most of it was never posted anywhere. Where someone who has lived in Seongsu for three years goes for lunch does not turn up in search.\n\nThe web an agent reads also has no way to charge. A crawler can read everything it wants and nothing goes back to whoever wrote it. OPENSHELF puts a database of people into that gap.\n\nSearch is only the first step here. We check the shelves first, and only ask something new when the answer is not there.'
  },
  {
    q: 'Why not just ask a general AI?',
    a: 'A general AI is useful for the part that is genuinely general. When human coverage is empty, OPENSHELF can show a free AI baseline with stable background, decision criteria, and a clear list of what still needs firsthand evidence. It never presents that output as somebody’s experience.\n\nAI baselines have zero price, expire, cannot be resold, and never enter Shelf ranking, authority, or Memory. If enough human documents already exist, the server switches the baseline off instead of letting free AI undercut them.\n\nOPENSHELF pays for the scarce layer: what people actually did, when they did it, what changed, and where their experiences disagree. Gemini supplies liquidity and organizes purchased evidence; people create the asset.'
  },
  {
    q: 'How is this different from a survey panel?',
    a: 'It is priced case by case. Until now surveys traded only in bulk. You buy a 300-person panel whole and wait two weeks. You had to buy the pack to smoke one cigarette. OPENSHELF prices one question and one answer at a time.\n\nThe order is reversed too. Search comes first, not the survey. If an MD that fits the conditions is already on the shelves, no open call goes out and it simply gets opened. The survey only fires when the shelves come up empty.\n\nAn answer written once does not disappear. With a normal survey the project ends and the data goes into a warehouse; here it stacks up in memory and matches the next question automatically. The same answer sells more than once.'
  },
  {
    q: 'Why should I hand over my personal information?',
    a: 'We do not take bank or card details. What we take is life-level records. A day in Seongsu, what you had for lunch, which app you deleted and why. The thing you wanted to buy and did not. That kind of thing.\n\nIf you leave, your MD is burned. Not pulled off the shelf, deleted. Settlement records in the open history stay for accounting, but the text does not.\n\nAnd the money arrives on its own. When your MD fits the conditions it sells without you pressing an approve button, and the wallet fills up by however much it sold. When money comes in automatically, there is not much reason to sit it out.'
  },
  {
    q: 'What happens if the shelves are empty at launch?',
    a: 'The user does not get a blank page. Gemini provides a clearly labelled general baseline immediately, then shows the specific local, current, or experiential gaps it cannot honestly fill. The question can continue as an open call without pretending the AI result is human coverage.\n\nIf contributors arrive before buyers, Gemini acts as an interviewer instead. It creates optional Shelf starter prompts from the contributor’s broad fields, but no fake buyer or bounty. Only the person’s quality-checked answer becomes a priced document and starts with zero earnings until somebody opens it.\n\nThis does not eliminate cold start; it makes it survivable. The product still needs density in a narrow region or subject, but both sides can get useful work done while that density forms.'
  },
  {
    q: 'What if the answers are careless?',
    a: 'Blocking fake and low-effort answers up front is out of scope for the first version. We decided against ID-verified real names. An identity checkpoint would shrink the pool of people filling the shelves early on even further.\n\nWhat exists now is after-the-fact signal only. Open counts, how often the same author’s MDs get opened again, client reports. An MD with weak signal has a hard time reaching the top of the similarity ranking.\n\nOne thing to be clear about: effort is not writing skill. We do not ask for polished sentences. Polishing actually lowers the value. Three lines sell fine if the record is specific.'
  }
]

export const PRICING_FAQ: Faq[] = [
  {
    q: 'Who sets the rate per question?',
    a: 'The client does. When the answer is not on the shelves and an open call goes out, the librarian asks in order. “This has not been researched yet, should I ask?” → “How many people?” → “How much do you want to attach?”\n\nThe amount attached there is the rate for one answer. Some questions are ₩300, some are ₩5,000. That rate shows up as-is on the respondent dashboard, and respondents pick by looking at it.\n\nThe higher the rate, the faster a call fills. Amounts are displayed in KRW; the actual movement settles in USDC on Solana.'
  },
  {
    q: 'Can I post a call at ₩0?',
    a: 'You can. We do not block it. A ₩0 call is unlikely to fill, though, because respondents choose by rate.\n\nIt does not get thrown away either. It stays on the dashboard as a demand signal that somebody is asking this. When ₩0 calls on the same subject keep appearing, respondents read the demand and write the MD in advance.\n\nAn MD written in advance gets matched, and paid, the next time that question comes in. A ₩0 call is less an order than a heads-up sent to the shelves.'
  },
  {
    q: 'Does the amount change with the number of respondents?',
    a: 'It does. Rate × headcount is the maximum order total. Asking ten people a ₩300 question comes to ₩3,000.\n\nSet the headcount to whatever you need. Three people gives you a direction, thirty shows you a distribution. One Phantom approval funds all paid slots in Devnet USDC, and a call in progress shows its remaining slots live, like 4/7 left.\n\nIf the call stops early, accepted answers keep their exact shares and cancelling creates a refund claim for every unused atomic unit. Post for seven, get three answers, and the other four shares return to the original payer wallet.'
  },
  {
    q: 'If the answer already exists, does it charge without an open call?',
    a: 'Yes. In that case the order flips. When several MDs already fit the conditions, the librarian skips the open call and says it straight: “People matching your conditions are already here. This is the price. Do you want to pay?”\n\nThe price here is the open price, not the answer rate. Even if 40 candidates come back, the librarian opens only the top 5 by similarity. At ₩10 per open, that is ₩50.\n\nNot having to wait is the point of this path. The thicker the shelves get, the larger the share of questions that land on it.'
  },
  {
    q: 'What is x402?',
    a: 'A payment convention that actually uses HTTP 402 Payment Required. The status code sat reserved and empty for a long time; this puts money through it.\n\nIn the current browser demo, Phantom asks once for the exact selected set. One document pays its author directly; a multi-document purchase lands in payout escrow and records each contributor’s claim. A production agent can make the same x402 request autonomously only after you give it a policy-limited wallet or spending delegation. There is no card checkout.\n\nThe rail is USDC on Solana. Display is in KRW, and a ₩5–₩25 document open goes through the same way. Phantom may label Devnet USDC as Unknown, so the payment screen also shows the mint to verify.'
  },
  {
    q: 'When does settlement happen?',
    a: 'The buyer settlement happens when the selected documents open. A one-document purchase pays that author directly onchain. For a multi-document purchase, one transfer lands in the configured payout escrow and each author’s exact claim is recorded against the verified wallet shown in My Memory.\n\nA paid open call is funded once for its whole target before it is posted. Each accepted human answer or opted-in exact-memory match creates a deterministic Devnet USDC payout claim; cancellation returns the exact unused remainder to the payer. The crash-safe worker marks a claim paid only after confirmation. Zero-price calls alone use the labelled KRW_SANDBOX path.\n\nDevnet tokens and sandbox KRW are test value. Mainnet operation, real-value custody, and commercial withdrawals are intentionally not enabled in this build.'
  },
  {
    q: 'Am I charged for MDs that were never opened?',
    a: 'No. You pay for what was opened.\n\nThe librarian lines candidates up by similarity, but only opens a few representative ones. If 40 candidates come back and 5 get opened, only those 5 are billed. Lining them up costs nothing.\n\nIt works like web search. Looking at the result list is free; the charge happens when you click through. Before anything opens, we show you how many will be opened and what the total will be.'
  },
  {
    q: 'How does automatic matching work?',
    a: 'Every time you answer, a record stacks up in your memory stream. That record is the fishing line. When a question that fits the conditions comes in, the existing record matches and sells without you answering again.\n\nRecent records weigh more. Something written last month ranks above a neighborhood note from three years ago. Old records are not deleted, they just fade.\n\nSo the more answers you stack up, the more often you get picked automatically. That is why cumulative sales show up — 42 opens, say — even when you never picked a call off the dashboard.'
  },
  {
    q: 'If more people match than the call needs, is it first come, first served?',
    a: 'Not decided yet. It is an open question, so we will say so plainly.\n\nFor the first version we plan to go with whoever claims it first on the dashboard, among the people who meet the conditions. It is the simplest to build and the easiest to explain to respondents. The catch is that it hands every opportunity to whoever opens the dashboard most often.\n\nHow to mix similarity score, recent activity, and past open history is the part still unsolved. Whether it stays pure first come, first served or moves to a weighted draw depends on how large the early respondent pool turns out to be.'
  },
  {
    q: 'Can I get a refund?',
    a: 'It depends. An MD you have not opened is fully refundable. Cancel an open call before any answers land and the order amount comes straight back. If a call closes short of its headcount, the unfilled slots are returned automatically.\n\nAn MD you have already opened is not refundable. The moment it opens the money passes to the author, and x402 settles it on the spot. That is why we confirm how many will be opened, and the total, before anything opens.\n\nRefunds on the grounds that an answer was thin are not offered in the first version. There is no quality-judgment mechanism yet. Reports are accepted, and MDs from authors with reports stacked against them get pushed down in the ranking.'
  }
]
