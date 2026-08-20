/**
 * Records one end-to-end pass through Obolus against the LIVE deployed app.
 *
 * Unlike `scripts/record-e2e.mjs`, this take starts NO mock backend and NO
 * local Vite. It drives the real Cloudflare Pages deployment
 * (https://obolus-9qi.pages.dev), which proxies `/api/*` to the live Cloud Run
 * backend and `/x402/*` to the live gateway. Everything the browser sees is the
 * production artifact.
 *
 * Wallet auth is real. The browser has no Phantom extension, so a provider is
 * injected before any page script runs — but its `signMessage` produces a
 * genuine Ed25519 signature. The private key never enters the page: signing is
 * delegated to Node through `page.exposeFunction('__nodeSignMessage', …)`, and
 * only the 64-byte signature crosses back. The app's own Login.tsx makes the
 * `/auth/wallet/challenge` → sign → `/auth/wallet/verify` calls, so the
 * HttpOnly `openshelf_session` cookie is set by the real backend on the real
 * origin exactly as it is for a human.
 *
 * Before recording, a facilitator-attested prepaid deposit is posted for the
 * generated wallet (internal-token gated) so the app's balances render. That is
 * off-chain prepaid credit; no real USDC transfer or SOL gas is involved.
 *
 * On-chain caveat: a real x402 top-up / USDC settlement needs a signed Solana
 * TRANSACTION plus SOL gas, which the injected message-only signer cannot
 * produce. Any step that would trigger one is soft-handled (skipped and logged)
 * rather than failing the whole take.
 *
 * The private key and the internal token are NEVER printed.
 *
 *   Env:
 *     OBOLUS_INTERNAL_TOKEN   Secret Manager `obolus-internal-token` value.
 *                             Required to fund; without it the deposit is
 *                             skipped and balances render as zero.
 *     LIVE_BASE               Override the record target (default live Pages).
 *     API_BASE                Override the backend used for the Node-side
 *                             deposit (default live Cloud Run).
 *     HQ=0                    Record at 1x instead of 2x (default is 2x HQ).
 */

import { spawnSync } from 'node:child_process'
import { mkdirSync, readdirSync, rmSync } from 'node:fs'
import { chromium } from '@playwright/test'
import { Keypair } from '@solana/web3.js'
import { ed25519 } from '@noble/curves/ed25519'

const LIVE_BASE = (process.env.LIVE_BASE ?? 'https://obolus-9qi.pages.dev').replace(/\/$/, '')
const API_BASE = (process.env.API_BASE ?? 'https://obolus-api-amjeodet3q-du.a.run.app').replace(/\/$/, '')
const ROOT = new URL('..', import.meta.url).pathname
const OUT = `${ROOT}scripts/.e2e-video/`

// Deposit policy — must match the live backend's configured bundle receiver,
// network, and asset (Product Decision (e) rejects anything else).
const DEPOSIT = {
  payTo: 'Ep6grip9Q4JC2nsPCdcMB9hBM1RnwctxgSfW3YtNAcNV',
  network: 'solana:EtWTRABZaYq6iMfeYKouRu166VU2xqa1',
  asset: '4zMMC9srt5Ri5X14GAgXhaHii3GnPAEERYPJgZJDncDU',
  amountAtomic: '50000000', // 50 Devnet USDC (6 decimals)
}

/** `HQ` (default on) records at 2x device pixels and encodes it harder. */
const HQ = process.env.HQ !== '0'
const WIDTH = 1440
const HEIGHT = 900
const SCALE = HQ ? 2 : 1
const CRF = HQ ? '17' : '20'
const PRESET = HQ ? 'slower' : 'slow'
const NAME = HQ ? 'obolus-e2e-hq' : 'obolus-e2e'

mkdirSync(OUT, { recursive: true })
for (const file of readdirSync(OUT)) {
  if (file.endsWith('.webm') || file === `${NAME}.mp4`) {
    rmSync(`${OUT}${file}`, { force: true })
  }
}

// --------------------------------------------------------------------------
// Keypair (private key stays in this Node process, never printed, never
// written to disk) + the real Ed25519 signer the browser delegates to.
// --------------------------------------------------------------------------
const keypair = Keypair.generate()
const PUBKEY = keypair.publicKey.toBase58()
const SEED = keypair.secretKey.slice(0, 32) // @noble/curves wants the 32-byte seed
const PUB8 = PUBKEY.slice(0, 8)

/** Signs raw message bytes in Node and returns the 64-byte signature. */
function nodeSignMessage(byteArray) {
  const message = Uint8Array.from(byteArray)
  const signature = ed25519.sign(message, SEED)
  return Array.from(signature) // JSON-serializable across the exposeFunction boundary
}

// --------------------------------------------------------------------------
// Fund the LIVE wallet with prepaid credit so balances render.
// --------------------------------------------------------------------------
async function fundWallet() {
  const token = process.env.OBOLUS_INTERNAL_TOKEN
  if (!token) {
    console.log('  [fund] OBOLUS_INTERNAL_TOKEN not set — skipping deposit (balances will be zero)')
    return { funded: false }
  }
  const body = {
    transactionSignature: `live-rec-${PUB8}-${Date.now()}`,
    payer: PUBKEY,
    payTo: DEPOSIT.payTo,
    network: DEPOSIT.network,
    asset: DEPOSIT.asset,
    amountAtomic: DEPOSIT.amountAtomic,
  }
  let res
  try {
    res = await fetch(`${API_BASE}/api/v1/prepaid/deposits`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-openshelf-internal-token': token },
      body: JSON.stringify(body),
    })
  } catch (e) {
    console.log(`  [fund] network error: ${e.message}`)
    return { funded: false }
  }
  const json = await res.json().catch(() => null)
  if (!res.ok) {
    console.log(`  [fund] deposit HTTP ${res.status}: ${json?.error?.message ?? '(no message)'}`)
    return { funded: false }
  }
  const atomic = json?.availableAtomic ?? json?.available_atomic ?? null
  const usdc = atomic != null ? (Number(atomic) / 1e6).toFixed(2) : '?'
  console.log(`  [fund] deposit OK. prepaid available: ${usdc} USDC (atomic ${atomic})`)
  return { funded: true, atomic }
}

// --------------------------------------------------------------------------
// Injected provider: connects and signs real messages, nothing more.
// --------------------------------------------------------------------------
const PHANTOM_PROVIDER = (pubkey) => {
  const listeners = {}
  const provider = {
    isPhantom: true,
    publicKey: null,
    isConnected: false,
    async connect(opts) {
      // A cold profile has not trusted this origin, so the silent reconnect
      // must fail exactly like the real extension's does.
      if (opts?.onlyIfTrusted && sessionStorage.getItem('__obolusTrusted') !== '1') {
        throw new Error('not trusted')
      }
      sessionStorage.setItem('__obolusTrusted', '1')
      provider.publicKey = { toString: () => pubkey }
      provider.isConnected = true
      return { publicKey: provider.publicKey }
    },
    async disconnect() {
      provider.publicKey = null
      provider.isConnected = false
      ;(listeners.disconnect ?? []).forEach((fn) => fn())
    },
    async signMessage(message /* Uint8Array */, _display) {
      // The private key lives in Node. Hand it the bytes, get back a real
      // Ed25519 signature, and return it in the shape Login.tsx expects
      // ({ signature: Uint8Array }); the app base58-encodes it itself.
      const bytes = Array.from(message)
      const sig = await window.__nodeSignMessage(bytes)
      return { signature: Uint8Array.from(sig) }
    },
    async signTransaction(_tx) {
      throw new Error('This live take signs messages only; no on-chain transaction is signed.')
    },
    on(event, handler) {
      ;(listeners[event] ??= []).push(handler)
    },
    removeListener(event, handler) {
      listeners[event] = (listeners[event] ?? []).filter((fn) => fn !== handler)
    },
  }
  window.phantom = { solana: provider }
  window.solana = provider
}

/** A caption strip so the recording explains itself without a voice-over. */
const CAPTION = () => {
  const mount = () => {
    const el = document.createElement('div')
    el.id = '__cap'
    el.style.cssText = [
      'position:fixed', 'left:0', 'right:0', 'bottom:0', 'z-index:2147483647',
      'font:500 20px/1.45 -apple-system,BlinkMacSystemFont,Segoe UI,sans-serif',
      'background:rgba(9,9,11,.94)', 'color:#fafafa', 'padding:16px 26px',
      'display:flex', 'gap:18px', 'align-items:baseline',
      'border-top:1px solid rgba(255,255,255,.14)', 'pointer-events:none',
      'transition:opacity .2s',
    ].join(';')
    el.innerHTML =
      '<span id="__capn" style="font:600 14px/1 ui-monospace,Menlo,monospace;letter-spacing:1.5px;color:#8266FF;flex:0 0 auto"></span>' +
      '<span id="__capt"></span>'
    document.body.appendChild(el)
    const kept = sessionStorage.getItem('__cap')
    if (kept) {
      const [n, ...rest] = kept.split(' ')
      el.querySelector('#__capn').textContent = n
      el.querySelector('#__capt').textContent = rest.join('')
    }
  }
  window.__cap = (n, text) => {
    if (!document.getElementById('__cap')) mount()
    sessionStorage.setItem('__cap', `${n} ${text}`)
    document.getElementById('__capn').textContent = n
    document.getElementById('__capt').textContent = text
  }
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', mount, { once: true })
  } else {
    mount()
  }
}

let stepNo = 0
async function step(page, text, ms = 1400) {
  stepNo += 1
  const n = String(stepNo).padStart(2, '0')
  console.log(`  ${n}  ${text}`)
  await page.evaluate(([n, text]) => window.__cap?.(n, text), [n, text]).catch(() => {})
  await page.waitForTimeout(ms)
}

/** Scroll the app's inner pane, which is what actually scrolls. */
async function glide(page, to, ms = 1200) {
  await page
    .evaluate(
      ([to, ms]) => {
        const pane = document.querySelector('div.overflow-y-auto') ?? document.scrollingElement
        const from = pane.scrollTop ?? 0
        const start = performance.now()
        return new Promise((done) => {
          const tick = (now) => {
            const t = Math.min(1, (now - start) / ms)
            const eased = t < 0.5 ? 2 * t * t : 1 - (-2 * t + 2) ** 2 / 2
            pane.scrollTop = from + (to - from) * eased
            if (t < 1) requestAnimationFrame(tick)
            else done()
          }
          requestAnimationFrame(tick)
        })
      },
      [to, ms],
    )
    .catch(() => {})
}

async function typeInto(locator, text, delay = 22) {
  await locator.click()
  await locator.type(text, { delay })
}

/** Click a visible label if present; never throws. */
async function softChoose(page, label, ms = 500) {
  try {
    const target = page.getByText(label, { exact: true }).first()
    if (await target.count()) {
      await target.click({ timeout: 6000 })
      await page.waitForTimeout(ms)
      return true
    }
  } catch (e) {
    console.log(`    [skip choose "${label}"] ${(e.message || '').split('\n')[0].slice(0, 70)}`)
  }
  return false
}

/** Click a locator if present; never throws. */
async function softClick(page, locator, ms = 800) {
  try {
    if (await locator.count()) {
      await locator.first().click({ timeout: 6000 })
      await page.waitForTimeout(ms)
      return true
    }
  } catch (e) {
    console.log(`    [skip click] ${(e.message || '').split('\n')[0].slice(0, 70)}`)
  }
  return false
}

/**
 * Navigate the way a person does — through the sidebar — but bounded and with a
 * fallback. Some routes (the full-screen answer flow) drop the sidebar, so a
 * sidebar click there would hang; the click is capped at 6s and, if it does not
 * land, the target URL is loaded directly so the pass never stalls.
 */
async function go(page, label, urlPath, expect) {
  try {
    const link = page.getByRole('link', { name: label, exact: true }).first()
    if (await link.count()) {
      await link.click({ timeout: 6000 })
      if (expect) await page.waitForURL(expect, { timeout: 10_000 }).catch(() => {})
      await page.waitForLoadState('networkidle').catch(() => {})
      await page.waitForTimeout(700)
      return true
    }
  } catch (e) {
    console.log(`    [nav sidebar miss "${label}"] ${(e.message || '').split('\n')[0].slice(0, 60)}`)
  }
  if (urlPath) {
    try {
      await page.goto(`${LIVE_BASE}${urlPath}`, { waitUntil: 'networkidle' })
      await page.waitForTimeout(800)
      return true
    } catch (e) {
      console.log(`    [nav goto fail "${label}"] ${(e.message || '').split('\n')[0].slice(0, 60)}`)
    }
  }
  console.log(`    [nav skip "${label}"]`)
  return false
}

/**
 * Walk the light warm-ups that sit in front of an open call's real question, if
 * the live answer flow shows them. Bounded and fully soft — it loops on what is
 * on screen and gives up quickly rather than assuming a fixed shape.
 */
async function warmups(page) {
  for (let i = 0; i < 6; i += 1) {
    if (await page.getByPlaceholder('Write it the way it happened.').count()) return
    const choices = page.locator('div.flex.flex-col.gap-2 > button')
    if (await choices.count()) {
      await choices.first().click({ timeout: 4000 }).catch(() => {})
      await page.waitForTimeout(500)
      continue
    }
    const scale = page.getByRole('button', { name: '4', exact: true })
    if (await scale.count()) {
      await scale.first().click({ timeout: 4000 }).catch(() => {})
      await page.waitForTimeout(500)
      continue
    }
    const advance = page.getByRole('button', { name: /^(next|skip)$/i }).first()
    if (!(await advance.count())) return
    await advance.click({ timeout: 4000 }).catch(() => {})
    await page.waitForTimeout(500)
  }
}

const result = { login: false, balance: null, reached: [], skipped: [] }

const run = async () => {
  const browser = await chromium.launch({
    args: [`--force-device-scale-factor=${SCALE}`, '--hide-scrollbars'],
  })
  const context = await browser.newContext({
    viewport: { width: WIDTH, height: HEIGHT },
    recordVideo: { dir: OUT, size: { width: WIDTH * SCALE, height: HEIGHT * SCALE } },
    deviceScaleFactor: SCALE,
    reducedMotion: 'no-preference',
  })
  // The real Ed25519 signer. Registered before any page navigates so the
  // injected provider can call it during the login signature.
  await context.exposeFunction('__nodeSignMessage', nodeSignMessage)
  await context.addInitScript(PHANTOM_PROVIDER, PUBKEY)
  await context.addInitScript(CAPTION)

  const page = await context.newPage()
  page.on('console', (m) => {
    if (m.type() === 'error') console.log('    [console]', m.text().slice(0, 160))
  })

  try {
    // ---------------------------------------------------------- 1. landing
    await page.goto(`${LIVE_BASE}/`, { waitUntil: 'networkidle' })
    await page.waitForTimeout(1300)
    result.reached.push('landing')
    await step(page, 'Live deployment. The whole thesis is one line: search people, not the web.', 1600)
    await glide(page, 1080)
    await step(page, 'A general model guesses. The people who lived it get paid, per answer.', 1800)
    await glide(page, 4360)
    await step(page, 'The server answers 402 with a price and the wallet pays it — no ₩12 approvals.', 1800)
    await glide(page, 0, 900)

    // ------------------------------------------------------------ 2. login
    await step(page, 'Sign in. There is no email or password — the wallet is the account.', 900)
    const entered = await softClick(page, page.getByRole('link', { name: /connect wallet|sign in/i }), 1000)
    if (!entered) await page.goto(`${LIVE_BASE}/login`, { waitUntil: 'networkidle' })
    await page.waitForURL('**/login', { timeout: 15_000 }).catch(() => {})
    await page.waitForTimeout(1200)
    await step(page, 'A generated Devnet wallet is injected. Connecting only reads its public address.', 1300)

    // Connect, then WAIT for the connected state before moving on. The age
    // confirmation and Enter button only render once `pubkey` is set, so their
    // presence is the reliable signal that connect actually succeeded — a single
    // fire-and-forget click can silently miss on a cold headless profile.
    const enterBtn = page.getByRole('button', { name: /^enter$/i })
    for (let attempt = 0; attempt < 4; attempt += 1) {
      if (await enterBtn.count()) break
      await softClick(page, page.getByRole('button', { name: /connect wallet/i }), 400)
      await enterBtn.first().waitFor({ state: 'visible', timeout: 4000 }).catch(() => {})
    }
    await step(page, 'Connected. One age confirmation, asked only the first time an address signs in.', 1400)
    await softClick(page, page.getByRole('button', { name: /i am 14 or over/i }), 700)

    // The signature here is a REAL Ed25519 signature produced in Node. Retry the
    // Enter click if the pass is still on /login (each click mints a fresh
    // challenge, so retrying is safe).
    for (let attempt = 0; attempt < 3; attempt += 1) {
      if (!new URL(page.url()).pathname.startsWith('/login')) break
      await softClick(page, enterBtn, 800)
      await page
        .waitForURL((url) => !url.pathname.startsWith('/login'), { timeout: 12_000 })
        .catch(() => {})
    }
    await page.waitForTimeout(1400)
    result.login = !new URL(page.url()).pathname.startsWith('/login')
    if (result.login) {
      result.reached.push('authenticated')
      await step(page, 'Signed in against the live backend. The signature proved ownership — nothing was typed.', 1500)
    } else {
      await step(page, 'Sign-in step.', 1000)
      console.log('    [login] still on /login — auth did not complete')
    }

    // Confirm the funded prepaid balance with the live wallet session.
    try {
      const bal = await page.evaluate(async () => {
        const r = await fetch('/api/v1/prepaid/balance', {
          credentials: 'include',
          headers: { 'x-obulus-client': 'web' },
        })
        let body = null
        try {
          body = await r.json()
        } catch {
          /* non-json */
        }
        return { status: r.status, body }
      })
      const atomic = bal.body?.availableAtomic ?? bal.body?.available_atomic ?? null
      result.balance = { status: bal.status, atomic }
      const usdc = atomic != null ? (Number(atomic) / 1e6).toFixed(2) : '?'
      console.log(`  [balance] GET /api/v1/prepaid/balance -> ${bal.status}, available ${usdc} USDC (atomic ${atomic})`)
    } catch (e) {
      console.log(`  [balance] read failed: ${(e.message || '').split('\n')[0]}`)
    }

    // ------------------------------------------------------- 3. onboarding
    // A brand-new wallet has no profile, so the app lands on onboarding.
    if (/\/onboarding/.test(page.url())) {
      result.reached.push('onboarding')
      try {
        await page.waitForTimeout(900)
        await step(page, 'Onboarding, step 1. A handle is the entire identity a buyer sees.', 1200)
        const handle = page.locator('input').first()
        if (await handle.count()) {
          await handle.fill('')
          await typeInto(handle, `LIVEREC_${PUB8.toUpperCase()}`)
          await page.waitForTimeout(500)
        }
        await softClick(page, page.getByRole('button', { name: /^continue$/i }), 800)

        await step(page, 'Bands, never exact values — enough to judge who an answer came from.', 1100)
        for (const band of ['35–44', 'Seoul', 'With kids at home']) await softChoose(page, band)
        await softClick(page, page.getByRole('button', { name: /^continue$/i }), 800)

        await step(page, 'Their own line of work, and how long they have done it.', 1000)
        await softChoose(page, 'Engineering')
        await softChoose(page, '7 years or more')
        await softClick(page, page.getByRole('button', { name: /^continue$/i }), 800)

        await step(page, 'The fields they agreed to take calls in — the matching key.', 1100)
        for (const field of ['Life', 'Money']) await softChoose(page, field)
        await softClick(page, page.getByRole('button', { name: /^continue$/i }), 800)

        await step(page, 'Where the money lands. The injected wallet signs to register itself for payouts.', 1400)
        await softClick(page, page.getByRole('button', { name: /use for payouts|payouts land here/i }), 800)
        await softClick(page, page.getByRole('button', { name: /^continue$/i }), 800)

        await step(page, 'The three-strike rule, stated before signup rather than buried in the terms.', 1600)
        await glide(page, 420, 900)
        await softClick(page, page.getByRole('button', { name: /I have read the three rules/i }), 500)
        await softClick(page, page.getByRole('button', { name: /agree and finish/i }), 1700)
        await step(page, 'Account ready on the live backend.', 900)
      } catch (e) {
        result.skipped.push('onboarding-partial')
        console.log(`    [onboarding] soft-skip: ${(e.message || '').split('\n')[0].slice(0, 90)}`)
      }
    }

    // -------------------------------------------------------- 4. the board
    if (await go(page, 'Open calls', '/dashboard', '**/dashboard')) {
      result.reached.push('dashboard')
      await step(page, 'The open-calls board — live data from the deployed backend.', 1700)
      if (await softChoose(page, 'Engineering')) {
        await step(page, 'Filtered to Engineering — the field this account said it can answer in.', 1400)
      }
      const payFilter = page.getByRole('button', { name: /₩1,000\+|1,000\+/ }).first()
      if (await softClick(page, payFilter, 1000)) {
        await step(page, 'And filtered again to calls paying ₩1,000 or more per answer.', 1300)
        await softClick(page, payFilter, 700)
      }
    }

    // ------------------------------------------------- 5. answer a call (if any)
    try {
      const card = page.getByRole('button', { name: 'Answer', exact: true }).first()
      if (await card.count()) {
        await card.scrollIntoViewIfNeeded().catch(() => {})
        await step(page, 'Pick one call. One screen, one question — not a forty-question form.', 1100)
        await card.click({ timeout: 8000 })
        await page.waitForURL('**/answer/**', { timeout: 12_000 }).catch(() => {})
        await page.waitForTimeout(1400)
        result.reached.push('answer')
        await step(page, 'A real open call on the live board, opened to answer.', 1500)
        // Light warm-ups sit before the money question on the live flow, too.
        await warmups(page)
        // Answering itself is off-chain (no signature). Live quality gates and
        // slot state vary, so this stays best-effort and never blocks the pass.
        const box = page.getByPlaceholder('Write it the way it happened.')
        if (await box.count()) {
          await box.scrollIntoViewIfNeeded().catch(() => {})
          await typeInto(
            box,
            'Three call-outs last month; the longest 2h40m at 03:10 on a Tuesday, all the same upstream timeout after a provider cut its idle cutoff from 300s to 60s without notice.',
            12,
          )
          await step(page, 'A real answer: numbers, a duration, a cause. The gate voids anything vaguer.', 1600)
          await softClick(page, page.getByRole('button', { name: /send and take/i }), 2000)
          await step(page, 'Submitted to the live backend.', 1200)
        } else {
          await step(page, 'The answer composer — one question, held while they write.', 1400)
        }
      } else {
        console.log('    [answer] no open calls to answer on the live board — skipping')
        result.skipped.push('answer-no-calls')
      }
    } catch (e) {
      result.skipped.push('answer')
      console.log(`    [answer] soft-skip: ${(e.message || '').split('\n')[0].slice(0, 90)}`)
    }

    // --------------------------------------------------------- 6. my shelf
    if (await go(page, 'My shelf', '/memory', '**/memory')) {
      result.reached.push('memory')
      await step(page, 'My shelf — the documents this account owns, and the balance it can spend.', 1700)
      await glide(page, 700)
      await step(page, 'Earnings states and the prepaid balance funded for this wallet.', 1600)
      await glide(page, 0, 800)
    }

    // -------------------------------------------------------- 7. ask a question
    if (await go(page, 'Ask', '/', '**/')) {
      result.reached.push('ask')
      await step(page, 'The asking side. A question goes into the chat box.', 1200)
      const ask = page.locator('textarea').first()
      if (await ask.count()) {
        await typeInto(ask, 'What does a weekday lunch actually cost in Seongsu?', 26)
        await page.waitForTimeout(900)
        await step(page, 'SHELF searches firsthand human documents, then prices only the passages you open.', 2000)
        // The query is composed but deliberately NOT submitted. Submitting
        // resolves into a paid settlement view whose passages open with a signed
        // on-chain USDC transfer (Solana TRANSACTION + SOL gas) — out of scope
        // for this message-only signer — so it is documented rather than run.
        result.skipped.push('x402-settlement')
        await step(page, 'Opening a priced passage needs an on-chain USDC transfer — out of scope for this automated take.', 2000)
        console.log('    [x402] settlement requires a signed on-chain transaction + SOL gas — composed only, not submitted')
      }
    }

    // ------------------------------------------------- 8. coverage / thin shelves
    if (await go(page, 'Thin shelves', '/coverage', '**/coverage')) {
      result.reached.push('coverage')
      await step(page, 'Thin shelves. Where questions come back empty is public; the documents are not.', 1800)
      await glide(page, 500)
      await page.waitForTimeout(1200)
      await glide(page, 0, 700)
    }

    // -------------------------------------------------------- 9. Korean pass
    await go(page, 'Ask', '/', '**/')
    // The language control is a Radix dropdown (trigger aria-label "Lang · EN").
    // Open it, then pick 한국어 — the menu item may be a menuitem or plain text.
    const langTrigger = page.getByRole('button', { name: /Lang/ }).first()
    if (await langTrigger.count()) {
      await langTrigger.click({ timeout: 6000 }).catch(() => {})
      await page.waitForTimeout(700)
      const ko = page.getByRole('menuitem', { name: /한국어/ }).first()
      const koText = page.getByText('한국어', { exact: false }).first()
      let switched = false
      if (await ko.count()) switched = await ko.click({ timeout: 5000 }).then(() => true).catch(() => false)
      else if (await koText.count()) switched = await koText.click({ timeout: 5000 }).then(() => true).catch(() => false)
      if (switched) {
        result.reached.push('korean')
        await page.waitForTimeout(1500)
        await step(page, 'The same live product in Korean — own typeface, own line-breaking.', 2000)
        await glide(page, 600)
      } else {
        await page.keyboard.press('Escape').catch(() => {})
        console.log('    [korean] language switch control did not respond — skipped')
      }
    }
    await step(page, 'End of the live pass.', 1400)
  } catch (error) {
    console.error('\n  FAILED:', error.message.split('\n')[0])
    await page.screenshot({ path: `${OUT}failure.png` }).catch(() => {})
    process.exitCode = 1
  } finally {
    await page.waitForTimeout(500)
    await context.close()
    await browser.close()
  }
}

// --------------------------------------------------------------------------
console.log(`  live target : ${LIVE_BASE}`)
console.log(`  backend     : ${API_BASE}`)
console.log(`  test wallet : ${PUB8}… (Devnet, generated fresh)`)
console.log('')
await fundWallet()
console.log('')
await run()

console.log('\n  --- summary ---')
console.log(`  login succeeded : ${result.login}`)
console.log(`  balance         : ${result.balance ? `HTTP ${result.balance.status}, atomic ${result.balance.atomic}` : 'n/a'}`)
console.log(`  reached         : ${result.reached.join(' -> ') || '(none)'}`)
console.log(`  skipped         : ${result.skipped.join(', ') || '(none)'}`)

// Playwright only writes webm. Convert when ffmpeg is around; keep the webm
// either way so a missing ffmpeg never costs a take.
const webm = readdirSync(OUT).find((f) => f.endsWith('.webm'))
if (webm && spawnSync('ffmpeg', ['-version'], { stdio: 'ignore' }).status === 0) {
  const mp4 = `${OUT}${NAME}.mp4`
  spawnSync(
    'ffmpeg',
    ['-y', '-i', `${OUT}${webm}`,
     '-vf', `fps=30,scale=${WIDTH * SCALE}:${HEIGHT * SCALE}:flags=lanczos,format=yuv420p`,
     '-c:v', 'libx264', '-preset', PRESET, '-crf', CRF,
     '-profile:v', 'high', '-movflags', '+faststart', mp4],
    { stdio: 'ignore' },
  )
  console.log(`\n  ${mp4}`)
} else {
  console.log(`\n  ${OUT}${webm ?? '(no recording written)'}`)
  if (webm) console.log('  install ffmpeg to get an mp4 as well')
}
