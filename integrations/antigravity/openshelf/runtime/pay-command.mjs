import { existsSync } from 'node:fs'
import { delimiter, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const PROJECT_PAY = fileURLToPath(
  new URL(
    process.platform === 'win32'
      ? '../../../../node_modules/.bin/pay.cmd'
      : '../../../../node_modules/.bin/pay',
    import.meta.url,
  ),
)

/**
 * Resolve one Pay CLI for every OpenShelf entry point.
 *
 * A plugin installation normally uses the user's global `pay`. A repository
 * checkout also pins the official npm binary, so `.agents/mcp_config.json`
 * works immediately after `npm ci` without a second global installation.
 */
export function payInvocation(env = process.env, options = {}) {
  const override = env.OPENSHELF_PAY_COMMAND?.trim()
  if (override) return { command: override, args: [], source: 'override' }

  const projectPay = options.projectPay || PROJECT_PAY
  if (existsSync(projectPay)) {
    return { command: projectPay, args: [], source: 'project' }
  }

  const systemPay = (options.findSystemPay || findSystemPay)(env)
  if (systemPay) return { command: systemPay, args: [], source: 'system' }

  return {
    command: process.platform === 'win32' ? 'npx.cmd' : 'npx',
    args: ['--yes', '@solana/pay@1.0.26'],
    source: 'pinned-npx',
  }
}

function findSystemPay(env) {
  const executable = process.platform === 'win32' ? 'pay.exe' : 'pay'
  for (const directory of (env.PATH || '').split(delimiter).filter(Boolean)) {
    const candidate = resolve(directory, executable)
    if (existsSync(candidate)) return candidate
  }
  return null
}
