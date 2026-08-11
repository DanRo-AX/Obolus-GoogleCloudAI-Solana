#!/usr/bin/env node

import { mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { assertSecretFree, buildDevnetEvidence } from './lib/finalist-evidence.mjs'

const { input, output } = parseArgs(process.argv.slice(2))
let raw
try {
  raw = JSON.parse(readFileSync(resolve(input), 'utf8'))
} catch (error) {
  console.error(`could not read structured Devnet run result: ${error.message}`)
  process.exit(2)
}

let report
try {
  // buildDevnetEvidence is an allowlist serializer: questions, passages, raw
  // responses, RPC URLs and wallet material in the source object are ignored.
  report = assertSecretFree(buildDevnetEvidence(raw))
} catch (error) {
  console.error(`Devnet evidence is malformed: ${error.message}`)
  process.exit(2)
}

const destination = resolve(output)
mkdirSync(dirname(destination), { recursive: true })
writeFileSync(destination, `${JSON.stringify(report, null, 2)}\n`, { mode: 0o600 })
process.stdout.write(`${JSON.stringify(report, null, 2)}\n`)
console.error(`wrote secret-free Devnet evidence: ${destination}`)
process.exitCode = report.summary.ready ? 0 : 1

function parseArgs(args) {
  const result = { input: null, output: null }
  for (let index = 0; index < args.length; index += 1) {
    const argument = args[index]
    if (argument === '--input') result.input = required(args, ++index, argument)
    else if (argument === '--output') result.output = required(args, ++index, argument)
    else if (argument === '--help') {
      console.log(`Usage: node scripts/record-finalist-devnet-evidence.mjs --input RUN.json --output EVIDENCE.json\n\n` +
        `The input may contain runtime detail. The output is an allowlisted, secret-free receipt bundle.\n`)
      process.exit(0)
    } else stop(`unknown argument: ${argument}`)
  }
  if (!result.input || !result.output) stop('--input and --output are required')
  return result
}

function required(args, index, flag) {
  if (!args[index]) stop(`${flag} requires a value`)
  return args[index]
}

function stop(message) {
  console.error(message)
  process.exit(2)
}
