/**
 * Records one end-to-end pass through Obolus against the seeded mock backend.
 *
 * Run it with `npm run demo:record`. It owns both processes it needs — a fresh
 * `scripts/mock-backend.mjs` and its own Vite server — because a mock that
 * survives between takes accumulates answered calls and quietly changes what
 * the filters return.
 *
 * The browser has no Phantom extension, so a stub provider is injected before
 * any page script runs. It answers connect/signMessage and nothing else. The
 * run uses the sandbox ledger (VITE_X402_ENABLED=false), so no transaction is
 * ever signed and nothing touches a chain.
 */

import { spawn, spawnSync } from 'node:child_process'
import { mkdirSync, readdirSync, rmSync } from 'node:fs'
import { chromium } from '@playwright/test'

const MOCK_PORT = Number(process.env.MOCK_PORT ?? 8788)
const APP_PORT = Number(process.env.APP_PORT ?? 4400)
const BASE = `http://localhost:${APP_PORT}`
const ROOT = new URL('..', import.meta.url).pathname
const OUT = `${ROOT}scripts/.e2e-video/`
const PUBKEY = '7xKXtg2CW87d97TXJSDpbD5jBkheTqA83TZRuJosgAsU'

rmSync(OUT, { recursive: true, force: true })
mkdirSync(OUT, { recursive: true })

const children = []

function start(name, command, args, env) {
  const child = spawn(command, args, {
    cwd: ROOT,
    env: { ...process.env, ...env },
    stdio: ['ignore', 'pipe', 'pipe'],
  })
  child.stdout.on('data', (d) => process.env.VERBOSE && process.stdout.write(`[${name}] ${d}`))
  child.stderr.on('data', (d) => process.env.VERBOSE && process.stderr.write(`[${name}] ${d}`))
  children.push(child)
  return child
}

async function waitFor(url, label, tries = 60) {
  for (let i = 0; i < tries; i += 1) {
    try {
      const response = await fetch(url)
      if (response.ok || response.status < 500) return
    } catch {
      /* not up yet */
    }
    await new Promise((r) => setTimeout(r, 500))
  }
  throw new Error(`${label} never came up at ${url}`)
}

function stopAll() {
  for (const child of children) child.kill('SIGTERM')
}
process.on('exit', stopAll)
process.on('SIGINT', () => {
  stopAll()
  process.exit(130)
})

/** Injected before app code: a Phantom that connects and signs, nothing more. */
const PHANTOM_STUB = (pubkey) => {
  const listeners = {}
  const provider = {
    isPhantom: true,
    publicKey: null,
    isConnected: false,
    async connect(opts) {
      // A cold profile has not trusted this origin yet, so the silent
      // reconnect must fail exactly like the real extension's does.
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
    async signMessage(message) {
      const signature = new Uint8Array(64)
      for (let i = 0; i < 64; i += 1) signature[i] = (message[i % message.length] + i) & 0xff
      return { signature }
    },
    async signTransaction(_tx) {
      throw new Error('This demo runs on the sandbox ledger; no transaction is signed.')
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
      const [n, ...rest] = kept.split('\u0000')
      el.querySelector('#__capn').textContent = n
      el.querySelector('#__capt').textContent = rest.join('')
    }
  }
  window.__cap = (n, text) => {
    if (!document.getElementById('__cap')) mount()
    sessionStorage.setItem('__cap', `${n}\u0000${text}`)
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
  await page.evaluate(
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
}

async function typeInto(locator, text, delay = 26) {
  await locator.click()
  await locator.type(text, { delay })
}

/**
 * Click a choice by its visible label.
 *
 * Several of these are cards whose accessible name swallows the description,
 * so matching the label text node and letting the click bubble to the button
 * is more durable than matching an accessible name.
 */
async function choose(page, label, timeout = 8000) {
  const target = page.getByText(label, { exact: true }).first()
  await target.click({ timeout })
  await page.waitForTimeout(500)
}

/**
 * Navigate the way a person does — through the sidebar.
 *
 * page.goto() reloads the document, which replays the splash every time and
 * makes the recording look like a slideshow of cold starts. Clicking the nav
 * keeps it a single-page session.
 */
async function go(page, label, expect) {
  await page.getByRole('link', { name: label, exact: true }).first().click()
  if (expect) await page.waitForURL(expect, { timeout: 15_000 })
  await page.waitForLoadState('networkidle').catch(() => {})
  await page.waitForTimeout(800)
}

/**
 * Walk the warm-ups that sit in front of the money question.
 *
 * There are three kinds and two of them auto-advance on pick, so this loops on
 * what is actually on screen rather than assuming a fixed number of steps.
 */
async function warmups(page) {
  for (let i = 0; i < 8; i += 1) {
    if (await page.getByPlaceholder('Write it the way it happened.').count()) return
    const choices = page.locator('div.flex.flex-col.gap-2 > button')
    if (await choices.count()) {
      await choices.first().click()
      await page.waitForTimeout(600)
      continue
    }
    const scale = page.getByRole('button', { name: '4', exact: true })
    if (await scale.count()) {
      await scale.first().click()
      await page.waitForTimeout(600)
      continue
    }
    const short = page.locator('input[type="text"], input:not([type])').first()
    if (await short.count()) {
      await typeInto(short, 'the noodle place by exit 3', 22)
      await page.waitForTimeout(500)
      await page.getByRole('button', { name: /^(next|skip)$/i }).first().click()
      await page.waitForTimeout(600)
      continue
    }
    const advance = page.getByRole('button', { name: /^(next|skip)$/i }).first()
    if (!(await advance.count())) return
    await advance.click()
    await page.waitForTimeout(600)
  }
}

const run = async () => {
  const browser = await chromium.launch({
    args: ['--force-device-scale-factor=1', '--hide-scrollbars'],
  })
  const context = await browser.newContext({
    viewport: { width: 1440, height: 900 },
    recordVideo: { dir: OUT, size: { width: 1440, height: 900 } },
    deviceScaleFactor: 1,
    reducedMotion: 'no-preference',
  })
  await context.addInitScript(PHANTOM_STUB, PUBKEY)
  await context.addInitScript(CAPTION)

  const page = await context.newPage()
  page.on('console', (m) => {
    if (m.type() === 'error') console.log('    [console]', m.text().slice(0, 160))
  })

  try {
    // ---------------------------------------------------------- 1. landing
    await page.goto(`${BASE}/`, { waitUntil: 'networkidle' })
    await page.waitForTimeout(1300)
    await step(page, 'Landing. The whole thesis is one line: search people, not the web.', 1600)
    await glide(page, 1080)
    await step(page, 'A general model guesses. Four people who live there each get paid ₩38 total.', 1900)
    await glide(page, 4360)
    await step(page, 'The server answers 402 with a price and the wallet pays it. Nobody approves ₩12.', 1900)
    await glide(page, 0, 900)

    // ------------------------------------------------------------ 2. login
    await step(page, 'Sign in. There is no email or password — the wallet is the account.', 900)
    await page.getByRole('link', { name: /connect wallet|sign in/i }).first().click()
    await page.waitForURL('**/login', { timeout: 15_000 })
    await page.waitForTimeout(1200)
    await step(page, 'Phantom is stubbed for this run. Connecting only reads the public address.', 1300)
    await page.getByRole('button', { name: /connect wallet/i }).first().click()
    await page.waitForTimeout(1400)
    await step(page, 'Connected. One age confirmation, asked only the first time an address signs in.', 1400)
    await page.getByRole('button', { name: /i am 14 or over/i }).click()
    await page.waitForTimeout(700)
    await page.getByRole('button', { name: /^enter$/i }).click()
    await page.waitForURL((url) => !url.pathname.startsWith('/login'), { timeout: 25_000 })
    await page.waitForTimeout(1400)
    await step(page, 'Signed in. Credentials were derived from the public key, not typed.', 1300)

    // ------------------------------------------------------- 3. onboarding
    const setUp = page.getByRole('link', { name: /set up your shelf/i }).first()
    if (await setUp.count()) {
      await setUp.click()
      await page.waitForURL('**/onboarding', { timeout: 15_000 })
    } else {
      await page.goto(`${BASE}/onboarding`, { waitUntil: 'networkidle' })
    }
    await page.waitForTimeout(1000)
    await step(page, 'Onboarding, step 1 of 6. A handle is the entire identity a buyer sees.', 1200)
    const handle = page.locator('input').first()
    await handle.fill('')
    await typeInto(handle, 'SEONGSU_42')
    await page.waitForTimeout(600)
    await page.getByRole('button', { name: /^continue$/i }).click()

    await page.waitForTimeout(800)
    await step(page, 'Bands, never exact values. Enough to judge who an answer came from.', 1100)
    for (const band of ['35–44', 'Seoul', 'With kids at home']) await choose(page, band)
    await page.waitForTimeout(500)
    await page.getByRole('button', { name: /^continue$/i }).click()

    await page.waitForTimeout(800)
    await step(page, 'Their own line of work, and how long they have done it.', 1000)
    await choose(page, 'Engineering')
    await choose(page, '7 years or more')
    await page.waitForTimeout(600)
    await page.getByRole('button', { name: /^continue$/i }).click()

    await page.waitForTimeout(800)
    await step(page, 'The fields they agreed to take calls in. This is the matching key.', 1100)
    for (const field of ['Life', 'Money']) await choose(page, field)
    await page.waitForTimeout(500)
    await page.getByRole('button', { name: /^continue$/i }).click()

    await page.waitForTimeout(800)
    await step(page, 'Where the money lands. Connecting an extension is not the same as naming a payout wallet.', 1400)
    const useThis = page.getByRole('button', { name: /use for payouts|payouts land here/i }).first()
    if (await useThis.count()) {
      await useThis.click()
      await page.waitForTimeout(600)
    }
    await page.getByRole('button', { name: /^continue$/i }).click()

    await page.waitForTimeout(800)
    await step(page, 'The three-strike rule, stated before signup rather than buried in the terms.', 1900)
    await glide(page, 420, 900)
    await page.waitForTimeout(800)
    await page.getByRole('button', { name: /I have read the three rules/i }).click()
    await page.waitForTimeout(500)
    await page.getByRole('button', { name: /agree and finish/i }).click()
    await page.waitForTimeout(1700)
    await step(page, 'Account ready.', 900)

    // -------------------------------------------------------- 4. the board
    await go(page, 'Open calls', '**/dashboard')
    await page.waitForTimeout(800)
    await step(page, 'The open-calls board. 36 seeded calls across 11 fields, newest first.', 1700)
    await choose(page, 'Engineering')
    await page.waitForTimeout(1300)
    await step(page, 'Filtered to Engineering — the field this account said it can answer in.', 1400)
    const payFilter = page.getByRole('button', { name: /₩1,000\+|1,000\+/ }).first()
    if (await payFilter.count()) {
      await payFilter.click()
      await page.waitForTimeout(1200)
      await step(page, 'And filtered again to calls paying ₩1,000 or more per answer.', 1400)
      await payFilter.click()
      await page.waitForTimeout(700)
    }

    // ------------------------------------------------------- 5. an answer
    const card = page.getByRole('button', { name: 'Answer', exact: true }).first()
    await card.scrollIntoViewIfNeeded()
    await step(page, 'Pick one call. One screen, one question — not a forty-question form.', 1100)
    await card.click()
    await page.waitForURL('**/answer/**', { timeout: 15_000 })
    await page.waitForTimeout(1500)
    await step(page, 'Four light warm-ups first. They set the register before the money question.', 1700)
    await warmups(page)
    await page.waitForTimeout(1000)
    await step(page, 'Then the real question. The slot is held for ten minutes while they write.', 1600)

    const box = page.getByPlaceholder('Write it the way it happened.')
    await box.scrollIntoViewIfNeeded()
    await typeInto(
      box,
      'Three call-outs last month. The longest was 2h40m at 03:10 on a Tuesday, all of them the same upstream timeout after a provider changed its idle cutoff from 300s to 60s without notice. On-call pays ₩250,000 a week here plus a day back in lieu, which works out under minimum wage for the bad weeks.',
      14,
    )
    await page.waitForTimeout(1000)
    await step(page, 'A real answer: numbers, a duration, a cause. The gate voids anything vaguer.', 1900)
    const submit = page.getByRole('button', { name: /send and take/i }).first()
    await submit.click()
    await page.waitForTimeout(2200)
    await step(page, 'Accepted. It settled and became a document on their shelf.', 1400)

    // --------------------------------------------------------- 6. my shelf
    await go(page, 'My shelf', '**/memory')
    await page.waitForTimeout(800)
    await step(page, 'My shelf. The answer just written sits on top of 14 seeded ones.', 1700)
    await glide(page, 700)
    await step(page, 'Earnings split accrued, held for 14 days, and claimable — the real ledger states.', 1700)
    await glide(page, 0, 800)

    // -------------------------------------------------------- 7. a hit ask
    await go(page, 'Ask')
    await step(page, 'Now the asking side. This question has coverage on the shelves.', 1200)
    const ask = page.locator('textarea').first()
    await typeInto(ask, 'What does a weekday lunch actually cost in Seongsu?', 30)
    await page.waitForTimeout(800)
    await ask.press('Enter')
    await page.waitForTimeout(2700)
    await step(page, 'HIT. Five documents ranked, priced ₩5–₩20 each, passages still sealed.', 2200)
    const pay = page.getByRole('button', { name: /open|pay|settle|confirm/i }).first()
    if (await pay.count()) {
      await pay.click()
      await page.waitForTimeout(2900)
      await step(page, 'Settled on the sandbox ledger. Each passage unsealed, each author credited.', 2200)
      await glide(page, 600)
      await page.waitForTimeout(1300)
    }

    // ------------------------------------------------------- 8. a miss ask
    await go(page, 'Ask')
    await step(page, 'And a question nobody has written down yet.', 1000)
    const ask2 = page.locator('textarea').first()
    await typeInto(ask2, 'How long does a studio visa renewal really take in Lisbon?', 26)
    await page.waitForTimeout(700)
    await ask2.press('Enter')
    await page.waitForTimeout(2900)
    await step(page, 'MISS. Not "no results" — it offers to commission the answer instead.', 2200)
    const askThem = page.getByRole('button', { name: /^ask them$/i }).first()
    if (await askThem.count()) {
      await askThem.click()
      await page.waitForTimeout(1900)
      await step(page, 'First question: how many people should answer.', 1700)
      await choose(page, '7')
      await page.waitForTimeout(1200)
      await step(page, 'Second question: what one answer is worth. ₩0 still gets answers, slower.', 1900)
      await choose(page, '₩800')
      await page.waitForTimeout(2600)
      await step(page, 'Call posted. The whole budget is reserved up front and refunds what goes unanswered.', 2200)
    }

    // -------------------------------------------------------- 9. the rest
    await go(page, 'Receipts', '**/archive')
    await page.waitForTimeout(800)
    await step(page, 'Receipts. Every chat, every document opened, every amount.', 1700)

    await go(page, 'Thin shelves', '**/coverage')
    await page.waitForTimeout(800)
    await step(page, 'Thin shelves. Where questions come back empty is public; the documents are not.', 1900)
    await glide(page, 500)
    await page.waitForTimeout(1500)

    await go(page, 'Ask')
    await page.getByRole('button', { name: '한국어' }).first().click()
    await page.waitForTimeout(1700)
    await step(page, 'The same product in Korean — own typeface, own line-breaking, copy rewritten.', 2200)
    await glide(page, 900)
    await page.waitForTimeout(1900)
    await step(page, 'End of the pass.', 1400)
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

console.log(`  starting mock backend on :${MOCK_PORT}`)
start('mock', process.execPath, ['scripts/mock-backend.mjs'], { MOCK_PORT: String(MOCK_PORT) })
await waitFor(`http://127.0.0.1:${MOCK_PORT}/healthz`, 'mock backend')

console.log(`  starting the app on :${APP_PORT}`)
start('vite', 'npx', ['vite', '--port', String(APP_PORT)], {
  VITE_X402_ENABLED: 'false',
  VITE_API_PROXY_TARGET: `http://127.0.0.1:${MOCK_PORT}`,
})
await waitFor(BASE, 'vite')
console.log('')

await run()
stopAll()

// Playwright only writes webm. Convert when ffmpeg is around; keep the webm
// either way so a missing ffmpeg never costs a take.
const webm = readdirSync(OUT).find((f) => f.endsWith('.webm'))
if (webm && spawnSync('ffmpeg', ['-version'], { stdio: 'ignore' }).status === 0) {
  const mp4 = `${OUT}obolus-e2e.mp4`
  spawnSync(
    'ffmpeg',
    ['-y', '-i', `${OUT}${webm}`, '-vf', 'fps=30,format=yuv420p',
     '-c:v', 'libx264', '-preset', 'slow', '-crf', '20',
     '-movflags', '+faststart', mp4],
    { stdio: 'ignore' },
  )
  console.log(`\n  ${mp4}`)
} else {
  console.log(`\n  ${OUT}${webm ?? '(no recording written)'}`)
  if (webm) console.log('  install ffmpeg to get an mp4 as well')
}
