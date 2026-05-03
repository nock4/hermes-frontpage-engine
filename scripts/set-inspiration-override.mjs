import fs from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const root = path.resolve(fileURLToPath(new URL('..', import.meta.url)))
const defaultManifestPath = path.join(root, 'tmp', 'next-run-inspiration-override.json')

function usage() {
  console.log(`Usage:\n  node scripts/set-inspiration-override.mjs --image <path-or-url> [--title <text>] [--note <text>] [--source <name>] [--source-url <url>] [--manifest <path>] [--bias-terms term1,term2]\n`)
}

function parseArgs(argv) {
  const options = {
    image: null,
    title: 'Telegram inspiration override',
    note: '',
    source: 'telegram',
    sourceUrl: null,
    manifest: defaultManifestPath,
    biasTerms: [],
  }
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index]
    const readValue = () => {
      const value = argv[index + 1]
      if (!value || value.startsWith('--')) throw new Error(`Missing value for ${arg}`)
      index += 1
      return value
    }
    if (arg === '--help') {
      usage()
      process.exit(0)
    }
    if (arg === '--image') {
      options.image = readValue()
      continue
    }
    if (arg === '--title') {
      options.title = readValue()
      continue
    }
    if (arg === '--note') {
      options.note = readValue()
      continue
    }
    if (arg === '--source') {
      options.source = readValue()
      continue
    }
    if (arg === '--source-url') {
      options.sourceUrl = readValue()
      continue
    }
    if (arg === '--manifest') {
      options.manifest = readValue()
      continue
    }
    if (arg === '--bias-terms') {
      options.biasTerms = readValue().split(',').map((term) => term.trim()).filter(Boolean)
      continue
    }
    throw new Error(`Unknown option: ${arg}`)
  }
  if (!options.image) throw new Error('Missing required --image')
  return options
}

async function main() {
  const options = parseArgs(process.argv.slice(2))
  const manifestPath = path.isAbsolute(options.manifest) ? options.manifest : path.resolve(root, options.manifest)
  const imageIsUrl = /^https?:\/\//i.test(options.image) || options.image.startsWith('data:')
  const payload = {
    active: true,
    title: options.title,
    note: options.note,
    source: options.source,
    source_url: options.sourceUrl,
    received_at: new Date().toISOString(),
    prompt_bias_terms: options.biasTerms,
    consume_after_success: true,
    ...(imageIsUrl ? { image_url: options.image } : { image_path: path.isAbsolute(options.image) ? options.image : path.resolve(process.cwd(), options.image) }),
  }
  await fs.mkdir(path.dirname(manifestPath), { recursive: true })
  await fs.writeFile(manifestPath, `${JSON.stringify(payload, null, 2)}\n`, 'utf8')
  console.log(JSON.stringify({ ok: true, manifest: manifestPath, image: options.image, source: options.source }, null, 2))
}

main().catch((error) => {
  console.error(error.message)
  process.exit(1)
})
