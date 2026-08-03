export type Faq = { q: string; a: string }

export const HOME_FAQ: Faq[] = [
  {
    q: 'What is OPENSHELF?',
    a: 'OPENSHELF is a market of human persona databases. A contributor’s accepted answers build a private memory stream; quality-checked firsthand passages become versioned documents that an agent can discover and purchase over x402.\n\nThe shape resembles the web. One document has an anonymous handle, public metadata, a content hash, a price, and a paid URL. SHELF-1 searches the index, opens only a small representative set, and pays every DB owner whose passage it actually uses.',
  },
  {
    q: 'How are the best databases found?',
    a: 'Filtering happens before payment. Rust applies category, demographic, price, consent, lock, and conduct rules, then scores local lexical/hash relevance, freshness, reliability, and trust. A query-specific personalized PageRank adds authority from independently verified evidence links.\n\nPaid, sponsored, inferred, self-owned, raw-user, dispute, and lineage links cannot buy positive authority. The final set also penalizes duplicate authors and redundant passages, so an agent does not pay twenty copies of the same viewpoint.',
  },
  {
    q: 'Why not just ask a general AI?',
    a: 'A general AI is useful for stable background and for identifying what should be asked next. When human coverage is thin, OPENSHELF can return a free, expiring Gemini baseline with the missing local or firsthand questions made explicit.\n\nThat baseline never becomes a human document, Memory entry, authority edge, paid citation, or source of contributor earnings. Gemini may organize passages after purchase, but only server-proven paid snapshots are allowed into the cited synthesis.',
  },
  {
    q: 'How does a persona database grow?',
    a: 'An answer is collected through one main question plus short interview prompts. The accepted answer becomes an observation memory and a searchable document; the extra interview turns remain private context and are not sold as separate passages.\n\nMemory stores importance, reliability, source IDs, hashes, versions, access history, and lock state. New corrections append a version instead of silently rewriting history, and repeated observations can create non-sellable reflections linked to their sources.',
  },
  {
    q: 'What can a buyer see about a person?',
    a: 'Before payment, discovery exposes only an anonymous handle, category, optional demographic bands, price, version/hash metadata, and ranking components. It does not expose the private passage or interview transcript.\n\nAfter payment, the buyer receives only the exact committed passage and its citation. Contributors can lock a passage to remove it from retrieval, export their memory and access history, or delete the account. Account deletion removes profile, documents, and memory, revokes sessions, returns unused balances, and anonymizes retained accounting rows.',
  },
  {
    q: 'What stops careless or copied answers?',
    a: 'The answer flow asks contextual follow-ups and runs specificity, relevance, copying, and generated-text checks before settlement. Flagged answers can be voided, the slot remains open, and the contributor can use the dispute process.\n\nPaid buyers can also mark a passage useful or report it. Upheld reports reduce reliability; repeated reports lock a document out of search. Two strikes pause auto-match and hold new payouts, and three suspend the account. These controls reduce low-effort inventory, but they do not prove identity or guarantee that every statement is true.',
  },
  {
    q: 'What happens when no human coverage exists?',
    a: 'The user can still receive the free AI baseline, then turn the precise missing evidence into an open call. The asker chooses how many people to reach and the price per accepted answer.\n\nContributors receive matching calls, answer through the interview flow, and the accepted passage joins their memory. The next similar question can purchase that same human evidence without commissioning it again.',
  },
]

export const PRICING_FAQ: Faq[] = [
  {
    q: 'What is free?',
    a: 'Search, filtering, ranking, candidate handles, prices, score components, and recovery checks are free. A Gemini general baseline is also free when human coverage is thin. Private human passage text is never part of the free response.',
  },
  {
    q: 'How is an existing database priced?',
    a: 'Each document has its own KRW price. Before spending, Rust commits the exact document, immutable content hash, version, consent version, verified recipient, Devnet USDC amount, mint, network, exchange rate, and expiry.\n\nThe question total is the sum of the independently rounded document charges. Only a DB whose matching Pay.sh payment callback succeeds can release its passage.',
  },
  {
    q: 'How does automatic web payment work?',
    a: 'The user signs one fresh Phantom ownership message and receives a revocable 30-day OPENSHELF session. That session has no Solana key or token allowance; it can reserve only the user’s deposited prepaid balance.\n\nWhen the balance is low, Phantom signs a bounded Devnet USDC refill. Later questions reserve credit automatically. A Cloud Run worker uses Pay.sh/MPP and a non-exportable GCP KMS service signer to pay every selected DB owner independently.',
  },
  {
    q: 'Who holds the private keys?',
    a: 'The user key remains inside Phantom. OPENSHELF never receives the seed phrase, private key, SPL delegate, or token-account authority.\n\nThe separate service key is held by Google Cloud KMS and cannot be exported; Cloud Run receives only IAM permission to request signatures. A DB owner publishes a verified receiving address but never gives OPENSHELF a signing key.',
  },
  {
    q: 'What if payment fails halfway through?',
    a: 'The job and exact budget are durable. Before retrying, the worker reloads the ledger and skips any quote already delivered, so a lost HTTP response does not pay twice.\n\nIf a permanent failure leaves some DBs unopened, only their atomic amounts return to prepaid credit. The user can retry the same job or withdraw the remaining prepaid balance to the verified wallet.',
  },
  {
    q: 'How are open calls funded?',
    a: 'The asker chooses a rate per accepted answer and a target count. A paid call uses one exact Phantom approval to fund the whole target in Devnet USDC escrow. Each accepted human answer or eligible memory match creates a deterministic payout claim.\n\nCancellation returns every unused atomic unit to the original payer. A zero-price call has no token transfer and therefore uses the off-chain application ledger only.',
  },
  {
    q: 'Does ranking itself cause charges?',
    a: 'No. Candidates can be filtered and ranked without opening their passages. If forty databases match and five are selected, only the successfully opened five are paid. Author diversity and redundancy penalties also limit unnecessary purchases.',
  },
  {
    q: 'Is this production money?',
    a: 'No. The current build is restricted to Solana Devnet and test USDC. Mainnet, fiat checkout, subscriptions, and commercial custody are not enabled. The on-chain and internal ledgers are implemented for end-to-end architecture validation, but Devnet assets have no production value.',
  },
]
