#!/usr/bin/env node

import { chmodSync, mkdirSync, readFileSync, renameSync, unlinkSync, writeFileSync } from 'node:fs'
import { randomUUID } from 'node:crypto'
import { execFileSync } from 'node:child_process'
import { dirname, resolve } from 'node:path'
import { assertSecretFree, buildAutonomyEvidence } from './lib/finalist-evidence.mjs'

const { input, output, project } = parseArgs(process.argv.slice(2))
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
  const provenance = project ? verifyCloudRunLog(raw, project) : null
  report = assertSecretFree(buildAutonomyEvidence(raw, new Date().toISOString(), provenance))
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
  const result = { input: null, output: null, project: null }
  for (let index = 0; index < args.length; index += 1) {
    const argument = args[index]
    if (argument === '--input') result.input = required(args, ++index, argument)
    else if (argument === '--output') result.output = required(args, ++index, argument)
    else if (argument === '--project') result.project = required(args, ++index, argument)
    else if (argument === '--help') {
      console.log(`Usage: node scripts/record-finalist-autonomy-evidence.mjs --input RUN.json --output EVIDENCE.json\n\n` +
        `The input may be a raw /questions/resolve response. --project verifies the matching deployed-run log and is required for a ready report.\n`)
      process.exit(0)
    } else stop(`unknown argument: ${argument}`)
  }
  if (!result.input || !result.output) stop('--input and --output are required')
  return result
}

function verifyCloudRunLog(raw, project) {
  if (!/^[a-z][a-z0-9-]{4,62}$/.test(project)) stop('--project is malformed')
  const response = raw?.response && typeof raw.response === 'object' ? raw.response : raw
  const run = response?.agentRun ?? {}
  const runId = String(run.id ?? '')
  const queryId = String(response?.queryId ?? '')
  const revision = String(run.runtimeRevision ?? '')
  if (!/^agent_[A-Za-z0-9._:-]+$/.test(runId)) stop('agent run id is missing or malformed')
  if (!/^qry_[A-Za-z0-9._:-]+$/.test(queryId)) stop('query id is missing or malformed')
  if (!/^obolus-api-[A-Za-z0-9-]+$/.test(revision)) stop('deployed API runtime revision is missing or malformed')

  const filter = [
    'resource.type="cloud_run_revision"',
    'resource.labels.service_name="obolus-api"',
    `resource.labels.revision_name="${revision}"`,
    'textPayload:"bounded research run completed"',
  ].join(' AND ')
  let entries
  try {
    entries = JSON.parse(execFileSync(process.env.OBOLUS_GCLOUD_BIN ?? 'gcloud', [
      'logging',
      'read',
      filter,
      `--project=${project}`,
      '--freshness=2h',
      '--limit=100',
      '--format=json',
    ], { encoding: 'utf8', timeout: 20_000 }))
  } catch (error) {
    stop(`matching Cloud Run log could not be read: ${error.message}`)
  }
  const entry = (Array.isArray(entries) ? entries : []).find((candidate) => {
    // tracing-subscriber enables ANSI when the runtime does not explicitly
    // disable it. Cloud Logging preserves those escape sequences between a
    // field name, `=`, and its value, so normalize display-only control codes
    // before performing the exact run correlation.
    const text = String(candidate?.textPayload ?? '').replace(/\x1b\[[0-9;]*m/g, '')
    return candidate?.resource?.labels?.service_name === 'obolus-api' &&
      candidate?.resource?.labels?.revision_name === revision &&
      text.includes(`agent_run_id=${runId}`) &&
      text.includes(`query_id=${queryId}`) &&
      text.includes('provider_call_count=2') &&
      text.includes('mode="vertex_two_stage_with_deterministic_guards"')
  })
  if (!entry || !Number.isFinite(Date.parse(entry.timestamp))) {
    stop('no matching two-stage Cloud Run application log was found')
  }
  return {
    kind: 'cloud_run_application_log',
    verified: true,
    project,
    service: 'obolus-api',
    runtimeRevision: revision,
    logTimestamp: new Date(Date.parse(entry.timestamp)).toISOString(),
  }
}

function required(args, index, flag) {
  if (!args[index]) stop(`${flag} requires a value`)
  return args[index]
}

function stop(message) {
  console.error(message)
  process.exit(2)
}
