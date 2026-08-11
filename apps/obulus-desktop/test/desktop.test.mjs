import assert from 'node:assert/strict'
import { mkdtemp, readFile, rm, stat, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import test from 'node:test'

import { stagePayBinary } from '../scripts/stage-pay.mjs'
import { browserPreferences, isAllowedNavigation } from '../src/security.mjs'
import { readSecureSettings, writeClaudeApiKey } from '../src/secure-settings.mjs'

test('desktop renderer is isolated from Node and untrusted navigation', () => {
  assert.deepEqual(browserPreferences, {
    contextIsolation: true,
    nodeIntegration: false,
    sandbox: true,
    webSecurity: true,
  })
  assert.equal(isAllowedNavigation('https://evil.example', 'file:///app/index.html'), false)
  assert.equal(isAllowedNavigation('file:///app/other.html', 'file:///app/index.html'), false)
  assert.equal(isAllowedNavigation('file:///app/index.html', 'file:///app/index.html'), true)
})

test('packaging stages only the pinned Pay.sh version and records its checksum', async (context) => {
  const directory = await mkdtemp(join(tmpdir(), 'obulus-desktop-'))
  context.after(() => rm(directory, { recursive: true, force: true }))
  const source = join(directory, 'source-pay')
  const target = join(directory, 'build/pay')
  const checksumTarget = join(directory, 'build/pay.sha256')
  await writeFile(source, 'trusted-pay-binary', { mode: 0o755 })
  const result = await stagePayBinary({
    source,
    target,
    checksumTarget,
    runner: async () => ({ stdout: 'pay 0.26.0\n' }),
  })
  assert.equal(result.version, '0.26.0')
  assert.equal(await readFile(target, 'utf8'), 'trusted-pay-binary')
  assert.equal((await readFile(checksumTarget, 'utf8')).trim(), result.digest)
})

test('renderer CSP forbids network and inline scripts', async () => {
  const html = await readFile(new URL('../src/renderer/index.html', import.meta.url), 'utf8')
  assert.match(html, /connect-src 'none'/)
  assert.match(html, /script-src 'self'/)
  assert.doesNotMatch(html, /unsafe-inline|https:\/\//)
})

test('Claude credentials are encrypted and stored with owner-only permissions', async (context) => {
  const directory = await mkdtemp(join(tmpdir(), 'obulus-desktop-secret-'))
  context.after(() => rm(directory, { recursive: true, force: true }))
  const path = join(directory, 'settings/secure-settings.json')
  const safeStorage = {
    isEncryptionAvailable: () => true,
    encryptString: (value) => Buffer.from(`encrypted:${value}`),
    decryptString: (value) => value.toString().replace(/^encrypted:/, ''),
  }
  const key = 'sk-ant-test-abcdefghijklmnopqrstuvwxyz'
  await writeClaudeApiKey(path, safeStorage, key)
  const raw = await readFile(path, 'utf8')
  assert.equal(raw.includes(key), false)
  assert.equal((await stat(path)).mode & 0o777, 0o600)
  assert.deepEqual(await readSecureSettings(path, safeStorage), { claudeApiKey: key })
})

test('desktop renderer presents a streaming agent workspace rather than a fixed search form', async () => {
  const html = await readFile(new URL('../src/renderer/index.html', import.meta.url), 'utf8')
  const renderer = await readFile(new URL('../src/renderer/renderer.js', import.meta.url), 'utf8')
  assert.match(html, /id="composer"/)
  assert.match(html, /id="conversation-list"/)
  assert.match(html, /id="activity-list"/)
  assert.doesNotMatch(html, /id="search-form"/)
  assert.match(renderer, /onAgentEvent/)
  assert.match(renderer, /prepare_open_call/)
  assert.match(renderer, /prepare_evidence_payment/)
})
