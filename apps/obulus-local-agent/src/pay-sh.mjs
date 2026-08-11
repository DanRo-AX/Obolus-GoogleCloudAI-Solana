import { existsSync } from 'node:fs'
import { delimiter, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const APP_PAY = fileURLToPath(
  new URL(
    process.platform === 'win32' ? '../node_modules/.bin/pay.cmd' : '../node_modules/.bin/pay',
    import.meta.url,
  ),
)
const ROOT_PAY = fileURLToPath(
  new URL(
    process.platform === 'win32' ? '../../../node_modules/.bin/pay.cmd' : '../../../node_modules/.bin/pay',
    import.meta.url,
  ),
)

export function payInvocation(env = process.env, options = {}) {
  const override = env.OBULUS_PAY_COMMAND?.trim() || env.OPENSHELF_PAY_COMMAND?.trim()
  if (override) {
    if (env.OBULUS_ALLOW_PAY_OVERRIDE !== '1') {
      throw new Error('OBULUS_PAY_COMMAND requires OBULUS_ALLOW_PAY_OVERRIDE=1')
    }
    if (!override.startsWith('/')) throw new Error('OBULUS_PAY_COMMAND must be an absolute path')
    return { command: override, args: [], source: 'override' }
  }
  const candidates = options.projectPay ? [options.projectPay] : [APP_PAY, ROOT_PAY]
  for (const candidate of candidates) {
    if (existsSync(candidate)) return { command: candidate, args: [], source: 'pinned-project' }
  }
  const system = (options.findSystemPay || findSystemPay)(env)
  if (system) return { command: system, args: [], source: 'system' }
  return {
    command: process.platform === 'win32' ? 'npx.cmd' : 'npx',
    args: ['--yes', '@solana/pay@1.0.26'],
    source: 'pinned-npx',
  }
}

export function payChildEnvironment(env = process.env) {
  const allowed = [
    'HOME',
    'PATH',
    'USER',
    'TMPDIR',
    'LANG',
    'LC_ALL',
    'XDG_CONFIG_HOME',
    'SSL_CERT_FILE',
    'SSL_CERT_DIR',
    'SYSTEMROOT',
    'WINDIR',
  ]
  const child = Object.fromEntries(
    allowed.filter((key) => typeof env[key] === 'string').map((key) => [key, env[key]]),
  )
  const account = env.OBULUS_PAY_ACCOUNT?.trim() || env.OPENSHELF_PAY_ACCOUNT?.trim()
  if (account) child.OPENSHELF_PAY_ACCOUNT = account
  return child
}

function findSystemPay(env) {
  const executable = process.platform === 'win32' ? 'pay.exe' : 'pay'
  for (const directory of (env.PATH || '').split(delimiter).filter(Boolean)) {
    const candidate = resolve(directory, executable)
    if (existsSync(candidate)) return candidate
  }
  return null
}
