#!/usr/bin/env node
/**
 * Seed the live Obolus staging backend with realistic demo data — accounts,
 * open calls (설문), and cross-answers — using ONLY the public HTTP API that
 * src/lib/api.ts already talks to. No direct DB access.
 *
 * Auth is wallet-only on this backend (email/password register is 404), so
 * this script generates throwaway Solana Ed25519 keypairs, walks the
 * challenge/verify flow the same way src/pages/Login.tsx does
 * (createWalletAuthChallenge -> sign the exact message bytes -> verifyWalletAuth),
 * and persists the resulting HttpOnly session cookie per account manually
 * (Node's fetch does not jar cookies across requests).
 *
 * Safe to re-run: every account/call/answer is wrapped so one rejection
 * (targeting mismatch, already answered, quality gate, etc.) never aborts
 * the run — it is logged and tallied, and the script moves on. Existing
 * entries in scripts/.demo-accounts.json are preserved and merged by handle,
 * not overwritten, so re-running never loses previously-saved keypairs.
 *
 * KNOWN BLOCKER (verified live 2026-08-13): priced open-call creation
 * (POST /api/v1/open-calls with unitPrice > 0) is rejected on ANY Cloud Run
 * deployment of this backend, staging included, with "paid open-call
 * funding is disabled on this endpoint; fund the call through the x402
 * gateway". This is not a misconfiguration — backend/src/environment.rs
 * `managed_environment()` treats the string "staging" itself as a managed/
 * production-tier environment, so `production` is true and the default for
 * `OPENSHELF_ALLOW_DEMO_OPEN` (`!production`) is false; backend/src/api.rs
 * additionally panics at startup if that flag is ever forced true while
 * `production` is true. So the KRW_SANDBOX direct-price open-call path this
 * script targets structurally cannot be enabled on a hosted staging (or
 * prod) instance — only locally. The only other path, x402/Devnet funding
 * via /api/v1/open-call-funding-quotes, is explicitly out of scope for this
 * script (real on-chain funding). Account + profile creation below is
 * unaffected and completes fully; open-call/answer creation will log this
 * exact skip message and post nothing until that invariant changes.
 *
 * Usage:
 *   node scripts/seed-demo-live.mjs
 *
 * Env:
 *   OBOLUS_API_BASE   Override the target backend (default: live staging).
 */

import { writeFileSync, readFileSync, existsSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import path from 'node:path'
import { Keypair } from '@solana/web3.js'
import { ed25519 } from '@noble/curves/ed25519'
import bs58 from 'bs58'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const BASE = process.env.OBOLUS_API_BASE ?? 'https://obolus-api-amjeodet3q-du.a.run.app'
const ACCOUNTS_OUT = path.join(__dirname, '.demo-accounts.json')

// Mirrors backend/src/store.rs CATEGORY_IDS / AGE_BANDS / REGIONS / HOUSEHOLDS / YEAR_BANDS.
const AGE_BANDS = ['under-25', '25-34', '35-44', '45-54', '55-plus']
const REGIONS = ['seoul', 'gyeonggi', 'metro', 'town', 'abroad']
const HOUSEHOLDS = ['alone', 'partner', 'kids', 'parents', 'shared']
const YEAR_BANDS = ['under-1', '1-3', '3-7', '7-plus']

// Mirrors src/lib/avatar.ts.
const AVATAR_LAYERS = [
  'face', 'nose', 'mouth', 'eyes', 'eyebrows', 'glasses', 'hair', 'accessories', 'details', 'beard',
]
const AVATAR_PART_COUNTS = {
  face: 16, nose: 14, mouth: 20, eyes: 14, eyebrows: 16,
  glasses: 15, hair: 59, accessories: 15, details: 14, beard: 17,
}
const AVATAR_BACKGROUNDS = [
  '#F4F4EF', '#FDE7C8', '#FBD4D4', '#E4E1FB', '#DCEEFB', '#DCEFE3', '#FBE7F3', '#F0E6D6',
]

function rand(n) {
  return Math.floor(Math.random() * n)
}
function pick(arr) {
  return arr[rand(arr.length)]
}
function shuffle(arr) {
  const copy = [...arr]
  for (let i = copy.length - 1; i > 0; i--) {
    const j = rand(i + 1)
    ;[copy[i], copy[j]] = [copy[j], copy[i]]
  }
  return copy
}
function randomAvatar() {
  const avatar = { bg: pick(AVATAR_BACKGROUNDS) }
  for (const layer of AVATAR_LAYERS) avatar[layer] = rand(AVATAR_PART_COUNTS[layer])
  return avatar
}
function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

// ---------------------------------------------------------------------------
// HTTP client: fetch() does not jar cookies, so each account gets its own
// Client holding the HttpOnly session cookie captured from Set-Cookie.
// ---------------------------------------------------------------------------

class Client {
  constructor(base) {
    this.base = base
    this.cookies = new Map()
  }

  cookieHeader() {
    return [...this.cookies.entries()].map(([name, value]) => `${name}=${value}`).join('; ')
  }

  captureCookies(res) {
    const setCookies = typeof res.headers.getSetCookie === 'function' ? res.headers.getSetCookie() : []
    for (const raw of setCookies) {
      const pair = raw.split(';', 1)[0]
      const eq = pair.indexOf('=')
      if (eq === -1) continue
      const name = pair.slice(0, eq).trim()
      const value = pair.slice(eq + 1).trim()
      if (value === '') this.cookies.delete(name)
      else this.cookies.set(name, value)
    }
  }

  async request(method, urlPath, body, extraHeaders = {}) {
    const headers = { ...extraHeaders }
    const init = { method, headers }
    if (body !== undefined) {
      headers['content-type'] = 'application/json'
      init.body = JSON.stringify(body)
    }
    const cookie = this.cookieHeader()
    if (cookie) headers['cookie'] = cookie

    let res
    try {
      res = await fetch(`${this.base}${urlPath}`, init)
    } catch (networkError) {
      throw new Error(`network error calling ${method} ${urlPath}: ${networkError.message}`)
    }
    this.captureCookies(res)
    const text = await res.text()
    let json = null
    if (text) {
      try {
        json = JSON.parse(text)
      } catch {
        json = text
      }
    }
    if (!res.ok) {
      const message = (json && json.error && json.error.message) || `HTTP ${res.status} on ${method} ${urlPath}`
      const error = new Error(message)
      error.status = res.status
      error.code = json && json.error && json.error.code
      throw error
    }
    return json
  }

  get(p, h) {
    return this.request('GET', p, undefined, h)
  }
  post(p, body, h) {
    return this.request('POST', p, body ?? {}, h)
  }
}

// ---------------------------------------------------------------------------
// Wallet auth — matches src/pages/Login.tsx: sign the raw UTF-8 bytes of the
// server-issued challenge message with Ed25519, base58-encode the signature.
// ---------------------------------------------------------------------------

function generateWallet() {
  const keypair = Keypair.generate()
  const seed = keypair.secretKey.slice(0, 32) // @noble/curves wants the 32-byte seed.
  return {
    pubkey: keypair.publicKey.toBase58(),
    seed,
    secretKeyBase58: bs58.encode(keypair.secretKey),
  }
}

function signChallenge(seed, message) {
  const bytes = new TextEncoder().encode(message)
  const signature = ed25519.sign(bytes, seed)
  return bs58.encode(signature)
}

async function walletSignIn(client, wallet, seed) {
  const challenge = await client.post('/api/v1/auth/wallet/challenge', { wallet })
  const signature = signChallenge(seed, challenge.message)
  return client.post('/api/v1/auth/wallet/verify', {
    wallet,
    challengeId: challenge.id,
    signature,
    ageConfirmed14: true,
  })
}

// ---------------------------------------------------------------------------
// Tally + safe-call wrapper so one rejected item never aborts the run.
// ---------------------------------------------------------------------------

const tally = {
  accountsOk: 0,
  accountsFail: 0,
  callsOk: 0,
  callsFail: 0,
  answersOk: 0,
  answersVoided: 0,
  answersFail: 0,
  earningsKrw: 0,
}

async function safe(label, fn) {
  try {
    return await fn()
  } catch (error) {
    console.warn(`  [skip] ${label}: ${error.message}`)
    return null
  }
}

// ---------------------------------------------------------------------------
// Demo dataset — 10 contributor/asker accounts, 8 categories, 13 open calls.
// ---------------------------------------------------------------------------

const ACCOUNT_DEFS = [
  { handle: 'SEONGSU_51', field: 'life', speaksTo: ['life', 'family', 'education'], ageBand: '25-34', region: 'seoul', household: 'alone', years: '1-3' },
  { handle: 'MAPO_29', field: 'business', speaksTo: ['business', 'money', 'life'], ageBand: '35-44', region: 'seoul', household: 'partner', years: '3-7' },
  { handle: 'YEONNAM_46', field: 'engineering', speaksTo: ['engineering', 'education', 'life'], ageBand: '25-34', region: 'seoul', household: 'shared', years: '1-3' },
  { handle: 'HAEUNDAE_63', field: 'travel', speaksTo: ['travel', 'health', 'life'], ageBand: '25-34', region: 'metro', household: 'alone', years: 'under-1' },
  { handle: 'SONGDO_88', field: 'engineering', speaksTo: ['engineering', 'life', 'business'], ageBand: '35-44', region: 'gyeonggi', household: 'kids', years: '7-plus' },
  { handle: 'PANGYO_34', field: 'business', speaksTo: ['business', 'engineering', 'money'], ageBand: '35-44', region: 'gyeonggi', household: 'partner', years: '3-7' },
  { handle: 'ILSAN_64', field: 'family', speaksTo: ['family', 'education', 'health'], ageBand: '35-44', region: 'gyeonggi', household: 'kids', years: '7-plus' },
  { handle: 'JAMSIL_33', field: 'health', speaksTo: ['health', 'money', 'family'], ageBand: '45-54', region: 'seoul', household: 'parents', years: '7-plus' },
  { handle: 'SUYU_88', field: 'life', speaksTo: ['life', 'travel', 'engineering'], ageBand: 'under-25', region: 'seoul', household: 'shared', years: 'under-1' },
  { handle: 'BUNDANG_15', field: 'family', speaksTo: ['family', 'health', 'travel'], ageBand: '45-54', region: 'gyeonggi', household: 'kids', years: '7-plus' },
]

const CALL_DEFS = [
  { asker: 'SUYU_88', category: 'life', shelf: '성수동 자취 3년차', unitPrice: 350, target: 6, fill: 'full', question: '성수동에서 원룸 자취하는데 관리비랑 생활비 아끼는 실제 방법이 궁금해요. 다들 한 달에 얼마 정도로 사시나요?' },
  { asker: 'SEONGSU_51', category: 'life', shelf: '자취 이사 실비용', unitPrice: 700, target: 6, fill: 'partial', question: '포장이사 견적 실제로 받아보신 분, 원룸 기준으로 얼마 나왔는지 알려주실 수 있나요?' },
  { asker: 'PANGYO_34', category: 'business', shelf: '카페 운영 원가 구조', unitPrice: 900, target: 6, fill: 'partial', question: '카페나 소규모 매장 운영하시는 분, 임대료 대비 인건비 비중을 실제로 어느 정도로 잡고 계신가요?' },
  { asker: 'MAPO_29', category: 'business', shelf: '쇼핑몰 초기 마케팅비', unitPrice: 1200, target: 5, fill: 'partial', question: '온라인 쇼핑몰 초기 창업하신 분, 첫 6개월 동안 마케팅비로 실제 얼마나 쓰셨는지 궁금합니다.' },
  { asker: 'SONGDO_88', category: 'engineering', shelf: '백엔드 이직 연봉 협상', unitPrice: 1000, target: 5, fill: 'full', question: '스타트업 백엔드 개발자로 이직 준비 중인데, 실제로 연봉 협상해보신 분 경험 나눠주실 수 있나요?' },
  { asker: 'YEONNAM_46', category: 'engineering', shelf: '재택 개발 집중 시간', unitPrice: 550, target: 10, fill: 'partial', question: '재택근무로 개발하시는 분들, 실제로 하루에 몇 시간 정도 집중해서 일하시나요?' },
  { asker: 'ILSAN_64', category: 'family', shelf: '초등 입학 준비 비용', unitPrice: 450, target: 9, fill: 'partial', question: '초등학교 입학 앞둔 아이 키우시는 분, 준비물이랑 가방까지 실제로 얼마 드셨는지 궁금해요.' },
  { asker: 'BUNDANG_15', category: 'family', shelf: '육아휴직 복직 적응기', unitPrice: 750, target: 6, fill: 'partial', question: '육아휴직 실제로 써보신 분, 복직하고 나서 적응하는 데 얼마나 걸리셨나요?' },
  { asker: 'HAEUNDAE_63', category: 'travel', shelf: '제주 한달살기 생활비', unitPrice: 600, target: 8, fill: 'partial', question: '제주도 한달살기 해보신 분, 숙소 빼고 한 달 생활비로 실제 얼마 쓰셨나요?' },
  { asker: 'JAMSIL_33', category: 'health', shelf: '직장인 헬스 3개월', unitPrice: 300, target: 5, fill: 'full', question: '직장인 헬스 3개월 이상 꾸준히 하신 분, 실제로 체감되는 변화가 언제부터 오던가요?' },
  { asker: 'HAEUNDAE_63', category: 'health', shelf: '불면증 치료 경험', unitPrice: 950, target: 6, fill: 'none', question: '불면증으로 병원 다녀보신 분, 실제 치료 과정이랑 비용이 어느 정도였는지 궁금합니다.' },
  { asker: 'ILSAN_64', category: 'education', shelf: '중학생 학원 스케줄', unitPrice: 500, target: 7, fill: 'none', question: '중학생 자녀 학원 스케줄 짜보신 부모님, 일주일에 몇 개 정도가 실제로 적당하던가요?' },
  { asker: 'JAMSIL_33', category: 'money', shelf: '예적금 대신 CMA', unitPrice: 800, target: 6, fill: 'partial', question: '적금 대신 예금이나 CMA로 실제로 굴려보신 분, 체감 수익률 차이가 궁금해요.' },
]

// Category-flavoured answer fragments. Each is a function so callers get
// fresh, differently-parameterised numbers on every call (near-duplicate
// detection only compares an author against their OWN prior answers, so
// variety here is for realism, not correctness).
const ANSWER_FRAGMENTS = {
  life: () => [
    `저도 원룸 자취 ${pick(['2', '3', '4'])}년 차인데, 관리비는 계절 따라 차이가 커서 여름엔 ${pick(['6', '7', '8'])}만원, 겨울엔 ${pick(['9', '10', '12'])}만원까지 나왔습니다.`,
    `가장 크게 줄인 건 인터넷이랑 TV를 결합 상품으로 바꾼 거고, 그 이후로 매달 ${pick(['1', '1.5', '2'])}만원 정도 절약됐어요.`,
    `포장이사는 원룸 기준으로 ${pick(['35', '42', '48', '55'])}만원 정도 받았고, 성수기인 ${pick(['3월', '11월'])}에는 여기서 ${pick(['10', '15'])}만원 정도 더 붙더라고요.`,
  ],
  business: () => [
    `저희 매장은 임대료가 매출의 ${pick(['12', '15', '18'])}%, 인건비가 ${pick(['28', '32', '35'])}% 정도로 잡고 있습니다.`,
    `초반 ${pick(['6', '8'])}개월은 마케팅비로 월 ${pick(['80', '100', '150'])}만원 정도 썼고, 그중 절반은 인스타그램 광고였어요.`,
    `직원 ${pick(['2', '3', '4'])}명 기준으로 4대보험까지 포함하면 인건비가 생각보다 ${pick(['20', '25'])}% 정도 더 나가더라고요.`,
  ],
  engineering: () => [
    `이직할 때 연봉 협상으로 처음 제시받은 금액에서 ${pick(['8', '10', '12'])}% 정도 더 올려 받았습니다.`,
    `재택근무 기준으로 하루에 순수 집중 시간은 ${pick(['4', '5', '6'])}시간 정도고, 나머지는 미팅이나 코드 리뷰로 나갑니다.`,
    `사이드 프로젝트까지 합치면 주말에도 ${pick(['2', '3'])}시간씩 코드를 보는데, 번아웃 안 오려고 ${pick(['금요일', '일요일'])} 저녁은 무조건 쉽니다.`,
  ],
  family: () => [
    `초등 입학 준비하면서 책가방이랑 실내화, 준비물까지 다 합쳐서 ${pick(['25', '32', '40'])}만원 정도 들었습니다.`,
    `육아휴직 ${pick(['6', '9', '12'])}개월 쓰고 복직했는데, 적응하는 데 체감상 ${pick(['한 달', '두 달', '세 달'])} 정도 걸렸어요.`,
    `방과후 학원은 주 ${pick(['2', '3', '4'])}개 정도가 아이도 안 지치고 저희도 부담이 덜하더라고요.`,
  ],
  travel: () => [
    `제주 한달살기 할 때 숙소 빼고 생활비로 한 달에 ${pick(['90', '110', '130'])}만원 정도 썼습니다.`,
    `렌트카는 한 달 기준 ${pick(['35', '45'])}만원이었고, 여기에 기름값이 매주 ${pick(['3', '4'])}만원씩 추가로 들었어요.`,
    `장보기는 동네 마트보다 ${pick(['오일장', '이마트'])}가 확실히 싸서 일주일에 한 번씩 몰아서 갔습니다.`,
  ],
  health: () => [
    `헬스 시작하고 체감되는 변화는 ${pick(['6주', '2개월', '3개월'])} 정도 지나서부터 왔던 것 같아요. 그전까진 체중계 숫자만 보고 실망했습니다.`,
    `불면증으로 병원 다니면서 초진에 ${pick(['3', '5', '8'])}만원, 이후 진료는 매번 ${pick(['1.5', '2'])}만원 정도 들었습니다.`,
    `주 ${pick(['3', '4', '5'])}회 운동으로 바꾸고 나서 수면의 질이 확실히 좋아졌다고 느꼈어요.`,
  ],
  education: () => [
    `저희 아이는 학원을 주 ${pick(['2', '3'])}개로 줄였는데, 오히려 성적이 더 안정적으로 나왔습니다.`,
    `학원비는 과목당 월 ${pick(['18', '22', '28'])}만원 정도라서 3과목이면 ${pick(['60', '70', '80'])}만원 가까이 나가요.`,
    `방학 특강까지 포함하면 한 학기에 ${pick(['15', '20'])}만원 정도 더 추가로 든다고 보시면 됩니다.`,
  ],
  money: () => [
    `예금 대신 CMA로 옮기고 나서 체감 수익률이 연 ${pick(['0.5', '0.8', '1.2'])}% 정도 더 높았습니다.`,
    `적금은 만기 전에 깨면 이자가 거의 없다시피 해서, 지금은 여유자금의 ${pick(['30', '40'])}% 정도만 적금으로 두고 있어요.`,
    `증권사 CMA는 하루만 넣어도 이자가 붙어서 비상금 ${pick(['200', '300'])}만원 정도는 항상 여기 넣어둡니다.`,
  ],
}

function answerFor(category) {
  const fragments = ANSWER_FRAGMENTS[category]()
  return shuffle(fragments).join(' ')
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

async function main() {
  console.log(`Seeding ${BASE}`)
  const accounts = new Map() // handle -> { client, pubkey, secretKeyBase58, def }

  for (const def of ACCOUNT_DEFS) {
    const created = await safe(`create account ${def.handle}`, async () => {
      const wallet = generateWallet()
      const client = new Client(BASE)
      await walletSignIn(client, wallet.pubkey, wallet.seed)
      await client.post('/api/v1/profile', {
        handle: def.handle,
        ageBand: def.ageBand,
        region: def.region,
        household: def.household,
        field: def.field,
        years: def.years,
        speaksTo: def.speaksTo,
        wallet: wallet.pubkey, // own wallet — auto-verified since this identity signed in with it
        avatar: randomAvatar(),
        autoMatch: true,
        agents: false,
        browserAlerts: false,
        emailAlerts: false,
      })
      return { client, pubkey: wallet.pubkey, secretKeyBase58: wallet.secretKeyBase58, def }
    })
    if (created) {
      accounts.set(def.handle, created)
      tally.accountsOk += 1
      console.log(`  account  ${def.handle}  ${created.pubkey.slice(0, 8)}…`)
    } else {
      tally.accountsFail += 1
    }
    await sleep(120)
  }

  console.log(`\nAccounts ready: ${accounts.size}/${ACCOUNT_DEFS.length}`)

  const calls = [] // { id, def }
  for (const def of CALL_DEFS) {
    const asker = accounts.get(def.asker)
    if (!asker) {
      console.warn(`  [skip] call "${def.shelf}": asker ${def.asker} was not created`)
      tally.callsFail += 1
      continue
    }
    const order = await safe(`post call "${def.shelf}"`, () =>
      asker.client.post('/api/v1/open-calls', {
        question: def.question,
        unitPrice: def.unitPrice,
        target: def.target,
        shelf: def.shelf,
        category: def.category,
      }),
    )
    if (order) {
      calls.push({ id: order.id, def })
      tally.callsOk += 1
      console.log(`  call     [${def.category}] ${def.shelf}  ₩${def.unitPrice} x${def.target}`)
    } else {
      tally.callsFail += 1
    }
    await sleep(150)
  }

  console.log(`\nOpen calls posted: ${calls.length}/${CALL_DEFS.length}`)

  for (const call of calls) {
    const { def, id } = call
    const eligible = shuffle(
      [...accounts.entries()]
        .filter(([handle, account]) => handle !== def.asker && account.def.speaksTo.includes(def.category))
        .map(([handle]) => handle),
    )
    let answerCount
    if (def.fill === 'none') answerCount = 0
    else if (def.fill === 'full') answerCount = Math.min(eligible.length, def.target)
    else answerCount = Math.min(eligible.length, Math.max(1, Math.ceil(eligible.length * 0.5)))

    const chosen = eligible.slice(0, answerCount)
    let filled = 0
    for (const handle of chosen) {
      const account = accounts.get(handle)
      const answerText = answerFor(def.category)
      const result = await safe(`answer "${def.shelf}" as ${handle}`, () =>
        account.client.post(`/api/v1/open-calls/${encodeURIComponent(id)}/answers`, {
          answer: answerText,
          interviewResponses: [],
        }),
      )
      if (result) {
        if (result.issues && result.issues.length > 0) {
          tally.answersVoided += 1
          console.log(`  answer   ${handle} -> "${def.shelf}"  voided (${result.issues[0].rule})`)
        } else {
          tally.answersOk += 1
          tally.earningsKrw += result.memory?.earned ?? 0
          filled += 1
          console.log(`  answer   ${handle} -> "${def.shelf}"  +₩${result.memory?.earned ?? 0}`)
        }
      } else {
        tally.answersFail += 1
      }
      await sleep(120)
    }
    console.log(`           progress: ${filled}/${def.target} accepted (of ${def.target} target, ${chosen.length} attempted)`)
  }

  // -------------------------------------------------------------------------
  // Save throwaway keypairs so the founder can identify / re-key these
  // accounts later. Wallet-only auth means "logging in" as one of these
  // requires importing secretKeyBase58 into a Solana wallet (e.g. Phantom's
  // "Import Private Key") and re-running the same challenge/verify flow this
  // script used — there is no email/password fallback on this backend.
  // -------------------------------------------------------------------------
  const newAccountsOut = [...accounts.values()].map(({ def, pubkey, secretKeyBase58 }) => ({
    handle: def.handle,
    pubkey,
    secretKeyBase58,
    field: def.field,
    speaksTo: def.speaksTo,
  }))
  // Merge by handle instead of overwriting, so a re-run (e.g. after fixing a
  // handle collision) never discards keypairs a previous run already saved.
  let mergedAccounts = new Map(newAccountsOut.map((account) => [account.handle, account]))
  if (existsSync(ACCOUNTS_OUT)) {
    const previous = await safe('read existing scripts/.demo-accounts.json', async () => {
      const parsed = JSON.parse(readFileSync(ACCOUNTS_OUT, 'utf8'))
      return Array.isArray(parsed.accounts) ? parsed.accounts : []
    })
    for (const account of previous ?? []) {
      if (!mergedAccounts.has(account.handle)) mergedAccounts.set(account.handle, account)
    }
  }
  writeFileSync(
    ACCOUNTS_OUT,
    JSON.stringify(
      {
        note:
          'Throwaway staging identities for the LIVE Obolus staging backend. Wallet-only auth: ' +
          'to log in as one of these, import secretKeyBase58 into a Solana wallet (base58 64-byte ' +
          'secret key, e.g. Phantom "Import Private Key") and sign in with that wallet on the ' +
          'staging frontend. Never commit this file. The DB is wipeable; the founder approved ' +
          'this data.',
        backend: BASE,
        generatedAt: new Date().toISOString(),
        accounts: [...mergedAccounts.values()],
      },
      null,
      2,
    ),
  )

  console.log(`\nSaved account keypairs -> ${ACCOUNTS_OUT}`)
  console.log('\n=== Summary ===')
  console.log(`Accounts:  ${tally.accountsOk} created, ${tally.accountsFail} failed`)
  console.log(`Calls:     ${tally.callsOk} posted, ${tally.callsFail} failed`)
  console.log(
    `Answers:   ${tally.answersOk} accepted, ${tally.answersVoided} voided (quality gate), ${tally.answersFail} failed`,
  )
  console.log(`Earnings:  ₩${tally.earningsKrw.toLocaleString('en-US')} KRW_SANDBOX accrued across accepted answers`)
}

main().catch((error) => {
  console.error('Fatal error:', error)
  process.exitCode = 1
})
