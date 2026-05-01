import { spawn } from 'node:child_process'
import fs from 'node:fs/promises'
import fsSync from 'node:fs'
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
import { startManagedBrowserHarnessBrowser, stopManagedBrowserHarnessBrowser } from './lib/browser-harness-runtime.mjs'
import { fetchWithTimeout } from './lib/fetch-with-timeout.mjs'
import { parseArgs } from './lib/cli-options.mjs'
import { mineSignals } from './lib/signal-mining.mjs'
import { inspectGeneratedPlate as inspectGeneratedPlateImpl } from './lib/plate-analysis.mjs'
import { inspectSourceCandidates } from './lib/source-research.mjs'
import { composeDailyPayload as composeDailyPayloadImpl, generateScenePlate as generateScenePlateImpl, imageAspectRatioFromSize } from './lib/scene-generation.mjs'
import { defaultGenerationName, requireOpenAiKey } from './lib/runtime-env.mjs'
import { chooseDiversityDirective, getRecentDiversityAvoidTerms, getRecentEditionSummaries, getRecentSourceKeys, loadManifest } from './lib/recent-edition-context.mjs'
import { sourceContentKey } from './lib/source-selection-policy.mjs'
import { runExistingMode } from './pipeline/run-existing-mode.mjs'
import { runFromScratchMode } from './pipeline/run-from-scratch-mode.mjs'

const root = process.cwd()
const minContentItems = 6
const targetContentItems = 9
const maxContentItems = 10
const recentDiversityEditionCount = 6

function formatCommand(command, args) {
  return [command, ...args].map((part) => (/\s/.test(part) ? JSON.stringify(part) : part)).join(' ')
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

async function runInternal(step, command, fn) {
  console.log(`\n[${step.index}/${step.total}] ${step.name}`)
  console.log(`tool: ${step.tool}`)
  console.log(`command: ${command}`)
  const result = await fn()
  if (result !== undefined) console.log(JSON.stringify(result, null, 2))
  return result
}

async function composeDailyPayload(args, runDir) {
  return composeDailyPayloadImpl(args, runDir, {
    writeJson,
    minContentItems,
    targetContentItems,
    maxContentItems,
  })
}

async function generateScenePlate(args, runDir) {
  return generateScenePlateImpl(args, runDir, { writeJson })
}

function inspectGeneratedPlate(args, runDir) {
  return inspectGeneratedPlateImpl(args, runDir, { writeJson, minContentItems, maxContentItems })
}

async function main() {
  const options = parseArgs(process.argv.slice(2))
  if (options.mode === 'existing') {
    await runExistingMode({
      options,
      root,
      loadManifest: () => loadManifest({ root, fsSync }),
      defaultGenerationName,
      requireOpenAiKey: (options = {}) => requireOpenAiKey({ root, ...options }),
      runInternal,
      runProcess,
      inspectGeneratedPlate,
      readJson,
      writeJson,
    })
    return
  }
  await runFromScratchMode({
    options,
    root,
    fs,
    requireOpenAiKey: (options = {}) => requireOpenAiKey({ root, ...options }),
    defaultGenerationName,
    getRecentEditionSummaries: (limit = recentDiversityEditionCount) => getRecentEditionSummaries({ root, fsSync, sourceContentKey, limit }),
    getRecentSourceKeys,
    getRecentDiversityAvoidTerms,
    chooseDiversityDirective,
    startManagedBrowserHarnessBrowser: async (runDir, runId) => startManagedBrowserHarnessBrowser({
      runDir,
      runId,
      root,
      fs,
      spawn,
      net: (await import('node:net')).default,
      fetchWithTimeout,
    }),
    stopManagedBrowserHarnessBrowser,
    mineSignals,
    inspectSourceCandidates,
    composeDailyPayload,
    generateScenePlate,
    inspectGeneratedPlate,
    assembleEditionPackage,
    runInternal,
    runProcess,
    recentDiversityEditionCount,
    imageAspectRatioFromSize,
  })
}

const isDirectRun = process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)

if (isDirectRun) {
  main().catch((error) => {
    console.error(error.stack || error.message)
    process.exit(1)
  })
}
