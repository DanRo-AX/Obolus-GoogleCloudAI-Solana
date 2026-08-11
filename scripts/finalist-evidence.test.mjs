import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { chmod, mkdtemp, readFile, readdir, rm, stat, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import test from 'node:test'
import {
  DEFAULT_INFRA_EXPECTATIONS,
  DEVNET_NETWORK,
  assertSecretFree,
  buildAutonomyEvidence,
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

test('Pay.sh sandbox gateway follows the current Rust API environment contract', async () => {
  const source = await readFile(new URL('../scripts/pay-sh-sandbox-e2e.sh', import.meta.url), 'utf8')
  const startGateway = source.match(/start_gateway\(\) \{[\s\S]*?\n\}/)?.[0] ?? ''
  assert.match(startGateway, /RUST_API_URL="\$backend_origin"/)
  assert.doesNotMatch(startGateway, /OPENSHELF_BACKEND_URL="\$backend_origin"/)
})

test('hosted Devnet funding is durably fenced before a payment can leave', async () => {
  const source = await readFile(new URL('../scripts/hosted-devnet-finalist-e2e.mjs', import.meta.url), 'utf8')
  assert.match(
    source,
    /quote\.status === 'quoted' && state\.fundingAttemptQuoteId !== quote\.id/,
  )
  assert.match(source, /reconciling without another payment/)
  const durableFence = source.indexOf('onReadyToSubmit()')
  const paidTransport = source.indexOf('wrapFetchWithPayment(fetch, client)')
  assert(durableFence >= 0 && paidTransport >= 0 && durableFence < paidTransport)
  assert.match(source, /attestations are operator declarations, not cryptographic authorship proof/)
  assert.match(source, /authorAttestation !== true \|\| contribution\.usageConsent !== true/)
  assert.doesNotMatch(source, /저는 2025년 봄부터 성수동 사무실에서 일했습니다/)
})

test('autonomy recorder validates a provider-path trace while dropping questions and capabilities', () => {
  const report = buildAutonomyEvidence(
    goodAutonomyRun(),
    '2026-08-11T00:00:00.000Z',
    goodAutonomyProvenance(),
  )
  assert.equal(report.summary.ready, true)
  assert.equal(report.agentRun.mode, 'vertex_two_stage_with_deterministic_guards')
  assert.equal(report.agentRun.steps.length, 3)
  assert.equal(JSON.stringify(report).includes('paymentAccessToken'), false)
  assert.equal(JSON.stringify(report).includes('private customer question'), false)
  assert.equal(JSON.stringify(report).includes('private planner detail'), false)
  assert.equal(JSON.stringify(report).includes('hidden_1'), false)
  assertSecretFree(report)
})

test('autonomy proof fails closed on fallback, unsafe tools, or a missing approval stop', () => {
  const input = goodAutonomyRun()
  input.agentRun.mode = 'deterministic_fallback'
  input.agentRun.steps[0].status = 'fallback'
  input.agentRun.steps[2].tool = 'execute_payment'
  input.agentRun.steps[2].status = 'completed'
  input.agentRun.nextAction = 'execute_payment'
  input.agentRun.requiresUserApproval = false
  const report = buildAutonomyEvidence(input)
  assert.equal(report.summary.ready, false)
  assert(report.checks.some((check) => check.id === 'planner.two-stage-vertex-tools' && !check.passed))
  assert(report.checks.some((check) => check.id === 'trace.safe-tools' && !check.passed))
  assert(report.checks.some((check) => check.id === 'approval.boundary' && !check.passed))
})

test('autonomy recorder CLI writes private output and refuses destructive in-place input', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'obolus-autonomy-evidence-'))
  const input = join(directory, 'resolve-response.json')
  const output = join(directory, 'autonomy.json')
  const fakeGcloud = join(directory, 'gcloud')
  const executable = fileURLToPath(new URL('./record-finalist-autonomy-evidence.mjs', import.meta.url))
  try {
    await writeFile(input, `${JSON.stringify(goodAutonomyRun())}\n`, { mode: 0o600 })
    await writeFile(fakeGcloud, `#!/bin/sh\nprintf '%s\\n' '${JSON.stringify([{
      timestamp: '2026-08-11T00:00:01.000Z',
      resource: { labels: { service_name: 'obolus-api', revision_name: 'obolus-api-test-00001' } },
      textPayload: 'bounded research run completed agent_run_id=agent_autonomy_001 query_id=qry_autonomy_001 provider_call_count=2 mode="vertex_two_stage_with_deterministic_guards"',
    }])}'\n`, { mode: 0o700 })
    await chmod(fakeGcloud, 0o700)
    const recorded = spawnSync(process.execPath, [
      executable,
      '--input', input,
      '--output', output,
      '--project', 'demo-project',
    ], {
      encoding: 'utf8',
      env: { ...process.env, OBOLUS_GCLOUD_BIN: fakeGcloud },
    })
    assert.equal(recorded.status, 0, recorded.stderr)
    assert.equal(JSON.parse(await readFile(output, 'utf8')).summary.ready, true)
    assert.equal((await stat(output)).mode & 0o777, 0o600)
    assert.deepEqual((await readdir(directory)).sort(), ['autonomy.json', 'gcloud', 'resolve-response.json'])

    const inPlace = spawnSync(process.execPath, [executable, '--input', input, '--output', input], {
      encoding: 'utf8',
    })
    assert.equal(inPlace.status, 2)
    assert.match(inPlace.stderr, /must be different/)
    assert.equal(JSON.parse(await readFile(input, 'utf8')).paymentAccessToken, 'never copy this capability')
  } finally {
    await rm(directory, { recursive: true, force: true })
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
    activityKind: 'open_call_lifecycle',
    activityId: 'call_001',
    activityStatus: 'cancelled_refunded',
    quotes: [
      {
        id: 'call_quote_001',
        kind: 'open-call-funding',
        status: 'funded',
        amountAtomic: '20',
        asset: '4zMMC9srt5Ri5X14GAgXhaHii3GnPAEERYPJgZJDncDU',
      },
      {
        id: 'payout_001',
        kind: 'open-call-payout',
        status: 'delivered',
        amountAtomic: '15',
        asset: '4zMMC9srt5Ri5X14GAgXhaHii3GnPAEERYPJgZJDncDU',
      },
    ],
    transactions: [
      {
        kind: 'open-call-funding',
        signature: '3333333333333333333333333333333333333333333333333333333333333333',
        quoteIds: ['call_quote_001'],
        status: 'finalized',
        finalityProviderCount: 2,
        ownerDeltaAtomic: '20',
        payerDeltaAtomic: '-20',
      },
      {
        kind: 'open-call-payout',
        signature: '1111111111111111111111111111111111111111111111111111111111111111',
        quoteIds: ['payout_001'],
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

function goodAutonomyRun() {
  return {
    queryId: 'qry_autonomy_001',
    decision: 'hit',
    requestedDocuments: 3,
    candidateCount: 7,
    matches: [{ handle: 'hidden_1' }, { handle: 'hidden_2' }],
    quote: { currency: 'KRW', documentCount: 2, totalPriceKrw: 30 },
    agentRun: {
      id: 'agent_autonomy_001',
      model: 'gemini-2.5-flash',
      mode: 'vertex_two_stage_with_deterministic_guards',
      providerCallCount: 2,
      runtimeRevision: 'obolus-api-test-00001',
      nextAction: 'propose_evidence_purchase',
      requiresUserApproval: true,
      steps: [
        {
          sequence: 1,
          agent: 'research_planner',
          tool: 'search_human_evidence',
          status: 'completed',
          summary: 'private planner detail that is not copied',
        },
        {
          sequence: 2,
          agent: 'retrieval_agent',
          tool: 'rank_evidence_bundle',
          status: 'completed',
          artifactRef: 'qry_autonomy_001',
        },
        {
          sequence: 3,
          agent: 'coverage_agent',
          tool: 'propose_evidence_purchase',
          status: 'awaiting_user_approval',
        },
      ],
    },
    questionText: 'private customer question',
    paymentAccessToken: 'never copy this capability',
  }
}

function goodAutonomyProvenance() {
  return {
    kind: 'cloud_run_application_log',
    verified: true,
    project: 'demo-project',
    service: 'obolus-api',
    runtimeRevision: 'obolus-api-test-00001',
    logTimestamp: '2026-08-11T00:00:01.000Z',
  }
}
