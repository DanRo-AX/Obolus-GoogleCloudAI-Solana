import { randomUUID } from 'node:crypto'
import { chmod, lstat, mkdir, open, readFile, rename, stat, unlink, writeFile } from 'node:fs/promises'
import { dirname } from 'node:path'

import { MAX_QUERY_AGE_MS, STATE_VERSION } from './constants.mjs'
import { LocalAgentError } from './errors.mjs'

export function emptyState() {
  return { version: STATE_VERSION, queries: {}, paymentIntents: {} }
}

export async function readState(config) {
  try {
    await rejectSymbolicLink(config.statePath)
    const parsed = JSON.parse(await readFile(config.statePath, 'utf8'))
    return normalizeState(parsed)
  } catch (error) {
    if (error?.code === 'ENOENT') return emptyState()
    if (error instanceof SyntaxError) {
      throw new LocalAgentError('Local state is not valid JSON.', 'invalid_local_state', 500)
    }
    throw error
  }
}

export async function updateState(config, updater) {
  return withStateLock(config, async () => {
    const state = await readState(config)
    const updated = normalizeState((await updater(state)) || state)
    await writeStateUnlocked(config, updated)
    return updated
  })
}

export async function writeState(config, state) {
  return withStateLock(config, () => writeStateUnlocked(config, state))
}

async function writeStateUnlocked(config, state) {
  const directory = dirname(config.statePath)
  await ensurePrivateDirectory(directory)
  await rejectSymbolicLink(config.statePath)
  const temporary = `${config.statePath}.${process.pid}.${randomUUID()}.tmp`
  try {
    await writeFile(temporary, `${JSON.stringify(normalizeState(state), null, 2)}\n`, {
      encoding: 'utf8',
      mode: 0o600,
      flag: 'wx',
    })
    await rename(temporary, config.statePath)
  } finally {
    await unlink(temporary).catch((error) => {
      if (error?.code !== 'ENOENT') throw error
    })
  }
}

export async function forgetLocalState(config, queryId = null) {
  if (!queryId) {
    await unlink(config.statePath).catch((error) => {
      if (error?.code !== 'ENOENT') throw error
    })
    return { forgotten: 'all' }
  }
  let existed = false
  await updateState(config, (state) => {
    existed = Boolean(state.queries[queryId])
    delete state.queries[queryId]
    for (const [intentId, intent] of Object.entries(state.paymentIntents)) {
      if (intent.queryId === queryId) delete state.paymentIntents[intentId]
    }
    return state
  })
  return { forgotten: queryId, existed }
}

export function requireQuery(state, queryId, now = Date.now()) {
  const query = state.queries[queryId]
  if (!query?.paymentAccessToken) {
    throw new LocalAgentError(
      `No local capability exists for query ${queryId}. Search again.`,
      'query_context_missing',
      404,
    )
  }
  if (!Number.isSafeInteger(query.createdAt) || now - query.createdAt > MAX_QUERY_AGE_MS) {
    throw new LocalAgentError('The local query capability expired. Search again.', 'query_expired', 410)
  }
  return query
}

export function requirePaymentIntent(state, intentId, now = Date.now(), options = {}) {
  const intent = state.paymentIntents[intentId]
  if (!intent?.paymentUrl || !intent?.approvalBinding) {
    throw new LocalAgentError(`No local payment intent exists for ${intentId}.`, 'intent_missing', 404)
  }
  if (!options.allowExpired && (!Number.isSafeInteger(intent.expiresAt) || intent.expiresAt <= now)) {
    throw new LocalAgentError('The local payment intent expired. Prepare a new quote.', 'quote_expired', 410)
  }
  return intent
}

function normalizeState(value) {
  const queries = value?.queries && typeof value.queries === 'object' ? value.queries : {}
  const paymentIntents =
    value?.paymentIntents && typeof value.paymentIntents === 'object'
      ? value.paymentIntents
      : {}
  return { version: STATE_VERSION, queries, paymentIntents }
}

async function rejectSymbolicLink(path) {
  const metadata = await lstat(path).catch((error) => {
    if (error?.code === 'ENOENT') return null
    throw error
  })
  if (metadata?.isSymbolicLink()) {
    throw new LocalAgentError('Refusing a symbolic-link local state file.', 'unsafe_state_path', 500)
  }
}

async function withStateLock(config, operation) {
  await ensurePrivateDirectory(dirname(config.statePath))
  const lockPath = `${config.statePath}.lock`
  const deadline = Date.now() + 5_000
  const nonce = randomUUID()
  let lock = null
  while (!lock) {
    try {
      lock = await open(lockPath, 'wx', 0o600)
      await lock.writeFile(JSON.stringify({ pid: process.pid, nonce, createdAt: Date.now() }))
    } catch (error) {
      if (lock) {
        await lock.close().catch(() => {})
        await unlink(lockPath).catch(() => {})
        lock = null
      }
      if (error?.code !== 'EEXIST') throw error
      if (await staleLock(lockPath)) {
        await unlink(lockPath).catch((unlinkError) => {
          if (unlinkError?.code !== 'ENOENT') throw unlinkError
        })
        continue
      }
      if (Date.now() >= deadline) {
        throw new LocalAgentError('Local capability state is busy.', 'local_state_busy', 503)
      }
      await new Promise((resolve) => setTimeout(resolve, 20))
    }
  }
  try {
    return await operation()
  } finally {
    await lock.close().catch(() => {})
    const owner = await readFile(lockPath, 'utf8')
      .then(JSON.parse)
      .catch(() => null)
    if (owner?.nonce === nonce) await unlink(lockPath).catch(() => {})
  }
}

async function ensurePrivateDirectory(directory) {
  await mkdir(directory, { recursive: true, mode: 0o700 })
  await chmod(directory, 0o700)
}

async function staleLock(lockPath) {
  const owner = await readFile(lockPath, 'utf8')
    .then(JSON.parse)
    .catch(() => null)
  const metadata = await stat(lockPath).catch((error) => {
    if (error?.code === 'ENOENT') return null
    throw error
  })
  if (!metadata) return false
  const createdAt = Number.isSafeInteger(owner?.createdAt) ? owner.createdAt : metadata.mtimeMs
  if (Date.now() - createdAt < 30_000) return false
  if (!Number.isSafeInteger(owner?.pid) || owner.pid < 1) return true
  try {
    process.kill(owner.pid, 0)
    return false
  } catch (error) {
    return error?.code === 'ESRCH'
  }
}
