/**
 * The field taxonomy. One list, used in three places that must agree:
 * the dashboard tabs, the onboarding "what can you speak to" step, and the
 * category stamped on every open call.
 *
 * Deliberately broad. A person does not think of themselves as belonging to
 * "Parenting & Education, primary bracket" — they think "I have kids". Narrow
 * categories look precise and then nothing lands in them.
 */

import {
  Briefcase,
  Code2,
  Dumbbell,
  GraduationCap,
  Handshake,
  HeartPulse,
  Home,
  Plane,
  Users,
  Utensils,
  Wallet,
  type LucideIcon,
} from 'lucide-react'

export type CategoryId =
  | 'life'
  | 'food'
  | 'family'
  | 'health'
  | 'business'
  | 'sales'
  | 'engineering'
  | 'education'
  | 'sports'
  | 'travel'
  | 'money'

export type Category = {
  id: CategoryId
  label: string
  /** Shown under the label when picking fields in onboarding. */
  blurb: string
  Icon: LucideIcon
  accent: string
}

export const CATEGORIES: Category[] = [
  {
    id: 'life',
    label: 'Life',
    blurb: 'Where the day goes — neighbourhood, housing, errands, routine.',
    Icon: Home,
    accent: '#866FF2',
  },
  {
    id: 'business',
    label: 'Business',
    blurb: 'Running something. Shops, studios, agencies, a company of four.',
    Icon: Briefcase,
    accent: '#0F766E',
  },
  {
    id: 'sales',
    label: 'Sales',
    blurb: 'Talking to customers for a living. Field, floor, or outbound.',
    Icon: Handshake,
    accent: '#ff7a45',
  },
  {
    id: 'engineering',
    label: 'Engineering',
    blurb: 'Building and running software. Tools, infra, the on-call pager.',
    Icon: Code2,
    accent: '#54a2ff',
  },
  {
    id: 'education',
    label: 'Education',
    blurb: 'Teaching or studying. Classrooms, tutoring, exams, retraining.',
    Icon: GraduationCap,
    accent: '#c07eff',
  },
  {
    id: 'sports',
    label: 'Sports',
    blurb: 'Training, gear, and what a real week of it looks like.',
    Icon: Dumbbell,
    accent: '#00d294',
  },
  {
    id: 'health',
    label: 'Health',
    blurb: 'Bodies over time. Conditions, care, sleep, recovery.',
    Icon: HeartPulse,
    accent: '#00d2ef',
  },
  {
    id: 'family',
    label: 'Family',
    blurb: 'Kids, parents, the household. What changed and what it cost.',
    Icon: Users,
    accent: '#fb64b6',
  },
  {
    id: 'food',
    label: 'Food & Drink',
    blurb: 'Eating and cooking, on both sides of the counter.',
    Icon: Utensils,
    accent: '#fac800',
  },
  {
    id: 'travel',
    label: 'Travel',
    blurb: 'Living somewhere else, or going back often enough to know it.',
    Icon: Plane,
    accent: '#ff6568',
  },
  {
    id: 'money',
    label: 'Money',
    blurb: 'Earning, saving, investing. What you actually did, not the theory.',
    Icon: Wallet,
    accent: '#8b5cf6',
  },
]

export const CATEGORY_BY_ID = Object.fromEntries(
  CATEGORIES.map((c) => [c.id, c]),
) as Record<CategoryId, Category>

/**
 * Legacy and free-text fallback.
 *
 * Calls placed before the taxonomy existed only carry a legacy category label,
 * and calls posted from a chat carry that stored label. Rather than migrate
 * storage, every read routes through here.
 */
const KEYWORDS: Array<[CategoryId, string[]]> = [
  ['family', ['parent', 'kid', 'child', 'school parent', 'dementia', 'household', 'family', 'grade']],
  ['education', ['teach', 'class', 'student', 'exam', 'tutor', 'study', 'education', 'academy']],
  ['engineering', ['infra', 'backend', 'deploy', 'migration', 'on-call', 'notion', 'developer', 'engineer', 'tool', 'database', 'api']],
  ['sales', ['sales', 'outbound', 'client', 'dealership', 'pitch to', 'showroom', 'quota']],
  ['business', ['shop', 'margin', 'franchise', 'owner', 'commerce', 'store', 'business', 'vendor', 'supplier']],
  ['money', ['invest', 'fund', 'crypto', 'treasury', 'dao', 'wallet', 'savings', 'salary', 'tax']],
  ['health', ['clinic', 'nurse', 'sleep', 'health', 'shift work', 'hospital', 'recovery', 'care']],
  ['sports', ['marathon', 'training', 'gym', 'climb', 'run ', 'football', 'sport', 'cycling']],
  ['food', ['kitchen', 'cafe', 'restaurant', 'lunch', 'coffee', 'menu', 'chef', 'f&b', 'bake']],
  ['travel', ['paris', 'travel', 'abroad', 'expat', 'trip', 'living in', 'visa']],
  ['life', ['daily', 'neighbou', 'neighbor', 'seongsu', 'routine', 'commute', 'moving', 'rent', 'errand']],
]

export function categoryFor(...parts: Array<string | undefined>): CategoryId {
  const text = parts.filter(Boolean).join(' ').toLowerCase()
  for (const [id, words] of KEYWORDS) {
    if (words.some((w) => text.includes(w))) return id
  }
  return 'life'
}
