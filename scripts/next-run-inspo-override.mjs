import fs from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const root = path.resolve(fileURLToPath(new URL('..', import.meta.url)))
const defaultManifestPath = path.join(root, 'tmp', 'next-run-inspiration-override.json')

function usage() {
  console.log(`Usage:
  npm run next-run:inspo-override -- --url <source-url> [--title <text>] [--note <text>] [--bias term1,term2] [--image <path-or-url>] [--manifest <path>]

Purpose:
  Formal repo-local command for a true next-run Daily Frontpage inspiration override.
  It writes tmp/next-run-inspiration-override.json by default.
  That manifest is consumed by npm run daily:publish:cron on the next successful publish, then deactivated.

Examples:
  npm run next-run:inspo-override -- \
    --url "https://example.com/source" \
    --title "Robot Monk Gabi" \
    --note "Bias tomorrow toward ritual interface and devotional robotics." \
    --bias "ritual interface,machine novice monk,devotional robotics"

  npm run next-run:inspo-override -- --show
  npm run next-run:inspo-override -- --clear
`)
}

function readValue(argv, index, arg) {
  const value = argv[index + 1]
  if (!value || value.startsWith('--')) throw new Error(`Missing value for ${arg}`)
  return value
}

function parseArgs(argv) {
  const options = {
    url: null,
    title: 'Next-run inspiration override',
    note: '',
    biasTerms: [],
    image: null,
    manifest: defaultManifestPath,
    show: false,
    clear: false,
  }

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index]
    if (arg === '--help' || arg === '-h') {
      options.help = true
      continue
    }
    if (arg === '--show') {
      options.show = true
      continue
    }
    if (arg === '--clear') {
      options.clear = true
      continue
    }
    if (arg === '--url' || arg === '--source-url') {
      options.url = readValue(argv, index, arg)
      index += 1
      continue
    }
    if (arg === '--title') {
      options.title = readValue(argv, index, arg)
      index += 1
      continue
    }
    if (arg === '--note') {
      options.note = readValue(argv, index, arg)
      index += 1
      continue
    }
    if (arg === '--bias' || arg === '--bias-terms') {
      options.biasTerms = readValue(argv, index, arg).split(',').map((term) => term.trim()).filter(Boolean)
      index += 1
      continue
    }
    if (arg === '--image') {
      options.image = readValue(argv, index, arg)
      index += 1
      continue
    }
    if (arg === '--manifest') {
      options.manifest = readValue(argv, index, arg)
      index += 1
      continue
    }
    throw new Error(`Unknown option: ${arg}`)
  }

  return options
}

function resolveManifestPath(value) {
  return path.isAbsolute(value) ? value : path.resolve(root, value)
}

function imageFields(image) {
  if (!image) return {}
  const imageIsUrl = /^https?:\/\//i.test(image) || image.startsWith('data:')
  return imageIsUrl
    ? { image_url: image }
    : { image_path: path.isAbsolute(image) ? image : path.resolve(process.cwd(), image) }
}

async function readManifest(manifestPath) {
  return JSON.parse(await fs.readFile(manifestPath, 'utf8'))
}

async function showManifest(manifestPath) {
  try {
    const payload = await readManifest(manifestPath)
    console.log(JSON.stringify({ ok: true, manifest: manifestPath, payload }, null, 2))
  } catch (error) {
    if (error?.code === 'ENOENT') {
      console.log(JSON.stringify({ ok: true, manifest: manifestPath, active: false, message: 'No next-run inspiration override is installed.' }, null, 2))
      return
    }
    throw error
  }
}

async function clearManifest(manifestPath) {
  let payload = {}
  try {
    payload = await readManifest(manifestPath)
  } catch (error) {
    if (error?.code !== 'ENOENT') throw error
  }
  payload.active = false
  payload.last_status = 'cleared'
  payload.last_cleared_at = new Date().toISOString()
  await fs.mkdir(path.dirname(manifestPath), { recursive: true })
  await fs.writeFile(manifestPath, `${JSON.stringify(payload, null, 2)}\n`, 'utf8')
  console.log(JSON.stringify({ ok: true, manifest: manifestPath, active: false, message: 'next-run inspiration override cleared' }, null, 2))
}

async function installManifest(options, manifestPath) {
  if (!options.url && !options.image && !options.note) {
    throw new Error('Missing override content: pass --url, --image, or --note')
  }

  const payload = {
    active: true,
    title: options.title,
    note: options.note,
    source: 'next-run-inspo-override-command',
    source_url: options.url,
    received_at: new Date().toISOString(),
    prompt_bias_terms: options.biasTerms,
    consume_after_success: true,
    ...imageFields(options.image),
  }

  await fs.mkdir(path.dirname(manifestPath), { recursive: true })
  await fs.writeFile(manifestPath, `${JSON.stringify(payload, null, 2)}\n`, 'utf8')
  console.log(JSON.stringify({
    ok: true,
    message: 'next-run inspiration override installed',
    manifest: manifestPath,
    title: payload.title,
    source_url: payload.source_url,
    bias_terms: payload.prompt_bias_terms,
    consumed_by: 'npm run daily:publish:cron',
  }, null, 2))
}

async function main() {
  const options = parseArgs(process.argv.slice(2))
  if (options.help) {
    usage()
    return
  }

  const manifestPath = resolveManifestPath(options.manifest)
  if (options.show) {
    await showManifest(manifestPath)
    return
  }
  if (options.clear) {
    await clearManifest(manifestPath)
    return
  }
  await installManifest(options, manifestPath)
}

main().catch((error) => {
  console.error(error.message)
  process.exit(1)
})
