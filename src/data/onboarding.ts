/**
 * What a person hands over before they can answer, and what happens if they
 * answer badly.
 *
 * The first half exists because a buyer paying ₩800 for a passage needs to know
 * the person who wrote it was actually in the situation. None of it is
 * financial and none of it identifies anyone — a buyer sees the handle and the
 * bands, never a name.
 *
 * The second half is the enforcement side, stated in plain terms on the way in
 * rather than buried in the terms page. Three strikes and the account stops.
 */

export type Option = { value: string; label: string; hint?: string }

export const AGE_BANDS: Option[] = [
  { value: 'under-25', label: 'Under 25' },
  { value: '25-34', label: '25–34' },
  { value: '35-44', label: '35–44' },
  { value: '45-54', label: '45–54' },
  { value: '55-plus', label: '55 and over' },
]

export const REGIONS: Option[] = [
  { value: 'seoul', label: 'Seoul' },
  { value: 'gyeonggi', label: 'Gyeonggi/Incheon' },
  { value: 'metro', label: 'Another metro city' },
  { value: 'town', label: 'Smaller city or town' },
  { value: 'abroad', label: 'Outside Korea' },
]

export const HOUSEHOLDS: Option[] = [
  { value: 'alone', label: 'Living alone' },
  { value: 'partner', label: 'With a partner' },
  { value: 'kids', label: 'With kids at home' },
  { value: 'parents', label: 'With parents' },
  { value: 'shared', label: 'Shared flat' },
]

export const YEAR_BANDS: Option[] = [
  { value: 'under-1', label: 'Under a year' },
  { value: '1-3', label: '1–3 years' },
  { value: '3-7', label: '3–7 years' },
  { value: '7-plus', label: '7 years or more' },
]

/** Handle seeds. A buyer never sees more than one of these plus two digits. */
const HANDLE_STEMS = [
  'SEOUL',
  'HANGANG',
  'SEONGSU',
  'MAPO',
  'NOKSAPYEONG',
  'YEONNAM',
  'BUKCHON',
  'SONGDO',
]

export function suggestHandle(): string {
  const stem = HANDLE_STEMS[Math.floor(Math.random() * HANDLE_STEMS.length)]
  const n = String(Math.floor(Math.random() * 89) + 10)
  return `${stem}_${n}`
}

export type Rule = { title: string; body: string }

/** What earns a strike. Worded so the line is checkable after the fact. */
export const STRIKE_RULES: Rule[] = [
  {
    title: 'Made-up facts',
    body: 'Answering about something you have not lived — a place you have not been, a job you never did, a price you never paid. The passage stays up and the asker rates it, so this is checkable long after the payout landed.',
  },
  {
    title: 'Low-effort answers',
    body: 'One line, the question restated, or anything any agent could have written without you. Only the part you lived gets opened, and opens are what pay you.',
  },
  {
    title: 'Copied text',
    body: 'Pasted from a search result, a blog, or another person’s document. If it already exists on the web, an agent could have read it for free.',
  },
]

/** What each strike costs. Escalating, and stated before anyone answers. */
export const STRIKE_LADDER: Array<{ n: number; title: string; body: string }> = [
  {
    n: 1,
    title: 'Warning',
    body: 'The answer is voided and its payout reversed. You are told which rule it hit. You can dispute it once.',
  },
  {
    n: 2,
    title: 'Restricted',
    body: 'Auto-match is switched off and payouts are held for 14 days. You can still pick up open calls.',
  },
  {
    n: 3,
    title: 'Suspended',
    body: 'The account is suspended. Your documents stop being quoted and stop earning. Anything already settled still lands in your wallet.',
  },
]

export const STRIKE_LIMIT = 3
export const AUTO_MATCH_STRIKE_LIMIT = 2

export const CONDUCT_SUMMARY =
  'Askers rate every passage they open. A rating below the floor goes to review, and a confirmed one becomes a strike. Three strikes suspends the account.'
