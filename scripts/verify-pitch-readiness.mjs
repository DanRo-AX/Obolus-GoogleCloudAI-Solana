import { execFileSync } from 'node:child_process'
import { existsSync, readFileSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const deckPath = join(root, 'docs', 'obulus-pitch-deck-white.html')
const runbookPath = join(root, 'docs', 'FINAL-PITCH-RUNBOOK.ko.md')
const infraPath = join(root, 'artifacts', 'finalist-evidence', 'infrastructure.json')
const autonomyPath = join(root, 'artifacts', 'finalist-evidence', 'autonomy.json')
const devnetPath = join(root, 'artifacts', 'finalist-evidence', 'devnet.json')
const requireLive = process.argv.includes('--require-live')
const publicOrigin = checkedOrigin(process.env.OBULUS_PUBLIC_ORIGIN ?? 'https://obolus-9qi.pages.dev')

const deck = readFileSync(deckPath, 'utf8')
const runbook = readFileSync(runbookPath, 'utf8')
const checks = []

function check(id, passed, detail) {
  checks.push({ id, passed: Boolean(passed), detail })
}

const slidePattern = /<section class="shell" data-title="([^"]+)"([^>]*)>/g
const slides = [...deck.matchAll(slidePattern)].map((match) => ({ title: match[1] }))
const titles = slides.map((slide) => slide.title)
const mainTitles = titles.slice(0, 7)
const expectedTitles = [
  '표지',
  '문제와 타깃',
  '제품 루프',
  '결제와 청구서',
  '메모리와 PageRank',
  '전체 아키텍처',
  '진입 시장과 비전',
  'Appendix · 개인 DB 페르소나',
  'Appendix · 결제 권한과 보안',
  'Appendix · Coverage policy',
  'Appendix · 검색 수식',
  'Appendix · 메모리 추상화',
  'Appendix · 스팸과 담합',
  'Appendix · GCP 운영 증거',
  'Appendix · 개인정보와 중앙서버',
  'Appendix · 콜드 스타트',
  'Appendix · 실제 배포 아키텍처',
]

check('deck.slide-count', slides.length === 17, `expected 17, found ${slides.length}`)
check('deck.unique-titles', new Set(titles).size === titles.length, `${new Set(titles).size}/${titles.length} unique`)
check(
  'deck.canonical-route',
  JSON.stringify(titles) === JSON.stringify(expectedTitles),
  `found ${titles.join(' -> ')}`,
)
check('deck.main-route', mainTitles.length === 7, `found ${mainTitles.length} main slides`)

const staleClaims = [
  '기준 시점 90개 테스트',
  '현재 약 23개 마켓플레이스 도구',
  '23 MARKETPLACE ACTIONS',
  'Devnet 검증 완료',
  '상업용 take rate는 아직 구현되지 않았습니다',
  '현재 데모는 상업 수수료를 부과하지 않습니다',
]
for (const phrase of staleClaims) {
  check(`deck.no-stale:${phrase}`, !deck.includes(phrase), phrase)
}

for (const [claim, marker] of [
  ['problem', '$142B'],
  ['human-evidence', '공개 웹에 없는 인간 근거'],
  ['product-loop', '없는 질문만 Open Call로 공고'],
  ['prepaid-only', 'Phantom에서 매번 출금하지 않고'],
  ['gasless-receipt', '가스비는 Facilitator가 내고 기록은 청구서로 남습니다'],
  ['pagerank', 'Obolus의 Page Rank 알고리즘'],
  ['persona', '에이전트 페르소나가 대답합니다'],
  ['gemini-boundary', '개인키·수취인·가격·transaction bytes에는 접근하지 못합니다'],
  ['rust-boundary', '동의 범위·예산·중복·수취인·mint·금액·PageRank 입력·finality'],
  ['gcp-proof', '77 / 77 checks passed'],
  ['solana-proof', '2 RPC finalized'],
  ['cold-start', '콜드 스타트 Problem'],
]) {
  check(`deck.required:${claim}`, deck.includes(marker), marker)
}

for (const token of ['id="prev"', 'id="next"', 'window.print()', "['ArrowRight','PageDown',' ']"]) {
  check(`deck.presenter-control:${token}`, deck.includes(token), token)
}

const assetRefs = new Set(
  [...deck.matchAll(/(?:src=|url\()["']?((?:pitch-final-assets|pitch-deck-assets|assets)\/[^"')\s]+)/g)].map((match) => match[1]),
)
for (const assetRef of assetRefs) {
  check(`deck.asset:${assetRef}`, existsSync(join(dirname(deckPath), assetRef)), assetRef)
}

let marketplaceTools = []
try {
  marketplaceTools = JSON.parse(
    execFileSync(process.execPath, ['integrations/antigravity/openshelf/runtime/server.mjs', 'tools'], {
      cwd: root,
      encoding: 'utf8',
      timeout: 10_000,
    }),
  )
  check('runtime.marketplace-tool-count', marketplaceTools.length === 24, `runtime exposes ${marketplaceTools.length}`)
} catch (error) {
  check('runtime.marketplace-tool-count', false, error instanceof Error ? error.message : String(error))
}

for (const phrase of [
  '0:00–0:22',
  '1:32–3:02',
  '5분 45초',
  '12초 중단 규칙',
  '일반 Gemini 답변',
  'Grounded persona answer',
  'AI 기술 자율성 30%',
  'GCP 확장성 15%',
  'Solana 결제 15%',
]) {
  check(`runbook.required:${phrase}`, runbook.includes(phrase), phrase)
}

function readEvidence(path, label) {
  if (!existsSync(path)) return { label, exists: false, ready: false, detail: 'missing' }
  try {
    const value = JSON.parse(readFileSync(path, 'utf8'))
    const validation = validateEvidence(value, label)
    return {
      label,
      exists: true,
      ready: validation.ready,
      detail: validation.detail,
      value,
    }
  } catch (error) {
    return { label, exists: true, ready: false, detail: error instanceof Error ? error.message : String(error) }
  }
}

const liveEvidence = [
  readEvidence(infraPath, 'infrastructure'),
  readEvidence(autonomyPath, 'autonomy'),
  readEvidence(devnetPath, 'devnet'),
]
const localCorrelation = validateEvidenceSet(liveEvidence)
const liveReady = liveEvidence.every((item) => item.ready) && localCorrelation.ready
const contentFailed = checks.filter((item) => !item.passed)
if (requireLive) {
  for (const item of liveEvidence) check(`live.${item.label}`, item.ready, item.detail)
  check('live.correlation', localCorrelation.ready, localCorrelation.detail)
  const remoteEvidence = await Promise.all([
    readPublishedEvidence('infrastructure'),
    readPublishedEvidence('autonomy'),
    readPublishedEvidence('devnet'),
  ])
  for (const item of remoteEvidence) {
    check(`published.${item.label}`, item.ready, item.detail)
  }
  const publishedCorrelation = validateEvidenceSet(remoteEvidence)
  check('published.correlation', publishedCorrelation.ready, publishedCorrelation.detail)
  const [app, deck, api, gateway] = await Promise.all([
    probe('/', 'text/html'),
    probe('/pitch/?mode=final', 'text/html'),
    probe('/api/v1/open-calls', 'application/json'),
    probe('/x402/readyz', 'application/json'),
  ])
  check('published.app', app.ready, app.detail)
  check('published.deck', deck.ready && deck.text?.includes('공개 웹에 없는 인간 근거'), deck.detail)
  check('published.api-proxy', api.ready && Array.isArray(api.body), api.detail)
  check('published.gateway-ready', gateway.ready && gateway.body?.status === 'ready', gateway.detail)
}

const failed = checks.filter((item) => !item.passed)
const report = {
  contentReady: contentFailed.length === 0,
  liveReady,
  requireLive,
  slides: slides.length,
  finalSlides: mainTitles.length,
  assets: assetRefs.size,
  marketplaceTools: marketplaceTools.length,
  liveEvidence: liveEvidence.map(({ value: _value, ...item }) => item),
  evidenceCorrelation: localCorrelation,
  ...(requireLive ? { publicOrigin } : {}),
  checks,
}

console.log(JSON.stringify(report, null, 2))
if (failed.length > 0) process.exitCode = 1

function validateEvidence(value, label) {
  if (value?.summary?.ready !== true) {
    return { ready: false, detail: `summary.ready=${String(value?.summary?.ready)}` }
  }
  const schema = String(value?.schemaVersion ?? '')
  const generatedAt = Date.parse(String(value?.generatedAt ?? ''))
  const ageMs = Date.now() - generatedAt
  if (!Number.isFinite(generatedAt) || ageMs < -300_000 || ageMs > 86_400_000) {
    return { ready: false, detail: 'evidence is missing a current generatedAt timestamp (maximum age 24h)' }
  }
  if (label === 'infrastructure') {
    return schema === 'obulus.finalist.infrastructure.v1'
      ? { ready: true, detail: 'ready infrastructure v1 evidence' }
      : { ready: false, detail: `unexpected infrastructure schema ${schema || 'missing'}` }
  }
  if (label === 'autonomy') {
    const twoStageCheck = value?.checks?.find((item) => item?.id === 'planner.two-stage-vertex-tools')
    const runtimeCheck = value?.checks?.find((item) => item?.id === 'runtime.deployed-run-log')
    const ready = schema === 'obulus.finalist.autonomy-evidence.v2'
      && value?.agentRun?.mode === 'vertex_two_stage_with_deterministic_guards'
      && value?.agentRun?.providerCallCount === 2
      && twoStageCheck?.passed === true
      && runtimeCheck?.passed === true
      && value?.deployedRunProvenance?.verified === true
      && value?.deployedRunProvenance?.runtimeRevision === value?.agentRun?.runtimeRevision
    return {
      ready,
      detail: ready
        ? 'ready two-stage Vertex autonomy v2 evidence with deployed-run log provenance'
        : 'autonomy evidence does not bind two provider calls to a deployed-run log',
    }
  }
  if (label === 'devnet') {
    const requiredChecks = [
      'network.devnet',
      'activity.typed',
      'activity.status',
      'quotes.canonical-mint',
      'quotes.status',
      'transactions.finalized',
      'transactions.two-rpc',
      'transactions.quote-linkage',
      'duplicates.zero',
      'duplicates.retry-exercised',
      'refund.finalized',
      'refund.two-rpc',
      'refund.arithmetic',
    ]
    const passed = new Map((value?.checks ?? []).map((item) => [item?.id, item?.passed === true]))
    const ready = schema === 'obulus.finalist.devnet-evidence.v2' &&
      value?.activity?.kind === 'open_call_lifecycle' &&
      requiredChecks.every((id) => passed.get(id) === true)
    return ready
      ? { ready: true, detail: 'ready typed Open Call Devnet v2 evidence' }
      : { ready: false, detail: `Devnet evidence is stale or lacks exact v2 receipt linkage (${schema || 'missing schema'})` }
  }
  return { ready: false, detail: `unsupported evidence label ${label}` }
}

function validateEvidenceSet(items) {
  const byLabel = new Map(items.map((item) => [item.label, item.value]))
  const infra = byLabel.get('infrastructure')
  const autonomy = byLabel.get('autonomy')
  const servingApi = (infra?.release?.api?.servingRevisions ?? [])
    .filter((entry) => Number(entry?.percent) > 0)
    .map((entry) => entry.revision)
  const revision = autonomy?.agentRun?.runtimeRevision
  const projectMatches = Boolean(infra?.project) &&
    infra.project === autonomy?.deployedRunProvenance?.project
  const revisionMatches = Boolean(revision) && servingApi.length === 1 && servingApi[0] === revision
  const generated = items.map((item) => Date.parse(String(item.value?.generatedAt ?? '')))
  const closeInTime = generated.every(Number.isFinite) && Math.max(...generated) - Math.min(...generated) <= 7_200_000
  return {
    ready: projectMatches && revisionMatches && closeInTime,
    detail: `project=${projectMatches ? 'matched' : 'mismatch'}; apiRevision=${revisionMatches ? 'matched' : 'mismatch'}; evidenceWindow=${closeInTime ? '<=2h' : '>2h'}`,
  }
}

async function readPublishedEvidence(label) {
  try {
    const result = await fetchBounded(`${publicOrigin}/artifacts/finalist-evidence/${label}.json`)
    if (!result.response.ok) {
      return { label, ready: false, detail: `published HTTP ${result.response.status}` }
    }
    const value = JSON.parse(result.text)
    return { label, value, ...validateEvidence(value, label) }
  } catch (error) {
    return { label, ready: false, detail: error instanceof Error ? error.message : String(error) }
  }
}

async function probe(path, expectedContentType) {
  try {
    const result = await fetchBounded(`${publicOrigin}${path}`)
    const contentType = result.response.headers.get('content-type') ?? ''
    const ready = result.response.ok && contentType.includes(expectedContentType)
    let body = null
    if (ready && expectedContentType === 'application/json') body = JSON.parse(result.text)
    return {
      ready,
      body,
      text: result.text,
      detail: `HTTP ${result.response.status}; content-type=${contentType || 'missing'}`,
    }
  } catch (error) {
    return { ready: false, body: null, text: '', detail: error instanceof Error ? error.message : String(error) }
  }
}

async function fetchBounded(url) {
  const response = await fetch(url, {
    headers: { accept: 'application/json, text/html;q=0.8' },
    signal: AbortSignal.timeout(10_000),
  })
  const declared = Number(response.headers.get('content-length') ?? 0)
  if (declared > 1_048_576) throw new Error('published response exceeds 1 MiB')
  const text = await response.text()
  if (Buffer.byteLength(text) > 1_048_576) throw new Error('published response exceeds 1 MiB')
  return { response, text }
}

function checkedOrigin(value) {
  const url = new URL(value)
  if (url.protocol !== 'https:' && !['127.0.0.1', 'localhost'].includes(url.hostname)) {
    throw new Error('OBULUS_PUBLIC_ORIGIN must use HTTPS')
  }
  return url.origin
}
