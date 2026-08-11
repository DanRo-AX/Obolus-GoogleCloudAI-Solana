import { createHash } from 'node:crypto'
import { chmod, copyFile, mkdir, readFile, writeFile } from 'node:fs/promises'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { execFile } from 'node:child_process'
import { promisify } from 'node:util'

const execFileAsync = promisify(execFile)
const root = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const source = resolve(root, '../obulus-local-agent/node_modules/@solana/pay/bin/pay')
const target = resolve(root, 'build/pay')
const checksumTarget = resolve(root, 'build/pay.sha256')

export async function stagePayBinary(options = {}) {
  const input = options.source || source
  const output = options.target || target
  const checksumOutput = options.checksumTarget || checksumTarget
  const runner = options.runner || execFileAsync
  const { stdout } = await runner(input, ['--version'], { timeout: 15_000 })
  const version = String(stdout || '').trim()
  if (!/^pay 0\.26\.0$/.test(version)) {
    throw new Error(`Expected Pay.sh 0.26.0, found ${version || 'unknown'}`)
  }
  await mkdir(dirname(output), { recursive: true })
  await copyFile(input, output)
  await chmod(output, 0o755)
  const digest = createHash('sha256').update(await readFile(output)).digest('hex')
  await writeFile(checksumOutput, `${digest}\n`, { mode: 0o644 })
  return { version: version.replace(/^pay\s+/, ''), digest, target: output }
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  stagePayBinary()
    .then((result) => process.stdout.write(`${JSON.stringify(result, null, 2)}\n`))
    .catch((error) => {
      process.stderr.write(`${error.message}\n`)
      process.exitCode = 1
    })
}
