// Deterministic judge evaluation against the five Demo Day criteria.
//
// Modes:
//   node scripts/judge-eval.mjs            # full: static + live probes + on-chain re-verification
//   node scripts/judge-eval.mjs --static   # no network: evidence files + claim lint only (CI-safe)
//
// Every check maps to one weighted criterion:
//   C1 ai-autonomy (30%), C2 business-ux (30%), C3 gcp-infra (15%),
//   C4 solana-payments (15%), C5 presentation (10%)
//
// Exit code 1 when any check fails, so a scheduled workflow stays red until fixed.

import { existsSync, readFileSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const staticOnly = process.argv.includes('--static')
const liveBase = process.env.JUDGE_LIVE_BASE ?? 'https://obolus-9qi.pages.dev'
const devnetRpc = process.env.JUDGE_DEVNET_RPC ?? 'https://api.devnet.solana.com'
const maxEvidenceAgeHours = Number(process.env.JUDGE_EVIDENCE_MAX_AGE_HOURS ?? '48')
const probeHandles = (process.env.JUDGE_PROBE_HANDLES ?? 'SEONGS_11').split(',').filter(Boolean)

const strictFreshness = process.env.JUDGE_STRICT_FRESHNESS === '1'
const skipResolveProbe = process.env.JUDGE_SKIP_RESOLVE_PROBE === '1'

const checks = []
function check(criterion, id, passed, detail, severity = 'fail') {
  checks.push({ criterion, id, passed: Boolean(passed), detail, severity })
}

function readJson(path) {
  if (!existsSync(path)) return null
  try {
    return JSON.parse(readFileSync(path, 'utf8'))
  } catch {
    return null
  }
}

function evidenceAgeHours(value) {
  const at = Date.parse(value?.generatedAt ?? '')
  if (Number.isNaN(at)) return Number.POSITIVE_INFINITY
  return (Date.now() - at) / 3_600_000
}

async function fetchWithTimeout(url, init = {}, timeoutMs = 15_000) {
  return fetch(url, { ...init, signal: AbortSignal.timeout(timeoutMs) })
}

// --- Static evidence: the three finalist evidence files must exist and be ready.
const evidencePaths = {
  autonomy: { criterion: 'C1', path: join(root, 'artifacts', 'finalist-evidence', 'autonomy.json') },
  infrastructure: { criterion: 'C3', path: join(root, 'artifacts', 'finalist-evidence', 'infrastructure.json') },
  devnet: { criterion: 'C4', path: join(root, 'artifacts', 'finalist-evidence', 'devnet.json') },
}
const evidence = {}
for (const [label, { criterion, path }] of Object.entries(evidencePaths)) {
  const value = readJson(path)
  evidence[label] = value
  check(criterion, `evidence.${label}.ready`, value?.summary?.ready === true, `summary.ready=${String(value?.summary?.ready)}`)
  if (!staticOnly) {
    const age = evidenceAgeHours(value)
    // Evidence regeneration needs gcloud credentials and a funded wallet, which CI
    // does not have — so staleness is a warning by default and only fatal in strict
    // mode (local pre-rehearsal runs with JUDGE_STRICT_FRESHNESS=1).
    check(
      criterion,
      `evidence.${label}.fresh`,
      age <= maxEvidenceAgeHours,
      `generatedAt age ${age === Number.POSITIVE_INFINITY ? 'unknown' : `${age.toFixed(1)}h`} (max ${maxEvidenceAgeHours}h)`,
      strictFreshness ? 'fail' : 'warn',
    )
  }
}

// --- Static claim lint: the deck must not claim capabilities the code does not have.
// The repo's own readiness docs forbid claiming Passkey / A2A / an on-chain escrow
// program / Mainnet settlement. Regressions here lose the pitch in Q&A.
const deckPath = join(root, 'docs', 'obulus-pitch-deck.html')
if (existsSync(deckPath)) {
  const deck = readFileSync(deckPath, 'utf8')
  const bannedClaims = [
    { id: 'passkey', pattern: /passkey|패스키/i },
    { id: 'escrow-program', pattern: /에스크로 프로그램|escrow program/i },
    { id: 'a2a-protocol', pattern: /A2A 프로토콜을 구현|implements? the A2A protocol/i },
    { id: 'mainnet-settlement', pattern: /메인넷 정산을 완료|settles? on mainnet/i },
  ]
  for (const { id, pattern } of bannedClaims) {
    const match = deck.match(pattern)
    check('C5', `claims.deck.no-${id}`, !match, match ? `deck contains "${match[0]}"` : 'absent')
  }
} else {
  check('C5', 'claims.deck.exists', false, 'docs/obulus-pitch-deck.html missing')
}

// --- Live probes ---------------------------------------------------------------
async function liveProbes() {
  // C5/C2: the hosted frontend answers.
  try {
    const res = await fetchWithTimeout(liveBase + '/')
    check('C2', 'live.pages.up', res.status === 200, `GET / -> ${res.status}`)
  } catch (error) {
    check('C2', 'live.pages.up', false, String(error))
  }

  // C1: the production Vertex planner must actually run. The planner is
  // deliberately gated behind an authenticated session (backend/src/api.rs:920)
  // — an anonymous resolve ALWAYS reports deterministic_fallback, which says
  // nothing about Vertex health. So the strict planner check only runs when a
  // session cookie is supplied via JUDGE_SESSION_COOKIE; without one the
  // anonymous probe is a reachability check plus a warning.
  // NOTE: this probe has side effects — it creates a real query row in the
  // production ledger (question is prefixed "judge-eval probe:" so it stays
  // identifiable and sweepable) and spends Vertex calls when authenticated.
  // Set JUDGE_SKIP_RESOLVE_PROBE=1 to omit it.
  const sessionCookie = process.env.JUDGE_SESSION_COOKIE ?? ''
  if (skipResolveProbe) {
    check('C1', 'live.vertex-planner.skipped', true, 'resolve probe skipped by JUDGE_SKIP_RESOLVE_PROBE=1', 'warn')
  } else try {
    const res = await fetchWithTimeout(liveBase + '/api/v1/questions/resolve', {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        ...(sessionCookie ? { cookie: sessionCookie } : {}),
      },
      body: JSON.stringify({
        question: 'judge-eval probe: 성수동 평일 점심 웨이팅 경험이 궁금합니다',
        requestedDocuments: 3,
        filters: {},
      }),
    }, 30_000)
    const body = await res.text()
    // Any vertex_* mode marker (vertex_two_stage…, partial_vertex…, legacy
    // vertex_tools…) proves the planner reached Vertex at least once.
    const vertexRan = /"mode"\s*:\s*"[^"]*vertex/.test(body) || body.includes('vertex_two_stage') || body.includes('partial_vertex')
    check('C1', 'live.vertex-planner.responds', res.status === 200, `POST resolve -> ${res.status}`)
    if (sessionCookie) {
      check(
        'C1',
        'live.vertex-planner.ran',
        res.status === 200 && vertexRan,
        vertexRan ? 'vertex planner ran for the authenticated probe' : 'authenticated probe still fell back — Vertex genuinely unavailable',
      )
    } else {
      check(
        'C1',
        'live.vertex-planner.unverified',
        false,
        'no JUDGE_SESSION_COOKIE — anonymous probes are fallback by design, planner health not verifiable from here',
        'warn',
      )
    }
  } catch (error) {
    check('C1', 'live.vertex-planner.responds', false, String(error))
  }

  // C5: demo supply. An empty production shelf means the HIT -> pay -> cite path
  // cannot be shown live ("목업 불가").
  try {
    const res = await fetchWithTimeout(liveBase + '/api/v1/open-calls')
    const body = res.status === 200 ? await res.json() : null
    const count = Array.isArray(body) ? body.length : 0
    check('C5', 'live.supply.open-calls', count > 0, `GET /open-calls -> ${res.status}, ${count} open calls`)
  } catch (error) {
    check('C5', 'live.supply.open-calls', false, String(error))
  }
  for (const handle of probeHandles) {
    try {
      const res = await fetchWithTimeout(`${liveBase}/api/v1/documents/${encodeURIComponent(handle)}`)
      check('C5', `live.supply.document:${handle}`, res.status === 200, `GET /documents/${handle} -> ${res.status}`)
    } catch (error) {
      check('C5', `live.supply.document:${handle}`, false, String(error))
    }
  }
}

// C4: independently re-verify the recorded Devnet transactions on chain.
async function verifyDevnetSignatures() {
  const txs = [
    ...(evidence.devnet?.transactions ?? []).map((tx) => ({ kind: tx.kind, signature: tx.signature })),
    ...(evidence.devnet?.refund?.signature ? [{ kind: 'refund', signature: evidence.devnet.refund.signature }] : []),
  ]
  check('C4', 'devnet.evidence.has-signatures', txs.length >= 3, `${txs.length} recorded signatures`)
  for (const { kind, signature } of txs) {
    try {
      const res = await fetchWithTimeout(devnetRpc, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          jsonrpc: '2.0',
          id: 1,
          method: 'getTransaction',
          params: [signature, { commitment: 'finalized', maxSupportedTransactionVersion: 0, encoding: 'json' }],
        }),
      }, 20_000)
      const body = await res.json()
      const found = body?.result != null
      const clean = found && body.result?.meta?.err == null
      check('C4', `devnet.chain.${kind}`, clean, found ? `finalized, err=${JSON.stringify(body.result?.meta?.err ?? null)}` : 'transaction not found on chain')
    } catch (error) {
      check('C4', `devnet.chain.${kind}`, false, String(error))
    }
  }
}

if (!staticOnly) {
  await liveProbes()
  await verifyDevnetSignatures()
}

// --- Report --------------------------------------------------------------------
const criteria = {
  C1: { name: 'AI autonomy', weight: 30 },
  C2: { name: 'Business value & UX', weight: 30 },
  C3: { name: 'GCP infrastructure', weight: 15 },
  C4: { name: 'Solana on-chain payments', weight: 15 },
  C5: { name: 'Presentation & live demo', weight: 10 },
}
const byCriterion = Object.fromEntries(
  Object.entries(criteria).map(([key, meta]) => {
    const own = checks.filter((item) => item.criterion === key)
    const passed = own.filter((item) => item.passed).length
    return [key, { ...meta, passed, total: own.length, ready: own.length > 0 && passed === own.length }]
  }),
)
const failed = checks.filter((item) => !item.passed && item.severity === 'fail')
const warned = checks.filter((item) => !item.passed && item.severity === 'warn')
console.log(JSON.stringify({ mode: staticOnly ? 'static' : 'full', liveBase: staticOnly ? null : liveBase, criteria: byCriterion, checks }, null, 2))
if (warned.length > 0) {
  console.error(`\n${warned.length} warning(s):`)
  for (const item of warned) console.error(`  [${item.criterion}] ${item.id} — ${item.detail}`)
}
if (failed.length > 0) {
  console.error(`\n${failed.length} judge check(s) failing:`)
  for (const item of failed) console.error(`  [${item.criterion}] ${item.id} — ${item.detail}`)
  process.exitCode = 1
}
