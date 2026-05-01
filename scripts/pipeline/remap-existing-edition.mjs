import fs from 'node:fs'
import fsPromises from 'node:fs/promises'
import path from 'node:path'

import { expansionLabel, readImageDimensions, rectPolygon, safeOrigin, writeArtifactSvgMasks } from '../lib/edition-geometry.mjs'
import { sentenceList } from '../lib/string-utils.mjs'

export async function remapExistingEditionPlate({
  editionId,
  apiKey,
  model,
  generationName,
  root,
  inspectGeneratedPlate,
  readJson,
  writeJson,
}) {
  const editionDir = path.join(root, 'public', 'editions', editionId)
  const edition = await readJson(path.join(editionDir, 'edition.json'))
  const brief = await readJson(path.join(editionDir, 'brief.json')).catch(() => ({}))
  const artifactMap = await readJson(path.join(editionDir, 'artifact-map.json'))
  const sourceBindings = await readJson(path.join(editionDir, 'source-bindings.json')).catch(() => ({ bindings: [] }))
  const bindingByArtifact = new Map((sourceBindings.bindings || []).map((binding) => [binding.artifact_id, binding]))
  let platePath = path.join(root, 'public', edition.plate_asset_path.replace(/^\//, ''))
  if (!fs.existsSync(platePath)) platePath = path.join(editionDir, 'assets', 'plate.png')

  const remapRunDir = path.join(root, 'tmp', 'daily-process-runs', generationName, `remap-${editionId}`)
  await fsPromises.mkdir(remapRunDir, { recursive: true })

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

  const analysis = await inspectGeneratedPlate({ payload, platePath, apiKey, model }, remapRunDir)

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
