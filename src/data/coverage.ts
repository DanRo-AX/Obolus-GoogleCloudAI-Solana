/**
 * What the shelves can currently answer, and where they cannot.
 *
 * This is deliberately not a catalogue. Browsing documents would give away the
 * thing being sold and would contradict the pitch — SHELF-1 decides what to
 * open, not you. What is useful to show instead is density: an asker learns
 * whether their question will land, and an answerer learns where their writing
 * is worth the most.
 *
 * The uncovered list is the product's biggest open problem made visible. Every
 * row is a question people actually asked that nothing on the shelves could
 * answer — which is exactly what an open call is for.
 */

export type Coverage = {
  category: string
  /** Documents on the shelves in this category. */
  docs: number
  /** Shelves the documents are spread across. */
  shelves: number
  /** Average price to open one, in KRW. */
  avgPrice: number
  /** Share of opens the asker marked useful. */
  useful: number
  /** Questions in this category in the last 30 days. */
  demand: number
  accent: string
}

/** Below this many documents a category cannot reliably answer. */
export const THIN_BELOW = 300

export const COVERAGE: Coverage[] = [
  {
    category: 'Neighborhood',
    docs: 1204,
    shelves: 3,
    avgPrice: 5,
    useful: 84,
    demand: 892,
    accent: '#866FF2',
  },
  {
    category: 'F&B',
    docs: 892,
    shelves: 3,
    avgPrice: 6,
    useful: 79,
    demand: 741,
    accent: '#ff7a45',
  },
  {
    category: 'Parenting & Education',
    docs: 634,
    shelves: 2,
    avgPrice: 10,
    useful: 81,
    demand: 588,
    accent: '#c07eff',
  },
  {
    category: 'Work & Tools',
    docs: 512,
    shelves: 2,
    avgPrice: 8,
    useful: 72,
    demand: 604,
    accent: '#54a2ff',
  },
  {
    category: 'Commerce',
    docs: 418,
    shelves: 2,
    avgPrice: 11,
    useful: 76,
    demand: 655,
    accent: '#fb64b6',
  },
  {
    category: 'Health',
    docs: 361,
    shelves: 2,
    avgPrice: 12,
    useful: 74,
    demand: 402,
    accent: '#00d2ef',
  },
  {
    category: 'Travel',
    docs: 348,
    shelves: 2,
    avgPrice: 9,
    useful: 83,
    demand: 511,
    accent: '#00d294',
  },
  {
    category: 'Hobbies & Content',
    docs: 297,
    shelves: 3,
    avgPrice: 7,
    useful: 69,
    demand: 226,
    accent: '#fac800',
  },
  {
    category: 'Hiring & Roles',
    docs: 187,
    shelves: 3,
    avgPrice: 16,
    useful: 77,
    demand: 713,
    accent: '#0F766E',
  },
  {
    category: 'Crypto & Investing',
    docs: 95,
    shelves: 2,
    avgPrice: 20,
    useful: 71,
    demand: 468,
    accent: '#ff6568',
  },
]

/** Questions people asked that nothing on the shelves could answer. */
export type Gap = {
  id: string
  question: string
  /** How many separate people asked something equivalent. */
  askedBy: number
  /** Closest category, for routing the call. */
  category: string
  /** What an answer would be worth given the demand and the scarcity. */
  suggestedPrice: number
  lastAsked: string
}

export const GAPS: Gap[] = [
  {
    id: 'g1',
    question:
      'What actually fills a rural clinic nurse’s shift, hour by hour, on a normal Tuesday?',
    askedBy: 6,
    category: 'Health',
    suggestedPrice: 1200,
    lastAsked: '14m ago',
  },
  {
    id: 'g2',
    question:
      'Two years into owning a second-hand EV — what has it actually cost beyond charging?',
    askedBy: 5,
    category: 'Commerce',
    suggestedPrice: 900,
    lastAsked: '1h ago',
  },
  {
    id: 'g3',
    question:
      'Moving a small team off Notion — what broke, and what did you end up keeping?',
    askedBy: 4,
    category: 'Work & Tools',
    suggestedPrice: 700,
    lastAsked: '3h ago',
  },
  {
    id: 'g4',
    question:
      'First year as a franchise owner: which numbers in the pitch turned out to be wrong?',
    askedBy: 4,
    category: 'Commerce',
    suggestedPrice: 1500,
    lastAsked: '5h ago',
  },
  {
    id: 'g5',
    question:
      'Running a wallet for a small DAO treasury — what do you actually do each week?',
    askedBy: 3,
    category: 'Crypto & Investing',
    suggestedPrice: 1400,
    lastAsked: '9h ago',
  },
  {
    id: 'g6',
    question:
      'Caring for a parent with dementia at home — what changed about your week first?',
    askedBy: 3,
    category: 'Health',
    suggestedPrice: 1100,
    lastAsked: '1d ago',
  },
]
