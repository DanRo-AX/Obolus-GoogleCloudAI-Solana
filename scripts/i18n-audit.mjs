// scripts/i18n-audit.mjs — t('...') 리터럴과 ko.ts 키셋 대조.
// 한계: 동적 키(t(variable))와 여러 줄에 걸친 리터럴은 잡지 못한다.
import { readFileSync, readdirSync, statSync } from 'node:fs'
import { join } from 'node:path'

const SRC = new URL('../src', import.meta.url).pathname
const KO = join(SRC, 'i18n/ko.ts')

function walk(dir) {
  return readdirSync(dir).flatMap((name) => {
    const p = join(dir, name)
    if (statSync(p).isDirectory()) return walk(p)
    return /\.(ts|tsx)$/.test(name) && !p.endsWith('ko.ts') ? [p] : []
  })
}

const LIT = /\bt\(\s*(['"])((?:\\.|(?!\1)[^\\])*)\1/g
const used = new Set()
for (const file of walk(SRC)) {
  const text = readFileSync(file, 'utf8')
  for (const m of text.matchAll(LIT)) used.add(m[2].replaceAll("\\'", "'"))
}

const KEY = /^\s{2}(['"])((?:\\.|(?!\1)[^\\])*)\1:/gm
const koText = readFileSync(KO, 'utf8')
const keys = new Set()
for (const m of koText.matchAll(KEY)) keys.add(m[2].replaceAll("\\'", "'"))

const missing = [...used].filter((k) => !keys.has(k)).sort()
const unused = [...keys].filter((k) => !used.has(k)).sort()
console.log(`MISSING (${missing.length}) — t()로 쓰였지만 ko.ts에 없음`)
for (const k of missing) console.log(`  ${k}`)
console.log(`UNUSED (${unused.length}) — ko.ts에 있지만 t() 호출 없음`)
for (const k of unused) console.log(`  ${k}`)
process.exit(missing.length ? 1 : 0)
