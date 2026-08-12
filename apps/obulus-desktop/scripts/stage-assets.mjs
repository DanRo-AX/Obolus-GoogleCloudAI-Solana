import { copyFile, mkdir } from 'node:fs/promises'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const desktopRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const repositoryRoot = resolve(desktopRoot, '../..')

export const desktopFonts = [
  'InstrumentSans_Variable.woff2',
  'GeistMono_Variable.p.2f937313.woff2',
  'PretendardVariable.woff2',
]

export async function stageDesktopAssets(options = {}) {
  const sourceDirectory = options.sourceDirectory || resolve(repositoryRoot, 'public/fonts')
  const targetDirectory = options.targetDirectory || resolve(desktopRoot, 'build/fonts')
  await mkdir(targetDirectory, { recursive: true })
  await Promise.all(
    desktopFonts.map((name) => copyFile(resolve(sourceDirectory, name), resolve(targetDirectory, name))),
  )
  return { targetDirectory, fonts: desktopFonts }
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  stageDesktopAssets()
    .then((result) => process.stdout.write(`${JSON.stringify(result, null, 2)}\n`))
    .catch((error) => {
      process.stderr.write(`${error.message}\n`)
      process.exitCode = 1
    })
}
