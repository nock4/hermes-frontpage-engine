import path from 'node:path'

import { loadInspirationOverride, consumeInspirationOverride } from '../lib/inspiration-override.mjs'
import { createAssembleEditionStep } from './assemble-edition.mjs'
import { createComposeBriefStep } from './compose-brief.mjs'
import { createGeneratePlateStep } from './generate-plate.mjs'
import { createMapArtifactsStep } from './map-artifacts.mjs'
import { createMineSignalsStep } from './mine-signals.mjs'
import { buildSmokeRoute, maskPipelineArgs, postPackageSteps } from './package-steps.mjs'
import { createResearchSourcesStep } from './research-sources.mjs'

export async function runFromScratchMode({
  options,
  root,
  fs,
  requireOpenAiKey,
  defaultGenerationName,
  getRecentEditionSummaries,
  getRecentSourceKeys,
  getRecentDiversityAvoidTerms,
  chooseDiversityDirective,
  startManagedBrowserHarnessBrowser,
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
}) {
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

  const inspirationOverride = await loadInspirationOverride({
    overridePath: options.inspirationOverride,
    date: options.date,
  })

  const context = {
    inspirationOverride,
  }
  const internalSteps = [
    createMineSignalsStep({ options, context, recentDiversityAvoidTerms, root, runDir, mineSignals }),
    createResearchSourcesStep({ apiKey, context, inspectSourceCandidates, options, recentSourceKeys, root, runDir }),
    createComposeBriefStep({ apiKey, composeDailyPayload, context, diversityDirective, options, recentEditions, root, runDir }),
    createGeneratePlateStep({ apiKey, context, generateScenePlate, imageAspectRatioFromSize, options, root, runDir }),
    createMapArtifactsStep({ apiKey, context, inspectGeneratedPlate, options, root, runDir }),
    createAssembleEditionStep({
      assembleEditionPackage,
      context,
      envLoadedFromFiles: Object.keys(loaded).filter((keyName) => keyName !== 'OPENAI_API_KEY').sort(),
      options,
      root,
      runDir,
    }),
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
    inspirationOverride: inspirationOverride ? {
      title: inspirationOverride.title,
      source: inspirationOverride.source,
      manifest: path.relative(root, inspirationOverride.override_path),
      source_url: inspirationOverride.source_url,
      consume_after_success: inspirationOverride.consume_after_success,
    } : null,
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

  if (context.inspirationOverride?.consume_after_success) {
    await consumeInspirationOverride(context.inspirationOverride, { status: 'consumed-after-success' })
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
