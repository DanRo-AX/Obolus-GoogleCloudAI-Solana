#!/usr/bin/env node

import { spawnSync } from 'node:child_process'
import { mkdirSync, writeFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import {
  DEFAULT_INFRA_EXPECTATIONS,
  assertSecretFree,
  evaluatePromotion,
} from './lib/finalist-evidence.mjs'

const options = parseArgs(process.argv.slice(2))
const expectation = structuredClone(DEFAULT_INFRA_EXPECTATIONS.services[options.role])
if (!expectation) stop(`unknown role: ${options.role}`)
if (options.expectedDigest) expectation.expectedDigest = options.expectedDigest

const raw = gcloudJson([
  'run',
  'revisions',
  'describe',
  options.revision,
  `--project=${options.project}`,
  `--region=${options.region}`,
])
const revisionService = raw.metadata?.labels?.['serving.knative.dev/service']
const revision = {
  name: raw.metadata?.name,
  image: raw.spec?.containers?.[0]?.image ?? null,
  serviceAccount: raw.spec?.serviceAccountName ?? null,
  ready: (raw.status?.conditions ?? []).some(
    (condition) => condition.type === 'Ready' && condition.status === 'True',
  ),
  rpcGroups: collectRpcGroups(raw.spec?.containers?.[0]?.env ?? [], {
    project: options.project,
    resolveSecrets: options.resolveRpcSecrets,
  }),
  settlementQueueConfigured: settlementQueueConfigured(raw.spec?.containers?.[0]?.env ?? []),
  kmsKeyConfigured: kmsKeyConfigured(raw.spec?.containers?.[0]?.env ?? []),
}
const report = evaluatePromotion(revision, expectation)
if (revisionService !== expectation.name) {
  report.approved = false
  report.reasons.push(`revision belongs to ${revisionService ?? 'an unknown service'}, not ${expectation.name}`)
}
report.project = options.project
report.region = options.region
if (report.approved) {
  report.manualPromotionCommand = [
    'gcloud',
    'run',
    'services',
    'update-traffic',
    expectation.name,
    `--project=${options.project}`,
    `--region=${options.region}`,
    `--to-revisions=${options.revision}=100`,
  ].join(' ')
}
assertSecretFree(report)

if (options.output) {
  const output = resolve(options.output)
  mkdirSync(dirname(output), { recursive: true })
  writeFileSync(output, `${JSON.stringify(report, null, 2)}\n`, { mode: 0o600 })
  console.error(`wrote promotion decision: ${output}`)
}
process.stdout.write(`${JSON.stringify(report, null, 2)}\n`)
if (!report.approved) {
  console.error('promotion denied; traffic was not changed')
  process.exitCode = 1
} else {
  console.error('promotion checks passed; review and run the printed revision-pinned command manually')
}

function collectRpcGroups(envEntries, { project, resolveSecrets }) {
  const env = new Map(envEntries.map((entry) => [entry.name, entry]))
  const definitions = {
    x402: ['X402_RPC_URL', 'X402_RECONCILIATION_RPC_URLS'],
    paySh: ['PAY_SH_RPC_URL', 'PAY_SH_RECONCILIATION_RPC_URLS'],
    payOrchestrator: ['OPENSHELF_PAY_RPC_URL', 'OPENSHELF_PAY_RECONCILIATION_RPC_URLS'],
  }
  const result = {}
  for (const [group, names] of Object.entries(definitions)) {
    if (!names.some((name) => env.has(name))) continue
    const origins = []
    let resolved = true
    let bindings = 0
    for (const name of names) {
      const entry = env.get(name)
      if (!entry) continue
      bindings += 1
      let rawValue
      if (typeof entry.value === 'string') rawValue = entry.value
      else if (entry.valueFrom?.secretKeyRef && resolveSecrets) {
        const reference = entry.valueFrom.secretKeyRef
        try {
          rawValue = gcloudText([
            'secrets', 'versions', 'access', reference.key || 'latest',
            `--secret=${reference.name}`,
            `--project=${project}`,
          ])
        } catch {
          resolved = false
        }
      } else resolved = false
      for (const value of String(rawValue ?? '').split(',')) {
        try {
          if (value.trim()) origins.push(new URL(value.trim()).origin)
        } catch {
          resolved = false
        }
      }
    }
    result[group] = {
      resolved: resolved && bindings >= 2 && origins.length >= 2,
      bindings,
      distinctOrigins: new Set(origins).size,
    }
  }
  return result
}

function settlementQueueConfigured(envEntries) {
  const env = new Map(envEntries.map((entry) => [entry.name, entry.value]))
  return (
    env.get('GOOGLE_CLOUD_PROJECT') === options.project &&
    env.get('OPENSHELF_SETTLEMENT_QUEUE_LOCATION') === options.region &&
    env.get('OPENSHELF_SETTLEMENT_QUEUE') === DEFAULT_INFRA_EXPECTATIONS.queue.name &&
    /^https:\/\//.test(env.get('OPENSHELF_SETTLEMENT_TARGET_URL') ?? '')
  )
}

function kmsKeyConfigured(envEntries) {
  const env = new Map(envEntries.map((entry) => [entry.name, entry.value]))
  return String(env.get('OPENSHELF_PAY_GCP_KMS_KEY_NAME') ?? '').includes(
    `/cryptoKeys/${DEFAULT_INFRA_EXPECTATIONS.kms.keyName}/`,
  )
}

function gcloudJson(args) {
  return JSON.parse(gcloudText([...args, '--format=json']))
}

function gcloudText(args) {
  const result = spawnSync('gcloud', args, { encoding: 'utf8', maxBuffer: 20 * 1024 * 1024 })
  if (result.error) throw result.error
  if (result.status !== 0) throw new Error(`gcloud ${args.slice(0, 3).join(' ')} failed with exit ${result.status}`)
  return result.stdout.trim()
}

function parseArgs(args) {
  const result = {
    project: process.env.GOOGLE_CLOUD_PROJECT || 'sweetspot-ax',
    region: process.env.GOOGLE_CLOUD_REGION || 'asia-northeast3',
    role: null,
    revision: null,
    expectedDigest: null,
    resolveRpcSecrets: true,
    output: null,
  }
  for (let index = 0; index < args.length; index += 1) {
    const argument = args[index]
    if (argument === '--project') result.project = required(args, ++index, argument)
    else if (argument === '--region') result.region = required(args, ++index, argument)
    else if (argument === '--role') result.role = required(args, ++index, argument)
    else if (argument === '--revision') result.revision = required(args, ++index, argument)
    else if (argument === '--output') result.output = required(args, ++index, argument)
    else if (argument === '--no-resolve-rpc-secrets') result.resolveRpcSecrets = false
    else if (argument === '--expected-digest') {
      const digest = required(args, ++index, argument).replace(/^sha256:/, '')
      if (!/^[a-f0-9]{64}$/i.test(digest)) stop('--expected-digest must be a sha256 digest')
      result.expectedDigest = digest
    } else if (argument === '--help') {
      console.log(`Usage: node scripts/guard-cloud-run-promotion.mjs --role ROLE --revision REVISION [options]\n\n` +
        `This command is read-only. It never changes Cloud Run traffic and never emits --to-latest.\n`)
      process.exit(0)
    } else stop(`unknown argument: ${argument}`)
  }
  if (!result.role || !result.revision) stop('--role and --revision are required')
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
