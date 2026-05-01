import fs from 'node:fs'
import path from 'node:path'

import { buildSmokeRoute, existingPackageSteps, getEditionIds, postPackageSteps } from './package-steps.mjs'
import { remapExistingEditionPlate } from './remap-existing-edition.mjs'

export async function runExistingMode({
  options,
  root,
  loadManifest,
  defaultGenerationName,
  requireOpenAiKey,
  runInternal,
  runProcess,
  inspectGeneratedPlate,
  readJson,
  writeJson,
}) {
  const manifest = loadManifest()
  const editionIds = getEditionIds(options, manifest)
  const generationName = options.generationName || defaultGenerationName()
  const firstEdition = manifest.editions.find((item) => item.edition_id === editionIds[0])
  const smokeRoute = buildSmokeRoute(firstEdition)

  for (const editionId of editionIds) {
    const editionDir = path.join(root, 'public', 'editions', editionId)
    if (!fs.existsSync(editionDir)) throw new Error(`Edition package not found: ${editionDir}`)
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
        root,
        inspectGeneratedPlate,
        readJson,
        writeJson,
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
