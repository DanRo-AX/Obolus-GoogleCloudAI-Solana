#!/usr/bin/env node

import { ed25519 } from '@noble/curves/ed25519'
import { Keypair } from '@solana/web3.js'
import bs58 from 'bs58'
import { execFileSync } from 'node:child_process'
import {
  chmodSync,
  lstatSync,
  mkdtempSync,
  realpathSync,
  rmdirSync,
  unlinkSync,
  writeFileSync,
} from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join, resolve, sep } from 'node:path'
import { fileURLToPath } from 'node:url'

const DEFAULT_API = 'https://obolus-api-amjeodet3q-du.a.run.app'
const DEFAULT_PROJECT = 'sweetspot-ax'
const DEFAULT_OUTPUT = 'artifacts/finalist-evidence/autonomy.json'
const DEFAULT_QUESTION =
  '성수에서 근무하는 직장인이 평일 점심 식당을 고를 때 실제로 중요하게 본 기준과 최근 경험을 알려줘.'

const args = parseArgs(process.argv.slice(2))
const apiOrigin = safeApiOrigin(args.apiOrigin)
const output = resolve(args.output)
const tempRoot = realpathSync(tmpdir())
const tempDirectory = mkdtempSync(join(tempRoot, 'obulus-autonomy-'))
chmodSync(tempDirectory, 0o700)
const rawPath = join(tempDirectory, 'resolve-response.json')
let cookie = null

try {
  const wallet = Keypair.generate()
  const address = wallet.publicKey.toBase58()
  const challenge = await apiJson(`${apiOrigin}/api/v1/auth/wallet/challenge`, {
    method: 'POST',
    body: { wallet: address, purpose: 'wallet_login_v1' },
  })
  const signature = bs58.encode(
    ed25519.sign(
      new TextEncoder().encode(requiredString(challenge?.message, 'challenge message')),
      wallet.secretKey.slice(0, 32),
    ),
  )
  const verified = await fetch(`${apiOrigin}/api/v1/auth/wallet/verify`, {
    method: 'POST',
    headers: { accept: 'application/json', 'content-type': 'application/json' },
    body: JSON.stringify({
      wallet: address,
      challengeId: requiredString(challenge?.id, 'challenge id'),
      signature,
      ageConfirmed14: true,
    }),
  })
  if (!verified.ok) throw await responseError(verified)
  cookie = sessionCookie(verified)

  const response = await apiJson(`${apiOrigin}/api/v1/questions/resolve`, {
    method: 'POST',
    cookie,
    body: {
      question: args.question,
      requestedDocuments: args.requestedDocuments,
      budgetKrw: args.budgetKrw,
      filters: {},
    },
  })
  assertTwoStageRun(response)
  writeFileSync(rawPath, `${JSON.stringify(response, null, 2)}\n`, {
    flag: 'wx',
    mode: 0o600,
  })
  chmodSync(rawPath, 0o600)

  const recorder = resolve(
    dirname(fileURLToPath(import.meta.url)),
    'record-finalist-autonomy-evidence.mjs',
  )
  let recorded = null
  let lastError = null
  for (let attempt = 1; attempt <= args.logAttempts; attempt += 1) {
    if (attempt > 1) await sleep(args.logDelayMs)
    try {
      const stdout = execFileSync(process.execPath, [
        recorder,
        '--input',
        rawPath,
        '--output',
        output,
        '--project',
        args.project,
      ], {
        encoding: 'utf8',
        timeout: 30_000,
        stdio: ['ignore', 'pipe', 'pipe'],
      })
      recorded = JSON.parse(stdout)
      break
    } catch (error) {
      lastError = error
      const stderr = String(error?.stderr ?? '')
      if (!stderr.includes('no matching two-stage Cloud Run application log was found')) break
    }
  }
  if (!recorded) {
    const detail = String(lastError?.stderr ?? lastError?.message ?? 'unknown recorder failure')
      .replaceAll(address, '[ephemeral-wallet]')
      .trim()
    throw new Error(`could not correlate the deployed autonomy run: ${detail}`)
  }
  if (recorded?.summary?.ready !== true) {
    throw new Error('autonomy evidence was recorded but did not satisfy the ready gate')
  }

  process.stdout.write(`${JSON.stringify(recorded, null, 2)}\n`)
  console.error(`verified deployed two-stage autonomy evidence: ${output}`)
} finally {
  if (cookie) {
    try {
      await fetch(`${apiOrigin}/api/v1/auth/logout`, {
        method: 'POST',
        headers: { cookie },
      })
    } catch {
      // The short-lived session expires server-side even if cleanup is unavailable.
    }
  }
  removePrivateTemporaryFile(rawPath, tempDirectory, tempRoot)
}

function parseArgs(values) {
  const result = {
    apiOrigin: process.env.OBOLUS_API_BASE ?? DEFAULT_API,
    project: process.env.GOOGLE_CLOUD_PROJECT ?? DEFAULT_PROJECT,
    output: DEFAULT_OUTPUT,
    question: DEFAULT_QUESTION,
    requestedDocuments: 4,
    budgetKrw: 1_000,
    logAttempts: 8,
    logDelayMs: 2_500,
  }
  for (let index = 0; index < values.length; index += 1) {
    const value = values[index]
    if (value === '--api') result.apiOrigin = required(values, ++index, value)
    else if (value === '--project') result.project = required(values, ++index, value)
    else if (value === '--output') result.output = required(values, ++index, value)
    else if (value === '--question') result.question = required(values, ++index, value)
    else if (value === '--requested-documents') {
      result.requestedDocuments = boundedInteger(required(values, ++index, value), value, 1, 20)
    } else if (value === '--budget-krw') {
      result.budgetKrw = boundedInteger(required(values, ++index, value), value, 1, 1_000_000)
    } else if (value === '--help') {
      console.log(
        'Usage: node scripts/run-finalist-autonomy-e2e.mjs [--api URL] [--project ID] [--output FILE]\n' +
          'Runs an authenticated question against the deployed API, correlates the exact Cloud Run log, and writes secret-free evidence.',
      )
      process.exit(0)
    } else stop(`unknown argument: ${value}`)
  }
  if (!/^[a-z][a-z0-9-]{4,62}$/.test(result.project)) stop('--project is malformed')
  if (result.question.trim().length < 8 || result.question.length > 1_000) {
    stop('--question must contain 8 to 1000 characters')
  }
  return result
}

function safeApiOrigin(value) {
  let url
  try {
    url = new URL(value)
  } catch {
    stop('--api must be a valid URL')
  }
  if (url.protocol !== 'https:' && url.hostname !== '127.0.0.1' && url.hostname !== 'localhost') {
    stop('--api must use HTTPS except for localhost')
  }
  if (url.username || url.password || url.search || url.hash) stop('--api may not contain credentials, query, or hash')
  return url.toString().replace(/\/$/, '')
}

async function apiJson(url, { method = 'GET', cookie: requestCookie, body } = {}) {
  const headers = { accept: 'application/json' }
  if (requestCookie) headers.cookie = requestCookie
  if (body !== undefined) headers['content-type'] = 'application/json'
  const response = await fetch(url, {
    method,
    headers,
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  })
  if (!response.ok) throw await responseError(response)
  if (response.status === 204) return null
  return response.json()
}

function sessionCookie(response) {
  const setCookies = typeof response.headers.getSetCookie === 'function'
    ? response.headers.getSetCookie()
    : [response.headers.get('set-cookie')].filter(Boolean)
  const cookies = setCookies
    .map((value) => String(value).split(';', 1)[0])
    .filter((value) => value.includes('='))
  if (cookies.length === 0) stop('wallet verification did not issue a session cookie')
  return cookies.join('; ')
}

function assertTwoStageRun(response) {
  const run = response?.agentRun
  if (!run || run.mode !== 'vertex_two_stage_with_deterministic_guards') {
    const stages = Array.isArray(run?.steps)
      ? run.steps
          .map((step) => `${String(step?.agent ?? 'unknown')}:${String(step?.status ?? 'unknown')}`)
          .join(',')
      : 'missing'
    throw new Error(
      `deployed run did not use the two-stage Vertex path (mode=${run?.mode ?? 'missing'}; stages=${stages})`,
    )
  }
  if (run.providerCallCount !== 2 || !String(run.runtimeRevision ?? '').startsWith('obolus-api-')) {
    throw new Error('deployed run is missing two provider calls or its Cloud Run revision')
  }
}

function removePrivateTemporaryFile(path, directory, root) {
  try {
    const resolvedDirectory = realpathSync(directory)
    if (!resolvedDirectory.startsWith(`${root}${sep}`) || lstatSync(resolvedDirectory).isSymbolicLink()) return
    if (resolve(dirname(path)) !== resolvedDirectory || resolve(path) !== join(resolvedDirectory, 'resolve-response.json')) return
    try {
      if (!lstatSync(path).isSymbolicLink()) unlinkSync(path)
    } catch (error) {
      if (error?.code !== 'ENOENT') throw error
    }
    rmdirSync(resolvedDirectory)
  } catch {
    // Do not broaden deletion scope when an exact private-file cleanup cannot be proven safe.
  }
}

async function responseError(response) {
  const text = (await response.text()).slice(0, 1_000)
  return new Error(`HTTP ${response.status}: ${text}`)
}

function requiredString(value, label) {
  if (typeof value !== 'string' || value.trim() === '') stop(`${label} is missing`)
  return value
}

function required(values, index, flag) {
  if (!values[index]) stop(`${flag} requires a value`)
  return values[index]
}

function boundedInteger(value, flag, minimum, maximum) {
  const number = Number(value)
  if (!Number.isSafeInteger(number) || number < minimum || number > maximum) {
    stop(`${flag} must be an integer between ${minimum} and ${maximum}`)
  }
  return number
}

function sleep(milliseconds) {
  return new Promise((resolvePromise) => setTimeout(resolvePromise, milliseconds))
}

function stop(message) {
  console.error(message)
  process.exit(2)
}
