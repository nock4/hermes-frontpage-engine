import { spawn } from 'node:child_process'
import crypto from 'node:crypto'
import fs from 'node:fs/promises'
import fsSync from 'node:fs'
import net from 'node:net'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

import {
  clamp01,
  expansionLabel,
  readImageDimensions,
  rectPolygon,
  safeOrigin,
  writeArtifactSvgMasks,
} from './lib/edition-geometry.mjs'
import { assembleEditionPackage } from './lib/edition-package-assembly.mjs'
import { fetchWithTimeout } from './lib/fetch-with-timeout.mjs'
import {
  findVisualReference,
  inspectCandidateSource,
  youtubeEmbedStatus,
} from './lib/source-inspection.mjs'
import { mineSignals } from './lib/signal-mining.mjs'
import {
  classifySource,
  isAllowedInspectedSource,
  isDirectRasterImageUrl,
  isLowValueVisualImage,
  selectContentSources,
  selectSourceCandidatesForInspection,
  sourceContentKey,
  sourceContentScore,
  sourceHasRenderableCardSurface,
  visualReferenceScore,
} from './lib/source-selection-policy.mjs'
import { domain, getSourceDisplayTitle } from './lib/source-display.mjs'
import { sanitizeSourceText } from './lib/source-text.mjs'
import {
  canonicalizeSourceUrl,
} from './lib/source-url-policy.mjs'
import { resolveFrontpageConfig } from './lib/frontpage-config.mjs'
import { sentenceList, slugify, uniqueNonEmpty } from './lib/string-utils.mjs'

const root = process.cwd()
const hermesImageGenerateScript = fileURLToPath(new URL('./lib/hermes_image_generate.py', import.meta.url))
const defaultSignalWindowDays = 30
const defaultMaxNotes = 30
const defaultMaxSources = 16
const minContentItems = 6
const targetContentItems = 9
const maxContentItems = 10
const recentDiversityEditionCount = 6
const maxAutoresearchCandidates = 36
const autoresearchCandidateMultiplier = 4
const supportedInputModes = ['manifest', 'markdown-folder', 'obsidian-allowlist']
const supportedImageBackends = ['openai', 'hermes']
const sceneStructurePolicy = {
  sourceAnchorCount: `${minContentItems} to ${maxContentItems} source windows with 2 hero-scale anchors when possible`,
  sourceMarkVocabulary: [
    'mark',
    'surface',
    'edge detail',
    'aperture',
    'label',
    'gesture',
    'block',
    'ribbon',
    'panel',
    'island',
    'notch',
    'stripe',
    'signal node',
    'small light',
  ],
}
const envFilePaths = [
  path.join(root, '.env'),
  path.join(os.homedir(), '.env'),
  path.join(os.homedir(), '.hermes', '.env'),
]

export const usage = `Usage:
  npm run daily:process
  npm run daily:process -- --use-sample-signals
  npm run daily:process -- --input-mode manifest --signal-manifest ./examples/signals/sample-signals.json
  npm run daily:process -- --input-mode markdown-folder --input-root ./examples/signals/sample-notes
  npm run daily:process -- --existing --edition 2026-04-23-forest-breath-cabinet-v2

Default mode:
  Runs the daily pipeline from scratch: signal mining, source research, AI scene brief,
  AI image generation, post-plate vision interpretation, package assembly, masks,
  interpretation/enhancement files, validation, tests, build, and smoke UX.

Input modes:
  manifest            Read a JSON list of URLs and metadata.
  markdown-folder     Read a local folder of markdown notes.
  obsidian-allowlist  Preserve the original Nick-specific vault allowlist scan.

Options:
  --config <path>               Optional JSON config file. Also supported: DFE_CONFIG_PATH.
  --date <YYYY-MM-DD>           Edition date. Defaults to today's local date in the configured timezone.
  --input-mode <mode>           manifest | markdown-folder | obsidian-allowlist.
  --input-root <path>           Root folder for markdown-folder or obsidian-allowlist mode.
  --signal-manifest <path>      JSON manifest for manifest mode.
  --use-sample-signals          Force the repo's bundled sample manifest.
  --vault <path>                Legacy alias for --input-mode obsidian-allowlist --input-root <path>.
  --window-days <number>        Recent-note window for signal mining. Defaults to ${defaultSignalWindowDays}.
  --max-notes <number>          Notes to feed into the research stage. Defaults to ${defaultMaxNotes}.
  --max-sources <number>        Source URLs to inspect and bind. Defaults to ${defaultMaxSources}.
  --model <model>               OpenAI text/vision model. Defaults to config or OPENAI_MODEL.
  --image-model <model>         OpenAI image model. Defaults to config or OPENAI_IMAGE_MODEL.
  --image-backend <backend>     Image generation backend: openai | hermes. Defaults to config or DFE_IMAGE_BACKEND.
  --browser-harness <path>      browser-harness executable. Defaults to config or BROWSER_HARNESS_PATH.
  --source-tool <tool>          Source capture tool. From-scratch runs require browser-harness after autoresearch.
  --image-size <size>           Image generation size. Defaults to 1536x1024.
  --image-quality <quality>     Image quality. Defaults to medium.
  --publish                     Promote the generated edition to current live after assembly.
  --ux <smoke|focused|full|none>
                                UX verification scope. Defaults to smoke for from-scratch and focused for --existing.
  --existing                    Run the post-package process against existing edition(s).
  --edition <id[,id]>           Existing edition id(s) for --existing.
  --all-editions                In --existing mode, process every manifest edition.
  --remap-plate                 In --existing mode, re-run OpenAI vision mapping on the finished plate before mask generation.
  --generation-name <name>      Output folder under tmp/automated-mask-generations/.
  --prompted-mask-dir <path>    Optional external SAM/SAM2-style PNG masks for the mask candidate scorer.
  --skip-mask                   Skip automated mask/geometry generation.
  --help                        Print this help.
`

function commandExists(command) {
  if (!command) return false
  if (command.includes(path.sep)) return fsSync.existsSync(command)
  const pathEntries = String(process.env.PATH || '').split(path.delimiter).filter(Boolean)
  return pathEntries.some((entry) => fsSync.existsSync(path.join(entry, command)))
}

function splitList(value) {
  return value.split(',').map((entry) => entry.trim()).filter(Boolean)
}

function resolveValue(cliValue, fallback) {
  return cliValue != null ? cliValue : fallback
}

function localDate(timeZone = process.env.TZ || 'UTC') {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(new Date())
}

export function parseArgs(argv) {
  loadDotEnv()
  const cli = {
    mode: 'from-scratch',
    date: null,
    inputMode: null,
    inputRoot: null,
    signalManifest: null,
    useSampleSignals: false,
    vault: null,
    windowDays: null,
    maxNotes: null,
    maxSources: null,
    model: null,
    imageModel: null,
    imageBackend: null,
    browserHarness: null,
    sourceTool: null,
    imageSize: '1536x1024',
    imageQuality: 'medium',
    publish: false,
    ux: null,
    editions: [],
    allEditions: false,
    remapPlate: false,
    generationName: null,
    promptedMaskDir: null,
    skipMask: false,
    configPath: null,
  }

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index]
    const readValue = (name) => {
      const value = argv[index + 1]
      if (!value || value.startsWith('--')) throw new Error(`Missing value for ${name}`)
      index += 1
      return value
    }

    if (arg === '--help') {
      console.log(usage)
      process.exit(0)
    }
    if (arg === '--existing') {
      cli.mode = 'existing'
      continue
    }
    if (arg === '--config') {
      cli.configPath = readValue(arg)
      continue
    }
    if (arg.startsWith('--config=')) {
      cli.configPath = arg.slice('--config='.length)
      continue
    }
    if (arg === '--date') {
      cli.date = readValue(arg)
      continue
    }
    if (arg.startsWith('--date=')) {
      cli.date = arg.slice('--date='.length)
      continue
    }
    if (arg === '--input-mode') {
      cli.inputMode = readValue(arg)
      continue
    }
    if (arg.startsWith('--input-mode=')) {
      cli.inputMode = arg.slice('--input-mode='.length)
      continue
    }
    if (arg === '--input-root') {
      cli.inputRoot = readValue(arg)
      continue
    }
    if (arg.startsWith('--input-root=')) {
      cli.inputRoot = arg.slice('--input-root='.length)
      continue
    }
    if (arg === '--signal-manifest') {
      cli.signalManifest = readValue(arg)
      continue
    }
    if (arg.startsWith('--signal-manifest=')) {
      cli.signalManifest = arg.slice('--signal-manifest='.length)
      continue
    }
    if (arg === '--use-sample-signals') {
      cli.useSampleSignals = true
      continue
    }
    if (arg === '--vault') {
      cli.vault = readValue(arg)
      continue
    }
    if (arg.startsWith('--vault=')) {
      cli.vault = arg.slice('--vault='.length)
      continue
    }
    if (arg === '--window-days') {
      cli.windowDays = Number(readValue(arg))
      continue
    }
    if (arg.startsWith('--window-days=')) {
      cli.windowDays = Number(arg.slice('--window-days='.length))
      continue
    }
    if (arg === '--max-notes') {
      cli.maxNotes = Number(readValue(arg))
      continue
    }
    if (arg.startsWith('--max-notes=')) {
      cli.maxNotes = Number(arg.slice('--max-notes='.length))
      continue
    }
    if (arg === '--max-sources') {
      cli.maxSources = Number(readValue(arg))
      continue
    }
    if (arg.startsWith('--max-sources=')) {
      cli.maxSources = Number(arg.slice('--max-sources='.length))
      continue
    }
    if (arg === '--model') {
      cli.model = readValue(arg)
      continue
    }
    if (arg.startsWith('--model=')) {
      cli.model = arg.slice('--model='.length)
      continue
    }
    if (arg === '--image-model') {
      cli.imageModel = readValue(arg)
      continue
    }
    if (arg.startsWith('--image-model=')) {
      cli.imageModel = arg.slice('--image-model='.length)
      continue
    }
    if (arg === '--image-backend') {
      cli.imageBackend = readValue(arg)
      continue
    }
    if (arg.startsWith('--image-backend=')) {
      cli.imageBackend = arg.slice('--image-backend='.length)
      continue
    }
    if (arg === '--browser-harness') {
      cli.browserHarness = readValue(arg)
      continue
    }
    if (arg.startsWith('--browser-harness=')) {
      cli.browserHarness = arg.slice('--browser-harness='.length)
      continue
    }
    if (arg === '--source-tool') {
      cli.sourceTool = readValue(arg)
      continue
    }
    if (arg.startsWith('--source-tool=')) {
      cli.sourceTool = arg.slice('--source-tool='.length)
      continue
    }
    if (arg === '--image-size') {
      cli.imageSize = readValue(arg)
      continue
    }
    if (arg.startsWith('--image-size=')) {
      cli.imageSize = arg.slice('--image-size='.length)
      continue
    }
    if (arg === '--image-quality') {
      cli.imageQuality = readValue(arg)
      continue
    }
    if (arg.startsWith('--image-quality=')) {
      cli.imageQuality = arg.slice('--image-quality='.length)
      continue
    }
    if (arg === '--publish') {
      cli.publish = true
      continue
    }
    if (arg === '--ux') {
      cli.ux = readValue(arg)
      continue
    }
    if (arg.startsWith('--ux=')) {
      cli.ux = arg.slice('--ux='.length)
      continue
    }
    if (arg === '--edition') {
      cli.editions.push(...splitList(readValue(arg)))
      continue
    }
    if (arg.startsWith('--edition=')) {
      cli.editions.push(...splitList(arg.slice('--edition='.length)))
      continue
    }
    if (arg === '--all-editions') {
      cli.allEditions = true
      continue
    }
    if (arg === '--remap-plate') {
      cli.remapPlate = true
      continue
    }
    if (arg === '--generation-name') {
      cli.generationName = readValue(arg)
      continue
    }
    if (arg.startsWith('--generation-name=')) {
      cli.generationName = arg.slice('--generation-name='.length)
      continue
    }
    if (arg === '--prompted-mask-dir') {
      cli.promptedMaskDir = readValue(arg)
      continue
    }
    if (arg.startsWith('--prompted-mask-dir=')) {
      cli.promptedMaskDir = arg.slice('--prompted-mask-dir='.length)
      continue
    }
    if (arg === '--skip-mask') {
      cli.skipMask = true
      continue
    }
    throw new Error(`Unknown option: ${arg}`)
  }

  const config = resolveFrontpageConfig({ cwd: root, env: process.env, explicitConfigPath: cli.configPath })
  const options = {
    mode: cli.mode,
    date: resolveValue(cli.date, localDate(config.timezone)),
    inputMode: resolveValue(cli.inputMode, config.input_mode),
    inputRoot: resolveValue(cli.inputRoot, config.input_root),
    signalManifest: resolveValue(cli.signalManifest, config.signal_manifest),
    useSampleSignals: cli.useSampleSignals,
    windowDays: resolveValue(cli.windowDays, defaultSignalWindowDays),
    maxNotes: resolveValue(cli.maxNotes, defaultMaxNotes),
    maxSources: resolveValue(cli.maxSources, defaultMaxSources),
    model: resolveValue(cli.model, config.openai_model),
    imageModel: resolveValue(cli.imageModel, config.openai_image_model),
    imageBackend: resolveValue(cli.imageBackend, config.image_backend),
    browserHarness: resolveValue(cli.browserHarness, config.browser_harness_path),
    sourceTool: resolveValue(cli.sourceTool, process.env.DFE_SOURCE_TOOL || 'browser-harness'),
    imageSize: cli.imageSize,
    imageQuality: cli.imageQuality,
    publish: cli.publish,
    ux: cli.ux,
    editions: cli.editions,
    allEditions: cli.allEditions,
    remapPlate: cli.remapPlate,
    generationName: cli.generationName,
    promptedMaskDir: resolveValue(cli.promptedMaskDir, process.env.DFE_PROMPTED_MASK_DIR || null),
    skipMask: cli.skipMask,
    configPath: config.config_path,
    timezone: config.timezone,
    sampleDataEnabled: config.sample_data_enabled,
    sampleManifestPath: config.sample_manifest_path,
    sampleInputRoot: config.sample_input_root,
  }

  if (cli.vault) {
    options.inputMode = 'obsidian-allowlist'
    options.inputRoot = cli.vault
  }
  if (options.sampleDataEnabled || cli.useSampleSignals) {
    options.inputMode = 'manifest'
    options.signalManifest = config.sample_manifest_path
  }
  options.vault = options.inputMode === 'obsidian-allowlist' ? options.inputRoot : null

  if (!/^\d{4}-\d{2}-\d{2}$/.test(options.date)) {
    throw new Error(`Expected --date in YYYY-MM-DD format. Received: ${options.date}`)
  }
  if (!Number.isFinite(options.windowDays) || options.windowDays < 1) {
    throw new Error(`Expected --window-days to be a positive number. Received: ${options.windowDays}`)
  }
  if (!Number.isFinite(options.maxNotes) || options.maxNotes < 6) {
    throw new Error(`Expected --max-notes to be at least 6. Received: ${options.maxNotes}`)
  }
  if (!Number.isFinite(options.maxSources) || options.maxSources < 6) {
    throw new Error(`Expected --max-sources to be at least 6. Received: ${options.maxSources}`)
  }
  options.ux = options.ux || (options.mode === 'from-scratch' ? 'smoke' : 'focused')
  if (!['smoke', 'focused', 'full', 'none'].includes(options.ux)) {
    throw new Error(`Expected --ux to be one of smoke, focused, full, none. Received: ${options.ux}`)
  }
  if (!supportedInputModes.includes(options.inputMode)) {
    throw new Error(`Expected --input-mode to be one of ${supportedInputModes.join(', ')}. Received: ${options.inputMode}`)
  }
  if (!['browser-harness', 'fetch'].includes(options.sourceTool)) {
    throw new Error(`Expected --source-tool to be browser-harness or fetch. Received: ${options.sourceTool}`)
  }
  if (!supportedImageBackends.includes(options.imageBackend)) {
    throw new Error(`Expected --image-backend to be one of ${supportedImageBackends.join(', ')}. Received: ${options.imageBackend}`)
  }
  if (options.inputMode === 'manifest' && !options.signalManifest) {
    throw new Error('Manifest mode requires --signal-manifest, DFE_SIGNAL_MANIFEST, or a config file value.')
  }
  if (['markdown-folder', 'obsidian-allowlist'].includes(options.inputMode) && !options.inputRoot) {
    throw new Error(`${options.inputMode} mode requires --input-root or a config file value.`)
  }
  if (options.mode === 'from-scratch' && options.sourceTool !== 'browser-harness') {
    throw new Error(`From-scratch source capture must use browser-harness after autoresearch. Received: ${options.sourceTool}`)
  }
  if (options.mode === 'from-scratch' && options.sourceTool === 'browser-harness' && !commandExists(options.browserHarness)) {
    throw new Error(`browser-harness executable not found: ${options.browserHarness}`)
  }
  if (options.mode === 'from-scratch' && options.imageBackend === 'openai' && options.imageModel !== 'gpt-image-2') {
    throw new Error(`From-scratch plate generation with the OpenAI backend must use gpt-image-2. Received: ${options.imageModel}`)
  }

  return options
}

function defaultGenerationName() {
  return `daily-process-${new Date().toISOString().replace(/[:.]/g, '-')}`
}

function formatCommand(command, args) {
  return [command, ...args].map((part) => (/\s/.test(part) ? JSON.stringify(part) : part)).join(' ')
}

function getFreePort() {
  return new Promise((resolve, reject) => {
    const server = net.createServer()
    server.on('error', reject)
    server.listen(0, '127.0.0.1', () => {
      const address = server.address()
      const port = typeof address === 'object' && address ? address.port : null
      server.close(() => {
        if (port) resolve(port)
        else reject(new Error('Unable to allocate a local browser-harness CDP port.'))
      })
    })
  })
}

async function waitForCdpWebSocket(port, timeoutMs = 15_000) {
  const deadline = Date.now() + timeoutMs
  let lastError = null
  while (Date.now() < deadline) {
    try {
      const response = await fetchWithTimeout(`http://127.0.0.1:${port}/json/version`, {}, 1000)
      if (response.ok) {
        const payload = await response.json()
        if (payload.webSocketDebuggerUrl) return payload.webSocketDebuggerUrl
      }
    } catch (error) {
      lastError = error
    }
    await new Promise((resolve) => setTimeout(resolve, 250))
  }
  throw new Error(`Managed Chromium CDP endpoint did not become ready on port ${port}. ${lastError?.message || ''}`.trim())
}

async function startManagedBrowserHarnessBrowser(runDir, runId) {
  const { chromium } = await import('playwright')
  const port = await getFreePort()
  const userDataDir = path.join(runDir, 'browser-harness-chrome-profile')
  await fs.mkdir(userDataDir, { recursive: true })

  const child = spawn(chromium.executablePath(), [
    `--remote-debugging-port=${port}`,
    `--user-data-dir=${userDataDir}`,
    '--no-first-run',
    '--no-default-browser-check',
    '--disable-background-networking',
    'about:blank',
  ], {
    cwd: root,
    stdio: ['ignore', 'pipe', 'pipe'],
  })

  child.stdout.on('data', () => {})
  child.stderr.on('data', () => {})

  const cdpWs = await waitForCdpWebSocket(port)
  return {
    child,
    cdpWs,
    port,
    buName: `dfe-${runId.replace(/[^a-zA-Z0-9_-]/g, '-').slice(0, 48)}`,
  }
}

function stopManagedBrowserHarnessBrowser(managedBrowser) {
  if (!managedBrowser || managedBrowser.child.killed) return
  managedBrowser.child.kill('SIGTERM')
}

function loadDotEnv() {
  const loaded = {}
  for (const filePath of envFilePaths) {
    if (!fsSync.existsSync(filePath)) continue
    const text = fsSync.readFileSync(filePath, 'utf8')
    for (const raw of text.split(/\r?\n/)) {
      const line = raw.trim()
      if (!line || line.startsWith('#') || !line.includes('=')) continue
      const [key, ...rest] = line.split('=')
      if (!key) continue
      const value = rest.join('=').trim().replace(/^['"]|['"]$/g, '')
      if (!process.env[key]) {
        process.env[key] = value
        loaded[key] = true
      }
    }
  }
  return loaded
}

function requireOpenAiKey({ required = true } = {}) {
  const loaded = loadDotEnv()
  const key = process.env.OPENAI_API_KEY || null
  if (!key && required) {
    throw new Error([
      'OPENAI_API_KEY is required for the from-scratch pipeline or existing-edition plate remap.',
      'The command checked process.env plus .env, ~/.env, and ~/.hermes/.env.',
    ].join(' '))
  }
  return { key, loaded }
}

async function readJson(filePath) {
  return JSON.parse(await fs.readFile(filePath, 'utf8'))
}

async function writeJson(filePath, value) {
  await fs.mkdir(path.dirname(filePath), { recursive: true })
  await fs.writeFile(filePath, `${JSON.stringify(value, null, 2)}\n`, 'utf8')
}

async function runProcess(command, args, step, extraEnv = {}) {
  console.log(`\n[${step.index}/${step.total}] ${step.name}`)
  console.log(`tool: ${step.tool}`)
  console.log(`command: ${formatCommand(command, args)}`)

  return new Promise((resolve, reject) => {
    const child = spawn(command, args, {
      cwd: root,
      env: { ...process.env, ...extraEnv },
      stdio: 'inherit',
    })

    child.on('error', reject)
    child.on('close', (code) => {
      if (code === 0) {
        resolve()
        return
      }
      reject(new Error(`${step.name} failed with exit code ${code}`))
    })
  })
}

async function runJsonCommand(command, args, extraEnv = {}) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, {
      cwd: root,
      env: { ...process.env, ...extraEnv },
      stdio: ['ignore', 'pipe', 'pipe'],
    })

    let stdout = ''
    let stderr = ''
    child.stdout.on('data', (chunk) => {
      stdout += chunk.toString()
    })
    child.stderr.on('data', (chunk) => {
      stderr += chunk.toString()
    })
    child.on('error', reject)
    child.on('close', (code) => {
      if (code !== 0) {
        reject(new Error((stderr || stdout || `${command} exited ${code}`).trim()))
        return
      }
      try {
        resolve(JSON.parse(stdout.trim()))
      } catch (error) {
        reject(new Error(`Expected JSON from ${command}: ${error.message}\n${stdout}`))
      }
    })
  })
}

function imageAspectRatioFromSize(size) {
  const match = String(size || '').match(/(\d+)x(\d+)/i)
  if (!match) return 'landscape'
  const width = Number(match[1])
  const height = Number(match[2])
  if (!Number.isFinite(width) || !Number.isFinite(height) || width <= 0 || height <= 0) return 'landscape'
  if (width === height) return 'square'
  return width > height ? 'landscape' : 'portrait'
}

async function runInternal(step, command, fn) {
  console.log(`\n[${step.index}/${step.total}] ${step.name}`)
  console.log(`tool: ${step.tool}`)
  console.log(`command: ${command}`)
  const result = await fn()
  if (result !== undefined) console.log(JSON.stringify(result, null, 2))
  return result
}

function getResearchContentSources(researchField) {
  return Array.isArray(researchField.content_sources) && researchField.content_sources.length
    ? researchField.content_sources
    : selectContentSources(researchField.sources || [])
}

function buildSourceLookup(sources) {
  const lookup = new Map()
  for (const source of sources || []) {
    for (const url of [source.url, source.source_url, source.final_url]) {
      if (url && !lookup.has(url)) lookup.set(url, source)
    }
  }
  return lookup
}

function noteLookupForSignalHarvest(signalHarvest) {
  const lookup = new Map()
  for (const note of signalHarvest?.notes_selected || []) {
    for (const key of [note.id, note.path, note.title].filter(Boolean)) lookup.set(key, note)
  }
  return lookup
}

function researchEvidenceForSource(source, index, { recentSourceKeys = new Set(), noteLookup = new Map() } = {}) {
  const note = noteLookup.get(source.note_id) || noteLookup.get(source.note_path) || noteLookup.get(source.note_title) || null
  return {
    id: `source-${index + 1}`,
    url: source.url,
    final_url: source.final_url,
    canonical_key: sourceContentKey(source),
    title: getSourceDisplayTitle(source, source.note_title || source.url),
    description: sanitizeSourceText(source.description, '', 650),
    visible_text: sanitizeSourceText(source.visible_text, '', 700),
    image_url: source.image_url || null,
    youtube_embed_status: source.youtube_embed_status || null,
    source_channel: source.source_channel,
    source_type: source.source_type,
    note_title: source.note_title,
    note_date: source.note_date,
    note_excerpt: sanitizeSourceText(note?.excerpt, '', 600),
    renderable_surface: sourceHasRenderableCardSurface(source, { notes_selected: note ? [note] : [] }),
    recent_duplicate: recentSourceKeys.has(sourceContentKey(source)),
    evidence_score: Math.round(sourceContentScore(source, recentSourceKeys)),
  }
}

function buildResearchSourceLookup(sources) {
  const lookup = new Map()
  for (const source of sources || []) {
    const aliases = [
      source.url,
      source.source_url,
      source.final_url,
      sourceContentKey(source),
      canonicalizeSourceUrl(source.url),
      canonicalizeSourceUrl(source.source_url),
      canonicalizeSourceUrl(source.final_url),
    ].filter(Boolean)
    for (const alias of aliases) {
      if (!lookup.has(alias)) lookup.set(alias, source)
    }
  }
  return lookup
}

function lookupResearchSource(lookup, value) {
  if (!value) return null
  return lookup.get(value) || lookup.get(canonicalizeSourceUrl(value)) || null
}

function selectedUrlsFromAutoresearch(autoresearch) {
  const urls = []
  for (const url of autoresearch?.selected_content_urls || []) urls.push(url)
  for (const decision of autoresearch?.source_decisions || []) {
    if (['content', 'visual_reference'].includes(decision?.role)) urls.push(decision.url)
  }
  for (const url of autoresearch?.visual_reference_urls || []) urls.push(url)
  return uniqueNonEmpty(urls)
}

function normalizeAutoresearchSelection(autoresearch, evidenceSources, {
  maxSources,
  recentSourceKeys = new Set(),
  signalHarvest = null,
} = {}) {
  const lookup = buildResearchSourceLookup(evidenceSources)
  const preferredTwitterSource = (source) => {
    if (source?.source_channel !== 'twitter-bookmark' || source?.source_type === 'tweet') return source
    const noteKey = source.note_id || source.note_title || source.note_path
    if (!noteKey) return source
    return evidenceSources.find((candidate) => (
      candidate?.source_channel === 'twitter-bookmark'
      && candidate?.source_type === 'tweet'
      && [candidate.note_id, candidate.note_title, candidate.note_path].includes(noteKey)
    )) || source
  }
  const selected = []
  const seen = new Set()
  const seenTwitterNotes = new Set()
  const addSource = (source) => {
    source = preferredTwitterSource(source)
    if (!source || selected.length >= maxSources) return
    const key = sourceContentKey(source)
    if (!key || seen.has(key)) return
    if (recentSourceKeys.has(key)) return
    if (source.source_channel === 'twitter-bookmark') {
      const twitterNoteKey = source.note_id || source.note_title || source.note_path
      if (twitterNoteKey && seenTwitterNotes.has(twitterNoteKey)) return
      if (twitterNoteKey) seenTwitterNotes.add(twitterNoteKey)
    }
    seen.add(key)
    selected.push(source)
  }

  for (const url of selectedUrlsFromAutoresearch(autoresearch)) {
    addSource(lookupResearchSource(lookup, url))
  }

  const deterministicContent = selectContentSources(evidenceSources, {
    recentSourceKeys,
    maxItems: maxSources,
    targetItems: Math.min(targetContentItems, maxSources),
    signalHarvest,
  })
  for (const source of deterministicContent) addSource(source)

  const rankedFallback = [...evidenceSources]
    .map((source) => ({ source, score: sourceContentScore(source, recentSourceKeys) }))
    .filter((entry) => Number.isFinite(entry.score))
    .sort((left, right) => right.score - left.score)
  for (const { source } of rankedFallback) addSource(source)

  return selected.slice(0, maxSources)
}

async function collectFetchEvidenceForAutoresearch(candidates, { recentSourceKeys, signalHarvest, runDir }) {
  const inspected = []
  for (const candidate of candidates) {
    const source = await inspectCandidateSource(candidate, { sourceTool: 'fetch', browserHarness: null })
    if (!source || !isAllowedInspectedSource(source)) continue
    inspected.push(source)
  }

  const noteLookup = noteLookupForSignalHarvest(signalHarvest)
  const evidence = inspected.map((source, index) => researchEvidenceForSource(source, index, {
    recentSourceKeys,
    noteLookup,
  }))
  await writeJson(path.join(runDir, 'source-candidate-evidence.json'), {
    generated_at: new Date().toISOString(),
    tool: 'Node fetch + DNS-aware source policy',
    candidate_count: candidates.length,
    evidence_count: evidence.length,
    evidence,
  })
  return inspected
}

async function runSourceAutoresearch({
  signalHarvest,
  evidenceSources,
  apiKey,
  model,
  date,
  maxSources,
  recentSourceKeys = new Set(),
}, runDir) {
  const noteLookup = noteLookupForSignalHarvest(signalHarvest)
  const evidence = evidenceSources.map((source, index) => researchEvidenceForSource(source, index, {
    recentSourceKeys,
    noteLookup,
  }))
  const request = {
    date,
    workflow: 'llm-wiki-inspired autoresearch: read all candidate source evidence first, cluster the field, synthesize a thesis, choose sources with provenance, then hand only selected URLs to browser capture.',
    hard_rules: [
      'Use only URLs present in candidate_sources. Do not invent outside URLs.',
      'Public content must come only from recent saved-signal channels: Twitter bookmarks, YouTube likes, NTS resolved streaming sources, and Chrome bookmarks.',
      'Never select local files, text documents, NTS pages, unresolved search locators, or URLs that are not in the candidate list.',
      `Select ${minContentItems} to ${maxContentItems} content URLs when enough suitable sources exist; ${targetContentItems} is ideal.`,
      'Avoid duplicates by story, source page, resolved media, redirect target, video, post, or image.',
      'Prefer variety across channel, source type, domain, and note cluster.',
      'Prefer source material that can render as title plus real image, direct image, tweet media, or native YouTube embed.',
      'For NTS-derived rows, prefer YouTube streaming sources, then Bandcamp, then SoundCloud.',
      'Choose artistic or material-rich raster visual references over technical diagrams, logos, docs chrome, favicons, icons, and placeholder images.',
    ],
    expected_output_schema: {
      research_question: 'string',
      synthesis: 'plain-language paragraph describing what the sources collectively suggest',
      edition_thesis: 'short visual/editorial thesis for today',
      clusters: [{ label: 'string', takeaway: 'string', urls: ['candidate URL strings'] }],
      source_decisions: [{ url: 'candidate URL string', role: 'content | visual_reference | supporting | reject', why: 'string', confidence: 'high | medium | low' }],
      selected_content_urls: ['7 to 10 candidate URL strings'],
      visual_reference_urls: ['1 to 3 candidate URL strings with likely strong real imagery'],
      capture_notes: ['what browser-harness should verify or capture after research'],
      rejected_patterns: ['duplicate or low-value patterns avoided'],
    },
    signal_summary: {
      notes_selected: signalHarvest.notes_selected.slice(0, 30).map(({ text, urls, ...note }) => ({
        ...note,
        url_count: urls?.length || 0,
        excerpt: sanitizeSourceText(note.excerpt, '', 500),
      })),
      motif_terms: signalHarvest.motif_terms.slice(0, 30),
    },
    candidate_sources: evidence,
  }
  await writeJson(path.join(runDir, 'source-autoresearch-request.json'), request)

  try {
    const result = await openAiJson({
      apiKey,
      model,
      instructions: [
        'You are the source-research editor for a daily interactive artwork.',
        'Think like an autoresearch pass, not a metadata scraper: orient to all evidence, cluster it, identify the strongest through-line, select a varied source set, and preserve provenance.',
        'Return strict JSON matching the requested schema. Do not include Markdown.',
      ].join(' '),
      input: JSON.stringify(request, null, 2),
      maxOutputTokens: 6000,
    })
    const normalized = {
      ...result,
      generated_at: new Date().toISOString(),
      tool: `OpenAI Responses API (${model})`,
      workflow: request.workflow,
      candidate_count: evidence.length,
    }
    await writeJson(path.join(runDir, 'source-autoresearch.json'), normalized)
    return normalized
  } catch (error) {
    const fallback = {
      generated_at: new Date().toISOString(),
      tool: `OpenAI Responses API (${model})`,
      workflow: request.workflow,
      status: 'fallback',
      error: error.message,
      research_question: `What recent saved signals should shape the ${date} edition?`,
      synthesis: 'The model autoresearch pass failed, so the runner fell back to deterministic channel-balanced source ranking.',
      edition_thesis: 'A varied saved-signal field selected by source quality, renderability, recency, and channel balance.',
      clusters: [],
      source_decisions: [],
      selected_content_urls: selectContentSources(evidenceSources, {
        recentSourceKeys,
        maxItems: Math.min(maxSources, maxContentItems),
        targetItems: Math.min(targetContentItems, maxSources),
        signalHarvest,
      }).map((source) => source.url),
      visual_reference_urls: evidenceSources
        .filter((source) => source.image_url && !isLowValueVisualImage(source.image_url))
        .sort((left, right) => visualReferenceScore(right, recentSourceKeys) - visualReferenceScore(left, recentSourceKeys))
        .slice(0, 3)
        .map((source) => source.url),
      capture_notes: ['Fallback mode: browser-harness should verify selected media surfaces and source images.'],
      rejected_patterns: ['recent duplicates', 'low-value technical preview images', 'non-renderable source URLs'],
      candidate_count: evidence.length,
    }
    await writeJson(path.join(runDir, 'source-autoresearch.json'), fallback)
    return fallback
  }
}

async function captureAutoresearchedSources(selectedSources, { sourceTool, browserHarness, maxSources }) {
  const captured = []
  const seen = new Set()

  for (const candidate of selectedSources) {
    if (captured.length >= maxSources) break
    const key = sourceContentKey(candidate)
    if (!key || seen.has(key)) continue
    seen.add(key)
    const source = await inspectCandidateSource(candidate, { sourceTool, browserHarness })
    if (!source || !isAllowedInspectedSource(source)) continue
    captured.push(source)
  }

  return captured
}

async function inspectSourceCandidates(signalHarvest, {
  maxSources,
  runDir,
  sourceTool,
  browserHarness,
  recentSourceKeys = new Set(),
  apiKey,
  model,
  date,
}) {
  const candidateLimit = Math.max(maxSources, Math.min(maxSources * autoresearchCandidateMultiplier, maxAutoresearchCandidates))
  const candidates = selectSourceCandidatesForInspection(signalHarvest, candidateLimit, { recentSourceKeys })
  const fetchEvidence = await collectFetchEvidenceForAutoresearch(candidates, {
    recentSourceKeys,
    signalHarvest,
    runDir,
  })
  const autoresearch = await runSourceAutoresearch({
    signalHarvest,
    evidenceSources: fetchEvidence,
    apiKey,
    model,
    date,
    maxSources,
    recentSourceKeys,
  }, runDir)
  const selectedForCapture = normalizeAutoresearchSelection(autoresearch, fetchEvidence, {
    maxSources,
    recentSourceKeys,
    signalHarvest,
  })
  const inspected = await captureAutoresearchedSources(selectedForCapture, {
    sourceTool,
    browserHarness,
    maxSources,
  })

  if (inspected.length < Math.min(maxSources, minContentItems)) {
    const capturedKeys = new Set(inspected.map(sourceContentKey))
    const fillCandidates = fetchEvidence
      .filter((source) => !capturedKeys.has(sourceContentKey(source)))
      .sort((left, right) => sourceContentScore(right, recentSourceKeys) - sourceContentScore(left, recentSourceKeys))
      .slice(0, maxSources - inspected.length)
    inspected.push(...await captureAutoresearchedSources(fillCandidates, {
      sourceTool,
      browserHarness,
      maxSources: maxSources - inspected.length,
    }))
  }

  const visualReference = await findVisualReference(signalHarvest, inspected, { sourceTool, browserHarness, recentSourceKeys })
  const contentSources = selectContentSources(inspected, { recentSourceKeys, signalHarvest })

  const researchField = {
    generated_at: new Date().toISOString(),
    source_research_tool: `OpenAI Responses API (${model}) autoresearch over Node fetch evidence`,
    source_capture_tool: sourceTool,
    browser_harness: sourceTool === 'browser-harness' ? browserHarness : null,
    autoresearch,
    fetch_evidence_count: fetchEvidence.length,
    source_count: inspected.length,
    visual_reference: visualReference,
    content_source_count: contentSources.length,
    content_sources: contentSources,
    sources: inspected,
  }

  await writeJson(path.join(runDir, 'source-research.json'), researchField)
  if (contentSources.length < minContentItems) {
    throw new Error(`Source research produced ${contentSources.length} non-duplicate renderable content sources; expected at least ${minContentItems}. See ${path.relative(root, path.join(runDir, 'source-research.json'))}.`)
  }
  return researchField
}

const fallbackMotifStopwords = new Set([
  'a',
  'an',
  'and',
  'are',
  'artwork',
  'audio',
  'avoid',
  'channel',
  'channels',
  'collisions',
  'cover',
  'creative process',
  'demo',
  'embed',
  'good',
  'image',
  'images',
  'instantly',
  'known',
  'landing',
  'media',
  'page',
  'pages',
  'persistent',
  'public',
  'recognizable',
  'reliable',
  'sample',
  'signal',
  'signals',
  'source',
  'sources',
  'stable',
  'strong',
  'support',
  'surface',
  'surfaces',
  'text',
  'thumbnail',
  'track',
  'urls',
  'variant',
  'video',
  'anchor',
  'originality',
  'recombination',
])

function trimSourceCreatorSuffix(value) {
  return String(value || '')
    .replace(/,\s*by\s+.+$/i, '')
    .replace(/\s+by\s+.+$/i, '')
    .replace(/\s*\([^)]*edition[^)]*\)/gi, '')
    .replace(/\s+/g, ' ')
    .trim()
}

function isUsefulFallbackMotifTerm(term) {
  const normalized = String(term || '').toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim()
  if (!normalized || normalized.length < 4) return false
  if (/^\d+$/.test(normalized)) return false
  if (fallbackMotifStopwords.has(normalized)) return false
  if (/^(known good|public signal|sample urls|landing page|image surface)$/.test(normalized)) return false
  return true
}

function selectFallbackMotifTerms(signalHarvest, limit = 8) {
  return uniqueNonEmpty(
    (signalHarvest?.motif_terms || [])
      .map((entry) => entry?.term)
      .filter(isUsefulFallbackMotifTerm),
  ).slice(0, limit)
}

function fallbackMotifPhrase(term) {
  const clean = String(term || '').replace(/-/g, ' ').trim()
  if (!clean) return ''
  if (/(dreamlike|ambient|electronic|textural|luminous|glow|bright|shadow|nocturnal|organ centered)/i.test(clean)) return `${clean} atmosphere`
  if (/(branching|labyrinth|geometry|structures|structure|logic|recursion|remix|recombination)/i.test(clean)) return `${clean} geometry`
  if (/(art|artwork|cover|poster|collage|ribbon|plaque|panel)/i.test(clean)) return `${clean} surfaces`
  return clean
}

function buildFallbackMaterialProfile(signalHarvest, researchField) {
  const motifTerms = selectFallbackMotifTerms(signalHarvest, 6)
  const visualReferenceTitle = trimSourceCreatorSuffix(getSourceDisplayTitle(researchField?.visual_reference, ''))
  const sourceTitles = getResearchContentSources(researchField)
    .slice(0, 3)
    .map((source) => trimSourceCreatorSuffix(getSourceDisplayTitle(source, '')))
    .filter(Boolean)

  return uniqueNonEmpty([
    visualReferenceTitle ? `${visualReferenceTitle} cover art` : '',
    ...motifTerms.slice(0, 4).map(fallbackMotifPhrase),
    ...sourceTitles.slice(0, 2).map((title) => `${title} sleeve imagery`),
  ]).slice(0, 5)
}

function inferVisualDirectionFallback(signalHarvest, researchField, recentEditions = []) {
  const motifTerms = selectFallbackMotifTerms(signalHarvest, 18)
  const textCorpus = [
    researchField.autoresearch?.synthesis,
    researchField.autoresearch?.edition_thesis,
    researchField.visual_reference?.description,
    researchField.visual_reference?.selection_reason,
    ...motifTerms,
    ...getResearchContentSources(researchField)
      .slice(0, 8)
      .flatMap((source) => [source.title, source.description, source.note_context]),
  ].filter(Boolean).join(' ').toLowerCase()

  const score = (terms) => terms.reduce((total, term) => total + (textCorpus.match(new RegExp(`\\b${term}\\b`, 'g')) || []).length, 0)
  const brightScore = score(['bright', 'sun', 'yellow', 'warm', 'color', 'chromatic', 'paint', 'floral', 'garden', 'glow'])
  const darkScore = score(['dark', 'night', 'charcoal', 'smoke', 'shadow', 'fog', 'black', 'nocturnal'])
  const hardEdgeScore = score(['grid', 'block', 'tile', 'panel', 'diagram', 'signal', 'poster', 'graphic', 'print'])
  const organicScore = score(['wave', 'cloud', 'petal', 'garden', 'field', 'body', 'drift', 'water', 'handmade'])
  const collageScore = score(['collage', 'scrap', 'archive', 'patch', 'assemblage', 'layer'])
  const gesturalScore = score(['gesture', 'paint', 'brush', 'scribble', 'smear', 'mark'])
  const denseScore = score(['dense', 'busy', 'crowd', 'cluster', 'maximal', 'stack'])
  const airyScore = score(['open', 'spare', 'quiet', 'empty', 'calm', 'breath'])
  const recentText = recentEditions.map((edition) => `${edition.title || ''} ${edition.scene_family || ''}`).join(' ').toLowerCase()
  const repeatedMinimal = /(minimal|quiet|gate|threshold|corridor|charcoal|shadow|fog)/.test(recentText)

  const brightnessProfile = brightScore > darkScore ? 'bright' : darkScore > brightScore + 1 ? 'low-key' : 'mixed'
  const densityProfile = denseScore > airyScore ? 'dense' : airyScore > denseScore ? 'airy' : 'balanced'
  const geometryProfile = hardEdgeScore > organicScore ? 'hard-edge' : organicScore > hardEdgeScore ? 'organic' : 'mixed'
  const compositionProfile = collageScore >= Math.max(gesturalScore, hardEdgeScore) && collageScore > 0
    ? 'collage'
    : gesturalScore > hardEdgeScore
      ? 'gestural'
      : hardEdgeScore > 0
        ? 'block-based'
        : 'distributed'
  const paletteProfile = brightnessProfile === 'bright'
    ? 'let the strongest source-image colors stay saturated and visible rather than muting them'
    : brightnessProfile === 'low-key'
      ? 'keep tonal contrast sourced from the material while preserving readable accents'
      : 'balance luminous accents with grounded neutrals drawn from the research set'
  const lightingProfile = brightnessProfile === 'bright'
    ? 'follow the source set toward even, open illumination unless the evidence clearly calls for drama'
    : 'derive the lighting from the strongest research imagery rather than imposing theatrical darkness'
  const negativeSpaceTarget = densityProfile === 'dense' ? 'let density expand where the sources support it; keep enough breathing room for interaction targets' : densityProfile === 'airy' ? 'preserve open breathing room where the source field feels spacious' : 'balance open space with clustered activity according to the source evidence'
  const materialProfile = buildFallbackMaterialProfile(signalHarvest, researchField)
  const avoidPatterns = uniqueNonEmpty([
    repeatedMinimal ? 'avoid repeating the recent minimal dark threshold/gate vocabulary unless the new research clearly reinforces it' : '',
    'avoid generic office-room, dashboard, or card-grid fallback staging',
  ])

  return {
    evidence_summary: researchField.autoresearch?.synthesis || researchField.autoresearch?.edition_thesis || 'Visual direction should be inferred from the saved-signal research set.',
    brightness_profile: brightnessProfile,
    density_profile: densityProfile,
    abstraction_profile: 'abstract',
    geometry_profile: geometryProfile,
    composition_profile: compositionProfile,
    palette_profile: paletteProfile,
    material_profile: materialProfile.length ? materialProfile : ['research-shaped surfaces', 'source-led color relationships'],
    lighting_profile: lightingProfile,
    negative_space_guidance: negativeSpaceTarget,
    anchor_strategy: 'derive anchor scale and loudness from the source field; some anchors can be bold islands while others remain embedded details',
    prompt_guardrails: uniqueNonEmpty([
      'derive composition, palette, density, and geometry from the supplied sources instead of a preset house style',
      'let the strongest visual reference influence spatial structure and color relationships, not just texture',
      repeatedMinimal ? 'break away from the recent dark sparse runs if the new source field allows it' : '',
    ]),
    avoid_patterns: avoidPatterns,
    scene_family_seed: slugBaseWithoutVersion(researchField.autoresearch?.edition_thesis || motifTerms.slice(0, 3).join(' ') || 'daily-source-field'),
    mood_phrase: `${brightnessProfile} ${compositionProfile} source field shaped by current research`,
    dominant_structure: densityProfile === 'dense' ? 'multiple clusters or panels if the evidence supports them' : 'one to three major structures if that best fits the evidence',
    material_limit: densityProfile === 'dense' ? 6 : densityProfile === 'airy' ? 4 : 5,
  }
}

async function inferVisualDirection({ signalHarvest, researchField, apiKey, model, date, recentEditions = [] }, runDir) {
  const fallback = inferVisualDirectionFallback(signalHarvest, researchField, recentEditions)
  const request = {
    date,
    goal: 'Infer visual direction from the mined Obsidian signals, autoresearch synthesis, selected content sources, and visual reference. Do not impose a fixed house aesthetic. Let the evidence decide brightness, density, geometry, composition, and material language.',
    constraints: [
      'Treat aesthetic direction as evidence-derived, not preset-derived.',
      'Use the supplied visual reference to influence composition structure, geometry, color relationships, layering, density, and atmosphere when relevant.',
      'Avoid generic office-room, dashboard, and card-grid staging.',
      'Consider recent editions only as anti-repetition pressure, not as a style template to repeat.',
    ],
    expected_output_schema: {
      evidence_summary: 'string',
      brightness_profile: 'bright | mixed | low-key',
      density_profile: 'airy | balanced | dense',
      abstraction_profile: 'abstract | hybrid | representational',
      geometry_profile: 'hard-edge | organic | mixed',
      composition_profile: 'field-based | block-based | collage | distributed | gestural | stacked',
      palette_profile: 'plain-language palette guidance grounded in evidence',
      material_profile: ['3 to 6 source-led materials or surface cues'],
      lighting_profile: 'plain-language lighting guidance grounded in evidence',
      negative_space_guidance: 'how open or dense the page should feel, based on evidence',
      dominant_structure: 'plain-language description of how many major structures the composition should support',
      anchor_strategy: 'how source anchors should show up visibly in this specific visual world',
      prompt_guardrails: ['3 to 6 evidence-derived art-direction guardrails'],
      avoid_patterns: ['specific repeated patterns to avoid if recent editions overused them'],
      scene_family_seed: 'kebab-case seed inferred from the field, not a versioned slug',
      mood_phrase: 'short phrase describing the source-led visual mood',
      material_limit: 'integer from 4 to 6',
    },
    signal_summary: {
      motif_terms: signalHarvest.motif_terms.slice(0, 24),
      notes_selected: signalHarvest.notes_selected.slice(0, 16).map(({ text, urls, ...note }) => ({
        ...note,
        url_count: urls?.length || 0,
        excerpt: sanitizeSourceText(note.excerpt, '', 240),
      })),
    },
    autoresearch: {
      synthesis: researchField.autoresearch?.synthesis || null,
      edition_thesis: researchField.autoresearch?.edition_thesis || null,
      clusters: researchField.autoresearch?.clusters || [],
      rejected_patterns: researchField.autoresearch?.rejected_patterns || [],
    },
    visual_reference: researchField.visual_reference ? {
      title: getSourceDisplayTitle(researchField.visual_reference, 'Visual reference'),
      description: researchField.visual_reference.description || null,
      selection_reason: researchField.visual_reference.selection_reason || null,
      source_url: researchField.visual_reference.url || researchField.visual_reference.source_url || null,
      image_url: researchField.visual_reference.image_url || null,
    } : null,
    content_sources: getResearchContentSources(researchField).slice(0, 8).map((source) => ({
      title: getSourceDisplayTitle(source, 'Source'),
      description: sanitizeSourceText(source.description, '', 240),
      note_context: sanitizeSourceText(source.note_context, '', 180),
      source_type: source.source_type || null,
      domain: domain(source.url || source.final_url || '') || null,
      has_image: Boolean(source.image_url),
    })),
    recent_editions: recentEditions.slice(0, recentDiversityEditionCount).map((edition) => ({
      title: edition.title,
      scene_family: edition.scene_family,
      summary: edition.about_excerpt || null,
    })),
  }
  await writeJson(path.join(runDir, 'visual-direction-request.json'), request)

  try {
    const inferred = await openAiJson({
      apiKey,
      model,
      instructions: [
        'You infer art direction for a daily interactive image from research evidence.',
        'Do not impose a fixed house style.',
        'Ground every visual recommendation in the supplied signals, source summaries, and visual reference.',
        'Return strict JSON matching the requested schema.',
      ].join(' '),
      input: JSON.stringify(request, null, 2),
      maxOutputTokens: 3000,
    })
    const normalized = {
      ...fallback,
      ...inferred,
      material_profile: normalizeStringArray(inferred.material_profile, fallback.material_profile).slice(0, 6),
      prompt_guardrails: normalizeStringArray(inferred.prompt_guardrails, fallback.prompt_guardrails).slice(0, 6),
      avoid_patterns: normalizeStringArray(inferred.avoid_patterns, fallback.avoid_patterns).slice(0, 6),
      scene_family_seed: slugBaseWithoutVersion(inferred.scene_family_seed || fallback.scene_family_seed),
      material_limit: Math.max(4, Math.min(6, Number(inferred.material_limit) || fallback.material_limit || 5)),
      generated_at: new Date().toISOString(),
      tool: `OpenAI Responses API (${model})`,
    }
    await writeJson(path.join(runDir, 'visual-direction.json'), normalized)
    return normalized
  } catch (error) {
    const normalized = {
      ...fallback,
      generated_at: new Date().toISOString(),
      tool: `OpenAI Responses API (${model})`,
      status: 'fallback',
      error: error.message,
    }
    await writeJson(path.join(runDir, 'visual-direction.json'), normalized)
    return normalized
  }
}

function firstJsonObject(text) {
  const trimmed = text.trim()
  if (trimmed.startsWith('{') && trimmed.endsWith('}')) return JSON.parse(trimmed)
  const start = trimmed.indexOf('{')
  const end = trimmed.lastIndexOf('}')
  if (start === -1 || end === -1 || end <= start) {
    throw new Error(`OpenAI response did not contain a JSON object: ${trimmed.slice(0, 200)}`)
  }
  return JSON.parse(trimmed.slice(start, end + 1))
}

function extractOutputText(response) {
  if (typeof response.output_text === 'string') return response.output_text
  const chunks = []
  for (const item of response.output || []) {
    for (const content of item.content || []) {
      if (content.type === 'output_text' && typeof content.text === 'string') chunks.push(content.text)
      if (content.type === 'text' && typeof content.text === 'string') chunks.push(content.text)
    }
  }
  return chunks.join('\n')
}

async function openAiJson({ apiKey, model, instructions, input, maxOutputTokens = 5000 }) {
  const jsonInput = ensureJsonModeInput(input)
  const response = await fetch('https://api.openai.com/v1/responses', {
    method: 'POST',
    headers: {
      authorization: `Bearer ${apiKey}`,
      'content-type': 'application/json',
    },
    body: JSON.stringify({
      model,
      instructions,
      input: jsonInput,
      text: { format: { type: 'json_object' } },
      max_output_tokens: maxOutputTokens,
    }),
  })

  const body = await response.json().catch(async () => ({ raw: await response.text() }))
  if (!response.ok) {
    throw new Error(`OpenAI Responses API failed (${response.status}): ${JSON.stringify(body).slice(0, 1000)}`)
  }
  return firstJsonObject(extractOutputText(body))
}

function ensureJsonModeInput(input) {
  if (typeof input === 'string') return `Return JSON.\n${input}`
  if (!Array.isArray(input)) return input
  return input.map((message, index) => {
    if (index !== 0 || !Array.isArray(message?.content)) return message
    return {
      ...message,
      content: [
        { type: 'input_text', text: 'Return JSON.' },
        ...message.content,
      ],
    }
  })
}

function fallbackDailyPayload(signalHarvest, researchField, visualDirection, date) {
  const sources = getResearchContentSources(researchField).slice(0, targetContentItems)
  const tags = selectFallbackMotifTerms(signalHarvest, 5)
  const sceneFamilySeed = slugBaseWithoutVersion(visualDirection.scene_family_seed || tags.join(' ') || 'daily-source-field')
  return {
    edition_title: String(researchField.autoresearch?.edition_thesis || '').trim() || 'Research Field',
    scene_family: sceneFamilySeed,
    slug_base: sceneFamilySeed,
    motif_tags: tags.length ? tags : ['signals', 'research', 'sources', 'field'],
    mood: visualDirection.mood_phrase || 'research-shaped visual field',
    material_language: visualDirection.material_profile?.length ? visualDirection.material_profile : ['research-shaped surfaces', 'source-led color relationships'],
    lighting: visualDirection.lighting_profile || 'derive the lighting from the strongest research imagery',
    object_inventory: [
      visualDirection.dominant_structure || 'research-led dominant structures',
      visualDirection.anchor_strategy || 'source-bearing anchors with varied scale',
      `${visualDirection.geometry_profile || 'mixed'} geometry`,
      `${visualDirection.composition_profile || 'distributed'} composition`,
    ],
    negative_constraints: uniqueNonEmpty([
      'no generic office room',
      'no dashboard cards',
      'no floating UI',
      'no equal-weight grid of source objects',
      'no literal depiction of the source reference image',
      ...(visualDirection.avoid_patterns || []),
    ]),
    ambiance: {
      motion_system: 'source-shaped drift',
      color_drift: visualDirection.palette_profile || 'research-led palette drift',
      glow_behavior: 'artifact-proximity',
      audio_posture: 'silent',
      webgl_mode: 'none',
    },
    scene_prompt: `A full-bleed artwork for ${date} derived from the current research field. ${visualDirection.evidence_summary || ''} Let the composition follow a ${visualDirection.composition_profile || 'distributed'} structure with ${visualDirection.geometry_profile || 'mixed'} geometry and a ${visualDirection.brightness_profile || 'mixed'} brightness profile. ${visualDirection.palette_profile || ''} ${visualDirection.lighting_profile || ''} ${visualDirection.negative_space_guidance || ''} Embed source-bearing anchors as visible forms that belong naturally to the scene rather than as a literal object inventory or interface mockup.`,
    visual_direction: visualDirection,
    artifacts: sources.map((source, index) => ({
      label: [
        'Primary Source Anchor',
        'Secondary Source Anchor',
        'Signal Panel',
        'Color Node',
        'Field Marker',
        'Edge Detail',
        'Layered Fragment',
        'Reference Plaque',
        'Distributed Marker',
        'Surface Annotation',
      ][index] || `Source Artifact ${index + 1}`,
      artifact_type: [
        'primary-source-anchor',
        'secondary-source-anchor',
        'signal-panel',
        'color-node',
        'field-marker',
        'edge-detail',
        'layered-fragment',
        'reference-plaque',
        'distributed-marker',
        'surface-annotation',
      ][index] || 'source-mark',
      role: index < 2 ? 'hero source-bearing anchor' : 'source-bearing detail',
      source_url: source.url,
    })),
  }
}

async function composeDailyPayload({ signalHarvest, researchField, apiKey, model, date, recentEditions = [], diversityDirective = '' }, runDir) {
  const contentSources = getResearchContentSources(researchField).slice(0, maxContentItems)
  const visualDirection = await inferVisualDirection({ signalHarvest, researchField, apiKey, model, date, recentEditions }, runDir)
  const visualReference = researchField.visual_reference?.image_url ? {
    title: getSourceDisplayTitle(researchField.visual_reference, 'Visual reference'),
    source_url: researchField.visual_reference.url || researchField.visual_reference.source_url,
    final_url: researchField.visual_reference.final_url,
    image_url: researchField.visual_reference.image_url,
    description: researchField.visual_reference.description,
    selection_reason: researchField.visual_reference.selection_reason,
    visual_reference_score: researchField.visual_reference.visual_reference_score,
  } : null
  const prompt = {
    date,
    product_rules: [
      'The image is the interface.',
      'Live mode should feel like artwork first, software second.',
      'Prefer abstract, image-led, research-shaped worlds over generic desks, dashboards, and office rooms.',
      'Every mapped artifact must be a visible source-bearing mark, gesture, edge, aperture, surface, or interruption in the generated plate.',
      'Source windows must bind to real saved source URLs, not generic summaries.',
      'Automated research shapes scene direction and ambiance, but public source bindings come from the saved material supplied here.',
    ],
    signal_harvest: {
      notes_selected: signalHarvest.notes_selected.slice(0, 24),
      motif_terms: signalHarvest.motif_terms.slice(0, 36),
    },
    source_research: contentSources,
    content_selection_rules: [
      `Use ${minContentItems} to ${maxContentItems} artifacts total; ${targetContentItems} is ideal when enough source material is available.`,
      'Use each supplied source URL at most once. Do not create multiple artifacts for the same article, post, redirect target, image, or source page.',
      'Prefer a mix of source types, domains, notes, media, and visual roles over several pieces from the same source cluster.',
      'Write source artifact labels as quiet visible anchor names, not raw filenames or URLs.',
      'Artifacts are clickable anchors, not a requirement for equal visual weight. Their scale and loudness should follow the inferred visual direction for this source field.',
    ],
    inferred_visual_direction: visualDirection,
    recent_edition_avoidance: recentEditions.map((edition) => ({
      title: edition.title,
      scene_family: edition.scene_family,
      slug: edition.slug,
    })),
    diversity_directive: diversityDirective,
    source_visual_reference: visualReference,
    source_visual_reference_instruction: visualReference
      ? 'Use the attached source image to inform composition structure, geometry, palette, contrast, layering, edge behavior, atmosphere, and gesture. Do not depict its subject literally, copy its scene, reproduce logos, or copy page chrome.'
      : 'No source image was available; derive visual direction from source metadata only.',
    scene_prompting_rules: [
      'Write the scene_prompt as art direction for one finished still image, not as product strategy or app documentation.',
      'Let the supplied inferred_visual_direction decide brightness, density, geometry, composition, material language, and openness.',
      'Start from the visual world implied by the research field rather than a stock room, desk, gallery wall, dashboard, or software mockup.',
      'Describe light, camera/framing, palette, density, scale, layering, edge behavior, and mood in plain language.',
      'Translate technical source concepts into visible scene elements that fit the inferred world: marks, panels, ribbons, labels, islands, apertures, blocks, traces, nodes, surfaces, or other source-led forms.',
      'Include the required source artifacts as physical anchor points in the scene, but do not explain clicking, source windows, bindings, masks, runtime behavior, or QA mechanics.',
      'Avoid technical prose in the scene_prompt: no API, framework, module, runtime, interface, dashboard, embedding, source window, artifact mapping, hot path, or product requirement language.',
      'Avoid object-by-object illustration. Do not make an archive wall, cabinet, shelf system, desk, dashboard, lab bench, gallery of cards, many-prop still life, or realistic object inventory unless the source field strongly justifies it.',
    ],
    required_output_shape: {
      edition_title: 'string',
      scene_family: 'kebab-case string',
      slug_base: 'kebab-case string without a version suffix; do not include -v1, -v2, or any edition version',
      motif_tags: ['5 to 8 short kebab-case tags'],
      mood: 'string',
      material_language: ['4 to 6 concrete materials/surfaces derived from the evidence'],
      lighting: 'string',
      object_inventory: ['3 to 6 nonliteral visual structures, forms, layers, or source-anchor families; avoid literal prop inventories'],
      negative_constraints: ['constraints'],
      ambiance: {
        motion_system: 'string',
        color_drift: 'string',
        glow_behavior: 'string',
        audio_posture: 'silent|ambient|reactive',
        webgl_mode: 'none|particles|shader-scene',
      },
      scene_prompt: '90 to 170 words of source-led image-generation art direction for gpt-image-2: use the inferred visual direction, visible source-bearing anchors, light, palette, density, composition, and mood; no markdown and no product/implementation explanation',
      artifacts: [
        {
          label: 'visible source-bearing mark label',
          artifact_type: 'kebab-case visible mark/gesture/surface type',
          role: 'why this mark or gesture can carry a source window',
          source_url: 'one of the supplied source_research URLs',
        },
      ],
    },
  }

  const instructions = [
    'You compose daily scene briefs for AI image generation.',
    'Return JSON only.',
    'Choose one coherent visual world from the saved signals and inspected source metadata.',
    'Use only source URLs from the supplied source_research array in artifacts.',
    'Do not put version suffixes such as -v1 or -v2 in scene_family or slug_base; the package assembler adds edition versions itself.',
    `Produce ${minContentItems} to ${maxContentItems} source anchor artifacts; ${targetContentItems} is ideal when enough sources are supplied. Exactly 2 should be hero-scale anchors, but the image should let the inferred visual direction decide how many major shapes or clusters it needs.`,
    'Never use the same source URL, resolved source, article, post, or image twice in artifacts.',
    'Favor variety across domains, notes, media types, visual scales, and artifact roles.',
    'Avoid repeating the recent edition titles, scene families, dominant materials, and visual worlds supplied in recent_edition_avoidance.',
    diversityDirective,
    'Use inferred_visual_direction as the primary aesthetic guide. Do not revert to a fixed house style.',
    'Let the visual reference influence composition structure, geometry, layering, density, palette, and atmosphere when present; do not depict or copy its subject.',
    'Keep technical source concepts out of the scene_prompt except as short visible labels when necessary.',
    'Avoid desks, dashboards, generic software UI, empty landing-page layout, source-summary cards, crowded archives, cabinets, shelves, realistic props, literal objects, and implementation language unless the research field clearly demands them.',
  ].join(' ')
  const responseInput = visualReference
    ? [
      {
        role: 'user',
        content: [
          { type: 'input_text', text: JSON.stringify(prompt) },
          { type: 'input_image', image_url: visualReference.image_url },
        ],
      },
    ]
    : JSON.stringify(prompt)

  await writeJson(path.join(runDir, 'brief-composition-request.json'), {
    model,
    instructions,
    input: prompt,
    attached_images: visualReference ? [visualReference] : [],
  })

  let payload
  try {
    payload = await openAiJson({
      apiKey,
      model,
      instructions,
      input: responseInput,
      maxOutputTokens: 6000,
    })
  } catch (error) {
    console.warn(`OpenAI research composition failed; using deterministic fallback. ${error.message}`)
    payload = fallbackDailyPayload(signalHarvest, researchField, visualDirection, date)
  }

  payload = normalizeDailyPayload(payload, signalHarvest, researchField, visualDirection, date)
  await writeJson(path.join(runDir, 'daily-generation-payload.json'), payload)
  return payload
}

function slugBaseWithoutVersion(value) {
  return slugify(value).replace(/-v\d+$/i, '') || 'daily-edition'
}

function normalizeDailyPayload(payload, signalHarvest, researchField, visualDirection, date) {
  const fallback = fallbackDailyPayload(signalHarvest, researchField, visualDirection, date)
  const contentSources = getResearchContentSources(researchField).slice(0, maxContentItems)
  const sourceByUrl = buildSourceLookup(contentSources)
  const sourceUrls = new Set(sourceByUrl.keys())
  const targetArtifactCount = Math.min(maxContentItems, Math.max(minContentItems, Math.min(targetContentItems, contentSources.length || targetContentItems)))
  const artifacts = Array.isArray(payload.artifacts) ? payload.artifacts : []
  const seenSourceKeys = new Set()
  const normalizedArtifacts = []
  for (const artifact of artifacts) {
    if (!artifact || !sourceUrls.has(artifact.source_url)) continue
    const source = sourceByUrl.get(artifact.source_url)
    const sourceKey = sourceContentKey(source)
    if (!sourceKey || seenSourceKeys.has(sourceKey)) continue
    seenSourceKeys.add(sourceKey)
    normalizedArtifacts.push(artifact)
    if (normalizedArtifacts.length >= maxContentItems) break
  }

  for (const fallbackArtifact of fallback.artifacts) {
    if (normalizedArtifacts.length >= targetArtifactCount) break
    const source = sourceByUrl.get(fallbackArtifact.source_url)
    const sourceKey = sourceContentKey(source)
    if (!sourceKey || seenSourceKeys.has(sourceKey)) continue
    seenSourceKeys.add(sourceKey)
    normalizedArtifacts.push(fallbackArtifact)
  }

  const normalized = {
    edition_title: String(payload.edition_title || fallback.edition_title),
    scene_family: slugBaseWithoutVersion(payload.scene_family || payload.slug_base || fallback.scene_family),
    slug_base: slugBaseWithoutVersion(payload.slug_base || payload.scene_family || fallback.slug_base),
    motif_tags: normalizeStringArray(payload.motif_tags, fallback.motif_tags).map(slugify).slice(0, 8),
    mood: String(payload.mood || fallback.mood),
    material_language: normalizeStringArray(payload.material_language, fallback.material_language)
      .map(repairProductLanguage)
      .slice(0, visualDirection.material_limit || fallback.visual_direction?.material_limit || 5),
    lighting: String(payload.lighting || fallback.lighting),
    object_inventory: normalizeStringArray(payload.object_inventory, fallback.object_inventory).map(repairProductLanguage).slice(0, 8),
    negative_constraints: uniqueNonEmpty([
      ...normalizeStringArray(payload.negative_constraints, fallback.negative_constraints),
      'no generic office-room fallback',
      'no many-prop still life',
      'no equal-weight grid of source objects',
      'no literal depiction of the source reference image',
    ]).slice(0, 14),
    ambiance: {
      motion_system: String(payload.ambiance?.motion_system || fallback.ambiance.motion_system),
      color_drift: String(payload.ambiance?.color_drift || fallback.ambiance.color_drift),
      glow_behavior: String(payload.ambiance?.glow_behavior || fallback.ambiance.glow_behavior),
      audio_posture: ['silent', 'ambient', 'reactive'].includes(payload.ambiance?.audio_posture) ? payload.ambiance.audio_posture : fallback.ambiance.audio_posture,
      webgl_mode: ['none', 'particles', 'shader-scene'].includes(payload.ambiance?.webgl_mode) ? payload.ambiance.webgl_mode : fallback.ambiance.webgl_mode,
    },
    scene_prompt: repairProductLanguage(String(payload.scene_prompt || fallback.scene_prompt)),
    visual_direction: visualDirection,
    artifacts: normalizedArtifacts.map((artifact, index) => ({
      label: repairArtifactLabel(String(artifact.label || fallback.artifacts[index]?.label || `Source Artifact ${index + 1}`), index),
      artifact_type: repairArtifactType(slugify(artifact.artifact_type || fallback.artifacts[index]?.artifact_type || 'source-mark'), index),
      role: String(artifact.role || fallback.artifacts[index]?.role || 'source-bearing mark'),
      source_url: artifact.source_url,
    })),
  }

  return normalized
}

function normalizeStringArray(value, fallback) {
  if (!Array.isArray(value)) return fallback
  const result = value.map((entry) => String(entry).trim()).filter(Boolean)
  return result.length ? result : fallback
}

const bannedProductTerms = [
  ['dashboard', 'signal board'],
  ['control panel', 'instrument array'],
  ['interface panel', 'source plaque'],
  ['digital interface', 'illuminated source surface'],
  ['traditional user interface', 'literal software interface'],
  ['floating screens', 'floating glass plates'],
  ['screen', 'glass plate'],
]

function repairProductLanguage(value) {
  let repaired = String(value)
  for (const [from, to] of bannedProductTerms) {
    repaired = repaired.replace(new RegExp(`\\b${from}\\b`, 'gi'), to)
  }
  return repaired
}

function repairArtifactLabel(label, index) {
  const repaired = repairProductLanguage(label)
  if (!/(dashboard|control panel|interface|screen|ui)/i.test(repaired)) return repaired
  return [
    'Memory Prism Catalogue',
    'Profile Glass Vitrine',
    'Data Loom Map',
    'Conversation Transcript Folio',
    'Source Pathway Plaque',
    'Preference Specimen Tray',
    'Agent Tool Reliquary',
    'Background Memory Ledger',
  ][index] || `Source Artifact ${index + 1}`
}

function repairArtifactType(type, index) {
  const repaired = slugify(repairProductLanguage(type))
  if (!/(dashboard|control-panel|interface|screen|ui)/i.test(repaired)) return repaired
  return [
    'memory-prism',
    'glass-vitrine',
    'data-loom-map',
    'transcript-folio',
    'pathway-plaque',
    'specimen-tray',
    'tool-reliquary',
    'memory-ledger',
  ][index] || 'source-artifact'
}

function imagePrompt(payload) {
  const visualDirection = payload.visual_direction || {}
  return [
    'Create one finished, full-bleed scene image from this art direction.',
    '',
    'Scene:',
    payload.scene_prompt,
    '',
    'Visible source anchors to embed:',
    payload.artifacts.map((artifact, index) => `${index + 1}. ${artifact.label}: ${artifact.artifact_type}`).join('\n'),
    '',
    'Inferred visual direction:',
    `Evidence summary: ${visualDirection.evidence_summary || payload.mood}`,
    `Brightness: ${visualDirection.brightness_profile || 'mixed'}`,
    `Density: ${visualDirection.density_profile || 'balanced'}`,
    `Geometry: ${visualDirection.geometry_profile || 'mixed'}`,
    `Composition: ${visualDirection.composition_profile || 'distributed'}`,
    `Palette: ${visualDirection.palette_profile || payload.ambiance?.color_drift || payload.mood}`,
    `Materials and surfaces: ${payload.material_language.join(', ')}`,
    `Lighting: ${payload.lighting}`,
    `Anchor strategy: ${visualDirection.anchor_strategy || 'fit anchors naturally into the scene'}`,
    '',
    'Composition rules:',
    '- Let the research-derived visual direction determine whether the plate is airy, balanced, or dense.',
    '- Let the visual reference influence composition structure, geometry, layering, palette, and atmosphere when present; do not depict or copy its subject.',
    '- Integrate listed anchors as forms that belong naturally inside the scene, not as a dense equal-weight inventory.',
    `- Use source-led anchor forms such as ${sceneStructurePolicy.sourceMarkVocabulary.join(', ')} when they fit the evidence.`,
    '- Avoid browser chrome, UI widgets, dashboard cards, floating app panels, chat interfaces, generic software screenshots, empty landing-page composition, shelves, cabinets, realistic furniture, literal props, and crowded archive walls unless the source field clearly demands them.',
    '- Do not include explanatory diagrams unless they are sparse physical drawings, labels, or inscriptions already justified by the source field.',
    '',
    `Avoid: ${payload.negative_constraints.join(', ')}`,
  ].join('\n')
}

async function generateScenePlate({ payload, apiKey, imageModel, imageBackend, imageSize, imageQuality }, runDir) {
  const prompt = imagePrompt(payload)
  const outputPath = path.join(runDir, 'plate.png')
  await fs.writeFile(path.join(runDir, 'scene-prompt.txt'), prompt, 'utf8')

  if (imageBackend === 'hermes') {
    const hermesResult = await runJsonCommand('python3', [
      hermesImageGenerateScript,
      '--prompt-file', path.join(runDir, 'scene-prompt.txt'),
      '--output', outputPath,
      '--aspect-ratio', imageAspectRatioFromSize(imageSize),
    ])

    await writeJson(path.join(runDir, 'scene-generation.json'), {
      backend: 'hermes',
      provider: hermesResult.provider || null,
      model: hermesResult.model || null,
      requested_openai_image_model: imageModel,
      size: imageSize,
      quality: imageQuality || null,
      generated_at: new Date().toISOString(),
      prompt_sha256: crypto.createHash('sha256').update(prompt).digest('hex'),
      asset_path: outputPath,
      source_image: hermesResult.source_image || null,
      aspect_ratio: hermesResult.aspect_ratio || imageAspectRatioFromSize(imageSize),
    })

    return {
      backend: 'hermes',
      provider: hermesResult.provider || null,
      model: hermesResult.model || 'hermes-image-provider',
      size: imageSize,
      quality: imageQuality || null,
      outputPath,
      prompt_sha256: crypto.createHash('sha256').update(prompt).digest('hex'),
    }
  }

  const bodyVariants = [
    { model: imageModel, prompt, size: imageSize, quality: imageQuality, n: 1, output_format: 'png' },
    { model: imageModel, prompt, size: imageSize, quality: imageQuality, n: 1 },
  ]

  let lastError = null
  for (const body of bodyVariants) {
    try {
      const response = await fetch('https://api.openai.com/v1/images/generations', {
        method: 'POST',
        headers: {
          authorization: `Bearer ${apiKey}`,
          'content-type': 'application/json',
        },
        body: JSON.stringify(body),
      })
      const result = await response.json().catch(async () => ({ raw: await response.text() }))
      if (!response.ok) {
        lastError = new Error(`OpenAI Images API failed (${response.status}) for ${imageModel}: ${JSON.stringify(result).slice(0, 1000)}`)
        continue
      }

      const data = result.data?.[0]
      let buffer
      if (data?.b64_json) {
        buffer = Buffer.from(data.b64_json, 'base64')
      } else if (data?.url) {
        const imageResponse = await fetch(data.url)
        if (!imageResponse.ok) throw new Error(`Image URL download failed (${imageResponse.status})`)
        buffer = Buffer.from(await imageResponse.arrayBuffer())
      } else {
        throw new Error(`OpenAI image response did not include b64_json or url: ${JSON.stringify(result).slice(0, 1000)}`)
      }

      await fs.writeFile(outputPath, buffer)
      await writeJson(path.join(runDir, 'scene-generation.json'), {
        backend: 'openai',
        model: imageModel,
        size: body.size,
        quality: body.quality || null,
        generated_at: new Date().toISOString(),
        prompt_sha256: crypto.createHash('sha256').update(prompt).digest('hex'),
        asset_path: outputPath,
      })

      return {
        backend: 'openai',
        model: imageModel,
        size: body.size,
        quality: body.quality || null,
        outputPath,
        prompt_sha256: crypto.createHash('sha256').update(prompt).digest('hex'),
      }
    } catch (error) {
      lastError = error
    }
  }

  throw lastError || new Error('OpenAI image generation failed.')
}

async function inspectGeneratedPlate({ payload, platePath, apiKey, model }, runDir) {
  const base64 = await fs.readFile(platePath, 'base64')
  const prompt = {
    task: 'Inspect this generated daily-frontpage scene plate and identify real visible source-bearing marks, gestures, and surfaces for interaction mapping.',
    rules: [
      'Use only visual features actually visible in the image.',
      'Treat planned_artifacts as a checklist: map each planned source artifact when its label, mark, slit, seam, pinhole cluster, glow, gesture, scar, fleck, stain, void, edge tear, or physical anchor is visible.',
      'Return normalized bounds where x, y, w, h are each between 0 and 1.',
      'For each source-bearing feature, return a normalized polygon with 5 to 18 points that follows the visible contour, edge, or mark outline as closely as possible.',
      'The polygon points must use full-image normalized coordinates, not coordinates relative to the bounds.',
      'Do not return a broad rectangle around a general area. If the visible target is text, a seam, a slit, a fleck, a stain, a scratch, a void, or a tiny light, make the bounds and polygon tightly hug that visible feature.',
      'Do not return a rectangle polygon unless the visible target itself is actually rectangular, and never use generic quadrant fallback geometry.',
      'Do not duplicate one visible feature for multiple planned artifacts unless there are distinct repeated marks for those artifacts.',
      'Prefer visible anchors: pigment-like islands, line breaks, bright flecks, torn edges, dense knots, scratches, pools, voids, marks, cuts, apertures, labels, slits, stains, edge details, small lights, and dominant gestures.',
      'Do not select empty space or arbitrary quadrants.',
      `Return ${minContentItems} to ${maxContentItems} useful artifacts when visible.`,
      'Also judge whether the plate is minimal and expressionist or too visually cluttered.',
    ],
    planned_artifacts: payload.artifacts,
    output_shape: {
      scene_summary: 'string',
      usable_surfaces: ['short surface phrases'],
      detected_objects: [
        {
          label: 'visible source-bearing mark label',
          artifact_type: 'kebab-case mark/gesture/surface type',
          role: 'hero-anchor|source-pocket|label-surface|media-surface|gesture-mark|edge-mark|void-mark|light-mark',
          bounds: { x: 0, y: 0, w: 0, h: 0 },
          polygon: [[0, 0], [0, 0], [0, 0]],
          confidence: 0.0,
          visual_evidence: 'what visible mark, edge, gesture, or surface supports this target',
        },
      ],
      complexity_assessment: {
        status: 'minimal|watch|too-complex',
        dominant_form_count: 0,
        large_region_count: 0,
        mapped_region_coverage: 0.0,
        rationale: 'short visual reason',
      },
    },
  }

  let analysis
  try {
    analysis = await openAiJson({
      apiKey,
      model,
      instructions: 'You are a vision QA pass for an image-led interactive artwork. Return JSON only.',
      input: [
        {
          role: 'user',
          content: [
            { type: 'input_text', text: JSON.stringify(prompt) },
            { type: 'input_image', image_url: `data:image/png;base64,${base64}` },
          ],
        },
      ],
      maxOutputTokens: 7000,
    })
  } catch (error) {
    console.warn(`OpenAI plate inspection failed; using planned artifact geometry fallback. ${error.message}`)
    analysis = fallbackPlateAnalysis(payload, error.message)
  }

  const normalized = normalizePlateAnalysis(analysis, payload)
  await writeJson(path.join(runDir, 'plate-analysis.json'), normalized)
  return normalized
}

function fallbackPlateAnalysis(payload, errorMessage = '') {
    const layout = fallbackBounds()
    return {
    inspection_mode: 'planned-artifact-fallback',
    inspection_error: errorMessage,
    scene_summary: payload.scene_prompt,
    usable_surfaces: payload.material_language,
    detected_objects: payload.artifacts.map((artifact, index) => ({
      label: artifact.label,
      artifact_type: artifact.artifact_type,
      role: index < 2 ? 'hero-anchor' : 'gesture-mark',
      bounds: layout[index],
      polygon: rectPolygon(layout[index]),
      confidence: 0.55,
      visual_evidence: 'Planned source-bearing mark from the scene brief.',
    })),
    complexity_assessment: {
      status: 'watch',
      dominant_form_count: 3,
      large_region_count: 3,
      mapped_region_coverage: 0.4,
      rationale: 'Fallback geometry cannot verify the plate complexity directly.',
    },
  }
}

function fallbackBounds() {
  return [
    { x: 0.08, y: 0.1, w: 0.32, h: 0.32 },
    { x: 0.58, y: 0.12, w: 0.32, h: 0.32 },
    { x: 0.08, y: 0.52, w: 0.22, h: 0.22 },
    { x: 0.34, y: 0.54, w: 0.22, h: 0.22 },
    { x: 0.62, y: 0.54, w: 0.22, h: 0.22 },
    { x: 0.1, y: 0.78, w: 0.18, h: 0.16 },
    { x: 0.42, y: 0.78, w: 0.18, h: 0.16 },
    { x: 0.72, y: 0.76, w: 0.18, h: 0.16 },
    { x: 0.28, y: 0.34, w: 0.16, h: 0.15 },
    { x: 0.56, y: 0.34, w: 0.16, h: 0.15 },
  ]
}

function normalizePlateAnalysis(analysis, payload) {
  const fallback = fallbackPlateAnalysis(payload)
  const objects = Array.isArray(analysis.detected_objects) ? analysis.detected_objects : []
  const normalized = objects
    .map((object, index) => normalizeDetectedObject(object, index))
    .filter(Boolean)
    .slice(0, maxContentItems)

  if (fallback.inspection_mode === analysis.inspection_mode || normalized.length === 0) {
    for (const object of fallback.detected_objects) {
      if (normalized.length >= maxContentItems) break
      normalized.push(object)
    }
  }

  const complexity = normalizeComplexityAssessment(analysis.complexity_assessment, normalized)

  return {
    analysis_id: `analysis-${Date.now()}`,
    inspection_mode: analysis.inspection_mode === 'planned-artifact-fallback' ? 'planned-artifact-fallback' : 'openai-vision',
    inspection_error: analysis.inspection_error || null,
    scene_summary: String(analysis.scene_summary || fallback.scene_summary),
    usable_surfaces: normalizeStringArray(analysis.usable_surfaces, fallback.usable_surfaces).slice(0, 12),
    detected_objects: normalized,
    complexity_assessment: complexity,
  }
}

function normalizeComplexityAssessment(value, detectedObjects) {
  const objectCount = detectedObjects.length
  const areas = detectedObjects.map((object) => object.bounds.w * object.bounds.h)
  const largeRegionCount = areas.filter((area) => area >= 0.08).length
  const mappedRegionCoverage = Number(areas.reduce((sum, area) => sum + area, 0).toFixed(3))
  const dominantFormCount = Number.isFinite(Number(value?.dominant_form_count)) ? Number(value.dominant_form_count) : largeRegionCount
  const suppliedStatus = String(value?.status || '').toLowerCase()
  const dominantCountIsRestrained = dominantFormCount <= 3
  const inferredStatus = objectCount > maxContentItems || largeRegionCount > 5 || (largeRegionCount > 4 && !dominantCountIsRestrained)
    ? 'too-complex'
    : objectCount >= 9 && largeRegionCount > 4
      ? 'watch'
      : 'minimal'
  const severity = { minimal: 0, watch: 1, 'too-complex': 2 }
  const acceptedSuppliedStatus = ['minimal', 'watch', 'too-complex'].includes(suppliedStatus) ? suppliedStatus : null
  const status = acceptedSuppliedStatus && severity[acceptedSuppliedStatus] > severity[inferredStatus]
    ? acceptedSuppliedStatus
    : inferredStatus

  return {
    status,
    dominant_form_count: dominantFormCount,
    large_region_count: largeRegionCount,
    mapped_region_coverage: mappedRegionCoverage,
    rationale: String(value?.rationale || `Detected ${objectCount} anchors, ${largeRegionCount} large regions, and ${mappedRegionCoverage} mapped-region coverage.`),
  }
}

function normalizeDetectedObject(object, index) {
  const bounds = object?.bounds
  if (!bounds) return null
  const x = clamp01(Number(bounds.x))
  const y = clamp01(Number(bounds.y))
  const w = clamp01(Number(bounds.w))
  const h = clamp01(Number(bounds.h))
  if (w < 0.04 || h < 0.04) return null
  const normalizedBounds = { x, y, w: Math.min(w, 1 - x), h: Math.min(h, 1 - y) }
  const polygon = normalizeDetectedPolygon(object.polygon, normalizedBounds)
  return {
    label: String(object.label || `Visible Source Mark ${index + 1}`),
    artifact_type: slugify(object.artifact_type || 'source-mark'),
    role: String(object.role || 'source-pocket'),
    bounds: normalizedBounds,
    ...(polygon ? { polygon } : {}),
    confidence: Number.isFinite(Number(object.confidence)) ? Number(object.confidence) : 0.5,
    visual_evidence: String(object.visual_evidence || ''),
  }
}

function normalizeDetectedPolygon(value, bounds) {
  if (!Array.isArray(value)) return null
  const points = value
    .map((point) => {
      if (!Array.isArray(point) || point.length < 2) return null
      const x = Number(point[0])
      const y = Number(point[1])
      if (!Number.isFinite(x) || !Number.isFinite(y)) return null
      return [Number(clamp01(x).toFixed(4)), Number(clamp01(y).toFixed(4))]
    })
    .filter(Boolean)

  if (points.length < 3) return null

  const padding = Math.max(0.012, Math.max(bounds.w, bounds.h) * 0.16)
  const insideCount = points.filter(([px, py]) => (
    px >= bounds.x - padding
    && px <= bounds.x + bounds.w + padding
    && py >= bounds.y - padding
    && py <= bounds.y + bounds.h + padding
  )).length
  if (insideCount / points.length < 0.7) return null

  const area = normalizedPointPolygonArea(points)
  const boundsArea = bounds.w * bounds.h
  if (area < boundsArea * 0.08 || area > boundsArea * 2.4) return null

  return points
}

function normalizedPointPolygonArea(points) {
  if (!Array.isArray(points) || points.length < 3) return 0
  let acc = 0
  for (let index = 0; index < points.length; index += 1) {
    const [x1, y1] = points[index]
    const [x2, y2] = points[(index + 1) % points.length]
    acc += x1 * y2 - x2 * y1
  }
  return Math.abs(acc) * 0.5
}

function loadManifest() {
  const manifestPath = path.join(root, 'public', 'editions', 'index.json')
  return JSON.parse(fsSync.readFileSync(manifestPath, 'utf8'))
}

function readJsonSyncIfExists(filePath) {
  try {
    return JSON.parse(fsSync.readFileSync(filePath, 'utf8'))
  } catch {
    return null
  }
}

function getRecentEditionSummaries(limit = recentDiversityEditionCount) {
  const manifest = loadManifest()
  return manifest.editions.slice(0, limit).map((item) => {
    const editionDir = path.join(root, 'public', item.path.replace(/^\//, ''))
    const edition = readJsonSyncIfExists(path.join(editionDir, 'edition.json'))
    const brief = readJsonSyncIfExists(path.join(editionDir, 'brief.json'))
    const sourceBindings = readJsonSyncIfExists(path.join(editionDir, 'source-bindings.json'))
    const sourceKeys = (sourceBindings?.bindings || [])
      .map((binding) => sourceContentKey({
        url: binding.source_url,
        source_url: binding.source_url,
        final_url: binding.resolved_url,
      }))
      .filter(Boolean)

    return {
      edition_id: item.edition_id,
      title: edition?.title || item.title,
      scene_family: edition?.scene_family || brief?.scene_family || '',
      slug: item.slug,
      source_keys: [...new Set(sourceKeys)],
      visual_summary: brief?.scene_prompt || brief?.summary || '',
    }
  })
}

function getRecentSourceKeys(recentEditions) {
  return new Set(recentEditions.flatMap((edition) => edition.source_keys || []))
}

function getRecentDiversityAvoidTerms(recentEditions, limit = 16) {
  const stop = new Set([
    'daily', 'edition', 'frontpage', 'source', 'window', 'generated', 'scene', 'world',
    'image', 'quiet', 'ambient', 'soft', 'hidden', 'signal',
  ])
  const counts = new Map()
  const text = recentEditions
    .map((edition) => `${edition.title} ${edition.scene_family} ${edition.slug} ${edition.visual_summary}`)
    .join(' ')
    .toLowerCase()

  for (const token of text.match(/[a-z][a-z0-9-]{3,}/g) || []) {
    const normalized = token.replace(/-v\d+$/i, '')
    if (stop.has(normalized)) continue
    counts.set(normalized, (counts.get(normalized) || 0) + 1)
  }

  return [...counts.entries()]
    .filter(([, count]) => count >= 2)
    .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
    .slice(0, limit)
    .map(([term]) => term)
}

function chooseDiversityDirective(recentEditions, runId) {
  const recentText = recentEditions.map((edition) => `${edition.title} ${edition.scene_family} ${edition.visual_summary}`).join(' ').toLowerCase()
  const directives = [
    'Favor an outdoor, civic, weather-shaped, or landscape-scale world if the sources allow it.',
    'Favor a theatrical, procession-like, or room-as-stage composition if the sources allow it.',
    'Favor a workshop, tool, craft, or material-transformation world if it is not already dominant in recent editions.',
    'Favor an astronomical, nocturnal, optical, or observatory-like world if the sources allow it.',
    'Favor a living field, garden, habitat, or botanical study world if the sources allow it.',
    'Favor an architectural threshold, corridor, facade, or public interior rather than a cabinet of objects.',
  ]
  const hash = crypto.createHash('sha1').update(`${runId}:${recentText}`).digest()
  let directive = directives[hash[0] % directives.length]

  if (/(roller|print|chapel|cipher|hidden marks|splatter canvas)/.test(recentText)) {
    directive += ' Recent editions already used roller/print/chapel imagery; do not make another printmaking chapel, roller room, cipher chapel, or splatter-canvas archive.'
  }
  if (/(conservatory|greenhouse|garden|field shrine)/.test(recentText)) {
    directive += ' Recent editions already used conservatory/greenhouse/garden imagery; avoid another glasshouse unless the source field demands it.'
  }
  if (/(threshold|corridor|passage|gate|public interior|negative space|pinlight|fog|ambient)/.test(recentText)) {
    directive += ' Recent editions have leaned heavily on minimal thresholds, corridors, gates, pinlights, fog, and ambient negative-space interiors; deliberately seek a different spatial premise, object language, palette, and source mix.'
  }
  return directive
}

function getEditionIds(options, manifest) {
  if (options.allEditions) return manifest.editions.map((edition) => edition.edition_id)
  if (options.editions.length) return [...new Set(options.editions)]
  return [manifest.current_edition_id]
}

async function remapExistingEditionPlate({ editionId, apiKey, model, generationName }) {
  const editionDir = path.join(root, 'public', 'editions', editionId)
  const edition = await readJson(path.join(editionDir, 'edition.json'))
  const brief = await readJson(path.join(editionDir, 'brief.json')).catch(() => ({}))
  const artifactMap = await readJson(path.join(editionDir, 'artifact-map.json'))
  const sourceBindings = await readJson(path.join(editionDir, 'source-bindings.json')).catch(() => ({ bindings: [] }))
  const bindingByArtifact = new Map((sourceBindings.bindings || []).map((binding) => [binding.artifact_id, binding]))
  let platePath = path.join(root, 'public', edition.plate_asset_path.replace(/^\//, ''))
  if (!fsSync.existsSync(platePath)) platePath = path.join(editionDir, 'assets', 'plate.png')

  const remapRunDir = path.join(root, 'tmp', 'daily-process-runs', generationName, `remap-${editionId}`)
  await fs.mkdir(remapRunDir, { recursive: true })

  const payload = {
    scene_prompt: brief.scene_prompt || brief.summary || edition.title || editionId,
    material_language: brief.material_language || [],
    artifacts: artifactMap.artifacts.map((artifact) => {
      const binding = bindingByArtifact.get(artifact.id)
      return {
        label: artifact.label,
        artifact_type: artifact.artifact_type,
        role: artifact.kind === 'hero' ? 'hero source surface' : 'secondary source pocket',
        source_url: binding?.source_url || '',
      }
    }),
  }

  const analysis = await inspectGeneratedPlate({
    payload,
    platePath,
    apiKey,
    model,
  }, remapRunDir)

  if (analysis.inspection_mode === 'planned-artifact-fallback' && analysis.inspection_error) {
    await writeJson(path.join(editionDir, 'analysis.json'), {
      ...analysis,
      analysis_id: `analysis-${editionId}`,
      edition_id: editionId,
      skipped_artifact_map_update: true,
      skip_reason: 'Vision remap failed; preserving the existing artifact map instead of overwriting it with planned fallback rectangles.',
    })

    return {
      edition_id: editionId,
      inspection_mode: analysis.inspection_mode,
      detected_objects: analysis.detected_objects.length,
      mapped_artifacts: artifactMap.artifacts.length,
      complexity: analysis.complexity_assessment,
      output: path.relative(root, path.join(remapRunDir, 'plate-analysis.json')),
      skipped_artifact_map_update: true,
    }
  }

  const detectedObjects = analysis.detected_objects.slice(0, artifactMap.artifacts.length)
  artifactMap.artifacts = artifactMap.artifacts.map((artifact, index) => {
    const object = detectedObjects[index]
    if (!object) return artifact
    const bounds = object.bounds
    return {
      ...artifact,
      label: object.label || artifact.label,
      artifact_type: object.artifact_type || artifact.artifact_type,
      bounds,
      polygon: object.polygon || rectPolygon(bounds),
      mask_path: artifact.mask_path || `/editions/${editionId}/assets/masks/${artifact.id}.svg`,
      geometry: {
        ...(artifact.geometry || {}),
        safe_hover_origin_px: safeOrigin(bounds, 'hover'),
        safe_stage_window_origin_px: safeOrigin(bounds, 'stage'),
        preferred_expansion_label: expansionLabel(bounds),
      },
    }
  })

  await writeJson(path.join(editionDir, 'analysis.json'), {
    ...analysis,
    analysis_id: `analysis-${editionId}`,
    edition_id: editionId,
  })
  await writeArtifactSvgMasks(editionDir, editionId, artifactMap.artifacts, await readImageDimensions(platePath))
  await writeJson(path.join(editionDir, 'artifact-map.json'), artifactMap)

  const aboutPath = path.join(editionDir, 'about.json')
  const about = await readJson(aboutPath).catch(() => null)
  if (about) {
    const visualObjects = sentenceList(detectedObjects.map((object) => object.label), 5)
    about.short_blurb = 'Built from saved signals, source research, one generated plate, and a corrected post-plate mapping pass.'
    about.body = [
      ...(Array.isArray(about.body) && about.body[0] ? [about.body[0]] : []),
      `A follow-up vision pass re-read the finished plate, moved the clickable regions onto ${visualObjects || 'the visible source objects'}, and then the mask audit tested tighter geometry from those corrected regions. Run artifacts are in ${path.relative(root, remapRunDir)}.`,
    ]
    await writeJson(aboutPath, about)
  }

  return {
    edition_id: editionId,
    inspection_mode: analysis.inspection_mode,
    detected_objects: analysis.detected_objects.length,
    mapped_artifacts: detectedObjects.length,
    complexity: analysis.complexity_assessment,
    output: path.relative(root, path.join(remapRunDir, 'plate-analysis.json')),
  }
}

function maskPipelineArgs(options, generationName, editionIds = []) {
  const args = ['scripts/automated-mask-pipeline.py', '--generation-name', generationName, '--apply-artifact-map']
  if (options.promptedMaskDir) args.push('--prompted-mask-dir', options.promptedMaskDir)
  args.push(...editionIds)
  return args
}

function existingPackageSteps(options, editionIds, generationName) {
  const steps = [
    {
      name: 'Verify packaged edition inputs are present',
      tool: 'Node fs',
      command: ['node', ['-e', `console.log(${JSON.stringify(JSON.stringify({ editions: editionIds }))})`]],
    },
    {
      name: 'Enrich source images',
      tool: 'Node fetch + provider image rules',
      command: ['npm', ['run', 'enrich:source-images']],
    },
  ]

  if (!options.skipMask) {
    steps.push({
      name: 'Generate post-plate mask candidates and geometry audit files',
      tool: 'Python + Pillow + NumPy + SciPy + OpenCV GrabCut + scikit-image contours',
      command: ['python3', maskPipelineArgs(options, generationName, editionIds)],
    })
  }

  return steps
}

function buildSmokeRoute(edition) {
  if (!edition) return '/'
  return edition.is_live ? '/?edition=' + encodeURIComponent(edition.edition_id) : '/?archive=' + encodeURIComponent(edition.slug)
}

function postPackageSteps({ options, editionIds, generationName, smokeRoute }) {
  const steps = [
    {
      name: 'Generate interpretation files',
      tool: 'Node interpretation generator',
      command: ['npm', ['run', 'generate:interpretations']],
    },
    {
      name: 'Generate enhancement plans',
      tool: 'Node enhancement-plan generator',
      command: ['npm', ['run', 'generate:enhancement-plans']],
    },
    {
      name: 'Validate packaged editions',
      tool: 'Node edition validator',
      command: ['node', ['scripts/validate-editions.mjs']],
    },
    {
      name: 'Run unit tests',
      tool: 'Vitest',
      command: ['npm', ['test']],
    },
    {
      name: 'Build production runtime',
      tool: 'TypeScript + Vite',
      command: ['npm', ['run', 'build']],
    },
  ]

  if (options.ux === 'smoke') {
    steps.push({
      name: 'Run generated-edition smoke UX test',
      tool: 'Playwright + Chromium',
      command: ['npx', ['playwright', 'test', '-c', 'playwright.ux.config.ts', 'tests/ux/generated-edition-smoke.spec.ts']],
      env: { DFE_SMOKE_ROUTE: smokeRoute },
    })
    steps.push({
      name: 'Run source-window media audit for generated edition',
      tool: 'Playwright + Chromium media audit',
      command: ['npm', ['run', 'test:ux:media']],
      env: {
        DFE_MEDIA_AUDIT_EDITIONS: editionIds.join(','),
        DFE_MEDIA_AUDIT_REQUIRE_YOUTUBE_EMBEDS: '1',
      },
    })
  } else if (options.ux === 'focused') {
    steps.push({
      name: 'Run focused source-window UX tests',
      tool: 'Playwright + Chromium',
      command: ['npx', ['playwright', 'test', '-c', 'playwright.ux.config.ts', 'tests/ux/stage-windows.spec.ts', '-g', 'forest breath|signal greenhouse youtube']],
    })
  } else if (options.ux === 'full') {
    steps.push({
      name: 'Run full UX test suite',
      tool: 'Playwright + Chromium + Axe',
      command: ['npm', ['run', 'test:ux']],
    })
  }

  return steps.map((step) => ({
    ...step,
    editionIds,
    generationName,
  }))
}

async function runExistingMode(options) {
  const manifest = loadManifest()
  const editionIds = getEditionIds(options, manifest)
  const generationName = options.generationName || defaultGenerationName()
  const firstEdition = manifest.editions.find((item) => item.edition_id === editionIds[0])
  const smokeRoute = buildSmokeRoute(firstEdition)

  for (const editionId of editionIds) {
    const editionDir = path.join(root, 'public', 'editions', editionId)
    if (!fsSync.existsSync(editionDir)) throw new Error(`Edition package not found: ${editionDir}`)
  }

  const steps = [
    ...existingPackageSteps(options, editionIds, generationName),
    ...postPackageSteps({ options, editionIds, generationName, smokeRoute }),
  ]
  const total = steps.length + (options.remapPlate ? editionIds.length : 0)

  console.log(JSON.stringify({
    command: 'daily:process',
    mode: 'existing',
    editions: editionIds,
    generationName,
    ux: options.ux,
    remapPlate: options.remapPlate,
    maskOutput: options.skipMask ? null : `tmp/automated-mask-generations/${generationName}/`,
  }, null, 2))

  let stepIndex = 0
  if (options.remapPlate) {
    const { key: apiKey } = requireOpenAiKey()
    for (const editionId of editionIds) {
      stepIndex += 1
      await runInternal({
        name: `Re-map finished plate for ${editionId}`,
        tool: `OpenAI Responses API vision (${options.model})`,
        index: stepIndex,
        total,
      }, `internal:openai-vision-remap-existing --model ${options.model} --edition ${editionId}`, async () => remapExistingEditionPlate({
        editionId,
        apiKey,
        model: options.model,
        generationName,
      }))
    }
  }

  for (const step of steps) {
    stepIndex += 1
    const [command, args] = step.command
    await runProcess(command, args, { ...step, index: stepIndex, total }, step.env)
  }

  console.log('\nDaily process completed.')
}

async function runFromScratchMode(options) {
  const { key: apiKey, loaded } = requireOpenAiKey({ required: false })
  const runId = options.generationName || defaultGenerationName()
  const runDir = path.join(root, 'tmp', 'daily-process-runs', runId)
  await fs.mkdir(runDir, { recursive: true })
  const generationName = runId
  const sampleMode = options.sampleDataEnabled || options.useSampleSignals
  const rawRecentEditions = sampleMode ? [] : getRecentEditionSummaries(recentDiversityEditionCount)
  const recentEditions = rawRecentEditions
  const recentSourceKeys = sampleMode ? new Set() : getRecentSourceKeys(recentEditions)
  const recentDiversityAvoidTerms = sampleMode ? [] : getRecentDiversityAvoidTerms(recentEditions)
  const diversityDirective = sampleMode
    ? 'Sample mode: use the public demo signals as-is rather than suppressing them based on prior local archive history.'
    : chooseDiversityDirective(recentEditions, runId)
  const managedBrowser = options.sourceTool === 'browser-harness' && !process.env.BU_CDP_WS
    ? await startManagedBrowserHarnessBrowser(runDir, runId)
    : null
  if (managedBrowser) {
    process.env.BU_CDP_WS = managedBrowser.cdpWs
    process.env.BU_NAME = managedBrowser.buName
    process.once('exit', () => stopManagedBrowserHarnessBrowser(managedBrowser))
  }

  let context = {}
  const internalSteps = [
    {
      name: 'Mine source signals',
      tool: options.inputMode === 'manifest'
        ? 'JSON manifest adapter'
        : options.inputMode === 'markdown-folder'
          ? 'Markdown folder adapter'
          : 'Obsidian allowlist adapter',
      command: [
        'internal:mine-signals',
        `--input-mode ${options.inputMode}`,
        options.inputRoot ? `--input-root ${JSON.stringify(options.inputRoot)}` : null,
        options.signalManifest ? `--signal-manifest ${JSON.stringify(options.signalManifest)}` : null,
        `--window-days ${options.windowDays}`,
        `--max-notes ${options.maxNotes}`,
        `--avoid-recent-terms ${JSON.stringify(recentDiversityAvoidTerms.join(','))}`,
      ].filter(Boolean).join(' '),
      run: async () => {
        context.signalHarvest = await mineSignals({ ...options, diversityAvoidTerms: recentDiversityAvoidTerms }, runDir)
        return {
          notes_scanned: context.signalHarvest.notes_scanned,
          notes_selected: context.signalHarvest.notes_selected.length,
          source_candidates: context.signalHarvest.source_candidates.length,
          diversity_avoid_terms: recentDiversityAvoidTerms,
          output: path.relative(root, path.join(runDir, 'signal-harvest.json')),
        }
      },
    },
    {
      name: 'Deep source autoresearch and browser capture',
      tool: `Node fetch evidence + OpenAI Responses API (${options.model}) + ${options.sourceTool === 'browser-harness' ? 'browser-harness Chrome capture' : 'Node fetch capture'}`,
      command: `internal:autoresearch-sources --model ${options.model} --capture-tool ${options.sourceTool} --max-sources ${options.maxSources}`,
      run: async () => {
        context.researchField = await inspectSourceCandidates(context.signalHarvest, {
          maxSources: options.maxSources,
          runDir,
          sourceTool: options.sourceTool,
          browserHarness: options.browserHarness,
          recentSourceKeys,
          apiKey,
          model: options.model,
          date: options.date,
        })
        return {
          sources: context.researchField.source_count,
          tool: context.researchField.source_research_tool,
          capture_tool: context.researchField.source_capture_tool,
          fetch_evidence: context.researchField.fetch_evidence_count,
          autoresearch_thesis: context.researchField.autoresearch?.edition_thesis || null,
          visual_reference: context.researchField.visual_reference ? {
            title: context.researchField.visual_reference.title,
            image_url: context.researchField.visual_reference.image_url,
            selection_reason: context.researchField.visual_reference.selection_reason,
          } : null,
          content_sources: context.researchField.content_source_count,
          output: path.relative(root, path.join(runDir, 'source-research.json')),
        }
      },
    },
    {
      name: 'Compose research field and daily scene brief',
      tool: `OpenAI Responses API (${options.model})`,
      command: `internal:openai-compose-brief --model ${options.model}`,
      run: async () => {
        context.payload = await composeDailyPayload({
          signalHarvest: context.signalHarvest,
          researchField: context.researchField,
          apiKey,
          model: options.model,
          date: options.date,
          recentEditions,
          diversityDirective,
        }, runDir)
        return {
          title: context.payload.edition_title,
          scene_family: context.payload.scene_family,
          artifacts: context.payload.artifacts.length,
          request: path.relative(root, path.join(runDir, 'brief-composition-request.json')),
          output: path.relative(root, path.join(runDir, 'daily-generation-payload.json')),
        }
      },
    },
    {
      name: 'Generate AI scene plate',
      tool: options.imageBackend === 'hermes'
        ? 'Hermes image generation provider'
        : `OpenAI Images API (${options.imageModel})`,
      command: options.imageBackend === 'hermes'
        ? `internal:hermes-generate-image --aspect-ratio ${imageAspectRatioFromSize(options.imageSize)} --size ${options.imageSize}`
        : `internal:openai-generate-image --size ${options.imageSize} --quality ${options.imageQuality}`,
      run: async () => {
        context.plate = await generateScenePlate({
          payload: context.payload,
          apiKey,
          imageModel: options.imageModel,
          imageBackend: options.imageBackend,
          imageSize: options.imageSize,
          imageQuality: options.imageQuality,
        }, runDir)
        return {
          backend: context.plate.backend,
          provider: context.plate.provider || null,
          model: context.plate.model,
          size: context.plate.size,
          output: path.relative(root, context.plate.outputPath),
        }
      },
    },
    {
      name: 'Inspect generated plate and map visible artifacts',
      tool: `OpenAI Responses API vision (${options.model})`,
      command: `internal:openai-vision-map --model ${options.model}`,
      run: async () => {
        context.analysis = await inspectGeneratedPlate({
          payload: context.payload,
          platePath: context.plate.outputPath,
          apiKey,
          model: options.model,
        }, runDir)
        return {
          detected_objects: context.analysis.detected_objects.length,
          usable_surfaces: context.analysis.usable_surfaces.length,
          complexity: context.analysis.complexity_assessment,
          output: path.relative(root, path.join(runDir, 'plate-analysis.json')),
        }
      },
    },
    {
      name: 'Assemble first edition package and archive manifest entry',
      tool: 'Node edition package assembler',
      command: `internal:assemble-edition-package --publish ${options.publish}`,
      run: async () => {
        context.package = await assembleEditionPackage({
          options,
          payload: context.payload,
          researchField: context.researchField,
          signalHarvest: context.signalHarvest,
          plate: context.plate,
          analysis: context.analysis,
          runDir,
        }, {
          env_loaded_from_files: Object.keys(loaded).filter((keyName) => keyName !== 'OPENAI_API_KEY').sort(),
        })
        return {
          edition_id: context.package.editionId,
          route: context.package.route,
          published: context.package.published,
          edition_dir: path.relative(root, context.package.editionDir),
        }
      },
    },
  ]

  const postAssemblySteps = [
    {
      name: 'Enrich source images',
      tool: 'Node fetch + provider image rules',
      command: ['npm', ['run', 'enrich:source-images']],
    },
  ]

  if (!options.skipMask) {
    postAssemblySteps.push({
      name: 'Generate post-plate mask candidates and geometry audit files',
      tool: 'Python + Pillow + NumPy + SciPy + OpenCV GrabCut + scikit-image contours',
      command: ['python3', maskPipelineArgs(options, generationName)],
      dynamicArgs: () => [context.package.editionId],
    })
  }

  const total = internalSteps.length + postAssemblySteps.length + postPackageSteps({
    options,
    editionIds: [],
    generationName,
    smokeRoute: '/',
  }).length

  console.log(JSON.stringify({
    command: 'daily:process',
    mode: 'from-scratch',
    date: options.date,
    vault: options.vault,
    runDir: path.relative(root, runDir),
    publish: options.publish,
    ux: options.ux,
    sourceBrowser: managedBrowser
      ? { mode: 'managed-playwright-chromium-cdp', port: managedBrowser.port, buName: managedBrowser.buName }
      : process.env.BU_CDP_WS
        ? { mode: 'provided-cdp-websocket', buName: process.env.BU_NAME || 'default' }
        : { mode: 'local-chrome-devtools', buName: process.env.BU_NAME || 'default' },
    diversity: {
      recent_editions_considered: recentEditions.map((edition) => edition.edition_id),
      directive: diversityDirective,
      recent_source_keys: recentSourceKeys.size,
    },
  }, null, 2))

  let stepIndex = 0
  for (const step of internalSteps) {
    stepIndex += 1
    await runInternal({ ...step, index: stepIndex, total }, step.command, step.run)
  }

  for (const step of postAssemblySteps) {
    stepIndex += 1
    const [command, baseArgs] = step.command
    const args = [...baseArgs, ...(step.dynamicArgs ? step.dynamicArgs() : [])]
    await runProcess(command, args, { ...step, index: stepIndex, total })
  }

  const postSteps = postPackageSteps({
    options,
    editionIds: [context.package.editionId],
    generationName,
    smokeRoute: buildSmokeRoute({
      edition_id: context.package.editionId,
      slug: context.package.route.replace('/archive/', ''),
      is_live: options.publish,
    }),
  })

  for (const step of postSteps) {
    stepIndex += 1
    const [command, args] = step.command
    await runProcess(command, args, { ...step, index: stepIndex, total }, step.env)
  }

  console.log(JSON.stringify({
    completed: true,
    edition_id: context.package.editionId,
    route: context.package.route,
    runDir: path.relative(root, runDir),
    published: context.package.published,
  }, null, 2))
  stopManagedBrowserHarnessBrowser(managedBrowser)
  console.log('\nDaily process completed.')
}

async function main() {
  const options = parseArgs(process.argv.slice(2))
  if (options.mode === 'existing') {
    await runExistingMode(options)
    return
  }
  await runFromScratchMode(options)
}

main().catch((error) => {
  console.error(error.stack || error.message)
  process.exit(1)
})
