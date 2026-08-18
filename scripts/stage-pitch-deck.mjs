#!/usr/bin/env node

import { copyFileSync, existsSync, mkdirSync, readFileSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { assertSecretFree } from './lib/finalist-evidence.mjs'

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const deckSource = join(root, 'docs', 'obulus-pitch-deck.html')
const pitchRoot = join(root, 'dist', 'pitch')
const deck = readFileSync(deckSource, 'utf8')
const stageDeckSource = join(root, 'docs', 'obulus-stage-pitch.html')
const stagePitchRoot = join(root, 'dist', 'stage-pitch')
const stageDeck = readFileSync(stageDeckSource, 'utf8')

copy(deckSource, join(pitchRoot, 'index.html'))

const assetRefs = new Set(
  [...deck.matchAll(/(?:src=|url\()["']?((?:pitch-deck-assets|assets)\/[^"')\s]+)/g)]
    .map((match) => match[1]),
)
for (const assetRef of assetRefs) {
  copy(join(root, 'docs', assetRef), join(pitchRoot, assetRef))
}

copy(stageDeckSource, join(stagePitchRoot, 'index.html'))

const stageAssetRefs = new Set(
  [...stageDeck.matchAll(/(?:src=|url\()\s*["']?([^"')\s]+)/g)]
    .map((match) => match[1])
    .filter((assetRef) => !assetRef.startsWith('data:') && !assetRef.startsWith('#')),
)
for (const assetRef of stageAssetRefs) {
  copy(resolve(dirname(stageDeckSource), assetRef), resolve(stagePitchRoot, assetRef))
}

for (const filename of ['infrastructure.json', 'autonomy.json', 'devnet.json']) {
  const source = join(root, 'artifacts', 'finalist-evidence', filename)
  if (!existsSync(source)) continue
  assertSecretFree(JSON.parse(readFileSync(source, 'utf8')))
  copy(source, join(root, 'dist', 'artifacts', 'finalist-evidence', filename))
}

console.log(`staged finalist pitch at /pitch/ with ${assetRefs.size} referenced assets`)
console.log(`staged live presentation at /stage-pitch/ with ${stageAssetRefs.size} referenced assets`)

function copy(source, destination) {
  if (!existsSync(source)) throw new Error(`pitch source is missing: ${source}`)
  mkdirSync(dirname(destination), { recursive: true })
  copyFileSync(source, destination)
}
