/**
 * A seeded stand-in for the Rust service, for driving the UI end to end on a
 * machine with no Rust toolchain.
 *
 * It implements only the endpoints the browser actually calls, with the exact
 * shapes `src/lib/api.ts` declares. Everything lives in memory and dies with
 * the process — this is a demo fixture, not a second implementation of the
 * product. Money here is the labelled sandbox ledger, never a chain transfer.
 */

import { createServer } from 'node:http'
import { randomUUID } from 'node:crypto'

const PORT = Number(process.env.MOCK_PORT ?? 8787)
const NOW = Date.now()
const HOUR = 3600_000
const DAY = 24 * HOUR

// ---------------------------------------------------------------- fixtures

const CATEGORIES = [
  'life', 'business', 'sales', 'engineering', 'education',
  'sports', 'health', 'family', 'food', 'travel', 'money',
]

const SHELF_BY_CATEGORY = {
  life: 'Living in Seongsu',
  business: 'Running a small studio',
  sales: 'Field sales, B2B',
  engineering: 'Backend on call',
  education: 'Public school, year one',
  sports: 'Amateur road cycling',
  health: 'Chronic condition, daily',
  family: 'Two kids under ten',
  food: 'Cooking for one',
  travel: 'Long-haul on a budget',
  money: 'Paying off a mortgage',
}

const AGE = ['under-25', '25-34', '35-44', '45-54', '55-plus']
const REGION = ['seoul', 'gyeonggi', 'metro', 'town', 'abroad']
const HOUSE = ['alone', 'partner', 'kids', 'parents', 'shared']

/** Deterministic pseudo-random so every recording gets the same board. */
let seed = 20260803
function rnd() {
  seed = (seed * 1103515245 + 12345) & 0x7fffffff
  return seed / 0x7fffffff
}
function pick(list) {
  return list[Math.floor(rnd() * list.length)]
}
function between(lo, hi) {
  return lo + Math.floor(rnd() * (hi - lo + 1))
}

const QUESTIONS = {
  life: [
    'What does a weekday actually cost you in Seongsu — lunch, coffee, transit?',
    'How long did it take to get a moving-in permit sorted, start to finish?',
    'Which errand near you still needs a physical visit in 2026?',
    'What broke in your flat in the last year, and what did the repair run to?',
  ],
  business: [
    'What did your first month of business insurance actually cost?',
    'How many days does a small studio wait to get paid, in practice?',
    'What software did you cancel this year, and what replaced it?',
    'Which single expense surprised you most in year one?',
  ],
  sales: [
    'How many touches before a mid-market deal actually closes for you?',
    'What does a real cold-call day look like, hour by hour?',
    'Which objection kills your deals most often, and what answers it?',
  ],
  engineering: [
    'What woke you up on call last month, and how long to resolve?',
    'How long does your CI actually take, and what did you try to cut it?',
    'Which migration cost you the most unplanned hours this year?',
    'What is your real on-call compensation, in money or time off?',
  ],
  education: [
    'What do you actually spend out of pocket on your classroom per term?',
    'How many hours a week go to admin rather than teaching?',
    'What changed in first-grade costs for parents this year?',
  ],
  sports: [
    'What does a season of amateur road racing cost, all in?',
    'How did you fit training around a full-time job — real schedule?',
    'What injury took you out, and how long was the return?',
  ],
  health: [
    'What does managing your condition cost per month after insurance?',
    'How long was the wait for a specialist referral where you live?',
    'Which pharmacy or clinic habit actually saved you money?',
  ],
  family: [
    'What does after-school care cost you, and what are the hours?',
    'How did you split the school-run logistics with a partner?',
    'What did you stop buying once the second child arrived?',
  ],
  food: [
    'What does cooking for one actually cost you a week?',
    'Which market day and hour gives you the best prices near you?',
    'What restaurant habit did you drop this year, and why?',
  ],
  travel: [
    'What did a long-haul trip cost you outside the flight?',
    'Which visa or entry step took longer than the guides said?',
    'What did you pack that you actually used, and what never left the bag?',
  ],
  money: [
    'What is your real monthly mortgage cost including everything?',
    'Which fee did you only notice after a year of paying it?',
    'How did your household budget change when rates moved?',
  ],
}

const ANSWER_SNIPPETS = [
  'Went at 19:30 and walked straight in. At 20:30 it is a forty-minute wait.',
  'Budgeted ₩180,000 a month and it came in at ₩214,000 once delivery fees counted.',
  'Took eleven working days, not the three the guide claims. Two of those were a resubmission.',
  'The place on my street stopped taking walk-ins in March, so plan around it.',
  'Marché Monge, Wednesday, before 11 — after that the good stalls are picked over.',
  'Three call-outs last month, longest was 2h40m, all of them the same upstream timeout.',
]

// --------------------------------------------------------------- the store

const db = {
  users: new Map(), // email -> user
  sessions: new Map(), // token -> userId
  profiles: new Map(), // userId -> ServerProfile
  balances: new Map(), // userId -> BalanceSummary
  orders: [],
  memory: new Map(), // userId -> MemoryEntry[]
  earnings: new Map(), // userId -> EarningEvent[]
  notifications: new Map(), // userId -> ContributorNotification[]
  chatAnswers: new Map(), // chatId -> ChatAnswer[]
  queries: new Map(), // queryId -> { token, matches, payer }
  reservations: new Map(),
  challenges: new Map(),
  disputes: [],
  feedback: [],
}

/** Open calls other people posted. This is what the board shows on arrival. */
function seedOrders() {
  const out = []
  for (const category of CATEGORIES) {
    const questions = QUESTIONS[category]
    for (let i = 0; i < questions.length; i += 1) {
      const target = between(3, 12)
      const answered = between(0, target - 1)
      const unitPrice = pick([300, 500, 800, 1200, 1500, 2000, 2500, 4000])
      out.push({
        id: `o_seed_${category}_${i}`,
        question: questions[i],
        unitPrice,
        target,
        answered,
        createdAt: NOW - between(1, 96) * HOUR,
        mine: false,
        shelf: SHELF_BY_CATEGORY[category],
        category,
        status: 'open',
        eligible: rnd() > 0.35,
        escrowMode: 'sandbox',
        escrowRemainingKrw: (target - answered) * unitPrice,
        filters: rnd() > 0.5
          ? { ageBand: pick(AGE), region: pick(REGION), field: category }
          : { field: category },
        recommendationScore: Math.round(rnd() * 100) / 100,
        recommendationReason: rnd() > 0.6 ? ['field match', 'pays above median'] : undefined,
      })
    }
  }
  return out.sort((a, b) => b.createdAt - a.createdAt)
}

db.orders = seedOrders()

/** Documents that already exist, so a question can come back HIT. */
const DOCUMENTS = []
for (const category of CATEGORIES) {
  for (let i = 0; i < 9; i += 1) {
    const handle = `${category.slice(0, 5).toUpperCase()}_${String(between(10, 99))}`
    DOCUMENTS.push({
      handle,
      shelfId: `sh_${category}`,
      shelf: SHELF_BY_CATEGORY[category],
      category,
      priceKrw: pick([5, 8, 9, 11, 12, 15, 18, 20]),
      excerpt: pick(ANSWER_SNIPPETS),
      demographics: {
        ageBand: pick(AGE),
        region: pick(REGION),
        household: pick(HOUSE),
        field: category,
      },
    })
  }
}

// The Seongsu question the brief uses as its worked example is guaranteed to
// hit, so the recorded run always shows the paid path rather than a miss.
const HIT_TERMS = ['seongsu', 'lunch', 'weekday', 'cost', '성수', '점심', 'paris', 'eat']

function seedContributor(userId) {
  const mem = []
  const earn = []
  for (let i = 0; i < 14; i += 1) {
    const category = CATEGORIES[i % CATEGORIES.length]
    const earned = pick([300, 500, 800, 1200, 1500])
    const createdAt = NOW - (i + 1) * 2 * DAY
    const voided = i === 11
    mem.push({
      id: `m_seed_${i}`,
      question: QUESTIONS[category][i % QUESTIONS[category].length],
      answer: `${pick(ANSWER_SNIPPETS)} ${pick(ANSWER_SNIPPETS)}`,
      shelf: SHELF_BY_CATEGORY[category],
      earned: voided ? 0 : earned,
      createdAt,
      via: i % 5 === 0 ? 'Auto-match' : 'Open call',
      status: voided ? 'voided' : 'settled',
      flags: voided ? [{ rule: 'too-short', detail: 'Under the length floor.' }] : undefined,
      rating: voided ? undefined : between(3, 5),
      memoryType: 'observation',
      importance: Math.round(rnd() * 100) / 100,
      reliabilityScore: 0.7 + Math.round(rnd() * 30) / 100,
      contentHash: randomUUID().replaceAll('-', ''),
      version: 1,
      locked: i === 3,
      accessCount: between(0, 42),
      lastAccessedAt: NOW - between(1, 200) * HOUR,
    })
    if (!voided) {
      earn.push({
        id: `e_seed_${i}`,
        memoryId: `m_seed_${i}`,
        source: 'open_call',
        amountKrw: earned,
        payoutStatus: i < 3 ? 'held' : i < 7 ? 'accrued' : 'claimable',
        availableAt: createdAt + 14 * DAY,
        createdAt,
      })
    }
  }
  db.memory.set(userId, mem)
  db.earnings.set(userId, earn)
  db.notifications.set(userId, [
    {
      id: 'n_1',
      kind: 'call_available',
      title: 'A call in Engineering fits your shelf',
      body: 'Someone is paying ₩2,000 an answer for real on-call numbers.',
      openCallId: 'o_seed_engineering_0',
      createdAt: NOW - 40 * 60_000,
    },
    {
      id: 'n_2',
      kind: 'answer_received',
      title: 'Your answer was opened',
      body: 'A buyer opened what you wrote about weekday costs. ₩12 accrued.',
      createdAt: NOW - 5 * HOUR,
    },
  ])
}

// ---------------------------------------------------------------- plumbing

function cookies(req) {
  const out = {}
  for (const part of (req.headers.cookie ?? '').split(';')) {
    const [k, ...v] = part.trim().split('=')
    if (k) out[k] = v.join('=')
  }
  return out
}

function userOf(req) {
  const token = cookies(req).obolus_session
  const id = token && db.sessions.get(token)
  if (!id) return null
  for (const user of db.users.values()) if (user.id === id) return user
  return null
}

function body(req) {
  return new Promise((resolve) => {
    let raw = ''
    req.on('data', (c) => { raw += c })
    req.on('end', () => {
      try { resolve(raw ? JSON.parse(raw) : {}) } catch { resolve({}) }
    })
  })
}

function send(res, status, payload, headers = {}) {
  const text = payload === undefined ? '' : JSON.stringify(payload)
  res.writeHead(status, {
    'content-type': 'application/json',
    'cache-control': 'no-store',
    ...headers,
  })
  res.end(text)
}

function fail(res, status, code, message) {
  send(res, status, { error: { code, message } })
}

function balanceOf(userId) {
  return db.balances.get(userId) ?? { currency: 'KRW_SANDBOX', availableKrw: 0, reservedKrw: 0, heldKrw: 0 }
}

function makeUser(email) {
  const user = { id: `u_${randomUUID().slice(0, 8)}`, email, role: 'user', createdAt: NOW }
  db.users.set(email, user)
  db.balances.set(user.id, {
    currency: 'KRW_SANDBOX',
    availableKrw: 100_000,
    reservedKrw: 0,
    heldKrw: 0,
  })
  seedContributor(user.id)
  return user
}

function startSession(res, user) {
  const token = randomUUID()
  db.sessions.set(token, user.id)
  return {
    headers: {
      'set-cookie': `obolus_session=${token}; HttpOnly; Path=/; SameSite=Lax; Max-Age=86400`,
    },
    payload: { user, balance: balanceOf(user.id) },
  }
}

function profileOf(userId) {
  return db.profiles.get(userId) ?? null
}

function earningsSummary(userId) {
  const events = db.earnings.get(userId) ?? []
  const sum = (status) => events
    .filter((e) => e.payoutStatus === status)
    .reduce((n, e) => n + e.amountKrw, 0)
  return {
    accruedKrw: events.reduce((n, e) => n + e.amountKrw, 0),
    heldKrw: sum('held'),
    availableKrw: sum('accrued'),
    claimableKrw: sum('claimable'),
    eventCount: events.length,
    events: [...events].sort((a, b) => b.createdAt - a.createdAt),
  }
}

// ----------------------------------------------------------------- routing

const routes = []
function route(method, pattern, handler) {
  routes.push({ method, pattern, handler })
}

route('POST', /^\/api\/v1\/auth\/(register|login)$/, async (req, res) => {
  const input = await body(req)
  const email = String(input.email ?? '').toLowerCase()
  if (!email) return fail(res, 400, 'invalid_email', 'An email is required.')
  const user = db.users.get(email) ?? makeUser(email)
  const { headers, payload } = startSession(res, user)
  send(res, 200, payload, headers)
})

route('GET', /^\/api\/v1\/auth\/me$/, (req, res) => {
  const user = userOf(req)
  if (!user) return fail(res, 401, 'unauthenticated', 'Sign in first.')
  send(res, 200, { user, balance: balanceOf(user.id) })
})

route('POST', /^\/api\/v1\/auth\/logout$/, (req, res) => {
  const token = cookies(req).obolus_session
  if (token) db.sessions.delete(token)
  send(res, 200, {}, { 'set-cookie': 'obolus_session=; HttpOnly; Path=/; Max-Age=0' })
})

route('GET', /^\/api\/v1\/account\/balance$/, (req, res) => {
  const user = userOf(req)
  if (!user) return fail(res, 401, 'unauthenticated', 'Sign in first.')
  send(res, 200, balanceOf(user.id))
})

route('GET', /^\/api\/v1\/profile$/, (req, res) => {
  const user = userOf(req)
  if (!user) return fail(res, 401, 'unauthenticated', 'Sign in first.')
  send(res, 200, profileOf(user.id))
})

route('POST', /^\/api\/v1\/profile$/, async (req, res) => {
  const user = userOf(req)
  if (!user) return fail(res, 401, 'unauthenticated', 'Sign in first.')
  const input = await body(req)
  const profile = {
    handle: input.handle,
    ageBand: input.ageBand,
    region: input.region,
    household: input.household,
    field: input.field,
    years: input.years,
    speaksTo: input.speaksTo ?? [],
    strikes: 0,
    disputeUsed: false,
    wallet: input.wallet,
    walletVerified: Boolean(input.wallet),
    walletVerifiedAt: input.wallet ? Date.now() : undefined,
    agreedAt: Date.now(),
    autoMatch: input.autoMatch ?? true,
    agents: input.agents ?? false,
    browserAlerts: input.browserAlerts ?? false,
    emailAlerts: input.emailAlerts ?? false,
    suspended: false,
  }
  db.profiles.set(user.id, profile)
  send(res, 200, profile)
})

route('POST', /^\/api\/v1\/profile\/preferences$/, async (req, res) => {
  const user = userOf(req)
  if (!user) return fail(res, 401, 'unauthenticated', 'Sign in first.')
  const input = await body(req)
  const profile = { ...(profileOf(user.id) ?? {}), ...input }
  db.profiles.set(user.id, profile)
  send(res, 200, profile)
})

route('POST', /^\/api\/v1\/profile\/wallet\/challenge$/, async (req, res) => {
  const input = await body(req)
  const challenge = {
    id: `wc_${randomUUID().slice(0, 8)}`,
    wallet: input.wallet,
    message: `Obolus wants to verify ${input.wallet} as your payout wallet.`,
    expiresAt: Date.now() + 5 * 60_000,
  }
  db.challenges.set(challenge.id, challenge)
  send(res, 200, challenge)
})

route('POST', /^\/api\/v1\/profile\/wallet\/verify$/, async (req, res) => {
  const user = userOf(req)
  if (!user) return fail(res, 401, 'unauthenticated', 'Sign in first.')
  const input = await body(req)
  const challenge = db.challenges.get(input.challengeId)
  const profile = {
    ...(profileOf(user.id) ?? {}),
    wallet: challenge?.wallet,
    walletVerified: true,
    walletVerifiedAt: Date.now(),
  }
  db.profiles.set(user.id, profile)
  send(res, 200, profile)
})

route('GET', /^\/api\/v1\/open-calls$/, (req, res) => {
  send(res, 200, db.orders)
})

route('POST', /^\/api\/v1\/open-calls$/, async (req, res) => {
  const user = userOf(req)
  if (!user) return fail(res, 401, 'unauthenticated', 'Sign in first.')
  const input = await body(req)
  const budget = input.unitPrice * input.target
  const balance = balanceOf(user.id)
  if (balance.availableKrw < budget) {
    return fail(res, 402, 'insufficient_balance', 'Sandbox credit is too low for that budget.')
  }
  db.balances.set(user.id, {
    ...balance,
    availableKrw: balance.availableKrw - budget,
    reservedKrw: balance.reservedKrw + budget,
  })
  const order = {
    id: `o_${randomUUID().slice(0, 8)}`,
    question: input.question,
    unitPrice: input.unitPrice,
    target: input.target,
    answered: 0,
    createdAt: Date.now(),
    chatId: input.chatId,
    mine: true,
    shelf: input.shelf,
    category: input.category,
    filters: input.filters,
    status: 'open',
    escrowMode: 'sandbox',
    escrowRemainingKrw: budget,
  }
  db.orders.unshift(order)
  send(res, 200, order)
})

route('DELETE', /^\/api\/v1\/open-calls\/([^/]+)$/, (req, res, [id]) => {
  const user = userOf(req)
  if (!user) return fail(res, 401, 'unauthenticated', 'Sign in first.')
  const order = db.orders.find((o) => o.id === id)
  if (!order) return fail(res, 404, 'not_found', 'No such call.')
  const refund = (order.target - order.answered) * order.unitPrice
  const balance = balanceOf(user.id)
  db.balances.set(user.id, {
    ...balance,
    availableKrw: balance.availableKrw + refund,
    reservedKrw: Math.max(0, balance.reservedKrw - refund),
  })
  order.status = 'cancelled'
  order.escrowRemainingKrw = 0
  send(res, 200, order)
})

route('POST', /^\/api\/v1\/open-calls\/([^/]+)\/reservation$/, (req, res, [id]) => {
  const expiresAt = Date.now() + 10 * 60_000
  db.reservations.set(id, expiresAt)
  send(res, 200, { openCallId: id, expiresAt })
})

route('POST', /^\/api\/v1\/open-calls\/([^/]+)\/reservation\/release$/, (req, res, [id]) => {
  db.reservations.delete(id)
  send(res, 204)
})

/** The quality gate the product promises: short or vague answers are voided. */
function assess(answer) {
  const issues = []
  const text = String(answer ?? '').trim()
  if (text.length < 80) {
    issues.push({ rule: 'too-short', detail: 'Under the length floor for a sellable answer.' })
  }
  if (!/\d/.test(text)) {
    issues.push({ rule: 'no-specifics', detail: 'No number, price, or duration anywhere in it.' })
  }
  return issues
}

route('POST', /^\/api\/v1\/open-calls\/([^/]+)\/answers$/, async (req, res, [id]) => {
  const user = userOf(req)
  if (!user) return fail(res, 401, 'unauthenticated', 'Sign in first.')
  const order = db.orders.find((o) => o.id === id)
  if (!order) return fail(res, 404, 'not_found', 'No such call.')
  const input = await body(req)
  const issues = assess(input.answer)
  const voided = issues.length > 0

  order.answered += 1
  order.escrowRemainingKrw = (order.target - order.answered) * order.unitPrice
  if (order.answered >= order.target) order.status = 'filled'

  const memory = {
    id: `m_${randomUUID().slice(0, 8)}`,
    question: order.question,
    answer: input.answer,
    shelf: order.shelf,
    earned: voided ? 0 : order.unitPrice,
    createdAt: Date.now(),
    via: 'Open call',
    status: voided ? 'voided' : 'settled',
    flags: voided ? issues : undefined,
    interviewResponses: input.interviewResponses ?? [],
    memoryType: 'observation',
    version: 1,
    contentHash: randomUUID().replaceAll('-', ''),
    accessCount: 0,
  }
  db.memory.set(user.id, [memory, ...(db.memory.get(user.id) ?? [])])

  if (!voided) {
    db.earnings.set(user.id, [
      {
        id: `e_${randomUUID().slice(0, 8)}`,
        memoryId: memory.id,
        source: 'open_call',
        amountKrw: order.unitPrice,
        payoutStatus: 'held',
        availableAt: Date.now() + 14 * DAY,
        createdAt: Date.now(),
      },
      ...(db.earnings.get(user.id) ?? []),
    ])
    if (order.chatId) {
      const answers = db.chatAnswers.get(order.chatId) ?? []
      answers.push({
        id: `ca_${randomUUID().slice(0, 8)}`,
        openCallId: order.id,
        handle: profileOf(user.id)?.handle ?? 'ANON_00',
        shelf: order.shelf,
        excerpt: input.answer,
        price: order.unitPrice,
        createdAt: Date.now(),
        demographics: {
          ageBand: profileOf(user.id)?.ageBand ?? '35-44',
          region: profileOf(user.id)?.region ?? 'seoul',
          household: profileOf(user.id)?.household ?? 'partner',
          field: order.category,
        },
      })
      db.chatAnswers.set(order.chatId, answers)
    }
  }

  if (voided) {
    const profile = profileOf(user.id)
    if (profile) db.profiles.set(user.id, { ...profile, strikes: Math.min(3, profile.strikes + 1) })
  }

  send(res, 200, { order, memory, issues })
})

route('GET', /^\/api\/v1\/chats\/([^/]+)\/answers$/, (req, res, [chatId]) => {
  send(res, 200, db.chatAnswers.get(chatId) ?? [])
})

route('GET', /^\/api\/v1\/memory$/, (req, res) => {
  const user = userOf(req)
  if (!user) return fail(res, 401, 'unauthenticated', 'Sign in first.')
  send(res, 200, db.memory.get(user.id) ?? [])
})

route('PATCH', /^\/api\/v1\/memory\/([^/]+)$/, async (req, res, [id]) => {
  const user = userOf(req)
  if (!user) return fail(res, 401, 'unauthenticated', 'Sign in first.')
  const input = await body(req)
  const list = db.memory.get(user.id) ?? []
  const entry = list.find((m) => m.id === id)
  if (!entry) return fail(res, 404, 'not_found', 'No such memory.')
  entry.locked = Boolean(input.locked)
  send(res, 200, entry)
})

route('GET', /^\/api\/v1\/earnings$/, (req, res) => {
  const user = userOf(req)
  if (!user) return fail(res, 401, 'unauthenticated', 'Sign in first.')
  send(res, 200, earningsSummary(user.id))
})

route('GET', /^\/api\/v1\/notifications$/, (req, res) => {
  const user = userOf(req)
  if (!user) return send(res, 200, [])
  send(res, 200, db.notifications.get(user.id) ?? [])
})

route('POST', /^\/api\/v1\/notifications\/read$/, async (req, res) => {
  const user = userOf(req)
  if (!user) return send(res, 204)
  const input = await body(req)
  const list = db.notifications.get(user.id) ?? []
  for (const n of list) {
    if (!input.ids?.length || input.ids.includes(n.id)) n.readAt = Date.now()
  }
  send(res, 204)
})

route('GET', /^\/api\/v1\/account-controls$/, (req, res) => {
  const user = userOf(req)
  const profile = user ? profileOf(user.id) : null
  send(res, 200, {
    strikes: profile?.strikes ?? 0,
    disputeUsed: profile?.disputeUsed ?? false,
    suspended: false,
  })
})

route('POST', /^\/api\/v1\/questions\/resolve$/, async (req, res) => {
  const input = await body(req)
  const question = String(input.question ?? '').toLowerCase()
  const requested = input.requestedDocuments ?? 5
  const filters = input.filters ?? {}

  let pool = DOCUMENTS
  if (filters.field) pool = pool.filter((d) => d.category === filters.field)
  if (filters.maxUnitPriceKrw) pool = pool.filter((d) => d.priceKrw <= filters.maxUnitPriceKrw)

  const wantsHit = HIT_TERMS.some((term) => question.includes(term))
  const matches = wantsHit
    ? pool.slice(0, requested).map((d, i) => ({
        handle: d.handle,
        shelfId: `${d.shelfId}_${i}`,
        shelf: d.shelf,
        category: d.category,
        priceKrw: d.priceKrw,
        score: Math.round((0.93 - i * 0.06) * 100) / 100,
        scoreBreakdown: {
          relevance: 0.9 - i * 0.05,
          termCoverage: 0.82 - i * 0.04,
          trust: 0.77,
          freshness: 0.71,
          authority: 0.64,
        },
        demographics: d.demographics,
      }))
    : []

  const queryId = `q_${randomUUID().slice(0, 8)}`
  const token = randomUUID()
  db.queries.set(queryId, { token, matches, settled: new Set() })

  if (matches.length) {
    return send(res, 200, {
      queryId,
      paymentAccessToken: token,
      decision: 'hit',
      reason: 'coverage_ready',
      liquidityState: 'human_covered',
      aiBaselineEligible: false,
      requestedDocuments: requested,
      candidateCount: pool.length,
      matches,
      quote: {
        currency: 'KRW',
        documentCount: matches.length,
        totalPriceKrw: matches.reduce((n, m) => n + m.priceKrw, 0),
      },
    })
  }

  send(res, 200, {
    queryId,
    paymentAccessToken: token,
    decision: 'miss',
    reason: 'no_relevant_documents',
    liquidityState: 'ai_liquidity_only',
    aiBaselineEligible: false,
    requestedDocuments: requested,
    candidateCount: 0,
    matches: [],
    openCall: {
      question: input.question,
      targetAnswers: 5,
      existingMatches: 0,
      answersNeeded: 5,
      suggestedUnitPriceKrw: 1200,
      suggestedBudgetKrw: 6000,
    },
  })
})

route('POST', /^\/api\/v1\/questions\/([^/]+)\/ai-baseline$/, (req, res) => {
  send(res, 200, { status: 'unavailable', baseline: null })
})

route('GET', /^\/api\/v1\/questions\/([^/]+)\/payment-progress$/, (req, res, [queryId], url) => {
  const query = db.queries.get(queryId)
  if (!query) return fail(res, 404, 'not_found', 'No such query.')
  const documents = query.matches.map((m) => ({
    handle: m.handle,
    priceKrw: m.priceKrw,
    status: query.settled.has(m.handle) ? 'settled' : 'unpaid',
  }))
  const settled = documents.filter((d) => d.status === 'settled')
  send(res, 200, {
    queryId,
    payer: url.searchParams.get('payer') ?? '',
    documentCount: documents.length,
    settledCount: settled.length,
    unpaidCount: documents.length - settled.length,
    totalPriceKrw: documents.reduce((n, d) => n + d.priceKrw, 0),
    settledPriceKrw: settled.reduce((n, d) => n + d.priceKrw, 0),
    documents,
  })
})

route('GET', /^\/api\/v1\/questions\/([^/]+)\/paid-documents\/([^/?]+)$/, (req, res, [queryId, handle]) => {
  const query = db.queries.get(queryId)
  const match = query?.matches.find((m) => m.handle === decodeURIComponent(handle))
  if (!match) return fail(res, 404, 'not_found', 'That handle was not quoted here.')
  const doc = DOCUMENTS.find((d) => d.handle === match.handle)
  send(res, 200, {
    citation: {
      handle: match.handle,
      shelf: match.shelf,
      excerpt: doc?.excerpt ?? '',
      price: match.priceKrw,
    },
    settlement: {
      id: `st_${randomUUID().slice(0, 8)}`,
      quoteId: `qt_${randomUUID().slice(0, 8)}`,
      transactionSignature: 'SANDBOX_LEDGER_NO_CHAIN_TRANSFER',
      payer: 'sandbox',
      payTo: 'sandbox',
      amountAtomic: String(match.priceKrw * 1000),
      network: 'sandbox',
      confirmedAt: Date.now(),
    },
  })
})

/**
 * The sandbox-ledger open. This is the endpoint that actually unseals passages,
 * so a quote is only released for handles this query quoted — the same rule the
 * Rust service enforces, minus the chain settlement it replaces.
 */
route('GET', /^\/api\/flash-research$/, (req, res, _params, url) => {
  const queryId = url.searchParams.get('queryId') ?? ''
  const wanted = (url.searchParams.get('docs') ?? '').split(',').filter(Boolean)
  const query = db.queries.get(queryId)
  if (!query) return fail(res, 404, 'unknown_query', 'That query id was never quoted here.')

  const citations = []
  for (const handle of wanted) {
    const match = query.matches.find((m) => m.handle === handle)
    if (!match) continue
    query.settled.add(handle)
    const doc = DOCUMENTS.find((d) => d.handle === handle)
    citations.push({
      handle,
      shelf: match.shelf,
      excerpt: doc?.excerpt ?? '',
      price: match.priceKrw,
      demographics: match.demographics,
    })
  }
  if (!citations.length) {
    return fail(res, 400, 'no_quoted_handles', 'None of those handles were quoted under this query.')
  }

  send(res, 200, {
    citations,
    settlement: {
      count: citations.length,
      total: citations.reduce((n, c) => n + c.price, 0),
      network: 'sandbox',
      mode: 'direct',
    },
  })
})

route('POST', /^\/api\/v1\/answers\/synthesize$/, async (req, res) => {
  const input = await body(req)
  const handles = input.handles ?? []
  send(res, 200, {
    answer: '',
    confidence: 0,
    consensus: [],
    disagreements: [],
    usedHandles: handles,
    contributions: handles.map((h) => ({ handle: h, score: 0.8, reason: 'quoted under this query' })),
    model: 'none',
    mode: 'evidence_only_fallback',
  })
})

route('GET', /^\/api\/v1\/shelf-starters$/, (req, res) => send(res, 200, []))
route('POST', /^\/api\/v1\/shelf-starters$/, (req, res) =>
  send(res, 200, { status: 'unavailable', starters: [] }))
route('GET', /^\/api\/v1\/admin\/disputes$/, (req, res) => send(res, 200, db.disputes))
route('GET', /^\/api\/v1\/admin\/document-feedback$/, (req, res) => send(res, 200, db.feedback))
route('GET', /^\/api\/v1\/prepaid\/balance$/, (req, res) =>
  fail(res, 404, 'no_prepaid_session', 'No prepaid session on this account.'))
route('GET', /^\/healthz$/, (req, res) => send(res, 200, { ok: true }))

// ------------------------------------------------------------------ server

const server = createServer(async (req, res) => {
  const url = new URL(req.url, `http://127.0.0.1:${PORT}`)
  for (const { method, pattern, handler } of routes) {
    if (req.method !== method) continue
    const match = pattern.exec(url.pathname)
    if (!match) continue
    try {
      await handler(req, res, match.slice(1), url)
    } catch (error) {
      console.error('[mock]', url.pathname, error)
      if (!res.headersSent) fail(res, 500, 'mock_error', String(error))
    }
    return
  }
  // Loud, because a silent 404 here looks exactly like a product bug when you
  // are watching the recording rather than the log.
  console.warn(`[mock] unmatched ${req.method} ${url.pathname}`)
  fail(res, 404, 'not_found', `No mock route for ${req.method} ${url.pathname}`)
})

server.listen(PORT, '127.0.0.1', () => {
  console.log(`[mock] listening on http://127.0.0.1:${PORT}`)
  console.log(`[mock] ${db.orders.length} open calls seeded across ${CATEGORIES.length} fields`)
  console.log(`[mock] ${DOCUMENTS.length} documents seeded`)
})
