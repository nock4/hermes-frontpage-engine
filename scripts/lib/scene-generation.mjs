import crypto from 'node:crypto'
import fs from 'node:fs/promises'
import path from 'node:path'
import { spawn } from 'node:child_process'
import { fileURLToPath } from 'node:url'

import { getSourceDisplayTitle } from './source-display.mjs'
import { openAiJson } from './openai-json.mjs'
import { sourceContentKey } from './source-selection-policy.mjs'
import { getResearchContentSources, } from './source-research.mjs'
import { inferVisualDirection, selectFallbackMotifTerms } from './visual-direction.mjs'
import { slugify, uniqueNonEmpty } from './string-utils.mjs'

const hermesImageGenerateScript = fileURLToPath(new URL('./hermes_image_generate.py', import.meta.url))
const sceneStructurePolicy = {
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
const bannedProductTerms = [
  ['dashboard', 'signal board'],
  ['control panel', 'instrument array'],
  ['interface panel', 'source plaque'],
  ['digital interface', 'illuminated source surface'],
  ['traditional user interface', 'literal software interface'],
  ['floating screens', 'floating glass plates'],
  ['screen', 'glass plate'],
]

export async function composeDailyPayload(
  { signalHarvest, researchField, apiKey, model, date, recentEditions = [], diversityDirective = '' },
  runDir,
  { writeJson, minContentItems, targetContentItems, maxContentItems },
) {
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
    payload = fallbackDailyPayload(signalHarvest, researchField, visualDirection, date, {
      getResearchContentSources,
      selectFallbackMotifTerms,
      targetContentItems,
    })
  }

  payload = normalizeDailyPayload(payload, signalHarvest, researchField, visualDirection, date, {
    getResearchContentSources,
    selectFallbackMotifTerms,
    minContentItems,
    targetContentItems,
    maxContentItems,
  })
  await writeJson(path.join(runDir, 'daily-generation-payload.json'), payload)
  return payload
}

export function imageAspectRatioFromSize(size) {
  const match = String(size || '').match(/(\d+)x(\d+)/i)
  if (!match) return 'landscape'
  const width = Number(match[1])
  const height = Number(match[2])
  if (!Number.isFinite(width) || !Number.isFinite(height) || width <= 0 || height <= 0) return 'landscape'
  if (width === height) return 'square'
  return width > height ? 'landscape' : 'portrait'
}

export async function generateScenePlate(
  { payload, apiKey, imageModel, imageBackend, imageSize, imageQuality },
  runDir,
  { writeJson },
) {
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

async function runJsonCommand(command, args, extraEnv = {}) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, {
      cwd: process.cwd(),
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

function fallbackDailyPayload(signalHarvest, researchField, visualDirection, date, {
  getResearchContentSources,
  selectFallbackMotifTerms,
  targetContentItems,
}) {
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

function slugBaseWithoutVersion(value) {
  return slugify(value).replace(/-v\d+$/i, '') || 'daily-edition'
}

function normalizeDailyPayload(payload, signalHarvest, researchField, visualDirection, date, {
  getResearchContentSources,
  selectFallbackMotifTerms,
  minContentItems,
  targetContentItems,
  maxContentItems,
}) {
  const fallback = fallbackDailyPayload(signalHarvest, researchField, visualDirection, date, {
    getResearchContentSources,
    selectFallbackMotifTerms,
    targetContentItems,
  })
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

  return {
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

function normalizeStringArray(value, fallback) {
  if (!Array.isArray(value)) return fallback
  const result = value.map((entry) => String(entry).trim()).filter(Boolean)
  return result.length ? result : fallback
}

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
