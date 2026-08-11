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
for (const marker of ['data-title="표지"', 'id="liveProofStatus"', '총 362개 테스트']) {
  if (!pitch.includes(marker)) throw new Error(`staged pitch is missing ${marker}`)
}
for (const path of [
  'dist/pitch/assets/hero.png',
  'dist/pitch/pitch-deck-assets/10-chat-hit-exact-quote.png',
  'dist/pitch/pitch-deck-assets/11-cli-mcp-agent-interface.png',
]) {
  if (!(await stat(path)).isFile()) throw new Error(`staged pitch asset is missing: ${path}`)
}

console.log(`verified ${assetNames.length} Pages JavaScript assets and the /pitch/ finalist deck`)
