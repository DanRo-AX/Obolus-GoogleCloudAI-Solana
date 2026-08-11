#!/usr/bin/env node

import { spawnSync } from 'node:child_process'
import { mkdirSync, writeFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import {
  DEFAULT_INFRA_EXPECTATIONS,
  assertSecretFree,
  evaluateInfraSnapshot,
} from './lib/finalist-evidence.mjs'

const options = parseArgs(process.argv.slice(2))
const expectations = structuredClone(DEFAULT_INFRA_EXPECTATIONS)
for (const [role, digest] of Object.entries(options.expectedDigests)) {
  if (!expectations.services[role]) fail(`unknown service role for --expected-digest: ${role}`)
  expectations.services[role].expectedDigest = digest
}

const snapshot = await collectSnapshot({
  project: options.project,
  region: options.region,
  expectations,
  resolveRpcSecrets: options.resolveRpcSecrets,
})
const report = assertSecretFree(evaluateInfraSnapshot(snapshot, expectations))

if (options.output) {
  const output = resolve(options.output)
  mkdirSync(dirname(output), { recursive: true })
  writeFileSync(output, `${JSON.stringify(report, null, 2)}\n`, { mode: 0o600 })
  console.error(`wrote secret-free infrastructure evidence: ${output}`)
}
process.stdout.write(`${JSON.stringify(report, null, 2)}\n`)
process.exitCode = report.summary.ready ? 0 : 1

async function collectSnapshot({ project, region, expectations, resolveRpcSecrets }) {
  const services = {}
  for (const [role, expected] of Object.entries(expectations.services)) {
    const service = gcloudJson([
      'run',
      'services',
      'describe',
      expected.name,
      `--project=${project}`,
      `--region=${region}`,
    ])
    const traffic = (service.status?.traffic ?? service.spec?.traffic ?? [])
      .filter((entry) => entry.revisionName)
      .map((entry) => ({
        revision: entry.revisionName,
        percent: Number(entry.percent ?? 0),
        ...(entry.tag ? { tag: entry.tag } : {}),
      }))
    const revisionNames = new Set([
      service.status?.latestReadyRevisionName,
      ...traffic.map((entry) => entry.revision),
    ].filter(Boolean))
    const revisions = {}
    for (const revisionName of revisionNames) {
      const revision = gcloudJson([
        'run',
        'revisions',
        'describe',
        revisionName,
        `--project=${project}`,
        `--region=${region}`,
      ])
      revisions[revisionName] = await sanitizeRevision(revision, {
        project,
        region,
        role,
        resolveRpcSecrets,
        queueName: expectations.queue.name,
        kmsKeyName: expectations.kms.keyName,
      })
    }
    services[role] = {
      name: expected.name,
      latestReadyRevision: service.status?.latestReadyRevisionName ?? null,
      traffic,
      revisions,
      readiness: await probeReadiness(service.status?.url, expected.readiness),
    }
  }

  const sqlRaw = gcloudJson([
    'sql',
    'instances',
    'describe',
    expectations.sql.name,
    `--project=${project}`,
  ])
  const queueRaw = gcloudJson([
    'tasks',
    'queues',
    'describe',
    expectations.queue.name,
    `--project=${project}`,
    `--location=${region}`,
  ])
  const keyRaw = gcloudJson([
    'kms',
    'keys',
    'describe',
    expectations.kms.keyName,
    `--project=${project}`,
    `--location=${region}`,
    '--keyring=obolus',
  ])
  const versionsRaw = gcloudJson([
    'kms',
    'keys',
    'versions',
    'list',
    `--key=${expectations.kms.keyName}`,
    `--project=${project}`,
    `--location=${region}`,
    '--keyring=obolus',
  ])
  const keyIam = gcloudJson([
    'kms',
    'keys',
    'get-iam-policy',
    expectations.kms.keyName,
    `--project=${project}`,
    `--location=${region}`,
    '--keyring=obolus',
  ])

  return {
    collectedAt: new Date().toISOString(),
    project,
    region,
    services,
    sql: {
      name: sqlRaw.name,
      databaseVersion: sqlRaw.databaseVersion,
      state: sqlRaw.state,
      connectionName: sqlRaw.connectionName,
      backupEnabled: sqlRaw.settings?.backupConfiguration?.enabled === true,
      pointInTimeRecoveryEnabled:
        sqlRaw.settings?.backupConfiguration?.pointInTimeRecoveryEnabled === true,
      retainedBackups:
        sqlRaw.settings?.backupConfiguration?.backupRetentionSettings?.retainedBackups ?? 0,
      transactionLogRetentionDays:
        sqlRaw.settings?.backupConfiguration?.transactionLogRetentionDays ?? 0,
      sslMode: sqlRaw.settings?.ipConfiguration?.sslMode ?? null,
    },
    queue: {
      name: tailName(queueRaw.name),
      state: queueRaw.state,
      maxAttempts: queueRaw.retryConfig?.maxAttempts ?? 0,
      maxRetryDurationSeconds: durationSeconds(queueRaw.retryConfig?.maxRetryDuration),
      maxConcurrentDispatches: queueRaw.rateLimits?.maxConcurrentDispatches ?? 0,
      maxDispatchesPerSecond: queueRaw.rateLimits?.maxDispatchesPerSecond ?? 0,
    },
    kms: {
      keyName: tailName(keyRaw.name),
      purpose: keyRaw.purpose,
      enabledVersion: versionsRaw.find((version) => version.state === 'ENABLED')?.name
        ? tailName(versionsRaw.find((version) => version.state === 'ENABLED').name)
        : null,
      signers: signerServiceAccounts(keyIam),
    },
  }
}

async function sanitizeRevision(
  revision,
  { project, region, role, resolveRpcSecrets, queueName, kmsKeyName },
) {
  const container = revision.spec?.containers?.[0] ?? {}
  const env = new Map((container.env ?? []).map((entry) => [entry.name, entry]))
  const annotations = revision.metadata?.annotations ?? {}
  const cloudSql = String(annotations['run.googleapis.com/cloudsql-instances'] ?? '')
    .split(',')
    .map((entry) => entry.trim())
    .filter(Boolean)
  const rpcGroups = {}
  const definitions = {
    x402: ['X402_RPC_URL', 'X402_RECONCILIATION_RPC_URLS'],
    paySh: ['PAY_SH_RPC_URL', 'PAY_SH_RECONCILIATION_RPC_URLS'],
    payOrchestrator: ['OPENSHELF_PAY_RPC_URL', 'OPENSHELF_PAY_RECONCILIATION_RPC_URLS'],
  }
  for (const [group, names] of Object.entries(definitions)) {
    if (!names.some((name) => env.has(name))) continue
    rpcGroups[group] = await rpcSummary(names.map((name) => env.get(name)), {
      project,
      resolveRpcSecrets,
    })
  }

  return {
    name: revision.metadata?.name,
    image: container.image ?? null,
    serviceAccount: revision.spec?.serviceAccountName ?? null,
    ready: (revision.status?.conditions ?? []).some(
      (condition) => condition.type === 'Ready' && condition.status === 'True',
    ),
    cloudSqlConnections: cloudSql,
    databaseSecretBound: Boolean(env.get('OPENSHELF_DATABASE')?.valueFrom?.secretKeyRef),
    kmsKeyConfigured: String(env.get('OPENSHELF_PAY_GCP_KMS_KEY_NAME')?.value ?? '').includes(
      `/cryptoKeys/${kmsKeyName}/`,
    ),
    settlementQueueConfigured:
      env.get('GOOGLE_CLOUD_PROJECT')?.value === project &&
      env.get('OPENSHELF_SETTLEMENT_QUEUE_LOCATION')?.value === region &&
      env.get('OPENSHELF_SETTLEMENT_QUEUE')?.value === queueName &&
      /^https:\/\//.test(env.get('OPENSHELF_SETTLEMENT_TARGET_URL')?.value ?? ''),
    rpcGroups,
    role,
  }
}

async function rpcSummary(entries, { project, resolveRpcSecrets }) {
  const origins = []
  let resolved = true
  let bindings = 0
  for (const entry of entries.filter(Boolean)) {
    bindings += 1
    let raw
    if (typeof entry.value === 'string') {
      raw = entry.value
    } else if (entry.valueFrom?.secretKeyRef && resolveRpcSecrets) {
      const reference = entry.valueFrom.secretKeyRef
      try {
        raw = gcloudText([
          'secrets',
          'versions',
          'access',
          reference.key || 'latest',
          `--secret=${reference.name}`,
          `--project=${project}`,
        ])
      } catch {
        resolved = false
      }
    } else {
      resolved = false
    }
    for (const value of String(raw ?? '').split(',')) {
      const candidate = value.trim()
      if (!candidate) continue
      try {
        origins.push(new URL(candidate).origin)
      } catch {
        resolved = false
      }
    }
  }
  return {
    resolved: resolved && bindings >= 2 && origins.length >= 2,
    bindings,
    distinctOrigins: new Set(origins).size,
  }
}

async function probeReadiness(serviceUrl, expected) {
  if (!serviceUrl) return { status: null, bodyReady: false }
  try {
    const response = await fetch(new URL(expected.path, serviceUrl), {
      signal: AbortSignal.timeout(5_000),
      redirect: 'error',
    })
    let bodyReady = expected.status !== 200
    if (response.status === 200) {
      try {
        const body = await response.json()
        bodyReady = body?.status === 'ready'
      } catch {
        bodyReady = false
      }
    }
    return { status: response.status, bodyReady }
  } catch {
    return { status: null, bodyReady: false }
  }
}

function signerServiceAccounts(policy) {
  const members = (policy.bindings ?? [])
    .filter((binding) => binding.role === 'roles/cloudkms.signerVerifier')
    .flatMap((binding) => binding.members ?? [])
  return members
    .filter((member) => member.startsWith('serviceAccount:'))
    .map((member) => member.slice('serviceAccount:'.length).split('@')[0])
}

function gcloudJson(args) {
  return JSON.parse(gcloudText([...args, '--format=json']))
}

function gcloudText(args) {
  const result = spawnSync('gcloud', args, { encoding: 'utf8', maxBuffer: 20 * 1024 * 1024 })
  if (result.error) throw result.error
  if (result.status !== 0) {
    throw new Error(`gcloud ${args.slice(0, 3).join(' ')} failed with exit ${result.status}`)
  }
  return result.stdout.trim()
}

function durationSeconds(value) {
  const match = /^(\d+(?:\.\d+)?)s$/.exec(String(value ?? ''))
  return match ? Number(match[1]) : 0
}

function tailName(value) {
  return String(value ?? '').split('/').at(-1) || null
}

function parseArgs(args) {
  const result = {
    project: process.env.GOOGLE_CLOUD_PROJECT || 'sweetspot-ax',
    region: process.env.GOOGLE_CLOUD_REGION || 'asia-northeast3',
    output: null,
    resolveRpcSecrets: true,
    expectedDigests: {},
  }
  for (let index = 0; index < args.length; index += 1) {
    const argument = args[index]
    if (argument === '--project') result.project = requireNext(args, ++index, argument)
    else if (argument === '--region') result.region = requireNext(args, ++index, argument)
    else if (argument === '--output') result.output = requireNext(args, ++index, argument)
    else if (argument === '--no-resolve-rpc-secrets') result.resolveRpcSecrets = false
    else if (argument === '--expected-digest') {
      const [role, digest] = requireNext(args, ++index, argument).split('=')
      if (!role || !/^(?:sha256:)?[a-f0-9]{64}$/i.test(digest ?? '')) fail('--expected-digest requires role=sha256')
      result.expectedDigests[role] = digest.replace(/^sha256:/, '')
    } else if (argument === '--help') {
      console.log(`Usage: node scripts/verify-finalist-infra.mjs [options]\n\n` +
        `  --project PROJECT\n  --region REGION\n  --output PATH\n` +
        `  --expected-digest ROLE=SHA256   Repeat for api/gateway/orchestrator/pay\n` +
        `  --no-resolve-rpc-secrets        Intentionally fail two-RPC proof without reading Secret Manager\n`)
      process.exit(0)
    } else fail(`unknown argument: ${argument}`)
  }
  return result
}

function requireNext(args, index, flag) {
  if (!args[index]) fail(`${flag} requires a value`)
  return args[index]
}

function fail(message) {
  console.error(message)
  process.exit(2)
}
