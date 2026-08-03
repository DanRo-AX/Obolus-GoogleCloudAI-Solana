// Projected mainnet top-ups. The working Devnet demo pays each live quote
// directly in USDC; the page labels that distinction so it cannot be mistaken
// for an already implemented subscription or stored-value product.

export type Plan = {
  id: string
  name: string
  tagline: string
  /**
   * Opens included per month. One open = one MD, opened.
   * Digits and thousands separators only. The estimator parses this with
   * Number(), so appending a unit word like 'opens' yields NaN and kills the
   * recommendation logic. The UI adds the unit label.
   */
  credits: string
  /** Display price in KRW, already formatted (e.g. '₩9,900'). 'Free' has no price. */
  price: string
  cta: string
  href: string
  /** Tailwind gradient stop + --card-accent + CTA glow, per plan. */
  from: string
  accent: string
  glow?: string
  lowestCost: boolean
}

export const PLANS: Plan[] = [
  {
    id: 'free',
    name: 'Free',
    tagline: 'See what is on the shelves first. No card required.',
    credits: '5',
    price: 'Free',
    cta: 'Start free',
    href: '/login?mode=signup',
    from: 'from-foreground/[0.05]',
    accent: '#0000001f',
    lowestCost: false,
  },
  {
    id: 'lite',
    name: 'Lite',
    tagline: 'About ₩10 an open for occasional questions.',
    credits: '300',
    price: '₩3,000',
    cta: 'Try on Devnet',
    href: '/login?mode=signup&plan=shelf-lite',
    from: 'from-[#0F766E]/[0.12]',
    accent: '#0F766E40',
    glow: '#0F766E',
    lowestCost: false,
  },
  {
    id: 'standard',
    name: 'Standard',
    tagline: 'About ₩7.5 an open for regular research.',
    credits: '2,000',
    price: '₩15,000',
    cta: 'Try on Devnet',
    href: '/login?mode=signup&plan=shelf-standard',
    from: 'from-[#6D28D9]/[0.13]',
    accent: '#6D28D940',
    glow: '#6D28D9',
    lowestCost: false,
  },
  {
    id: 'team',
    name: 'Team',
    tagline: 'About ₩5 an open. Five seats share one balance.',
    credits: '10,000',
    price: '₩50,000',
    cta: 'Join the pilot',
    href: '/login?mode=signup&plan=shelf-team',
    from: 'from-[#23008E]/[0.12]',
    accent: '#23008E40',
    glow: '#23008E',
    lowestCost: true,
  },
]

/**
 * Representative shelves. These are not data providers — they are condition
 * bundles filed on the shelves.
 * domain and plate are empty strings on purpose: these names have no favicon
 * file. The UI must not build an img src. It draws an initial chip from the
 * first two letters of name instead, so keep those two letters distinct across
 * entries.
 */
export const PROVIDER_CHIPS = [
  { name: 'Seongsu residents', domain: '', plate: '' },
  { name: 'Paris locals', domain: '', plate: '' },
  { name: 'Elementary school parents', domain: '', plate: '' },
  { name: 'Five years self-employed', domain: '', plate: '' },
  { name: 'Weekday lunch', domain: '', plate: '' },
]

export const FEATURE_TOOLTIPS: Record<string, string> = {
  'Opens per month':
    'One open is one MD, opened. SHELF-1 searching the stacks and ranking them by similarity costs nothing. Only the MDs you actually open come out of your balance.',
  'Full shelf access':
    'The plan does not lock the stacks. Free and Team see the same shelves. The only difference is how many opens are included each month.',
  'Auto-matching':
    'Every MD you open, and the conditions you used at the time, stay in memory. The next time the same conditions come in, it matches directly, with no open call.',
  'Open calls':
    'When no MD on the shelves fits the conditions, you post an open call. You set how many people to ask and what one open is worth, and you pay only for the answers that arrive.',
  'Source verification':
    'Each sentence in an answer keeps a record of which MD it came from and which passage. You can check it against your open history.',
  'x402 settlement':
    'Phantom refills a verified prepaid USDC balance only when it is low. Questions reserve that balance automatically, and a bounded GCP KMS agent pays every DB independently through Pay.sh; no user delegation or browser helper key is installed.',
}

/** Input for the "Find the right plan" estimator. Average opens per question. */
export const PROMPT_TYPES = [
  {
    id: 'quick',
    label: 'Quick lookup',
    blurb: 'A question with one condition. Two representative MDs and it is done.',
    creditsPerQuery: 2,
  },
  {
    id: 'mixed',
    label: 'Mixed',
    blurb:
      'Two or three conditions overlap. Skim the representative MDs, then open a few more where the answers diverge.',
    creditsPerQuery: 6,
  },
  {
    id: 'deep',
    label: 'Deep interview',
    blurb:
      'The conditions are narrow, so the stacks often have no answer. Post an open call and read every response that comes back.',
    creditsPerQuery: 18,
  },
] as const
