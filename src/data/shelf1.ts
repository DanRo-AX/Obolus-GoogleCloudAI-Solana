/**
 * The SHELF-1 page, as structure rather than a wall of HTML.
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
  eyebrow: 'Whitepaper · SHELF-1',
  title: 'An agent that searches people instead of the web',
  standfirst:
    'Every crawler in production today reads for free. SHELF-1 pays. This is what changes when the document on the other end has an author who gets a cut.',
  meta: [
    { label: 'Published', value: 'July 31, 2026' },
    { label: 'By', value: 'The OPENSHELF team' },
    { label: 'Reading', value: '8 min' },
    { label: 'Version', value: 'v0.1 · draft' },
  ],
}

export const DEFINITION = 'Turn the internet into a database, and charge x402 for access.'

/** The 7 steps, rendered as a table. Step 4 is the branch the product turns on. */
export const LIFECYCLE = [
  { n: 1, step: 'Ask', what: 'A question goes into the chat box.', pivot: false },
  { n: 2, step: 'Search the shelves', what: 'People’s documents, not the web.', pivot: false },
  { n: 3, step: 'Rank by similarity', what: 'The closest few, never the whole shelf.', pivot: false },
  { n: 4, step: 'Human coverage', what: 'A hit sells evidence. A miss gets an AI baseline and keeps the human gap open.', pivot: true },
  { n: 5, step: 'Open call', what: 'Price per answer, posted to the dashboard.', pivot: false },
  { n: 6, step: 'x402 settlement', what: 'Only the documents actually opened are billed.', pivot: false },
  { n: 7, step: 'Accrue', what: 'The answer joins the author’s memory. Next time it auto-matches.', pivot: false },
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
    body: 'An empty shelf now has a liquidity bridge, not fake inventory. Questioners receive a free general AI baseline while the human gap stays open; contributors can ask Gemini on Vertex AI for interview prompts with no fake buyer or bounty. The remaining problem is distribution: how the first hundred people arrive and which narrow market reaches density first.',
  },
  {
    status: 'Open',
    title: 'Voice or chat for collection',
    body: 'Two hours of talking to an AI produces the unpolished detail we want and almost nobody will do it. Chat is easy and people self-edit. v1 collects through the open-call flow and leaves the question open.',
  },
  {
    status: 'Open',
    title: 'Who gets picked when too many match',
    body: 'If twelve documents fit a call that needs seven, something has to choose. First come, thickest memory, and best prior rating all have obvious failure modes. Undecided.',
  },
  {
    status: 'Next',
    title: 'Low-effort answers',
    body: 'Identity-verified accounts would fix it and would also stop people signing up. Out of scope for v1; the rating loop carries the weight until then.',
  },
]

export const SECTIONS: Section[] = [
  {
    n: '00',
    eyebrow: 'The gap',
    title: 'Agents read for free, so the good stuff never gets written down',
    blocks: [
      {
        kind: 'lead',
        text: 'Ask any model a question today and it searches the web, cites a few pages, and moves on. Nobody on the other end of those pages is paid, and nobody expected to be.',
      },
      {
        kind: 'p',
        text: 'That works while the answer is already public. It stops working the moment the answer is worth something. Writing a blog post is one thing. Writing down where you actually eat lunch in Seongsu on a Tuesday, what it cost, and how long the queue was is another — there is no reason to publish that for nothing.',
      },
      {
        kind: 'quote',
        text: 'The web an agent can reach is the part nobody minded giving away.',
      },
      {
        kind: 'p',
        text: 'So the useful half never lands anywhere a crawler can see it. It stays in people. OPENSHELF is the attempt to put a price on the door instead of asking anyone to be generous.',
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
        text: 'We did not invent a retrieval architecture. We copied the internet. Each person writes an MD — a plain document about what they have lived through — and that document behaves exactly like a URL. Similar ones rank higher. The agent opens a handful, not the index.',
      },
      {
        kind: 'p',
        text: 'One thing is different. Opening the URL pays its author.',
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
        text: 'Google indexes everything and still fetches only what it shows you. Same reasoning, plus a bill attached to each fetch.',
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
        text: 'The same thing happens to a document when you tidy it. Smooth the sentences, cut the repetition, summarise the point, and the specific thing only that person knew is pulled toward the mean. The cleaner it gets, the closer it lands to what a general model would have said unprompted.',
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
          label: 'SHELF-1',
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
        text: 'So SHELF-1 does not rewrite documents. Not the grammar, not the phrasing. A line like “left at 11:40, ₩8,500, fifteen minutes standing” is awkward and is exactly the part that sells.',
      },
    ],
  },
  {
    n: '03',
    eyebrow: 'The branch',
    title: 'If the shelves come up empty, AI bridges the wait and people fill the gap',
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
        caption: 'The miss path, as the agent says it',
        lines: [
          '“Here is the general baseline. It is AI, free, and not evidence.”',
          '“These current, local details still need people. Want me to ask?”',
          '“How many people?”',
          '“What do you want to pay per answer?”',
          '→ call posted · answers return to this chat',
        ],
      },
      {
        kind: 'p',
        text: 'Twelve people at ₩500 each is a ₩6,000 call. It lands on the answerer dashboard, people who fit pick it up, and the asker sees it fill. Nobody involved feels like they are running a survey. One side is searching; the other side is answering a question they happen to know.',
      },
      {
        kind: 'note',
        label: 'The inverted case',
        text: 'Sometimes enough matching documents already exist. Then no call is posted at all — the agent goes straight to “this can be answered now, here is the price.” Search first, survey only when search fails.',
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
        text: 'Per-open pricing only works at true micropayment scale. The Devnet browser demo bundles the exact selected documents into one explicit Phantom approval; unattended agents still need a policy-limited wallet.',
      },
      {
        kind: 'p',
        text: 'HTTP already has the status code for this. A request arrives, the server answers 402 with a price, payment is presented, and the body is released. The current browser demo signs through Phantom. A delegated agent wallet is the next step for machine-to-machine settlement.',
      },
      {
        kind: 'code',
        caption: 'What the demo shows',
        lines: [
          'POST /api/open      { docs, question }',
          '  ← 402 Payment Required',
          '     { scheme, network, payTo, maxAmountRequired, asset, nonce }',
          'POST /api/open      + X-PAYMENT',
          '  ← 200 { citations, settlement: { count, total, txSig } }',
        ],
      },
      {
        kind: 'p',
        text: 'Settlement runs on Solana in USDC and is shown in KRW, because that is the currency the people on the shelves think in. The asker sees one line — how many documents opened and what it came to. The author sees a balance go up.',
      },
      {
        kind: 'quote',
        text: 'Sold by the cigarette, not by the pack.',
      },
      {
        kind: 'p',
        text: 'Data like this has only ever traded whole: a panel study, an annual licence, a report with three hundred people flattened into it. The unit here is one document, one open, one answer.',
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
        text: 'Nothing financial. No bank details, no card, no national ID. The first documents are living-level: where the day goes, what lunch costs, which errand is annoying enough to change your route.',
      },
      {
        kind: 'list',
        items: [
          'Quotes reach a buyer as an anonymous handle and the passage they paid for — nothing else.',
          'Individual passages can be locked so they are never quoted.',
          'Deleting the account destroys the documents and the memory stream. Search drops them immediately.',
          'Money arrives without asking. Once the memory is thick enough, auto-match quotes it without a call.',
        ],
      },
      {
        kind: 'p',
        text: 'That last point is the whole recruitment argument. Somebody who has already written things down does not have to do anything to keep earning from them.',
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
