#!/usr/bin/env node
/**
 * Fund real, Korean, x402-Devnet-paid open calls on the LIVE Obolus backend
 * for the 10 throwaway accounts scripts/seed-demo-live.mjs already created
 * (scripts/.demo-accounts.json), then cross-answer several of them so
 * earnings/memory/progress look real. Every escrow payment is a genuine
 * signed Solana Devnet USDC transfer, verified by the payment-gateway's
 * two-independent-RPC settlement reconciliation — this is NOT the
 * KRW_SANDBOX direct-price path (that path is structurally disabled on any
 * hosted deployment; see scripts/seed-demo-live.mjs's header comment).
 *
 * Flow per call, mirroring src/lib/x402.ts's fundOpenCall (browser) but with
 * a Node keypair signer instead of Phantom:
 *   1. POST /api/v1/open-call-funding-quotes (session-cookie authenticated)
 *   2. GET  {gateway}{quote.resourcePath} via @x402/fetch's
 *      wrapFetchWithPayment, which handles the 402 challenge, builds +
 *      signs the exact Devnet USDC transfer with our signer, and retries
 *      with the payment header.
 *   3. The gateway requires two independent finalized RPC views to agree
 *      before it reports settlement (docs/PAY-SH.md). That commonly takes
 *      1-3 minutes, and the *first* paid response often comes back as
 *      `settlement_reconciliation_pending` — expected, not a failure. We
 *      submit all payments first, then poll every pending quote together.
 *
 * KNOWN LIBRARY BUG WORKED AROUND: @x402/svm 2.20.0's ExactSvmScheme hard
 * codes a 20_000 compute-unit budget for the transferChecked+memo pair.
 * On this cluster that trips "Program Memo... failed: exceeded CUs meter"
 * during simulation (observed via a direct simulateTransaction probe against
 * the exact same instructions). Since the compute-budget instruction is part
 * of the transaction WE build and sign as the client, PatchedExactSvmScheme
 * below reimplements the scheme's createPaymentPayload 1:1 (same accounts,
 * same instruction order, so the facilitator's own parsing is unaffected)
 * with a 200_000 CU ceiling instead. This is a client-side-only change; nothing
 * about the deployed gateway/backend is touched.
 *
 * Usage:
 *   node scripts/seed-demo-live-x402.mjs
 *
 * Env:
 *   OBOLUS_API_BASE       Override the API origin (default: live production).
 *   OBOLUS_GATEWAY_BASE   Override the x402 gateway origin (default: live production).
 */

import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import path from 'node:path'
import { ed25519 } from '@noble/curves/ed25519'
import bs58 from 'bs58'
import {
  createKeyPairSignerFromBytes,
  createSolanaRpc,
  devnet,
  pipe,
  createTransactionMessage,
  setTransactionMessageFeePayer,
  prependTransactionMessageInstruction,
  appendTransactionMessageInstructions,
  setTransactionMessageLifetimeUsingBlockhash,
  partiallySignTransactionMessageWithSigners,
  getBase64EncodedWireTransaction,
} from '@solana/kit'
import { x402Client } from '@x402/core/client'
import { wrapFetchWithPayment } from '@x402/fetch'
import { decodePaymentResponseHeader } from '@x402/core/http'
import { getSetComputeUnitLimitInstruction, setTransactionMessageComputeUnitPrice } from '@solana-program/compute-budget'
import { getTransferCheckedInstruction, findAssociatedTokenPda, fetchMint } from '@solana-program/token-2022'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const API_BASE = process.env.OBOLUS_API_BASE ?? 'https://obolus-api-amjeodet3q-du.a.run.app'
const GATEWAY_BASE = process.env.OBOLUS_GATEWAY_BASE ?? 'https://obolus-gateway-amjeodet3q-du.a.run.app'
const DEVNET_NETWORK = 'solana:EtWTRABZaYq6iMfeYKouRu166VU2xqa1'
const DEVNET_RPC = 'https://api.devnet.solana.com'
const ACCOUNTS_FILE = path.join(__dirname, '.demo-accounts.json')

function shuffle(arr) {
  const copy = [...arr]
  for (let i = copy.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1))
    ;[copy[i], copy[j]] = [copy[j], copy[i]]
  }
  return copy
}
function pick(arr) {
  return arr[Math.floor(Math.random() * arr.length)]
}
function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

// ---------------------------------------------------------------------------
// HTTP client with a manual per-account cookie jar (fetch does not jar).
// ---------------------------------------------------------------------------

class Client {
  constructor(base) {
    this.base = base
    this.cookies = new Map()
  }
  cookieHeader() {
    return [...this.cookies.entries()].map(([n, v]) => `${n}=${v}`).join('; ')
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
  async request(method, urlPath, body) {
    const headers = {}
    const init = { method, headers }
    if (body !== undefined) {
      headers['content-type'] = 'application/json'
      init.body = JSON.stringify(body)
    }
    const cookie = this.cookieHeader()
    if (cookie) headers.cookie = cookie
    const res = await fetch(`${this.base}${urlPath}`, init)
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
      throw error
    }
    return json
  }
  get(p) {
    return this.request('GET', p)
  }
  post(p, body) {
    return this.request('POST', p, body ?? {})
  }
}

function signChallenge(seed, message) {
  return bs58.encode(ed25519.sign(new TextEncoder().encode(message), seed))
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
// x402 exact-SVM scheme, reimplemented with a realistic compute-unit budget.
// See header comment for why the upstream default fails simulation here.
// ---------------------------------------------------------------------------

const MEMO_PROGRAM_ADDRESS = 'MemoSq4gqABAXKb96qnH8TysNcWxMyWCqXgDLGmfcHr'
const PATCHED_COMPUTE_UNIT_LIMIT = 200_000

class PatchedExactSvmScheme {
  constructor(signer, config) {
    this.signer = signer
    this.config = config
    this.scheme = 'exact'
  }
  async createPaymentPayload(x402Version, paymentRequirements) {
    const rpc = createSolanaRpc(devnet(this.config?.rpcUrl ?? DEVNET_RPC))
    const mint = await fetchMint(rpc, paymentRequirements.asset)
    const tokenProgramAddress = mint.programAddress
    const [sourceATA] = await findAssociatedTokenPda({
      mint: paymentRequirements.asset,
      owner: this.signer.address,
      tokenProgram: tokenProgramAddress,
    })
    const [destinationATA] = await findAssociatedTokenPda({
      mint: paymentRequirements.asset,
      owner: paymentRequirements.payTo,
      tokenProgram: tokenProgramAddress,
    })
    const transferIx = getTransferCheckedInstruction(
      {
        source: sourceATA,
        mint: paymentRequirements.asset,
        destination: destinationATA,
        authority: this.signer,
        amount: BigInt(paymentRequirements.amount),
        decimals: mint.data.decimals,
      },
      { programAddress: tokenProgramAddress },
    )
    const feePayer = paymentRequirements.extra?.feePayer
    if (!feePayer) throw new Error('feePayer is required in paymentRequirements.extra for SVM transactions')
    const { value: latestBlockhash } = await rpc.getLatestBlockhash().send()
    const memoData = new TextEncoder().encode(paymentRequirements.extra?.memo ?? '')
    const memoIx = { programAddress: MEMO_PROGRAM_ADDRESS, accounts: [], data: memoData }
    const tx = pipe(
      createTransactionMessage({ version: 0 }),
      (m) => setTransactionMessageComputeUnitPrice(1, m),
      (m) => setTransactionMessageFeePayer(feePayer, m),
      (m) => prependTransactionMessageInstruction(getSetComputeUnitLimitInstruction({ units: PATCHED_COMPUTE_UNIT_LIMIT }), m),
      (m) => appendTransactionMessageInstructions([transferIx, memoIx], m),
      (m) => setTransactionMessageLifetimeUsingBlockhash(latestBlockhash, m),
    )
    const signedTransaction = await partiallySignTransactionMessageWithSigners(tx)
    return { x402Version, payload: { transaction: getBase64EncodedWireTransaction(signedTransaction) } }
  }
}

function pinQuotePolicy(quote) {
  const memo = `openshelf:v1:open_call:${quote.id}`
  return (_version, requirements) =>
    requirements.filter(
      (r) =>
        r.scheme === 'exact' &&
        r.network === quote.network &&
        r.asset === quote.asset &&
        r.amount === quote.amountAtomic &&
        r.payTo === quote.payTo &&
        r.extra?.memo === memo,
    )
}

// ---------------------------------------------------------------------------
// Tally + safe-call wrapper.
// ---------------------------------------------------------------------------

const tally = {
  callsSubmitted: 0,
  callsFunded: 0,
  callsFailed: 0,
  answersOk: 0,
  answersVoided: 0,
  answersFail: 0,
  earningsKrw: 0,
  txSignatures: [],
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
// Dataset — same 13 Korean calls as scripts/seed-demo-live.mjs's plan.
// ---------------------------------------------------------------------------

const ACCOUNT_HANDLES = [
  'SEONGSU_51', 'MAPO_29', 'YEONNAM_46', 'HAEUNDAE_63', 'SONGDO_88',
  'PANGYO_34', 'ILSAN_64', 'JAMSIL_33', 'SUYU_88', 'BUNDANG_15',
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

const ACCOUNT_SPEAKS_TO = {
  SEONGSU_51: ['life', 'family', 'education'],
  MAPO_29: ['business', 'money', 'life'],
  YEONNAM_46: ['engineering', 'education', 'life'],
  HAEUNDAE_63: ['travel', 'health', 'life'],
  SONGDO_88: ['engineering', 'life', 'business'],
  PANGYO_34: ['business', 'engineering', 'money'],
  ILSAN_64: ['family', 'education', 'health'],
  JAMSIL_33: ['health', 'money', 'family'],
  SUYU_88: ['life', 'travel', 'engineering'],
  BUNDANG_15: ['family', 'health', 'travel'],
}

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
  return shuffle(ANSWER_FRAGMENTS[category]()).join(' ')
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

async function main() {
  console.log(`Funding real Devnet x402 open calls on ${API_BASE} via gateway ${GATEWAY_BASE}`)

  const accountsFile = JSON.parse(readFileSync(ACCOUNTS_FILE, 'utf8'))
  const accounts = new Map()
  for (const handle of ACCOUNT_HANDLES) {
    const record = accountsFile.accounts.find((a) => a.handle === handle)
    if (!record) {
      console.warn(`  [skip] ${handle}: not found in ${ACCOUNTS_FILE}`)
      continue
    }
    const secretKey = bs58.decode(record.secretKeyBase58)
    const seed = secretKey.slice(0, 32)
    const client = new Client(API_BASE)
    const signedIn = await safe(`sign in ${handle}`, () => walletSignIn(client, record.pubkey, seed))
    if (!signedIn) continue
    const signer = await createKeyPairSignerFromBytes(secretKey)
    accounts.set(handle, { client, signer, pubkey: record.pubkey, speaksTo: ACCOUNT_SPEAKS_TO[handle] ?? [] })
    console.log(`  signed in ${handle}  ${record.pubkey.slice(0, 10)}…  balance=${signedIn.balance?.availableKrw}`)
  }
  console.log(`\nAccounts ready: ${accounts.size}/${ACCOUNT_HANDLES.length}`)

  // --- Phase 1: create quotes + submit x402 payments for all calls ---
  const pending = [] // { def, quoteId, askerHandle }
  for (const def of CALL_DEFS) {
    const asker = accounts.get(def.asker)
    if (!asker) {
      console.warn(`  [skip] call "${def.shelf}": asker ${def.asker} not signed in`)
      tally.callsFailed += 1
      continue
    }
    const outcome = await safe(`fund call "${def.shelf}"`, async () => {
      const quote = await asker.client.post('/api/v1/open-call-funding-quotes', {
        question: def.question,
        unitPrice: def.unitPrice,
        target: def.target,
        shelf: def.shelf,
        category: def.category,
      })
      const client = new x402Client()
      client.registerPolicy(pinQuotePolicy(quote))
      client.register(DEVNET_NETWORK, new PatchedExactSvmScheme(asker.signer, { rpcUrl: DEVNET_RPC }))
      const paidFetch = wrapFetchWithPayment(fetch, client)
      const resourceUrl = `${GATEWAY_BASE}${quote.resourcePath}`
      const response = await paidFetch(resourceUrl, { method: 'GET', headers: { accept: 'application/json' } })
      const paymentResponseHeader = response.headers.get('PAYMENT-RESPONSE') ?? response.headers.get('payment-response')
      let receipt = null
      if (paymentResponseHeader) {
        try {
          receipt = decodePaymentResponseHeader(paymentResponseHeader)
        } catch {
          // ignore decode failures; we still have the quote id to poll
        }
      }
      if (response.ok) {
        const body = await response.json().catch(() => null)
        return { status: 'funded', quoteId: quote.id, txSig: receipt?.transaction, body }
      }
      // A settlement_reconciliation_pending (or similar) 402/409 here is
      // expected — the payment was submitted and just needs the gateway's
      // two-RPC finality check to catch up. Anything else is a real failure.
      if (receipt && receipt.errorReason === 'settlement_reconciliation_pending') {
        return { status: 'pending', quoteId: quote.id }
      }
      const bodyText = await response.text().catch(() => '')
      throw new Error(`gateway returned ${response.status}: ${receipt?.errorMessage ?? bodyText.slice(0, 200)}`)
    })
    if (!outcome) {
      tally.callsFailed += 1
      continue
    }
    tally.callsSubmitted += 1
    if (outcome.status === 'funded') {
      tally.callsFunded += 1
      if (outcome.txSig) tally.txSignatures.push(outcome.txSig)
      console.log(`  funded immediately: [${def.category}] ${def.shelf}`)
    } else {
      pending.push({ def, quoteId: outcome.quoteId, asker })
      console.log(`  submitted, reconciling: [${def.category}] ${def.shelf} (quote ${outcome.quoteId})`)
    }
    await sleep(300)
  }

  // --- Phase 2: poll every pending quote together until funded or timeout ---
  const fundedCalls = [] // { def, openCallId }
  const deadline = Date.now() + 5 * 60 * 1000
  while (pending.length > 0 && Date.now() < deadline) {
    for (let i = pending.length - 1; i >= 0; i -= 1) {
      const { def, quoteId, asker } = pending[i]
      const reconciled = await safe(`poll quote for "${def.shelf}"`, () =>
        asker.client.get(`/api/v1/open-call-funding-quotes/${encodeURIComponent(quoteId)}`),
      )
      if (reconciled?.status === 'funded' && reconciled.openCallId) {
        console.log(`  FUNDED (reconciled): [${def.category}] ${def.shelf}`)
        tally.callsFunded += 1
        fundedCalls.push({ def, openCallId: reconciled.openCallId })
        pending.splice(i, 1)
      } else if (reconciled && !['quoted', 'settling'].includes(reconciled.status)) {
        console.warn(`  [skip] "${def.shelf}" left status ${reconciled.status} — treating as failed`)
        tally.callsFailed += 1
        pending.splice(i, 1)
      }
    }
    if (pending.length > 0) await sleep(6_000)
  }
  for (const { def } of pending) {
    console.warn(`  [timeout] "${def.shelf}" never reconciled within 5 minutes`)
    tally.callsFailed += 1
  }

  // Pull final open-call ids/state (includes calls funded immediately in phase 1).
  const allCalls = (await safe('list open calls', () => accounts.values().next().value.client.get('/api/v1/open-calls'))) ?? []
  const callsByShelf = new Map(allCalls.map((c) => [c.shelf, c]))
  for (const def of CALL_DEFS) {
    const call = callsByShelf.get(def.shelf)
    if (call && call.escrowMode === 'x402_solana_escrow' && !fundedCalls.some((f) => f.openCallId === call.id)) {
      fundedCalls.push({ def, openCallId: call.id })
      if (call.fundingTransactionSignature) tally.txSignatures.push(call.fundingTransactionSignature)
    }
  }

  console.log(`\nCalls funded: ${fundedCalls.length}/${CALL_DEFS.length}`)

  // --- Phase 3: cross-answer funded calls ---
  for (const { def, openCallId } of fundedCalls) {
    const eligible = shuffle(
      [...accounts.entries()].filter(([handle, acc]) => handle !== def.asker && acc.speaksTo.includes(def.category)).map(([handle]) => handle),
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
        account.client.post(`/api/v1/open-calls/${encodeURIComponent(openCallId)}/answers`, {
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
      await sleep(150)
    }
    console.log(`           progress: ${filled}/${def.target} accepted (${chosen.length} attempted)`)
  }

  console.log('\n=== Summary ===')
  console.log(`Calls:     ${tally.callsFunded} funded, ${tally.callsFailed} failed (of ${tally.callsSubmitted} submitted / ${CALL_DEFS.length} planned)`)
  console.log(`Answers:   ${tally.answersOk} accepted, ${tally.answersVoided} voided (quality gate), ${tally.answersFail} failed`)
  console.log(`Earnings:  ₩${tally.earningsKrw.toLocaleString('en-US')} KRW accrued (sandbox ledger credit on accepted answers)`)
  console.log(`Tx signatures (${tally.txSignatures.length}):`)
  for (const sig of tally.txSignatures) console.log(`  https://explorer.solana.com/tx/${sig}?cluster=devnet`)
}

main().catch((error) => {
  console.error('Fatal error:', error)
  process.exitCode = 1
})
