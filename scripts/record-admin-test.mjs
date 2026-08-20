/**
 * Record only the Admin Test observatory while a real Obulus MCP request is
 * issued outside the captured page.
 *
 * The existing local Vite app and Rust API must already be running. Login is
 * completed in a non-recorded context with a deterministic demo wallet; the
 * recorded context starts only after the authenticated /admin page is ready.
 */

import { execFile } from 'node:child_process'
import { copyFileSync, mkdirSync, mkdtempSync, readdirSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { promisify } from 'node:util'

import { ed25519 } from '@noble/curves/ed25519'
import { chromium } from '@playwright/test'
import bs58 from 'bs58'

const execFileAsync = promisify(execFile)

const ROOT = new URL('..', import.meta.url).pathname
const BASE = process.env.OBULUS_WEB_URL || 'http://127.0.0.1:4322'
const API =
  process.env.OBULUS_API_URL
  || process.env.RUST_API_URL
  || 'http://127.0.0.1:8788'
const GATEWAY = process.env.OBULUS_GATEWAY_URL || 'http://127.0.0.1:1402'
const ARTIFACTS = join(ROOT, 'artifacts')
const VIDEO_DIR = mkdtempSync(join(tmpdir(), 'obulus-admin-record-'))
const WEBM_OUT = join(ARTIFACTS, 'obulus-admin-test-live.webm')
const MP4_OUT = join(ARTIFACTS, 'obulus-admin-test-live.mp4')
const WIDTH = 1728
const HEIGHT = 1080

// A public, deterministic demo-only key. It signs the free wallet login
// challenge and is never used for a transaction or funded account.
const DEMO_SEED = Uint8Array.from([
  77, 13, 204, 91, 18, 56, 240, 42, 188, 7, 61, 225, 102, 4, 149, 33,
  211, 71, 9, 166, 53, 200, 118, 27, 92, 143, 15, 230, 68, 174, 31, 121,
])
const DEMO_WALLET = bs58.encode(ed25519.getPublicKey(DEMO_SEED))

async function assertHealthy(url, label) {
  const response = await fetch(url)
  if (!response.ok) throw new Error(`${label} returned HTTP ${response.status}: ${url}`)
}

async function installDemoWallet(context) {
  await context.exposeFunction('__obulusDemoSign', (message) =>
    Array.from(ed25519.sign(Uint8Array.from(message), DEMO_SEED)),
  )
  await context.addInitScript((wallet) => {
    const listeners = {}
    const provider = {
      isPhantom: true,
      publicKey: null,
      isConnected: false,
      async connect() {
        provider.publicKey = { toString: () => wallet }
        provider.isConnected = true
        return { publicKey: provider.publicKey }
      },
      async disconnect() {
        provider.publicKey = null
        provider.isConnected = false
        ;(listeners.disconnect ?? []).forEach((listener) => listener())
      },
      async signMessage(message) {
        const signature = await window.__obulusDemoSign(Array.from(message))
        return { signature: Uint8Array.from(signature) }
      },
      async signTransaction() {
        throw new Error('The recording wallet cannot sign transactions.')
      },
      on(event, listener) {
        ;(listeners[event] ??= []).push(listener)
      },
      removeListener(event, listener) {
        listeners[event] = (listeners[event] ?? []).filter((item) => item !== listener)
      },
    }
    window.phantom = { solana: provider }
    window.solana = provider
  }, DEMO_WALLET)
}

async function authenticate(context) {
  const page = await context.newPage()
  await page.goto(`${BASE}/login?returnTo=/admin`, { waitUntil: 'networkidle' })

  if (new URL(page.url()).pathname !== '/admin') {
    const connect = page.getByRole('button', { name: /지갑 연결|connect wallet/i }).first()
    if (await connect.count()) await connect.click({ timeout: 15_000 })
    const ageButton = page.getByRole('button', { name: /14.*이상|14 or over/i }).first()
    if (await ageButton.count()) {
      await ageButton.click()
    } else {
      const age = page.locator('input[type="checkbox"]').first()
      if (!(await age.isChecked())) await age.check()
    }
    await page.getByRole('button', { name: /들어가기|enter/i }).first().click()
    await page.waitForURL('**/admin', { timeout: 25_000 })
  }
  return page
}

async function issueMcpRequest() {
  const args = {
    question: '성수동에서 실제로 일하는 사람들은 평일 점심시간을 어떻게 보내나요?',
    requestedDocuments: 5,
    filters: { category: 'life', region: 'seoul' },
  }
  return execFileAsync(
    process.execPath,
    [
      'apps/obulus-mcp/src/cli.mjs',
      'call',
      'ask_people',
      '--json',
      JSON.stringify(args),
    ],
    {
      cwd: ROOT,
      env: {
        ...process.env,
        OBULUS_API_URL: API,
        OBULUS_GATEWAY_URL: GATEWAY,
        OBULUS_MCP_CLIENT: 'gemini-mcp',
        OBULUS_MCP_INSTANCE: 'admin-test-recording',
      },
      timeout: 30_000,
      maxBuffer: 1024 * 1024,
    },
  )
}

async function main() {
  mkdirSync(ARTIFACTS, { recursive: true })
  await assertHealthy(BASE, 'Obulus web app')
  await assertHealthy(`${API}/healthz`, 'Rust API')

  const browser = await chromium.launch({ args: ['--hide-scrollbars'] })
  let trimStart = 0
  try {
    const context = await browser.newContext({
      viewport: { width: WIDTH, height: HEIGHT },
      deviceScaleFactor: 1,
      reducedMotion: 'no-preference',
      recordVideo: { dir: VIDEO_DIR, size: { width: WIDTH, height: HEIGHT } },
    })
    await installDemoWallet(context)
    const videoStartedAt = Date.now()
    const page = await authenticate(context)
    page.on('console', (message) => {
      if (message.type() === 'error') process.stderr.write(`[browser] ${message.text()}\n`)
    })

    await page.getByLabel('Obolus 실시간 데이터 적재와 검색 아키텍처').waitFor({ timeout: 20_000 })
    trimStart = Math.max(0, (Date.now() - videoStartedAt) / 1_000)
    await page.waitForTimeout(2_000)

    process.stdout.write('  recording Admin Test; issuing MCP request off-screen\n')
    const response = await issueMcpRequest()
    const parsed = JSON.parse(response.stdout)
    process.stdout.write(`  MCP query: ${parsed.queryId || parsed.query?.id || 'completed'}\n`)

    // The page polls every 2.5 s, then replays each route at 620 ms per node.
    await page.waitForTimeout(13_500)
    await context.close()
  } finally {
    await browser.close()
  }

  const video = readdirSync(VIDEO_DIR).find((file) => file.endsWith('.webm'))
  if (!video) throw new Error('Playwright did not write a WebM recording')
  copyFileSync(join(VIDEO_DIR, video), WEBM_OUT)

  const ffmpeg = await execFileAsync('ffmpeg', [
    '-y',
    '-ss', trimStart.toFixed(3),
    '-i', WEBM_OUT,
    '-vf', `fps=30,scale=${WIDTH}:${HEIGHT}:flags=lanczos,format=yuv420p`,
    '-c:v', 'libx264',
    '-preset', 'slow',
    '-crf', '18',
    '-profile:v', 'high',
    '-movflags', '+faststart',
    MP4_OUT,
  ], { maxBuffer: 4 * 1024 * 1024 }).catch((error) => ({ error }))

  process.stdout.write(`  ${WEBM_OUT}\n`)
  if (!ffmpeg.error) process.stdout.write(`  ${MP4_OUT}\n`)
}

main().catch((error) => {
  process.stderr.write(`${error.stack || error.message}\n`)
  process.exitCode = 1
})
