/**
 * The warm-up before the money question.
 *
 * Nobody answers a deep question cold. Four or five very light ones first —
 * loosely tied to the main question, answerable in a second, never invasive —
 * do two jobs: they get the person moving, and they show by example what kind
 * of answer is wanted. Specific, lived, unpolished. By the time the real
 * question arrives the register is already set.
 *
 * Keep them light. Anything that feels like an interview loses people.
 */

export type Warmup =
  | { id: string; kind: 'choice'; prompt: string; hint?: string; options: string[] }
  | { id: string; kind: 'scale'; prompt: string; hint?: string; low: string; high: string }
  | { id: string; kind: 'short'; prompt: string; hint?: string; placeholder: string }

/** Warm-ups are chosen by stored category label, so a new open call inherits the right set. */
export const WARMUPS: Record<string, Warmup[]> = {
  '성수동에서 먹고 삽니다': [
    {
      id: 'w1',
      kind: 'choice',
      prompt: 'Roughly what time do you eat lunch?',
      options: ['Before 11:40', 'Around 12', 'After 1', 'It varies a lot'],
    },
    {
      id: 'w2',
      kind: 'scale',
      prompt: 'How long a queue is too long?',
      low: 'I leave immediately',
      high: '30 minutes is fine',
    },
    {
      id: 'w3',
      kind: 'choice',
      prompt: 'Do you stay inside the neighbourhood for lunch?',
      options: ['Almost always', 'Depends on the day', 'I usually go elsewhere'],
    },
    {
      id: 'w4',
      kind: 'short',
      prompt: 'One place you go when you have no time at all.',
      hint: 'A name is enough. No need to explain.',
      placeholder: 'e.g. the noodle place near exit 3',
    },
  ],
  '초등 입학 준비': [
    {
      id: 'w1',
      kind: 'choice',
      prompt: 'How far into it are you?',
      options: ['Starting next year', 'First grade now', 'Already past it'],
    },
    {
      id: 'w2',
      kind: 'scale',
      prompt: 'Did the spending land where you expected?',
      low: 'Nothing like it',
      high: 'Pretty much as planned',
    },
    {
      id: 'w3',
      kind: 'choice',
      prompt: 'What surprised you most?',
      options: ['Supplies', 'After-school', 'Clothes', 'Something else entirely'],
    },
    {
      id: 'w4',
      kind: 'short',
      prompt: 'One thing you would have skipped.',
      hint: 'Whatever comes to mind first.',
      placeholder: 'e.g. the branded backpack set',
    },
  ],
  '가게를 3년째 운영합니다': [
    {
      id: 'w1',
      kind: 'choice',
      prompt: 'How long have you been running it?',
      options: ['Under a year', '1–3 years', '3–5 years', 'Over 5'],
    },
    {
      id: 'w2',
      kind: 'scale',
      prompt: 'How close is your margin to what you planned on opening day?',
      low: 'Nowhere near',
      high: 'About right',
    },
    {
      id: 'w3',
      kind: 'choice',
      prompt: 'Which line moves the most month to month?',
      options: ['Rent', 'Staff', 'Supplies', 'Platform fees'],
    },
    {
      id: 'w4',
      kind: 'short',
      prompt: 'A cost nobody warned you about.',
      hint: 'One line. The specific thing, not the category.',
      placeholder: 'e.g. water filter changes',
    },
  ],
  '파리에 삽니다': [
    {
      id: 'w1',
      kind: 'choice',
      prompt: 'How long have you lived there?',
      options: ['Under a year', '1–3 years', '3–5 years', 'Over 5'],
    },
    {
      id: 'w2',
      kind: 'choice',
      prompt: 'What time do you usually sit down for dinner?',
      options: ['Before 19:30', '19:30–20:30', 'After 20:30'],
    },
    {
      id: 'w3',
      kind: 'scale',
      prompt: 'How do you feel about booking ahead?',
      low: 'Never bother',
      high: 'Always book',
    },
    {
      id: 'w4',
      kind: 'short',
      prompt: 'Your default place when you cannot decide.',
      hint: 'Just the name and roughly where.',
      placeholder: 'e.g. the place on rue de Charonne',
    },
  ],
}

/** Anything without a bespoke set falls back to these. */
export const DEFAULT_WARMUPS: Warmup[] = [
  {
    id: 'w1',
    kind: 'choice',
    prompt: 'How close is this to your everyday life?',
    options: ['I live it', 'I know it well', 'I have some experience', 'Not really'],
  },
  {
    id: 'w2',
    kind: 'scale',
    prompt: 'How settled is your view on it?',
    low: 'Still figuring it out',
    high: 'Very settled',
  },
  {
    id: 'w3',
    kind: 'choice',
    prompt: 'When did you last deal with it?',
    options: ['This week', 'This month', 'This year', 'Longer ago'],
  },
  {
    id: 'w4',
    kind: 'short',
    prompt: 'One concrete detail that comes to mind.',
    hint: 'A number, a name, a time. Whatever is first.',
    placeholder: 'Write it the way you would say it',
  },
]

export function warmupsFor(shelf: string): Warmup[] {
  return WARMUPS[shelf] ?? DEFAULT_WARMUPS
}

/** Shown on the last screen, above the box where the money question is answered. */
export const MAIN_GUIDANCE = {
  eyebrow: 'The one that pays',
  do: [
    'Name the actual place, time, or number.',
    'Say what you did, not what people generally do.',
    'Leave it rough. Polishing it makes it worth less.',
  ],
  dont: 'Skip the summary. Nobody pays to open a summary.',
}
