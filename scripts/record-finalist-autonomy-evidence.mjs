#!/usr/bin/env node

import { chmodSync, mkdirSync, readFileSync, renameSync, unlinkSync, writeFileSync } from 'node:fs'
import { randomUUID } from 'node:crypto'
import { dirname, resolve } from 'node:path'
import { assertSecretFree, buildAutonomyEvidence } from './lib/finalist-evidence.mjs'

const { input, output } = parseArgs(process.argv.slice(2))
const source = resolve(input)
const destination = resolve(output)
if (source === destination) stop('--input and --output must be different files')
let raw
try {
  raw = JSON.parse(readFileSync(source, 'utf8'))
} catch (error) {
  console.error(`could not read structured autonomy run result: ${error.message}`)
  process.exit(2)
}

let report
try {
  // The source may be a raw /questions/resolve response. The builder copies
  // only bounded trace metadata, never the question, passages, capabilities,
  // cookies, model payload, or hidden reasoning.
  report = assertSecretFree(buildAutonomyEvidence(raw))
} catch (error) {
  console.error(`autonomy evidence is malformed: ${error.message}`)
  process.exit(2)
}

const temporary = `${destination}.tmp-${randomUUID()}`
let temporaryCreated = false
try {
  mkdirSync(dirname(destination), { recursive: true })
  writeFileSync(temporary, `${JSON.stringify(report, null, 2)}\n`, {
    flag: 'wx',
    mode: 0o600,
  })
  temporaryCreated = true
  renameSync(temporary, destination)
  temporaryCreated = false
  chmodSync(destination, 0o600)
} catch (error) {
  if (temporaryCreated) {
    try {
      unlinkSync(temporary)
    } catch {
      // A best-effort cleanup must not hide the original write failure.
    }
  }
  console.error(`could not write autonomy evidence: ${error.message}`)
  process.exit(2)
}
process.stdout.write(`${JSON.stringify(report, null, 2)}\n`)
console.error(`wrote secret-free autonomy evidence: ${destination}`)
process.exitCode = report.summary.ready ? 0 : 1

function parseArgs(args) {
  const result = { input: null, output: null }
  for (let index = 0; index < args.length; index += 1) {
    const argument = args[index]
    if (argument === '--input') result.input = required(args, ++index, argument)
    else if (argument === '--output') result.output = required(args, ++index, argument)
    else if (argument === '--help') {
      console.log(`Usage: node scripts/record-finalist-autonomy-evidence.mjs --input RUN.json --output EVIDENCE.json\n\n` +
        `The input may be a raw /questions/resolve response. The output is an allowlisted, secret-free trace.\n`)
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
