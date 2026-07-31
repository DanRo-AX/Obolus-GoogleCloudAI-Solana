// The six volumes the landing ticker cycles through. They are a representative
// sample of the MDs shelved in the stacks, and every time a card flips, the
// point field behind it is repainted in that card's accent color.

export type TickerSource = {
  id: string
  /** Anonymous handle. Real names appear nowhere. */
  handle: string
  /** One-line intro: where, how long, what they do. */
  label: string
  /** One sentence on the questions this MD is strong on. */
  description: string
  /** Entries stacked up in the memory stream. */
  entries: string
  /** Share of opens rated useful afterwards. */
  openRate: string
  /** Moves --card-accent, the mark plate, and the point field together. */
  accent: string
  /** Mark color that sits on top of the accent plate. */
  mark: string
  canvasBackground: string
}

export const TICKER_SOURCES: TickerSource[] = [
  {
    id: 'seongsu-04',
    handle: 'SEONGSU_04',
    label: 'Seongsu, 4 years · runs a cafe',
    description:
      'Weeknight foot traffic in Seongsu and what a 12-pyeong shop really costs, straight off the books.',
    entries: '128',
    openRate: '81%',
    accent: 'rgb(255, 176, 32)',
    mark: 'rgb(0, 0, 0)',
    canvasBackground: 'rgb(24, 14, 4)',
  },
  {
    id: 'paris-11e',
    handle: 'PARIS_11E',
    label: 'Paris 11th, 6 years · resident',
    description:
      'Which day Parisians actually shop and what they budget to eat out. Lived in, not toured.',
    entries: '212',
    openRate: '86%',
    accent: 'rgb(84, 162, 255)',
    mark: 'rgb(0, 0, 0)',
    canvasBackground: 'rgb(8, 14, 28)',
  },
  {
    id: 'yeonsu-mom',
    handle: 'YEONSU_MOM',
    label: 'Yeonsu-gu, Incheon · kids aged 6 and 4',
    description:
      'The daily pickup run for two kids, and where ₩620,000 a month of after-school classes goes, item by item.',
    entries: '341',
    openRate: '74%',
    accent: 'rgb(251, 100, 182)',
    mark: 'rgb(0, 0, 0)',
    canvasBackground: 'rgb(22, 8, 18)',
  },
  {
    id: 'smartstore',
    handle: 'SMARTSTORE',
    label: 'Smartstore, 3 years · ₩42,000,000 a month',
    description:
      'Return rates by category and the point where ad spend pays back, off real settlement records.',
    entries: '176',
    openRate: '77%',
    accent: 'rgb(0, 210, 148)',
    mark: 'rgb(0, 0, 0)',
    canvasBackground: 'rgb(5, 20, 16)',
  },
  {
    id: 'onchain-02',
    handle: 'ONCHAIN_02',
    label: 'Onchain, 2 years · runs a Solana wallet',
    description:
      'Why they actually switched wallets, and the exact fee at which they abandon a transaction.',
    entries: '94',
    openRate: '69%',
    accent: 'rgb(192, 126, 255)',
    mark: 'rgb(0, 0, 0)',
    canvasBackground: 'rgb(14, 8, 26)',
  },
  {
    id: 'night-rn-8',
    handle: 'NIGHT_RN_8',
    label: 'Tertiary hospital, 3 rotating shifts · 8 years in',
    description:
      'How eating and sleeping actually go through a night-shift week, and what would make them quit.',
    entries: '263',
    openRate: '83%',
    accent: 'rgb(0, 210, 239)',
    mark: 'rgb(0, 0, 0)',
    canvasBackground: 'rgb(4, 16, 26)',
  },
]

/** Canvas palette per use-case carousel category. Keys match the labels in useCases.ts. */
export const USE_CASE_THEME: Record<
  string,
  { background: string; color: string; colorAlt: string }
> = {
  Neighborhood: {
    background: 'rgb(20, 14, 5)',
    color: '#ffb020',
    colorAlt: '#9b8f7d',
  },
  'Food & Drink': {
    background: 'rgb(22, 9, 6)',
    color: '#ff7a45',
    colorAlt: '#9b837d',
  },
  Commerce: {
    background: 'rgb(22, 8, 18)',
    color: '#fb64b6',
    colorAlt: '#a0868f',
  },
  Hiring: { background: 'rgb(19, 18, 4)', color: '#fac800', colorAlt: '#9b9a7d' },
  Travel: { background: 'rgb(8, 14, 28)', color: '#54a2ff', colorAlt: '#8a959b' },
  Crypto: { background: 'rgb(6, 20, 15)', color: '#00d294', colorAlt: '#7d9b90' },
  Parenting: {
    background: 'rgb(14, 8, 26)',
    color: '#c07eff',
    colorAlt: '#8d86a0',
  },
  Health: { background: 'rgb(4, 16, 26)', color: '#00d2ef', colorAlt: '#7d939b' },
}
