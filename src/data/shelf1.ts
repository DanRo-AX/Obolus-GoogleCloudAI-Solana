/**
 * The Obolus argument page, as structure rather than a wall of HTML.
 *
 * Sections are numbered 00–06 and carry a mono eyebrow, which is the same
 * document language the project's own briefs use. Keeping it as data means the
 * page can render a section rail, a progress state, and per-block treatments
 * without parsing anything.
 */

export type Block =
  | { kind: 'p'; text: string }
  | { kind: 'lead'; text: string }
  | { kind: 'quote'; text: string; attribution?: string }
  | { kind: 'list'; items: string[]; ordered?: boolean }
  | { kind: 'note'; label: string; text: string }
  | { kind: 'code'; caption: string; lines: string[] }
  | { kind: 'compare'; left: Side; right: Side }

export type Side = { label: string; title: string; lines: string[] }

export type Section = {
  n: string
  eyebrow: string
  title: string
  blocks: Block[]
}

export const HERO = {
  eyebrow: 'The argument · Obolus',
  title: 'An agent that searches people instead of the web',
  standfirst:
    'Every crawler in production today reads for free. Obolus gives each firsthand document an exact USDC price; 90% of every qualified open settles to its owner and 10% funds the protocol.',
  meta: [
    { label: 'Published', value: 'July 31, 2026' },
    { label: 'By', value: 'The Obolus team' },
    { label: 'Reading', value: '8 min' },
    { label: 'Version', value: 'v0.1 · draft' },
  ],
}

export const DEFINITION = 'Obolus searches personal human databases, opens only the evidence a question needs, and splits each USDC open 90% to its owner and 10% to the protocol.'

/** The 7 steps, rendered as a table. Step 4 is the branch the product turns on. */
export const LIFECYCLE = [
  { n: 1, step: 'Ask', what: 'A question goes into the chat box.', pivot: false },
  { n: 2, step: 'Search human databases', what: 'People’s documents, not the web.', pivot: false },
  { n: 3, step: 'Rank the databases', what: 'Relevance, trust, freshness, PageRank, and author diversity. The closest few, never the whole database.', pivot: false },
  { n: 4, step: 'Hit or miss', what: 'A hit opens paid evidence. A miss returns a free general answer first and explains what human evidence is still missing.', pivot: true },
  { n: 5, step: 'Open call', what: 'Only when firsthand experience is needed, the user can choose the audience, response count and reward.', pivot: false },
  { n: 6, step: 'x402 settlement', what: 'The asker pays only for documents opened. Each author’s USDC lands the same moment.', pivot: false },
  { n: 7, step: 'Accrue', what: 'The answer becomes a document in the author’s personal database. Next time it can match automatically.', pivot: false },
]

export const SECTIONS: Section[] = [
  {
    n: '00',
    eyebrow: 'The gap',
    title: 'Agents read for free, so nobody wrote down the part worth reading',
    blocks: [
      {
        kind: 'lead',
        text: 'Ask any model a question today and it searches the web, cites a few pages, and moves on. Nobody on the other end of those pages is paid, and nobody expected to be.',
      },
      {
        kind: 'p',
        text: 'That works while the answer is already public. It stops working the moment the answer is worth something. Where you ate lunch in Seongsu on a Tuesday, what it cost, how long the queue ran — nobody publishes that for nothing.',
      },
      {
        kind: 'quote',
        text: 'The web an agent can reach is the part nobody minded giving away.',
      },
      {
        kind: 'p',
        text: 'So that half never lands anywhere a crawler can see it. It stays in people. Obolus puts a price on the door instead of asking anyone to be generous.',
      },
    ],
  },
  {
    n: '01',
    eyebrow: 'The shape',
    title: 'One document is one URL',
    blocks: [
      {
        kind: 'p',
        text: 'We adapted the useful shape of the internet: one person writes one memory-backed document about what they lived, and it behaves like a protected URL — an owner, public discovery metadata, a content hash, a version, an exact USDC price, and a body that opens only after settlement. Obolus ranks the closest independent records and opens a handful, never the full index.',
      },
      {
        kind: 'p',
        text: 'One thing is different. Opening the URL creates a document-level settlement: 90% to its owner and 10% to the protocol.',
      },
      {
        kind: 'list',
        ordered: true,
        items: [
          'Cost. Opening a document is a spend. Open a hundred and you pay a hundred times.',
          'Answer quality. Five representative documents beat the average of everything. Blend it all and you are back to a generic answer.',
        ],
      },
      {
        kind: 'note',
        label: '',
        text: 'Google indexes everything and still fetches only what it shows you. Same reasoning here. The Rust ranker weighs lexical and deterministic hash relevance, freshness, trust, and a query-specific personalized PageRank over independently verified evidence links, then drops duplicate authors and repeated passages — all before anything is paid for. Only the selected documents open, each with a transparent 90/10 owner and protocol split.',
      },
    ],
  },
  {
    n: '02',
    eyebrow: 'The failure mode',
    title: 'Cleaning up a document destroys what it was worth',
    blocks: [
      {
        kind: 'p',
        text: 'A language model is good at the average: stable background, common criteria, and the questions worth asking next. That makes it useful as free liquidity, but not as a person or a sellable source.',
      },
      {
        kind: 'p',
        text: 'The same thing happens to a document when you tidy it. Smooth the sentences, cut the repetition, and the one thing only that person knew gets pulled toward the mean. The cleaner it gets, the closer it lands to what a general model would have said unprompted.',
      },
      {
        kind: 'compare',
        left: {
          label: 'General model',
          title: 'Paris is a city where…',
          lines: [
            'Locals tend to eat later than tourists.',
            'Neighbourhood bistros are usually a good bet.',
            'Reservations are generally recommended.',
          ],
        },
        right: {
          label: 'Obolus',
          title: 'Seven people who live there',
          lines: [
            'PARIS_11 · 6 years — “Go at 19:30 and you walk in. 20:30 and you wait 40 minutes.”',
            'PARIS_18 · 3 years — “The place on my street stopped taking walk-ins in March.”',
            'PARIS_05 · 4 years — “Marché Monge, Wednesday, before 11.”',
          ],
        },
      },
      {
        kind: 'p',
        text: 'Obolus does not rewrite firsthand documents. Not the grammar, not the phrasing. A concrete line such as “left at 11:40 and waited fifteen minutes standing” is awkward and is exactly the detail a generic summary loses.',
      },
    ],
  },
  {
    n: '03',
    eyebrow: 'The branch',
    title: 'If human coverage comes up empty, Obolus answers what it can and lets you choose whether to ask people',
    blocks: [
      {
        kind: 'p',
        text: 'After the search there is one branch, and the whole product sits on it. Hit or miss.',
      },
      {
        kind: 'p',
        text: 'A hit behaves like search: open the closest human documents, quote them, settle, done. A miss returns a free general AI baseline, marks what still requires firsthand evidence, and offers to go and get it.',
      },
      {
        kind: 'code',
        caption: 'The missing-coverage path',
        lines: [
          '“Here is the general baseline. It is AI, it is free, and it is not evidence.”',
          '“No matching human evidence was found. Nothing has been purchased or posted.”',
          '“If firsthand experience is essential, choose Ask people.”',
          '› user chooses audience · answer count · reward',
          '→ call posted only after confirmation · answers return here',
        ],
      },
      {
        kind: 'p',
        text: 'Twelve people at 0.50 USDC each is a 6.00 USDC call. It lands on the open-calls board, qualified people can answer it, and the asker watches independent coverage fill.',
      },
      {
        kind: 'note',
        label: '',
        text: 'Sometimes enough matching documents already exist. Then no call is posted — Obolus shows the evidence set and exact USDC quote. Search personal databases first. Offer an open call only when coverage is missing, firsthand experience is essential, and the user chooses to proceed.',
      },
    ],
  },
  {
    n: '04',
    eyebrow: 'The rail',
    title: 'x402, because agents need policy-limited payments',
    blocks: [
      {
        kind: 'p',
        text: 'Per-open pricing works only when a small USDC payment needs no manual gas step. The user explicitly tops up a bounded prepaid balance from My Database; the x402 facilitator sponsors the network fee and a KMS-protected agent settles each selected database through Pay.sh.',
      },
      {
        kind: 'p',
        text: 'HTTP already has the status code for this. A request arrives, the server answers 402 with a price, the payment is presented, and the document opens. Phantom appears only for an explicit top-up or withdrawal; the server agent settles ordinary 402 opens from prepaid USDC, with no user delegate in the middle.',
      },
      {
        kind: 'code',
        caption: 'The hosted request boundary',
        lines: [
          'SEARCH  → handles, prices, score components · passages closed',
          'COMMIT  → query + document hashes + owners + atomic prices',
          'RESERVE → verified prepaid balance · one SQLite transaction',
          'PAY     → Cloud Run + Pay.sh/MPP + GCP KMS · one DB at a time',
          'DELIVER → paid snapshots only · cited synthesis · replay safe',
        ],
      },
      {
        kind: 'p',
        text: 'Settlement runs on Solana Devnet in USDC. Phantom proves the wallet and signs only a top-up the user explicitly starts; a non-exportable KMS service key pays each selected database through Pay.sh from the existing prepaid balance. The asker sees how many documents opened and the exact USDC total. A failed open returns to prepaid credit instead of becoming author earnings.',
      },
      {
        kind: 'p',
        text: 'This has only ever traded whole: a panel study, an annual licence, three hundred people flattened into one report. The unit here is one document, one open, one answer.',
      },
    ],
  },
  {
    n: '05',
    eyebrow: 'The deal',
    title: 'What a person actually hands over',
    blocks: [
      {
        kind: 'p',
        text: 'No bank details, card number, seed phrase, private key, or national ID. Obolus does store account data, demographic bands, a public payout address, wallet proofs, and life-level records such as where the day goes, what lunch costs, and which errand changes a route.',
      },
      {
        kind: 'list',
        items: [
          'Free discovery shows an anonymous handle and payment-safe metadata. A paid open releases the committed passage and its citation — nothing else.',
          'The short interview turns fill in private context. They are not indexed and never sold as separate passages.',
          'Individual passages can be locked so they are never quoted.',
          'Delete the account and the profile, the documents, and the memory go with it. Sessions are revoked, unused balance comes back, and the accounting rows that have to be kept are anonymized.',
          'Auto-match can pick an eligible passage without a new call. The 90% evidence-owner share settles without a new answer — but only when that committed passage is actually opened.',
        ],
      },
      {
        kind: 'p',
        text: 'That is the contributor incentive. Somebody who recorded an experience once receives 90% of its displayed USDC price each time Obolus qualifies and opens it again.',
      },
    ],
  },
]
