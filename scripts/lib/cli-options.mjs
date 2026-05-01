import fsSync from 'node:fs'
import path from 'node:path'

import { resolveFrontpageConfig } from './frontpage-config.mjs'
import { loadDotEnv } from './runtime-env.mjs'

const root = process.cwd()
const defaultSignalWindowDays = 30
const defaultMaxNotes = 30
const defaultMaxSources = 16
const supportedInputModes = ['manifest', 'markdown-folder', 'obsidian-allowlist']
const supportedImageBackends = ['openai', 'hermes']

const usage = `Usage:
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
  loadDotEnv({ root })
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
