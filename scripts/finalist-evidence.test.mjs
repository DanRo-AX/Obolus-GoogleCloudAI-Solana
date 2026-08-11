import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import test from 'node:test'
import {
  DEFAULT_INFRA_EXPECTATIONS,
  DEVNET_NETWORK,
  assertSecretFree,
  buildDevnetEvidence,
  evaluateInfraSnapshot,
  evaluatePromotion,
} from './lib/finalist-evidence.mjs'

test('a production-shaped infrastructure snapshot passes every finalist gate', () => {
  const report = evaluateInfraSnapshot(goodInfraSnapshot())
  assert.equal(report.summary.ready, true)
  assert.equal(report.summary.failed, 0)
  assertSecretFree(report)
})

test('the verifier catches the current class of wrong latest gateway image', () => {
  const snapshot = goodInfraSnapshot()
  snapshot.services.gateway.latestReadyRevision = 'obolus-gateway-00002-bad'
  snapshot.services.gateway.revisions['obolus-gateway-00002-bad'] = revision({
    name: 'obolus-gateway-00002-bad',
    image: 'asia-northeast3-docker.pkg.dev/demo/obolus/pay@sha256:bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb',
    serviceAccount: 'obolus-pay@demo.iam.gserviceaccount.com',
  })
  const report = evaluateInfraSnapshot(snapshot)
  assert.equal(report.summary.ready, false)
  assert(report.checks.some((check) => check.id === 'run.gateway.latest-safe' && !check.passed))
})

test('serving identity and independent RPC failures are fail-closed', () => {
  const snapshot = goodInfraSnapshot()
  const gateway = snapshot.services.gateway.revisions['obolus-gateway-00001-good']
  gateway.serviceAccount = 'shared-runtime@demo.iam.gserviceaccount.com'
  gateway.rpcGroups.x402 = { resolved: true, bindings: 2, distinctOrigins: 1 }
  const report = evaluateInfraSnapshot(snapshot)
  assert.equal(report.summary.ready, false)
  assert(report.checks.some((check) => check.id.includes('identity') && !check.passed))
  assert(report.checks.some((check) => check.id.endsWith('rpc.x402') && !check.passed))
})

test('promotion guard rejects a Pay.sh image under the gateway service', () => {
  const report = evaluatePromotion(
    revision({
      name: 'obolus-gateway-00009-kop',
      image: 'asia-northeast3-docker.pkg.dev/demo/obolus/pay@sha256:cccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccc',
      serviceAccount: 'obolus-pay@demo.iam.gserviceaccount.com',
    }),
    DEFAULT_INFRA_EXPECTATIONS.services.gateway,
  )
  assert.equal(report.approved, false)
  assert(report.reasons.some((reason) => reason.includes('gateway repository')))
})

test('promotion guard approves only a ready revision with identity, queue and two-RPC finality', () => {
  const report = evaluatePromotion(
    revision({
      name: 'obolus-gateway-00010-good',
      image: 'asia-northeast3-docker.pkg.dev/demo/obolus/gateway@sha256:dddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddd',
      serviceAccount: 'obolus-gateway-run@demo.iam.gserviceaccount.com',
      settlementQueueConfigured: true,
      rpcGroups: {
        x402: { resolved: true, bindings: 2, distinctOrigins: 2 },
        paySh: { resolved: true, bindings: 2, distinctOrigins: 2 },
      },
    }),
    DEFAULT_INFRA_EXPECTATIONS.services.gateway,
  )
  assert.equal(report.approved, true)
})

test('money-moving Cloud Build releases create no-traffic candidate revisions', async () => {
  for (const path of ['pay/cloudbuild.yaml', 'agent-orchestrator/cloudbuild.yaml']) {
    const source = await readFile(new URL(`../${path}`, import.meta.url), 'utf8')
    assert.match(source, /- --no-traffic(?:\r?\n|$)/, path)
    assert.doesNotMatch(source, /--to-latest/, path)
  }
})

test('Devnet recorder keeps receipts while dropping questions, passages and wallet secrets', () => {
  const report = buildDevnetEvidence(goodDevnetRun(), '2026-08-11T00:00:00.000Z')
  assert.equal(report.summary.ready, true)
  assert.equal(report.transactions[0].explorerUrl.includes('?cluster=devnet'), true)
  assert.equal(JSON.stringify(report).includes('privateKey'), false)
  assert.equal(JSON.stringify(report).includes('paid human passage'), false)
  assertSecretFree(report)
})

test('Devnet proof fails when duplicate protection, two-RPC finality or refund proof is absent', () => {
  const input = goodDevnetRun()
  input.transactions[0].finalityProviderCount = 1
  input.duplicateProtection.duplicateSettlementCount = 1
  delete input.refund
  const report = buildDevnetEvidence(input)
  assert.equal(report.summary.ready, false)
  assert(report.checks.some((check) => check.id === 'transactions.two-rpc' && !check.passed))
  assert(report.checks.some((check) => check.id === 'duplicates.zero' && !check.passed))
  assert(report.checks.some((check) => check.id === 'refund.present' && !check.passed))
})

function goodInfraSnapshot() {
  const services = {}
  for (const [role, expected] of Object.entries(DEFAULT_INFRA_EXPECTATIONS.services)) {
    const revisionName = `${expected.name}-00001-good`
    services[role] = {
      name: expected.name,
      latestReadyRevision: revisionName,
      traffic: [{ revision: revisionName, percent: 100 }],
      readiness: {
        status: expected.readiness.status,
        bodyReady: expected.readiness.status === 200 ? true : true,
      },
      revisions: {
        [revisionName]: revision({
          name: revisionName,
          image: `asia-northeast3-docker.pkg.dev/demo/obolus/${expected.imageComponent}@sha256:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa`,
          serviceAccount: `${expected.serviceAccount}@demo.iam.gserviceaccount.com`,
          cloudSqlConnections: role === 'api' ? ['demo:asia-northeast3:ax-apps-db'] : [],
          databaseSecretBound: role === 'api',
          settlementQueueConfigured: role === 'gateway',
          kmsKeyConfigured: role === 'orchestrator',
          rpcGroups:
            role === 'gateway'
              ? {
                  x402: { resolved: true, bindings: 2, distinctOrigins: 2 },
                  paySh: { resolved: true, bindings: 2, distinctOrigins: 2 },
                }
              : role === 'orchestrator'
                ? { payOrchestrator: { resolved: true, bindings: 2, distinctOrigins: 2 } }
                : {},
        }),
      },
    }
  }
  return {
    collectedAt: '2026-08-11T00:00:00.000Z',
    project: 'demo',
    region: 'asia-northeast3',
    services,
    sql: {
      name: 'ax-apps-db',
      databaseVersion: 'POSTGRES_16',
      state: 'RUNNABLE',
      connectionName: 'demo:asia-northeast3:ax-apps-db',
      backupEnabled: true,
      pointInTimeRecoveryEnabled: true,
      retainedBackups: 7,
      transactionLogRetentionDays: 7,
      sslMode: 'ENCRYPTED_ONLY',
    },
    queue: {
      name: 'obolus-settlements',
      state: 'RUNNING',
      maxAttempts: 100,
      maxRetryDurationSeconds: 604800,
      maxConcurrentDispatches: 20,
      maxDispatchesPerSecond: 20,
    },
    kms: {
      keyName: 'solana-service-wallet',
      purpose: 'ASYMMETRIC_SIGN',
      enabledVersion: '1',
      signers: ['obolus-orchestrator-run', 'obolus-pay'],
    },
  }
}

function revision(overrides = {}) {
  return {
    name: 'revision',
    image: 'asia-northeast3-docker.pkg.dev/demo/obolus/api@sha256:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
    serviceAccount: 'obolus-api-run@demo.iam.gserviceaccount.com',
    ready: true,
    cloudSqlConnections: [],
    databaseSecretBound: false,
    settlementQueueConfigured: false,
    kmsKeyConfigured: false,
    rpcGroups: {},
    ...overrides,
  }
}

function goodDevnetRun() {
  return {
    runId: 'finalist-demo-001',
    network: DEVNET_NETWORK,
    queryId: 'query_001',
    jobId: 'job_001',
    jobStatus: 'completed',
    quotes: [
      {
        id: 'quote_001',
        kind: 'evidence',
        status: 'delivered',
        amountAtomic: '15',
        asset: '4zMMC9srt5Ri5X14GAgXhaHii3GnPAEERYPJgZJDncDU',
      },
    ],
    transactions: [
      {
        kind: 'evidence',
        signature: '1111111111111111111111111111111111111111111111111111111111111111',
        quoteIds: ['quote_001'],
        status: 'finalized',
        finalityProviderCount: 2,
        ownerDeltaAtomic: '15',
        payerDeltaAtomic: '-15',
      },
    ],
    duplicateProtection: { retryAttempts: 1, duplicateSettlementCount: 0 },
    refund: {
      claimId: 'refund_001',
      status: 'finalized',
      amountAtomic: '5',
      signature: '2222222222222222222222222222222222222222222222222222222222222222',
      finalityProviderCount: 2,
    },
    questionText: 'private customer question',
    passage: 'paid human passage',
    privateKey: 'never copy me',
  }
}
