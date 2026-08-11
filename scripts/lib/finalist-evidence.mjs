import { createHash } from 'node:crypto'

export const DEVNET_NETWORK = 'solana:EtWTRABZaYq6iMfeYKouRu166VU2xqa1'

export const DEFAULT_INFRA_EXPECTATIONS = Object.freeze({
  services: {
    api: {
      name: 'obolus-api',
      imageComponent: 'api',
      serviceAccount: 'obolus-api-run',
      readiness: { path: '/readyz', status: 200 },
      requireCloudSql: true,
      requireDatabaseSecret: true,
    },
    gateway: {
      name: 'obolus-gateway',
      imageComponent: 'gateway',
      serviceAccount: 'obolus-gateway-run',
      readiness: { path: '/readyz', status: 200 },
      rpcGroups: ['x402', 'paySh'],
      requireSettlementQueue: true,
    },
    orchestrator: {
      name: 'obolus-orchestrator',
      imageComponent: 'orchestrator',
      serviceAccount: 'obolus-orchestrator-run',
      readiness: { path: '/readyz', status: 200 },
      rpcGroups: ['payOrchestrator'],
      requireKmsKey: true,
    },
    pay: {
      name: 'obolus-pay',
      imageComponent: 'pay',
      serviceAccount: 'obolus-pay',
      // The production Pay.sh front must not expose the collector health route.
      readiness: { path: '/__402/health', status: 404 },
    },
  },
  sql: {
    name: 'ax-apps-db',
    databaseVersion: 'POSTGRES_16',
    minimumRetainedBackups: 7,
    minimumTransactionLogDays: 7,
  },
  queue: {
    name: 'obolus-settlements',
    minimumAttempts: 20,
    minimumRetryDurationSeconds: 86_400,
  },
  kms: {
    keyName: 'solana-service-wallet',
    purpose: 'ASYMMETRIC_SIGN',
    signers: ['obolus-orchestrator-run', 'obolus-pay'],
  },
})

export function evaluateInfraSnapshot(snapshot, expectations = DEFAULT_INFRA_EXPECTATIONS) {
  const checks = []
  const add = (id, passed, message, evidence = undefined) => {
    checks.push({ id, passed: Boolean(passed), message, ...(evidence ? { evidence } : {}) })
  }

  for (const [role, expected] of Object.entries(expectations.services)) {
    const service = snapshot.services?.[role]
    add(`run.${role}.exists`, Boolean(service), `${expected.name} Cloud Run service is present`)
    if (!service) continue

    const serving = (service.traffic ?? []).filter((entry) => Number(entry.percent) > 0)
    add(
      `run.${role}.traffic`,
      serving.length > 0 && serving.reduce((sum, entry) => sum + Number(entry.percent), 0) === 100,
      `${expected.name} has an explicit 100% serving traffic allocation`,
      { revisions: serving.map((entry) => entry.revision), totalPercent: serving.reduce((sum, entry) => sum + Number(entry.percent), 0) },
    )

    for (const entry of serving) {
      checkRevision(add, role, service.revisions?.[entry.revision], expected, `serving.${entry.revision}`)
    }

    const latest = service.revisions?.[service.latestReadyRevision]
    checkRevision(add, role, latest, expected, `latest.${service.latestReadyRevision ?? 'missing'}`)
    add(
      `run.${role}.latest-safe`,
      Boolean(latest && imageMatchesComponent(latest.image, expected.imageComponent)),
      `latest-ready ${expected.name} revision cannot promote another service image`,
      latest ? { revision: latest.name, image: latest.image } : undefined,
    )

    add(
      `run.${role}.readyz`,
      service.readiness?.status === expected.readiness.status &&
        (expected.readiness.status !== 200 || service.readiness?.bodyReady === true),
      `${expected.readiness.path} fails closed with the expected public status`,
      {
        expectedStatus: expected.readiness.status,
        actualStatus: service.readiness?.status ?? null,
        bodyReady: service.readiness?.bodyReady ?? null,
      },
    )

    for (const group of expected.rpcGroups ?? []) {
      for (const entry of serving) {
        const rpc = service.revisions?.[entry.revision]?.rpcGroups?.[group]
        add(
          `run.${role}.${entry.revision}.rpc.${group}`,
          Boolean(rpc?.resolved && rpc.distinctOrigins >= 2),
          `${group} finality uses at least two independently resolved RPC origins`,
          {
            revision: entry.revision,
            resolved: Boolean(rpc?.resolved),
            distinctOrigins: rpc?.distinctOrigins ?? 0,
          },
        )
      }
    }
  }

  const sql = snapshot.sql
  const sqlExpected = expectations.sql
  add('sql.exists', Boolean(sql), `${sqlExpected.name} Cloud SQL instance is present`)
  if (sql) {
    add('sql.engine', sql.databaseVersion === sqlExpected.databaseVersion, `Cloud SQL uses ${sqlExpected.databaseVersion}`)
    add('sql.running', sql.state === 'RUNNABLE', 'Cloud SQL is runnable')
    add('sql.backup', Boolean(sql.backupEnabled), 'Cloud SQL automated backups are enabled')
    add('sql.pitr', Boolean(sql.pointInTimeRecoveryEnabled), 'Cloud SQL point-in-time recovery is enabled')
    add(
      'sql.retention',
      Number(sql.retainedBackups) >= sqlExpected.minimumRetainedBackups &&
        Number(sql.transactionLogRetentionDays) >= sqlExpected.minimumTransactionLogDays,
      'Cloud SQL retains enough backups and transaction logs for payment-ledger recovery',
      {
        retainedBackups: Number(sql.retainedBackups ?? 0),
        transactionLogRetentionDays: Number(sql.transactionLogRetentionDays ?? 0),
      },
    )
    add(
      'sql.transport',
      sql.sslMode !== 'ALLOW_UNENCRYPTED_AND_ENCRYPTED',
      'Cloud SQL does not permit unencrypted direct connections',
      { sslMode: sql.sslMode ?? null },
    )

    const api = snapshot.services?.api
    for (const entry of (api?.traffic ?? []).filter((candidate) => Number(candidate.percent) > 0)) {
      const revision = api.revisions?.[entry.revision]
      add(
        `sql.api-binding.${entry.revision}`,
        Boolean(revision?.cloudSqlConnections?.includes(sql.connectionName)),
        'serving API revision mounts the audited Cloud SQL instance',
        { revision: entry.revision, bound: Boolean(revision?.cloudSqlConnections?.includes(sql.connectionName)) },
      )
      add(
        `sql.api-secret.${entry.revision}`,
        Boolean(revision?.databaseSecretBound),
        'serving API database URL is injected from Secret Manager',
        { revision: entry.revision, secretBound: Boolean(revision?.databaseSecretBound) },
      )
    }
  }

  const queue = snapshot.queue
  const queueExpected = expectations.queue
  add('tasks.exists', Boolean(queue), `${queueExpected.name} Cloud Tasks queue is present`)
  if (queue) {
    add('tasks.running', queue.state === 'RUNNING', 'settlement queue is running')
    add(
      'tasks.retry',
      Number(queue.maxAttempts) >= queueExpected.minimumAttempts &&
        Number(queue.maxRetryDurationSeconds) >= queueExpected.minimumRetryDurationSeconds,
      'settlement tasks have durable bounded retries',
      {
        maxAttempts: Number(queue.maxAttempts ?? 0),
        maxRetryDurationSeconds: Number(queue.maxRetryDurationSeconds ?? 0),
      },
    )
    add(
      'tasks.capacity',
      Number(queue.maxConcurrentDispatches) > 0 && Number(queue.maxDispatchesPerSecond) > 0,
      'settlement queue has explicit concurrency and dispatch limits',
      {
        maxConcurrentDispatches: Number(queue.maxConcurrentDispatches ?? 0),
        maxDispatchesPerSecond: Number(queue.maxDispatchesPerSecond ?? 0),
      },
    )
  }

  const kms = snapshot.kms
  const kmsExpected = expectations.kms
  add('kms.exists', Boolean(kms), `${kmsExpected.keyName} KMS key is present`)
  if (kms) {
    add('kms.purpose', kms.purpose === kmsExpected.purpose, `KMS key purpose is ${kmsExpected.purpose}`)
    add('kms.version', Boolean(kms.enabledVersion), 'KMS has an enabled asymmetric signing version')
    for (const signer of kmsExpected.signers) {
      add(
        `kms.signer.${signer}`,
        (kms.signers ?? []).includes(signer),
        `${signer} has KMS signerVerifier and no private-key export is required`,
      )
    }
  }

  const failed = checks.filter((check) => !check.passed).length
  return {
    schemaVersion: 'obulus.finalist.infrastructure.v1',
    generatedAt: snapshot.collectedAt ?? new Date().toISOString(),
    project: snapshot.project,
    region: snapshot.region,
    release: summarizeRelease(snapshot),
    resources: {
      cloudSql: sql ? { name: sql.name, databaseVersion: sql.databaseVersion, state: sql.state } : null,
      cloudTasks: queue ? { name: queue.name, state: queue.state } : null,
      kms: kms ? { keyName: kms.keyName, purpose: kms.purpose, enabledVersion: kms.enabledVersion } : null,
    },
    summary: { passed: checks.length - failed, failed, ready: failed === 0 },
    checks,
  }
}

function checkRevision(add, role, revision, expected, label) {
  add(`run.${role}.${label}.exists`, Boolean(revision), `${label} revision is inspectable`)
  if (!revision) return
  add(`run.${role}.${label}.ready`, revision.ready === true, `${label} revision reports Ready=True`)
  add(
    `run.${role}.${label}.image`,
    imageMatchesComponent(revision.image, expected.imageComponent),
    `${label} revision uses the ${expected.imageComponent} image repository`,
    { revision: revision.name, image: revision.image },
  )
  if (expected.expectedDigest) {
    add(
      `run.${role}.${label}.release-digest`,
      revision.image?.endsWith(`@sha256:${expected.expectedDigest.replace(/^sha256:/, '')}`),
      `${label} revision matches the explicitly approved image digest`,
      { revision: revision.name, expectedDigest: `sha256:${expected.expectedDigest.replace(/^sha256:/, '')}` },
    )
  }
  add(
    `run.${role}.${label}.identity`,
    serviceAccountMatches(revision.serviceAccount, expected.serviceAccount),
    `${label} revision uses the dedicated ${expected.serviceAccount} service account`,
    { revision: revision.name, serviceAccount: revision.serviceAccount ?? null },
  )
  if (expected.requireCloudSql) {
    add(
      `run.${role}.${label}.cloudsql`,
      (revision.cloudSqlConnections ?? []).length > 0,
      `${label} revision mounts Cloud SQL`,
    )
  }
  if (expected.requireDatabaseSecret) {
    add(
      `run.${role}.${label}.db-secret`,
      revision.databaseSecretBound === true,
      `${label} revision injects the database URL from Secret Manager`,
    )
  }
  if (expected.requireSettlementQueue) {
    add(
      `run.${role}.${label}.settlement-queue`,
      revision.settlementQueueConfigured === true,
      `${label} revision is bound to the audited Cloud Tasks queue and target`,
    )
  }
  if (expected.requireKmsKey) {
    add(
      `run.${role}.${label}.kms-key`,
      revision.kmsKeyConfigured === true,
      `${label} revision is bound to the audited KMS signing key`,
    )
  }
}

export function evaluatePromotion(revision, expectation) {
  const reasons = []
  if (!revision) reasons.push('revision does not exist')
  if (revision && revision.ready !== true) reasons.push('revision is not Ready=True')
  if (revision && !imageMatchesComponent(revision.image, expectation.imageComponent)) {
    reasons.push(`image is not from the ${expectation.imageComponent} repository`)
  }
  if (revision && !serviceAccountMatches(revision.serviceAccount, expectation.serviceAccount)) {
    reasons.push(`service account is not ${expectation.serviceAccount}`)
  }
  if (revision && expectation.expectedDigest && !revision.image?.endsWith(`@sha256:${expectation.expectedDigest.replace(/^sha256:/, '')}`)) {
    reasons.push('image digest does not match the approved release digest')
  }
  for (const group of expectation.rpcGroups ?? []) {
    const rpc = revision?.rpcGroups?.[group]
    if (!rpc?.resolved || rpc.distinctOrigins < 2) reasons.push(`${group} does not have two independent RPC origins`)
  }
  if (expectation.requireSettlementQueue && revision?.settlementQueueConfigured !== true) {
    reasons.push('revision is not bound to the audited Cloud Tasks settlement queue')
  }
  if (expectation.requireKmsKey && revision?.kmsKeyConfigured !== true) {
    reasons.push('revision is not bound to the audited KMS signing key')
  }
  return {
    schemaVersion: 'obulus.finalist.promotion-guard.v1',
    approved: reasons.length === 0,
    service: expectation.name,
    revision: revision?.name ?? null,
    image: revision?.image ?? null,
    serviceAccount: revision?.serviceAccount ?? null,
    reasons,
  }
}

export function buildDevnetEvidence(input, generatedAt = new Date().toISOString()) {
  const transactions = (input.transactions ?? []).map((transaction) => ({
    kind: allowedKind(transaction.kind),
    signature: safeBase58(transaction.signature, 'transaction signature'),
    quoteIds: uniqueStrings(transaction.quoteIds ?? []),
    status: String(transaction.status ?? ''),
    finalityProviderCount: positiveInteger(transaction.finalityProviderCount),
    ownerDeltaAtomic: canonicalAtomic(transaction.ownerDeltaAtomic, { allowZero: false }),
    ...(transaction.payerDeltaAtomic !== undefined
      ? { payerDeltaAtomic: canonicalAtomic(transaction.payerDeltaAtomic, { allowNegative: true }) }
      : {}),
    explorerUrl: explorerUrl(safeBase58(transaction.signature, 'transaction signature')),
  }))

  const refundInput = input.refund
  const refund = refundInput
    ? {
        claimId: safeId(refundInput.claimId, 'refund claim id'),
        status: String(refundInput.status ?? ''),
        amountAtomic: canonicalAtomic(refundInput.amountAtomic, { allowZero: false }),
        signature: safeBase58(refundInput.signature, 'refund signature'),
        finalityProviderCount: positiveInteger(refundInput.finalityProviderCount),
        explorerUrl: explorerUrl(safeBase58(refundInput.signature, 'refund signature')),
      }
    : null

  const quotes = (input.quotes ?? []).map((quote) => ({
    id: safeId(quote.id, 'quote id'),
    kind: allowedKind(quote.kind),
    status: String(quote.status ?? ''),
    amountAtomic: canonicalAtomic(quote.amountAtomic, { allowZero: false }),
    asset: safeBase58(quote.asset, 'asset mint'),
  }))
  const uniqueSignatures = new Set(transactions.map((transaction) => transaction.signature))
  const duplicateSettlementCount = Number(input.duplicateProtection?.duplicateSettlementCount)
  const retryAttempts = Number(input.duplicateProtection?.retryAttempts)

  const checks = [
    evidenceCheck('network.devnet', input.network === DEVNET_NETWORK, 'receipt uses Solana Devnet'),
    evidenceCheck('query.id', Boolean(safeIdOrNull(input.queryId)), 'query id is recorded'),
    evidenceCheck('job.id', Boolean(safeIdOrNull(input.jobId)), 'research job id is recorded'),
    evidenceCheck('quotes.present', quotes.length > 0, 'one or more exact quotes are recorded'),
    evidenceCheck('transactions.present', transactions.length > 0, 'one or more on-chain transactions are recorded'),
    evidenceCheck(
      'transactions.finalized',
      transactions.length > 0 && transactions.every((transaction) => transaction.status === 'finalized'),
      'every payment transaction is finalized',
    ),
    evidenceCheck(
      'transactions.two-rpc',
      transactions.length > 0 && transactions.every((transaction) => transaction.finalityProviderCount >= 2),
      'every payment receipt is reproduced by at least two RPC origins',
    ),
    evidenceCheck(
      'transactions.owner-delta',
      transactions.length > 0 && transactions.every((transaction) => BigInt(transaction.ownerDeltaAtomic) > 0n),
      'every settled purchase has a positive owner token delta',
    ),
    evidenceCheck(
      'duplicates.zero',
      Number.isInteger(duplicateSettlementCount) && duplicateSettlementCount === 0 && uniqueSignatures.size === transactions.length,
      'retry produced zero duplicate settlements',
    ),
    evidenceCheck(
      'duplicates.retry-exercised',
      Number.isInteger(retryAttempts) && retryAttempts >= 1,
      'the same durable job was retried at least once',
    ),
    evidenceCheck('refund.present', Boolean(refund), 'unused or failed reservation refund is recorded'),
    evidenceCheck('refund.finalized', refund?.status === 'finalized', 'refund transaction is finalized'),
    evidenceCheck('refund.two-rpc', Number(refund?.finalityProviderCount) >= 2, 'refund is verified by at least two RPC origins'),
  ]
  const failed = checks.filter((check) => !check.passed).length

  return {
    schemaVersion: 'obulus.finalist.devnet-evidence.v1',
    generatedAt,
    runId: safeId(input.runId, 'run id'),
    network: input.network,
    query: { id: safeId(input.queryId, 'query id') },
    job: { id: safeId(input.jobId, 'job id'), status: String(input.jobStatus ?? '') },
    quotes,
    transactions,
    duplicateProtection: {
      retryAttempts: Number.isInteger(retryAttempts) ? retryAttempts : 0,
      uniqueSignatures: uniqueSignatures.size,
      duplicateSettlementCount: Number.isInteger(duplicateSettlementCount) ? duplicateSettlementCount : -1,
    },
    refund,
    summary: { passed: checks.length - failed, failed, ready: failed === 0 },
    checks,
  }
}

export function assertSecretFree(value) {
  const serialized = JSON.stringify(value)
  const forbidden = [
    /"private[_-]?key"\s*:/i,
    /"seed[_-]?phrase"\s*:/i,
    /"mnemonic"\s*:/i,
    /"authorization"\s*:/i,
    /bearer\s+[a-z0-9._-]+/i,
    /(?:postgres(?:ql)?):\/\//i,
    /"api[_-]?key"\s*:/i,
    /"passage"\s*:/i,
    /"responseText"\s*:/i,
    /"questionText"\s*:/i,
  ]
  const match = forbidden.find((pattern) => pattern.test(serialized))
  if (match) throw new Error(`evidence contains forbidden sensitive field or value (${match})`)
  return value
}

export function imageMatchesComponent(image, component) {
  if (typeof image !== 'string' || !image) return false
  const withoutDigest = image.split('@')[0]
  const withoutTag = withoutDigest.replace(/:[^/]+$/, '')
  return withoutTag.endsWith(`/obolus/${component}`) || withoutTag.endsWith(`/openshelf/${component}`)
}

function summarizeRelease(snapshot) {
  return Object.fromEntries(
    Object.entries(snapshot.services ?? {}).map(([role, service]) => [
      role,
      {
        latestReadyRevision: service.latestReadyRevision ?? null,
        servingRevisions: (service.traffic ?? [])
          .filter((entry) => Number(entry.percent) > 0)
          .map((entry) => ({ revision: entry.revision, percent: Number(entry.percent) })),
        images: uniqueStrings(
          Object.values(service.revisions ?? {})
            .map((revision) => revision.image)
            .filter(Boolean),
        ),
      },
    ]),
  )
}

function serviceAccountMatches(actual, expectedShortName) {
  return typeof actual === 'string' && (actual === expectedShortName || actual.startsWith(`${expectedShortName}@`))
}

function allowedKind(value) {
  const kind = String(value ?? '')
  if (!['evidence', 'open-call-payout', 'refund'].includes(kind)) throw new Error(`unsupported transaction kind: ${kind}`)
  return kind
}

function safeBase58(value, label) {
  const candidate = String(value ?? '')
  if (!/^[1-9A-HJ-NP-Za-km-z]{32,100}$/.test(candidate)) throw new Error(`${label} must be base58`)
  return candidate
}

function safeId(value, label) {
  const candidate = String(value ?? '')
  if (!/^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/.test(candidate)) throw new Error(`${label} is missing or malformed`)
  return candidate
}

function safeIdOrNull(value) {
  try {
    return safeId(value, 'id')
  } catch {
    return null
  }
}

function canonicalAtomic(value, { allowNegative = false, allowZero = true } = {}) {
  const candidate = String(value ?? '')
  const pattern = allowNegative ? /^-?(?:0|[1-9]\d*)$/ : /^(?:0|[1-9]\d*)$/
  if (!pattern.test(candidate)) throw new Error('atomic amount must be a canonical integer string')
  const parsed = BigInt(candidate)
  if (!allowZero && parsed === 0n) throw new Error('atomic amount must be non-zero')
  return candidate
}

function positiveInteger(value) {
  const number = Number(value)
  return Number.isInteger(number) && number >= 0 ? number : 0
}

function uniqueStrings(values) {
  return [...new Set(values.map((value) => String(value)))]
}

function evidenceCheck(id, passed, message) {
  return { id, passed: Boolean(passed), message }
}

function explorerUrl(signature) {
  return `https://explorer.solana.com/tx/${signature}?cluster=devnet`
}

export function opaqueFingerprint(value) {
  return createHash('sha256').update(String(value)).digest('hex').slice(0, 16)
}
