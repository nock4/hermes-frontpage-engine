import path from 'node:path'

import { loadInspirationOverride, consumeInspirationOverride } from '../lib/inspiration-override.mjs'
import { selectPlatePosture } from '../lib/scene-posture.mjs'
import { createAssembleEditionStep } from './assemble-edition.mjs'
import { createComposeBriefStep } from './compose-brief.mjs'
import { createGeneratePlateStep } from './generate-plate.mjs'
import { createMapArtifactsStep } from './map-artifacts.mjs'
import { createMineSignalsStep } from './mine-signals.mjs'
import { buildSmokeRoute, maskPipelineArgs, pipelinePython, postPackageSteps } from './package-steps.mjs'
import { createResearchSourcesStep } from './research-sources.mjs'
import { buildSourceContract } from '../lib/source-contract.mjs'
import { prepareSourceAudioMaterial } from '../lib/source-audio-material.mjs'

export async function runFromScratchMode({
  options,
  root,
  fs,
  requireOpenAiKey,
  defaultGenerationName,
  getRecentEditionSummaries,
  getRecentSourceKeys,
  getHistoricalSourceKeys,
  getRecentDiversityAvoidTerms,
  chooseDiversityDirective,
  startManagedBrowserHarnessBrowser,
  stopManagedBrowserHarnessBrowser,
  mineSignals,
  inspectSourceCandidates,
  composeDailyPayload,
  generateScenePlate,
  auditSourceImageFidelity,
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
  const sampleMode = options.useSampleSignals || (options.sampleDataEnabled && options.inputMode === 'manifest')
  const rawRecentEditions = sampleMode ? [] : getRecentEditionSummaries(recentDiversityEditionCount)
  const recentEditions = rawRecentEditions
  const recentSourceKeys = sampleMode ? new Set() : (getHistoricalSourceKeys ? getHistoricalSourceKeys() : getRecentSourceKeys(recentEditions))
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

  const platePosture = selectPlatePosture({
    date: options.date,
    runId,
    recentEditions,
    options,
    sampleMode,
    inspirationOverride,
  })
  await fs.writeFile(path.join(runDir, 'plate-posture.json'), `${JSON.stringify(platePosture, null, 2)}\n`, 'utf8')

  const context = {
    inspirationOverride,
    platePosture,
  }
  const internalSteps = [
    createMineSignalsStep({ options, context, recentDiversityAvoidTerms, recentSourceKeys, root, runDir, mineSignals }),
    createResearchSourcesStep({ apiKey, context, inspectSourceCandidates, options, recentSourceKeys, root, runDir }),
    {
      name: 'Prepare source audio material',
      tool: 'yt-dlp + ffmpeg + songsee/librosa audio analysis',
      command: 'internal:prepare-source-audio-material --youtube-anchors',
      run: async () => {
        context.audioMaterial = await prepareSourceAudioMaterial(context.researchField, { runDir, root })
        context.researchField = {
          ...context.researchField,
          source_audio_material: context.audioMaterial,
          source_audio_material_path: path.join(runDir, 'source-audio-material.json'),
        }
        await fs.writeFile(path.join(runDir, 'source-research.json'), `${JSON.stringify(context.researchField, null, 2)}\n`, 'utf8')
        return {
          status: context.audioMaterial.status,
          sources: context.audioMaterial.sources?.length || 0,
          briefs: context.audioMaterial.audio_visual_briefs?.length || 0,
          output: path.relative(root, path.join(runDir, 'source-audio-material.json')),
        }
      },
    },
    createComposeBriefStep({ apiKey, composeDailyPayload, context, diversityDirective, options, recentEditions, root, runDir }),
    {
      name: 'Build source contract',
      tool: 'Deterministic source-image contract gate',
      command: 'write source-contract.json and attach prompt safety contract',
      run: async () => {
        const contract = buildSourceContract({
          sourceImageFingerprints: context.payload?.source_image_fingerprints || [],
          visualDirection: context.payload?.visual_direction || {},
          platePosture,
          scenePrompt: context.payload?.scene_prompt || '',
          sourceImageMode: context.payload?.source_image_mode,
        })
        context.payload = contract.mode === 'source-image'
          ? { ...context.payload, source_contract: contract }
          : {
              ...context.payload,
              source_contract: contract,
              source_image_fingerprints: [],
              source_image_mode: 'skipped-no-valid-dominant-source-image',
              source_image_mode_reason: contract.skip_reason,
            }
        await fs.writeFile(path.join(runDir, 'source-contract.json'), `${JSON.stringify(contract, null, 2)}\n`, 'utf8')
        await fs.writeFile(path.join(runDir, 'daily-generation-payload.json'), `${JSON.stringify(context.payload, null, 2)}\n`, 'utf8')
        return contract
      },
    },
    createGeneratePlateStep({ apiKey, context, generateScenePlate, imageAspectRatioFromSize, options, root, runDir }),
    {
      name: 'Audit source-image fidelity before mapping',
      tool: 'Vision source/plate adversarial QA',
      command: 'compare attached source material against generated plate; recover with audit-guided source-preserving plates if blocked',
      run: async () => {
        const auditPlate = () => auditSourceImageFidelity({
          payload: context.payload,
          platePath: context.plate.outputPath,
          apiKey,
          model: options.model,
        }, runDir)

        try {
          return await auditPlate()
        } catch (firstError) {
          const hasSourceImage = Array.isArray(context.payload?.source_image_fingerprints)
            && context.payload.source_image_fingerprints.some((fingerprint) => fingerprint?.image_url)
          if (!hasSourceImage || process.env.DFE_SOURCE_FIDELITY_AUTO_RECOVERY === '0') throw firstError

          let lastError = firstError
          const recoveryAttempts = sourceFidelityRecoveryAttempts()
          for (let attempt = 1; attempt <= recoveryAttempts; attempt += 1) {
            const failedAudit = await readSourceFidelityAudit(runDir, fs)
            context.payload = buildSourceFidelityRecoveryPayload(context.payload, failedAudit, attempt)
            await fs.writeFile(
              path.join(runDir, `daily-generation-payload.source-fidelity-recovery-${attempt}.json`),
              `${JSON.stringify(context.payload, null, 2)}\n`,
              'utf8',
            )

            console.warn(`[source-fidelity] ${lastError.message}; regenerating recovery plate ${attempt}/${recoveryAttempts} with audit-guided preserve cues`)
            const previousRecoveryFlag = process.env.DFE_SOURCE_PRESERVE_PLATE
            process.env.DFE_SOURCE_PRESERVE_PLATE = '1'
            try {
              context.plate = await generateScenePlate({
                payload: context.payload,
                apiKey,
                imageModel: options.imageModel,
                imageBackend: options.imageBackend,
                imageSize: options.imageSize,
                imageQuality: options.imageQuality,
              }, runDir)
            } finally {
              if (previousRecoveryFlag === undefined) delete process.env.DFE_SOURCE_PRESERVE_PLATE
              else process.env.DFE_SOURCE_PRESERVE_PLATE = previousRecoveryFlag
            }

            try {
              return await auditPlate()
            } catch (recoveryError) {
              lastError = recoveryError
            }
          }
          throw lastError
        }
      },
    },
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
      command: ['npm', ['run', 'enrich:source-images', '--', '--edition']],
      dynamicArgs: () => [context.package.editionId],
    },
    {
      name: 'Prepare loud source visual surfaces',
      tool: 'Roboflow Supervision + OpenCV saliency cropper',
      command: ['npm', ['run', 'prepare:source-visuals', '--', '--edition']],
      dynamicArgs: () => [context.package.editionId],
    },
  ]

  if (!options.skipMask) {
    postAssemblySteps.push({
      name: 'Generate post-plate mask candidates and geometry audit files',
      tool: 'Python + Pillow + NumPy + SciPy + OpenCV GrabCut + scikit-image contours',
      command: [pipelinePython(), maskPipelineArgs(options, generationName)],
      dynamicArgs: () => [context.package.editionId],
    }, {
      name: 'Build interaction mesh hover territories',
      tool: 'Python + Pillow + NumPy + SciPy mask-derived navmesh topology',
      command: [pipelinePython(), ['scripts/build-interaction-mesh.py', '--generation-name', generationName, '--apply-artifact-map']],
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
    platePosture: {
      plate_posture: platePosture.plate_posture,
      density_target: platePosture.density_target,
      abstraction_target: platePosture.abstraction_target,
      minimality_target: platePosture.minimality_target,
      manual_override: platePosture.manual_override,
      reason: platePosture.reason,
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

function sourceFidelityRecoveryAttempts() {
  const parsed = Number.parseInt(process.env.DFE_SOURCE_FIDELITY_RECOVERY_ATTEMPTS || '', 10)
  if (Number.isFinite(parsed) && parsed >= 0) return Math.min(parsed, 4)
  return 2
}

async function readSourceFidelityAudit(runDir, fsImpl) {
  try {
    return JSON.parse(await fsImpl.readFile(path.join(runDir, 'source-fidelity-audit.json'), 'utf8'))
  } catch {
    return null
  }
}

export function buildSourceFidelityRecoveryPayload(payload, audit, attempt = 1) {
  const existingPreserve = Array.isArray(payload?.source_reference_preserve) ? payload.source_reference_preserve : []
  const missing = Array.isArray(audit?.missing_critical_elements) ? audit.missing_critical_elements : []
  const risks = Array.isArray(audit?.drift_risks) ? audit.drift_risks : []
  const blockers = Array.isArray(audit?.blockers) ? audit.blockers : []
  const retained = Array.isArray(audit?.retained_critical_elements) ? audit.retained_critical_elements : []
  const failureCueText = [
    ...missing.map((cue) => `Recover missing source cue: ${cue}`),
    ...risks.slice(0, 3).map((cue) => `Avoid drift: ${cue}`),
    ...blockers.slice(0, 3).map((cue) => `Previous blocker: ${cue}`),
  ]
  const keepCueText = retained.slice(0, 4).map((cue) => `Keep retained source cue: ${cue}`)
  const sourceReferencePreserve = uniqueStrings([
    ...existingPreserve,
    ...failureCueText,
    ...keepCueText,
    'Recovery rule: preserve the named missing details as visible illegible marks or material objects, not as readable labels or debug annotations.',
  ], 12)

  const negativeConstraints = uniqueStrings([
    ...(Array.isArray(payload?.negative_constraints) ? payload.negative_constraints : []),
    'do not strip handmade details into generic torn-paper ambience',
    'do not fragment the primary source objects until their original silhouettes stop reading',
    'do not replace source candy/wrapper/handwriting cues with unrelated scraps',
  ], 16)

  const scenePrompt = [
    payload?.scene_prompt || '',
    `Source-fidelity recovery pass ${attempt}: restore the audit-missing source identifiers before adding seams or ruptures.`,
    missing.length ? `Visible details to restore: ${missing.slice(0, 5).join('; ')}.` : '',
    'Keep source-window marks grown from those restored details; no labels, rings, pins, or pasted cards.',
  ].filter(Boolean).join(' ')

  return {
    ...payload,
    source_reference_preserve: sourceReferencePreserve,
    negative_constraints: negativeConstraints,
    scene_prompt: scenePrompt,
  }
}

function uniqueStrings(values, limit) {
  const result = []
  const seen = new Set()
  for (const value of values) {
    const text = String(value || '').replace(/\s+/g, ' ').trim()
    const key = text.toLowerCase()
    if (!text || seen.has(key)) continue
    seen.add(key)
    result.push(text)
    if (result.length >= limit) break
  }
  return result
}
