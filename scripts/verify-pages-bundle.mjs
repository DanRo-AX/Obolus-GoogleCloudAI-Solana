import { readFile, readdir, stat } from 'node:fs/promises'

const routeManifest = JSON.parse(await readFile('dist/_routes.json', 'utf8'))
if (JSON.stringify(routeManifest.include) !== JSON.stringify(['/api/*', '/x402/*'])) {
  throw new Error('Pages Functions routes are missing or broader than /api/* and /x402/*')
}

const assetNames = (await readdir('dist/assets')).filter((name) => name.endsWith('.js'))
const forbidden = ['127.0.0.1:1402', '.run.app']
for (const assetName of assetNames) {
  const source = await readFile(`dist/assets/${assetName}`, 'utf8')
  const leaked = forbidden.find((value) => source.includes(value))
  if (leaked) {
    throw new Error(`Pages asset ${assetName} bypasses the same-origin proxy with ${leaked}`)
  }
}

const pitch = await readFile('dist/pitch/index.html', 'utf8')
for (const marker of [
  'data-title="표지"',
  'data-title="진입 시장과 비전"',
  'data-title="Appendix · 실제 배포 아키텍처"',
  '공개 웹에 없는 인간 근거',
  'Phantom에서 매번 출금하지 않고',
  '77 / 77 checks passed',
]) {
  if (!pitch.includes(marker)) throw new Error(`staged pitch is missing ${marker}`)
}
for (const path of [
  'dist/pitch/pitch-final-assets/00-dream-weave-white.png',
  'dist/pitch/pitch-final-assets/03-ranked-evidence-4k.png',
  'dist/pitch/pitch-final-assets/04b-admin-architecture-canvas.png',
  'dist/pitch/pitch-final-assets/05-wallet-memory-4k.png',
  'dist/pitch/pitch-final-assets/brand-assets/gemini.png',
  'dist/pitch/pitch-final-assets/brand-assets/rust.png',
  'dist/pitch/pitch-final-assets/brand-assets/solana.png',
]) {
  if (!(await stat(path)).isFile()) throw new Error(`staged pitch asset is missing: ${path}`)
}

console.log(`verified ${assetNames.length} Pages JavaScript assets and the /pitch/ finalist deck`)
