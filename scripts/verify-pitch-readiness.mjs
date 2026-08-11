import { execFileSync } from 'node:child_process'
import { existsSync, readFileSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const deckPath = join(root, 'docs', 'obulus-pitch-deck.html')
const runbookPath = join(root, 'docs', 'FINAL-PITCH-RUNBOOK.ko.md')
const infraPath = join(root, 'artifacts', 'finalist-evidence', 'infrastructure.json')
const autonomyPath = join(root, 'artifacts', 'finalist-evidence', 'autonomy.json')
const devnetPath = join(root, 'artifacts', 'finalist-evidence', 'devnet.json')
const requireLive = process.argv.includes('--require-live')

const deck = readFileSync(deckPath, 'utf8')
const runbook = readFileSync(runbookPath, 'utf8')
const checks = []

function check(id, passed, detail) {
  checks.push({ id, passed: Boolean(passed), detail })
}

const slidePattern = /<section class="slide-shell" data-title="([^"]+)"([^>]*)>/g
const slides = [...deck.matchAll(slidePattern)].map((match) => ({
  title: match[1],
  final: /\bdata-final\b/.test(match[2]),
}))
const titles = slides.map((slide) => slide.title)
const finalTitles = slides.filter((slide) => slide.final).map((slide) => slide.title)
const expectedFinalTitles = [
  '표지',
  'AI가 모르는 인간 데이터',
  '제품 해결책',
  'Gemini와 Google Cloud',
  '유료 URL과 결제',
  '전체 아키텍처',
  '첫 고객과 진입 시장',
  '증거와 비전',
]

check('deck.slide-count', slides.length === 20, `expected 20, found ${slides.length}`)
check('deck.unique-titles', new Set(titles).size === titles.length, `${new Set(titles).size}/${titles.length} unique`)
check(
  'deck.final-route',
  JSON.stringify(finalTitles) === JSON.stringify(expectedFinalTitles),
  `found ${finalTitles.join(' -> ')}`,
)

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

for (const phrase of [
  '총 356개 테스트',
  'summary.ready',
  'id="infraProofStatus"',
  'id="autonomyProofStatus"',
  'id="devnetProofStatus"',
  'id="liveProofStatus"',
]) {
  check(`deck.required-proof:${phrase}`, deck.includes(phrase), phrase)
}

for (const token of ['id="modeBtn"', "event.key === '6'", "event.key.toLowerCase() === 'b'", "new URLSearchParams(window.location.search).get('mode')"]) {
  check(`deck.presenter-control:${token}`, deck.includes(token), token)
}

const assetRefs = new Set(
  [...deck.matchAll(/(?:src=|url\()["']?((?:pitch-deck-assets|assets)\/[^"')\s]+)/g)].map((match) => match[1]),
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
  check('deck.marketplace-tool-count', marketplaceTools.length === 24, `runtime exposes ${marketplaceTools.length}`)
  check('deck.marketplace-tool-copy', deck.includes('24개 마켓플레이스 도구') && deck.includes('24 MARKETPLACE ACTIONS'), 'deck says 24')
} catch (error) {
  check('deck.marketplace-tool-count', false, error instanceof Error ? error.message : String(error))
}

for (const phrase of [
  '0:00–0:20',
  '1:08–2:38',
  '5분 45초',
  '12초 넘게',
  '세 JSON 모두 `ready=true`',
  '검색·허가·결제 가능하게 만듭니다',
]) {
  check(`runbook.required:${phrase}`, runbook.includes(phrase), phrase)
}

function readEvidence(path, label) {
  if (!existsSync(path)) return { label, exists: false, ready: false, detail: 'missing' }
  try {
    const value = JSON.parse(readFileSync(path, 'utf8'))
    return {
      label,
      exists: true,
      ready: value?.summary?.ready === true,
      detail: `summary.ready=${String(value?.summary?.ready)}`,
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
const liveReady = liveEvidence.every((item) => item.ready)
const contentFailed = checks.filter((item) => !item.passed)
if (requireLive) {
  for (const item of liveEvidence) check(`live.${item.label}`, item.ready, item.detail)
}

const failed = checks.filter((item) => !item.passed)
const report = {
  contentReady: contentFailed.length === 0,
  liveReady,
  requireLive,
  slides: slides.length,
  finalSlides: finalTitles.length,
  assets: assetRefs.size,
  marketplaceTools: marketplaceTools.length,
  liveEvidence,
  checks,
}

console.log(JSON.stringify(report, null, 2))
if (failed.length > 0) process.exitCode = 1
