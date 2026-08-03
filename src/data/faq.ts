export type Faq = { q: string; a: string }

export const HOME_FAQ: Faq[] = [
  {
    q: 'What is Obolus?',
    a: 'People write short documents about things they have lived through. SHELF-1 searches those documents instead of the web, opens a handful, and quotes them. Every open pays its author, over x402.\n\nThe shape is a library. One document is one book, the shelves are the stacks, and SHELF-1 is the librarian. A question comes in, it pulls the few books that fit, and hands back the passages that matter.\n\nWe copied the shape of the internet almost exactly. One document is one URL, the closest matches rise to the top, and SHELF-1 opens a handful of them. One thing is different: opening that URL pays the author.'
  },
  {
    q: 'Is this a search engine?',
    a: 'No. What makes it onto the web is the tip of the iceberg. Where someone who has lived in Seongsu for three years goes for lunch was never posted anywhere.\n\nThe web an agent reads has no way to charge either. A crawler reads everything it wants and nothing goes back to whoever wrote it. Obolus puts what people wrote into that gap, with a price on it.\n\nSearch is the first step, not the whole thing. SHELF-1 checks the shelves first, and posts an open call only when the answer is not there.'
  },
  {
    q: 'How does SHELF-1 decide which documents to open?',
    a: 'Filtering runs before any money moves. Category, demographic band, price, consent, lock state and conduct rules cut the field first. What survives is scored on word and hash match, how recent the document is, how reliable the author has been, and how much independently verified evidence links to it.\n\nStanding cannot be bought. Paid, sponsored, inferred, self-owned, disputed and lineage links add nothing to a document’s authority.\n\nThe last pass penalises the same author twice over and near-identical passages, so an asker does not pay twenty times for one viewpoint.'
  },
  {
    q: 'Why not ask a general model?',
    a: 'A general model fills the blank with conditional probability. Ask it “what do people in Paris like?” and it assembles the most plausible sentence out of what it read about the city. Cafes, bakeries, the Seine — not wrong, and nothing you could not have guessed.\n\nSHELF-1 opens only the documents of people who live in Paris, and pays each of them for the open. If nothing on the shelves has lived it, SHELF-1 posts an open call to people in Paris.\n\nWhen the shelves are thin, SHELF-1 can hand back a free general-model baseline that spells out which questions only a person can answer. It expires, it is never sold, it earns nobody anything, and it does not count as human coverage.\n\nThat is why documents are left rough on purpose. The more the sentences get polished, the closer they drift back to what a general model would have said. Rough and specific is what sells.'
  },
  {
    q: 'How is this different from a survey panel?',
    a: 'A panel trades whole: 300 people, two weeks, one report. Here the unit is one question, one answer, one open. Sold by the cigarette, not by the pack.\n\nThe order is reversed too. Search comes first — if documents already on the shelves fit, SHELF-1 opens them and no open call goes out. The call fires only when the shelves come up empty.\n\nAn answer written once does not disappear. A panel study ends and the report goes in a drawer; a document stays on your shelf and matches the next question. The same answer earns more than once.'
  },
  {
    q: 'How does a shelf grow?',
    a: 'One main question, then a few short follow-up prompts. The answer you accept becomes a document on your shelf and goes into search; the follow-up turns stay private context and are never sold as separate passages.\n\nEach document carries its own version, content hash, reliability, source ids, open history and lock state. A correction appends a new version instead of quietly rewriting what was there.\n\nWrite the same thing more than once and it can fold into a private note linked back to both documents. Notes like that are not for sale.'
  },
  {
    q: 'Why should I hand over my personal information?',
    a: 'We never ask for bank or card details. What you write down is life-level: a day in Seongsu, what lunch cost, which app you deleted and why. The thing you wanted to buy and did not.\n\nLeave, and your documents burn. Not pulled off the shelf — deleted. The settlement lines stay for accounting; the writing does not.\n\nThe money arrives on its own. When a document fits, SHELF-1 opens it without you pressing approve, and USDC lands in your wallet on the spot.'
  },
  {
    q: 'What can an asker see about me?',
    a: 'Before payment: an anonymous handle, the category, optional demographic bands, the price, the version and content hash, and the ranking numbers. Not the passage, not the follow-up turns.\n\nAfter payment: the exact passage that was committed, and its citation. Nothing else opens with it.\n\nYou can lock a document to pull it out of search, export your documents and your open history, or delete the account outright. Deleting removes the profile, the documents and the memory, revokes sessions, returns any unused balance, and anonymises the settlement rows that have to stay for accounting.'
  },
  {
    q: 'What happens if the shelves are empty at launch?',
    a: 'This is the hardest problem we have. We have not solved it, and we are not going to talk around it here. An empty shelf leaves the librarian nothing to do.\n\nEarly on, most questions will land on “nobody has lived this yet.” That means posting an open call and waiting, so Obolus at the start is not an instant answer. It is closer to asking a question and waiting hours or days.\n\nThe plan is narrow before wide. Fill one region or one subject until search works inside it, then widen sideways. Which subject to start with, and how to find the first authors, is still undecided.'
  },
  {
    q: 'What if the answers are careless?',
    a: 'Three things cost a strike: made-up facts, low-effort answers, copied text. Strike 3 of 3 suspends the wallet. Every strike names which of the three it was, and you can dispute it once from your shelf.\n\nA struck answer is voided and its price goes back to the asker. We do not check IDs — an identity checkpoint would thin the shelves further at the start. What stands in for it is the open history: how often an author’s documents get opened again, and what askers report. An upheld report drops a document’s reliability, and enough of them pull it out of search; strike 2 of 3 also pauses automatic matching and holds payouts.\n\nEffort is not writing skill. We never ask for polished sentences, and polishing lowers what a document is worth. Three lines sell fine if they are specific.'
  }
]

export const PRICING_FAQ: Faq[] = [
  {
    q: 'Who sets the price per answer?',
    a: 'The asker does. When nothing on the shelves answers, SHELF-1 asks in order. “Nobody has lived this yet — post an open call?” → “How many answers?” → “What is one answer worth?”\n\nThe amount named there is the price for one answer. Some calls are ₩300, some are ₩5,000. It shows up as-is on the board, and people pick by looking at it.\n\nThe higher the price, the faster a call fills. You read ₩; the transfer settles in USDC on Solana.'
  },
  {
    q: 'Can I post a call at ₩0?',
    a: 'You can. We do not block it. A ₩0 call is unlikely to fill, because people pick by price.\n\nIt is not thrown away either. It stays on the board as a standing question somebody wants answered. When ₩0 calls on the same subject keep appearing, authors read that and write the document in advance.\n\nA document written in advance gets matched, and paid, the next time that question comes in. A ₩0 call buys nothing today; it tells the shelves what to write next.'
  },
  {
    q: 'Does the total change with the number of answers?',
    a: 'It does. Price per answer × answers wanted is what the call costs. Ten answers to a ₩300 question comes to ₩3,000.\n\nAsk for as many as you need. Three answers give you a direction, thirty show you a spread. A call in progress shows its slots live, like 4/7 left.\n\nSlots that never fill are not billed. Post for seven, get three answers, and you pay for three.'
  },
  {
    q: 'If the answer already exists, does it charge without an open call?',
    a: 'Yes, and the order flips. When documents already on the shelves fit, SHELF-1 skips the open call and says it straight: “People who have lived this are already here. This is the price. Do you want to pay?”\n\nThe price here is the open price, not the price per answer. Even if 40 documents match, SHELF-1 opens only the top 5 by similarity. At ₩10 an open, that is ₩50.\n\nNothing to wait for is the point of this path. The thicker the shelves get, the larger the share of questions that land on it.'
  },
  {
    q: 'What does a quote lock in?',
    a: 'Every document carries its own ₩ price. Before anything is spent, the quote pins the exact document, its content hash, its version and consent version, the verified recipient, the Devnet USDC amount, the mint, the network, the exchange rate and an expiry.\n\nThe total for one question is the sum of those document charges, each rounded on its own. A document releases its passage only after its own Pay.sh payment callback comes back good.'
  },
  {
    q: 'What is x402?',
    a: 'A payment convention that uses HTTP 402 Payment Required. The status code sat reserved and empty for years; this puts money through it.\n\nIn the browser demo, Phantom asks once for the exact set you selected. One document pays its author directly. A set of documents sends one transfer to payout escrow, which records what each author is owed.\n\nAn agent can make the same x402 request on its own only after you hand it a policy-limited wallet or a spending delegation. There is no card checkout.\n\nThe rail is USDC on Solana, and you read ₩. A ₩5–₩25 open goes through the same way. Phantom may label Devnet USDC as Unknown, so the payment screen shows the mint to check it against.'
  },
  {
    q: 'How is an open call funded?',
    a: 'One Phantom approval funds the whole target up front, in Devnet USDC, into escrow. Each accepted answer — and each eligible match already sitting on the shelves — becomes a deterministic payout claim against it.\n\nCancel, and every unused unit goes back to the wallet that paid.\n\nA ₩0 call moves no tokens at all. It lives on the off-chain ledger only.'
  },
  {
    q: 'Do I sign for every open?',
    a: 'No. You sign one fresh Phantom ownership message and get a revocable 30-day Obolus session. That session holds no Solana key and no token allowance — the only thing it can reserve is the prepaid balance you deposited.\n\nWhen the balance runs low, Phantom signs a bounded Devnet USDC refill. Questions after that reserve credit on their own.\n\nThe payouts run from a Cloud Run worker over Pay.sh/MPP, signed by a non-exportable GCP KMS service key, and every author on the list is paid independently.'
  },
  {
    q: 'Who holds the keys?',
    a: 'Your key stays inside Phantom. Obolus never receives a seed phrase, a private key, an SPL delegate or token-account authority.\n\nThe service key is held by Google Cloud KMS and cannot be exported; Cloud Run only gets IAM permission to ask it for a signature.\n\nAn author publishes a verified receiving address and never hands Obolus a signing key.'
  },
  {
    q: 'When does settlement happen?',
    a: 'The asker settles the moment the selected documents open. One document pays that author directly onchain. A set of documents sends one transfer to payout escrow, which records each author’s claim against the wallet shown on their shelf.\n\nThe current build does not pretend that claim is already a payout sitting in the author’s wallet. For answers to an open call, the price moves through the ledger labelled KRW_SANDBOX once the asker accepts the answer. A call that closes short still pays everyone who answered, and the unfilled slots go back to the asker.\n\nDevnet USDC and sandbox ₩ are test value. Production withdrawals need a secured payout executor, a custody and compliance policy, and mainnet reconciliation — none of that is switched on in this build.'
  },
  {
    q: 'What if a payment fails partway through?',
    a: 'The job and its exact budget are durable. Before a retry, the worker reloads the ledger and skips any passage already delivered, so a lost response does not pay twice.\n\nIf something fails for good and some documents never opened, only their atomic amounts return to prepaid credit.\n\nYou can retry the same job, or withdraw what is left of the prepaid balance to the verified wallet.'
  },
  {
    q: 'Am I charged for documents nobody opened?',
    a: 'No. You pay for what was opened.\n\nSHELF-1 lines candidates up by similarity and opens only a few of them. If 40 match and 5 get opened, you are billed for 5. Lining them up costs nothing.\n\nIt works like web search: the list is free, the click is not. Search, filtering, ranking, handles, prices, score components and the general-model baseline are all free; passage text is the one thing behind the price. Before anything opens, we show you how many will open and what the total will be.'
  },
  {
    q: 'How does automatic matching work?',
    a: 'Every answer you write lands on your shelf as a document. That document is the fishing line. When a question fits it, SHELF-1 opens it and pays you without you answering again.\n\nRecent documents weigh more. Something written last month ranks above a neighborhood note from three years ago. Old ones are not deleted, they fade.\n\nSo the thicker your shelf, the more often SHELF-1 picks it up on its own. That is why the open count climbs — 42 opens, say — in a week you never touched the board.'
  },
  {
    q: 'If more people match than the call needs, is it first come, first served?',
    a: 'Not decided yet. It is an open question, so we will say so plainly.\n\nFor the first version, whoever claims it first on the board gets it, among the people who meet the conditions. It is the simplest to build and the easiest to explain. The catch is that it hands every call to whoever checks the board most often.\n\nHow to mix similarity score, recent writing, and past opens is the part still unsolved. Whether it stays pure first come, first served or moves to a weighted draw depends on how many people are writing early on.'
  },
  {
    q: 'Can I get a refund?',
    a: 'A document you have not opened is fully refundable. Cancel an open call before any answers land and the whole amount comes straight back. If a call closes short, the unfilled slots come back automatically.\n\nA document you have already opened is not refundable. The moment it opens, the money is in the author’s wallet — x402 settles on the spot. That is why we show how many will open, and the total, before anything opens.\n\nWe do not refund on the grounds that an answer was thin; there is no quality judgment in the first version. Report it instead: made-up facts, low-effort answers and copied text each cost the author a strike, and strike 3 of 3 suspends the wallet.'
  },
  {
    q: 'Is this real money?',
    a: 'Not yet. The build runs on Solana Devnet with test USDC, and ₩ figures settle through a sandbox ledger. Mainnet, card checkout, subscriptions and commercial custody are switched off.\n\nThe onchain path and the internal ledger are both wired end to end so the architecture can be checked against real transfers. Devnet assets are worth nothing.'
  }
]
