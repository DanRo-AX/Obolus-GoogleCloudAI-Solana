/**
 * The SHELF page, as structure rather than a wall of HTML.
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
  eyebrow: 'The argument · SHELF',
  title: 'An agent that searches people instead of the web',
  standfirst:
    'Every crawler in production today reads for free. SHELF prices each firsthand document at ₩5 to ₩25; 90% of every qualified open settles to its owner and 10% funds the protocol.',
  meta: [
    { label: 'Published', value: 'July 31, 2026' },
    { label: 'By', value: 'The Obolus team' },
    { label: 'Reading', value: '8 min' },
    { label: 'Version', value: 'v0.1 · draft' },
  ],
}

export const DEFINITION = 'SHELF searches the shelves, opens only the evidence a question needs, and splits each ₩5 to ₩25 open 90% to its owner and 10% to the protocol.'

/** The 7 steps, rendered as a table. Step 4 is the branch the product turns on. */
export const LIFECYCLE = [
  { n: 1, step: 'Ask', what: 'A question goes into the chat box.', pivot: false },
  { n: 2, step: 'Search the shelves', what: 'People’s documents, not the web.', pivot: false },
  { n: 3, step: 'Rank the shelves', what: 'Relevance, trust, freshness, PageRank, author diversity. The closest few, never the whole shelf.', pivot: false },
  { n: 4, step: 'Hit or miss', what: 'A hit ends as search. A miss gets a free AI baseline, keeps the human gap open, and posts an open call.', pivot: true },
  { n: 5, step: 'Open call', what: 'A price per answer, posted to the open calls board.', pivot: false },
  { n: 6, step: 'x402 settlement', what: 'The asker pays only for documents opened. Each author’s USDC lands the same moment.', pivot: false },
  { n: 7, step: 'Accrue', what: 'The answer becomes a document on the author’s shelf and joins their memory. Next time it auto-matches.', pivot: false },
]

export type OpenProblem = {
  status: 'Critical' | 'Open' | 'Next'
  title: string
  body: string
}

export const OPEN_PROBLEMS: OpenProblem[] = [
  {
    status: 'Critical',
    title: 'How the shelves get filled at launch',
    body: 'An empty shelf has a liquidity bridge: questioners receive a free general AI baseline while the human gap stays open, and contributors can request interview prompts without those prompts becoming buyer demand or paid inventory. The remaining problem is distribution: how the first hundred people arrive and which narrow market reaches density first.',
  },
  {
    status: 'Open',
    title: 'Voice or typing for the first draft',
    body: 'Two hours of talking out loud gives the rough detail we want, and almost nobody will sit through it. Typing takes ten minutes and people tidy themselves as they go. What ships today is one written answer plus a few short interview turns. Voice and longer interviews are a later channel, and the consent and retention lines for them are not drawn yet.',
  },
  {
    status: 'Open',
    title: 'Who gets picked when too many match',
    body: 'If twelve documents fit a call that needs seven, something has to choose. The ranker already weighs relevance, trust, freshness, personalized PageRank, author diversity, and budget. What it does not do yet is hold up against someone gaming it: the weights are not calibrated against outcomes, the evidence is not identity-resistant, and Sybil and spam have to be measured continuously rather than once.',
  },
  {
    status: 'Next',
    title: 'Low-effort answers',
    body: 'In already: specificity checks, the short interviews, reports, three strikes, passage locks, and disputes. Not in: proof that a person is a person, and independent verification that an answer held up. A hard identity check would settle both and would also stop people connecting a wallet at all, so real names stay out of the product and the strikes and the rating loop carry it until then.',
  },
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
        text: 'We did not invent a retrieval architecture. We copied the internet: one person writes one memory-backed document about what they lived, and it behaves like a URL — an owner, public discovery metadata, a content hash, a version, a price, and a body that opens only once it is paid for. SHELF ranks the closest few and opens a handful, never the index.',
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
        label: 'Why not embed the whole shelf',
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
          label: 'SHELF',
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
        text: 'So SHELF does not rewrite documents. Not the grammar, not the phrasing. A line like “left at 11:40, ₩8,500, fifteen minutes standing” is awkward and is exactly the part that sells.',
      },
    ],
  },
  {
    n: '03',
    eyebrow: 'The branch',
    title: 'If the shelves come up empty, AI answers for now and SHELF posts an open call',
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
        caption: 'The miss path, as SHELF says it',
        lines: [
          '“Here is the general baseline. It is AI, it is free, and it is not evidence.”',
          '“Nothing on the shelves has lived this part yet. Ask people?”',
          '“How many people?”',
          '“What do you want to pay per answer?”',
          '→ call posted · answers return to this chat',
        ],
      },
      {
        kind: 'p',
        text: 'Twelve people at ₩500 each is a ₩6,000 call. It lands on the open calls board, people who fit pick it up, and the asker watches it fill. One side is searching; the other is answering a question they happen to know.',
      },
      {
        kind: 'note',
        label: 'The inverted case',
        text: 'Sometimes enough matching documents already exist. Then no call is posted — SHELF goes straight to “this can be answered now, here is the price.” Search the shelves first, post a call only when they come up empty.',
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
        text: 'Per-open pricing only works when a ₩5 payment needs no manual gas step. Phantom authorizes a bounded USDC deposit only when prepaid credit runs low; the x402 facilitator sponsors the network fee and a KMS-protected agent settles each selected DB through Pay.sh.',
      },
      {
        kind: 'p',
        text: 'HTTP already has the status code for this. A request arrives, the server answers 402 with a price, the payment is presented, and the document opens. Phantom signs the balance refills and nothing else; the server agent settles 402 machine to machine, with no user delegate in the middle.',
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
        text: 'Settlement runs on Solana Devnet in USDC and reads in ₩, because that is what people on the shelves think in. Phantom proves the wallet and tops up prepaid credit when it runs low; a non-exportable KMS service key pays each DB through Pay.sh. The asker sees one line — how many documents opened, what it came to. An open that fails goes back to prepaid credit instead of becoming an author’s earnings.',
      },
      {
        kind: 'quote',
        text: 'Sold by the cigarette, not by the pack.',
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
        text: 'That last point is the recruitment argument. Somebody who wrote it down once receives 90% of the ₩5 to ₩25 open price each time SHELF qualifies and opens it again.',
      },
    ],
  },
  {
    n: '06',
    eyebrow: 'Honest',
    title: 'What is not solved',
    blocks: [
      {
        kind: 'p',
        text: 'Four things are open. The first one is the one that decides whether any of the rest matters.',
      },
    ],
  },
]
