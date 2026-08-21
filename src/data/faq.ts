export type Faq = { q: string; a: string }

/** Product copy follows the deployed USDC ledger and the final pitch deck. */
export const HOME_FAQ: Faq[] = [
  {
    q: 'What is Obolus?',
    a: 'Obolus searches firsthand human databases instead of averaging the web. It ranks a small, independent set of relevant records and shows an exact USDC quote before opening any private passage. Each qualified open settles 90% to the evidence owner and 10% to the protocol.',
  },
  {
    q: 'Why not ask a general model?',
    a: 'A general model predicts a plausible answer. Obolus retrieves what particular people actually experienced, with version, consent, source pointers, and a payment receipt. Gemini may provide a free public-model orientation when coverage is thin, but it never counts as human evidence or enters human ranking.',
  },
  {
    q: 'How are documents ranked?',
    a: 'Eligibility comes first: consent, lock state, audience filters, price, and budget. Obolus then combines relevance, coverage, trust, freshness, and query-personalized graph authority. Repeated authors and near-duplicate passages are removed, so paying more or answering more questions does not buy authority.',
  },
  {
    q: 'What happens when no human record answers the question?',
    a: 'Obolus offers a targeted open call instead of fabricating evidence. The asker chooses how many independent answers are needed and a positive USDC reward per accepted answer. The complete target is reserved from prepaid USDC before the call opens.',
  },
  {
    q: 'What happens to an accepted answer?',
    a: 'It becomes a versioned document in the contributor’s personal database. Its content hash, consent version, source pointers, access history, and correction lineage remain attached. When a later question qualifies and opens it, the contributor can earn again without rewriting the answer.',
  },
  {
    q: 'What can an asker see before paying?',
    a: 'Only payment-safe discovery metadata: anonymous handle, category, optional demographic bands, price, version and hash, plus ranking components. The committed passage opens only after its matching Pay.sh settlement is verified.',
  },
  {
    q: 'Do I need SOL or a Phantom approval for every document?',
    a: 'No. Phantom proves ownership and signs only a top-up or withdrawal that you explicitly start from My Database. Ordinary document opens spend the existing prepaid balance, while the x402 facilitator sponsors the network fee and a KMS-protected Pay.sh worker settles selected documents. Obolus never receives a seed phrase, private key, or wallet-wide token allowance.',
  },
  {
    q: 'How is an open call funded?',
    a: 'The target count × reward per answer is reserved up front from prepaid Devnet USDC. Each accepted answer creates an auditable payout claim. Cancelling returns every unused atomic unit to the verified payer wallet. Zero-price and private application-ledger calls are not supported.',
  },
  {
    q: 'What appears on the receipt?',
    a: 'The receipt binds the question job, exact document, content and consent versions, verified recipient, USDC amount, mint, network, policy split, expiry, and transaction signatures. Explorer links prove token movement; private question and passage text are never intentionally written to the public chain.',
  },
  {
    q: 'What if settlement fails halfway through?',
    a: 'The worker reloads the durable job, skips documents already delivered, and never pays one document twice. A permanently unopened amount returns to prepaid USDC. The buyer can retry the same job or withdraw the remaining service balance.',
  },
  {
    q: 'Who holds the keys?',
    a: 'The user key stays in Phantom. The separate service signer is non-exportable in Google Cloud KMS; Cloud Run receives only narrow IAM permission to request a signature. Contributors publish verified receiving addresses, never signing keys.',
  },
  {
    q: 'Is this real money?',
    a: 'The current build executes real on-chain transactions on Solana Devnet using test USDC. Recipients, amounts, finality, and signatures are verifiable in Explorer, but Devnet assets have no market value. Mainnet custody and commercial settlement are not enabled.',
  },
]
