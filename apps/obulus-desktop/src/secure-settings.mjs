import { chmod, mkdir, readFile, rename, writeFile } from 'node:fs/promises'
import { dirname } from 'node:path'

const SETTINGS_VERSION = 1

export async function readSecureSettings(path, safeStorage) {
  try {
    const stored = JSON.parse(await readFile(path, 'utf8'))
    if (stored.version !== SETTINGS_VERSION || typeof stored.claudeApiKey !== 'string') {
      return { claudeApiKey: '' }
    }
    if (!safeStorage.isEncryptionAvailable()) return { claudeApiKey: '' }
    const decrypted = safeStorage.decryptString(Buffer.from(stored.claudeApiKey, 'base64'))
    return { claudeApiKey: decrypted }
  } catch (error) {
    if (error?.code === 'ENOENT') return { claudeApiKey: '' }
    throw new Error(`보안 설정을 읽지 못했습니다: ${error.message}`)
  }
}

export async function writeClaudeApiKey(path, safeStorage, apiKey) {
  const normalized = String(apiKey || '').trim()
  if (normalized && !/^sk-ant-[A-Za-z0-9_-]{20,}$/.test(normalized)) {
    throw new Error('올바른 Claude API 키 형식이 아닙니다.')
  }
  if (!safeStorage.isEncryptionAvailable()) {
    throw new Error('운영체제의 보안 저장소를 사용할 수 없습니다.')
  }
  await mkdir(dirname(path), { recursive: true, mode: 0o700 })
  const encrypted = normalized
    ? safeStorage.encryptString(normalized).toString('base64')
    : ''
  const temporary = `${path}.${process.pid}.tmp`
  await writeFile(
    temporary,
    `${JSON.stringify({ version: SETTINGS_VERSION, claudeApiKey: encrypted }, null, 2)}\n`,
    { mode: 0o600 },
  )
  await chmod(temporary, 0o600)
  await rename(temporary, path)
  await chmod(path, 0o600)
  return { configured: Boolean(normalized) }
}
