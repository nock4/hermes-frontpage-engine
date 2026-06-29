import crypto from 'node:crypto'
import fs from 'node:fs/promises'
import path from 'node:path'

import {
  expansionLabel,
  parseImageSize,
  rectPolygon,
  safeOrigin,
  writeArtifactSvgMasks,
} from './edition-geometry.mjs'
import { youtubeEmbedStatus } from './source-inspection.mjs'
import {
  classifySource,
  isDirectRasterImageUrl,
  isLowValueVisualImage,
} from './source-selection-policy.mjs'
import { domain, getDistinctSourceDisplayTitle, getSourceDisplayTitle } from './source-display.mjs'
import { sanitizeSourceText } from './source-text.mjs'
import { isYouTubeVideoUrl } from './source-url-policy.mjs'
import { sentenceList, slugify, uniqueNonEmpty } from './string-utils.mjs'

const DEFAULT_MAX_CONTENT_ITEMS = 10
const FALLBACK_SURFACE_BOUNDS = [
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

async function readJson(filePath) {
  return JSON.parse(await fs.readFile(filePath, 'utf8'))
}

async function writeJson(filePath, value) {
  await fs.mkdir(path.dirname(filePath), { recursive: true })
  await fs.writeFile(filePath, `${JSON.stringify(value, null, 2)}\n`, 'utf8')
}

function nextVersion(manifest, date, slugBase) {
  const prefix = `${date}-${slugBase}-v`
  const versions = manifest.editions
    .map((item) => item.edition_id)
    .filter((id) => id.startsWith(prefix))
    .map((id) => Number(id.slice(prefix.length)))
    .filter(Number.isFinite)
  return versions.length ? Math.max(...versions) + 1 : 1
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

function artifactId(label, index, kind) {
  return `${kind}-${slugify(label).slice(0, 36) || `artifact-${index + 1}`}`
}

function uniqueArtifactId(label, index, kind, usedIds) {
  const base = artifactId(label, index, kind)
  let candidate = base
  let suffix = 2
  while (usedIds.has(candidate)) {
    candidate = `${base}-${suffix}`
    suffix += 1
  }
  usedIds.add(candidate)
  return candidate
}

function fallbackSurfaceObject(artifact, index) {
  const bounds = FALLBACK_SURFACE_BOUNDS[index % FALLBACK_SURFACE_BOUNDS.length]
  return {
    label: artifact?.label || `Source pocket ${index + 1}`,
    artifact_type: artifact?.artifact_type || 'source-surface',
    role: index < 2 ? 'hero-anchor' : 'source-pocket',
    bounds,
    polygon: rectPolygon(bounds),
    confidence: 0.45,
    visual_evidence: 'Planned source surface fallback used because plate inspection returned fewer mapped objects than source bindings.',
  }
}

function packageDetectedObjects(analysis, eligibleArtifacts, maxContentItems) {
  const detectedObjects = Array.isArray(analysis.detected_objects) ? analysis.detected_objects : []
  const targetCount = Math.min(eligibleArtifacts.length, maxContentItems)
  const objects = []

  for (let index = 0; index < targetCount; index += 1) {
    objects.push(detectedObjects[index] || fallbackSurfaceObject(eligibleArtifacts[index], index))
  }

  return objects
}

function sourceLookupKey(source) {
  return source?.note_id || source?.note_title || source?.note_path || ''
}

function getDirectSourceImageUrl(source) {
  return [source?.url, source?.source_url, source?.final_url].find((value) => isDirectRasterImageUrl(value)) || null
}

function getSignalHarvestImageForSource(source, signalHarvest) {
  if (!source || !signalHarvest?.notes_selected) return null
  const lookupValues = new Set(uniqueNonEmpty([source.note_id, source.note_path, source.note_title]))
  const note = signalHarvest.notes_selected.find((candidate) => (
    lookupValues.has(candidate.id)
    || lookupValues.has(candidate.path)
    || lookupValues.has(candidate.title)
  ))
  if (!note) return null
  return note.urls?.find((url) => isDirectRasterImageUrl(url) && !isLowValueVisualImage(url)) || null
}

function getRedirectSiblingImageUrl(source, researchField) {
  const candidates = uniqueNonEmpty([source?.final_url, source?.source_url])
  if (!candidates.length) return null

  const sibling = (researchField.sources || []).find((candidate) => {
    if (candidate === source) return false
    return candidates.includes(candidate.url) || candidates.includes(candidate.source_url) || candidates.includes(candidate.final_url)
  })

  if (!sibling) return null
  return getDirectSourceImageUrl(sibling) || (!isLowValueVisualImage(sibling.image_url) ? sibling.image_url : null)
}

function getSourceImageForBinding(source, researchField, signalHarvest = null) {
  if (!source) return null

  const directSourceImage = getDirectSourceImageUrl(source)
  if (directSourceImage) return directSourceImage

  const classification = classifySource(source.url || source.source_url || '')
  if (classification.source_type === 'tweet') {
    const signalHarvestImage = getSignalHarvestImageForSource(source, signalHarvest)
    if (signalHarvestImage) return signalHarvestImage
  }

  if (source.image_url && !isLowValueVisualImage(source.image_url)) return source.image_url

  const redirectSiblingImage = getRedirectSiblingImageUrl(source, researchField)
  if (redirectSiblingImage) return redirectSiblingImage

  if (classification.source_type !== 'tweet') return null

  const lookupKey = sourceLookupKey(source)
  const relatedMedia = (researchField.sources || []).find((candidate) => {
    if (candidate === source) return false
    if (lookupKey && sourceLookupKey(candidate) !== lookupKey) return false
    return getDirectSourceImageUrl(candidate)
  })

  return getDirectSourceImageUrl(relatedMedia)
}

function getSourceMediaForBinding(source, sourceImageUrl) {
  if (!source?.media_url || !source?.media_type) return { mediaUrl: sourceImageUrl, mediaType: sourceImageUrl ? 'image' : null }
  if (source.media_type !== 'video' && source.media_type !== 'image') return { mediaUrl: sourceImageUrl, mediaType: sourceImageUrl ? 'image' : null }
  return {
    mediaUrl: source.media_url,
    mediaType: source.media_type,
  }
}

function chooseAboutTypography(payload) {
  const text = [
    payload.edition_title,
    payload.scene_family,
    payload.mood,
    payload.lighting,
    payload.scene_prompt,
    ...(payload.material_language || []),
    ...(payload.object_inventory || []),
  ].join(' ').toLowerCase()

  const profiles = {
    botanicalField: {
      profile_id: 'botanical-field',
      heading_family: "'DFE Fraunces', Georgia, serif",
      body_family: "'DFE Newsreader', Iowan Old Style, Georgia, serif",
      accent_family: "'DFE Space Grotesk', ui-sans-serif, system-ui, sans-serif",
      heading_weight: 700,
      body_weight: 430,
      accent_weight: 720,
      rationale: 'Fraunces gives the title an organic, seed-label quality; Newsreader keeps the explanation calm and readable.',
    },
    archiveReader: {
      profile_id: 'archive-reader',
      heading_family: "'DFE Newsreader', Georgia, serif",
      body_family: "'DFE Newsreader', Iowan Old Style, Georgia, serif",
      accent_family: "'DFE Space Grotesk', ui-sans-serif, system-ui, sans-serif",
      heading_weight: 700,
      body_weight: 430,
      accent_weight: 720,
      rationale: 'Newsreader supports an editorial archive voice while Space Grotesk keeps process labels crisp.',
    },
    signalTechnical: {
      profile_id: 'signal-technical',
      heading_family: "'DFE Space Grotesk', ui-sans-serif, system-ui, sans-serif",
      body_family: "'DFE Space Grotesk', ui-sans-serif, system-ui, sans-serif",
      accent_family: "'DFE JetBrains Mono', 'DFE Mono', ui-monospace, monospace",
      heading_weight: 700,
      body_weight: 430,
      accent_weight: 640,
      rationale: 'Space Grotesk carries a precise technical mood without turning the panel into a dashboard.',
    },
    constructedWorld: {
      profile_id: 'constructed-world',
      heading_family: "'DFE Bricolage Grotesque', ui-sans-serif, system-ui, sans-serif",
      body_family: "'DFE Space Grotesk', ui-sans-serif, system-ui, sans-serif",
      accent_family: "'DFE Newsreader', Georgia, serif",
      heading_weight: 700,
      body_weight: 430,
      accent_weight: 640,
      rationale: 'Bricolage Grotesque fits assembled, experimental scenes while Space Grotesk keeps the process text direct.',
    },
    listeningArcade: {
      profile_id: 'listening-arcade',
      heading_family: "'DFE Bricolage Grotesque', ui-sans-serif, system-ui, sans-serif",
      body_family: "'DFE Space Grotesk', ui-sans-serif, system-ui, sans-serif",
      accent_family: "'DFE Fraunces', Georgia, serif",
      heading_weight: 720,
      body_weight: 430,
      accent_weight: 680,
      rationale: 'Bricolage Grotesque and Space Grotesk fit record, arcade, and listening-room editions while Fraunces keeps source captions tactile.',
    },
    artObject: {
      profile_id: 'art-object',
      heading_family: "'DFE Fraunces', 'DFE Newsreader', Georgia, serif",
      body_family: "'DFE Newsreader', Georgia, serif",
      accent_family: "'DFE Space Grotesk', ui-sans-serif, system-ui, sans-serif",
      heading_weight: 700,
      body_weight: 430,
      accent_weight: 700,
      rationale: 'Fraunces and Newsreader fit image-led art objects while Space Grotesk keeps process labels crisp.',
    },
  }

  if (/(listen|listening|audio|track|album|record|radio|nts|bandcamp|mix|music|arcade|speaker|sound|cassette|turntable|song)/.test(text)) {
    return profiles.listeningArcade
  }
  if (/(plant|garden|botanic|botanical|native|seed|field|forest|moss|leaf|flower|pollinator|prairie|meadow|habitat|dragonfly|milkweed)/.test(text)) {
    return profiles.botanicalField
  }
  if (/(paint|painting|print|printmaking|artist|artwork|gallery|canvas|photograph|image|studio|exhibition|chapel|lacquer|pigment|ink)/.test(text)) {
    return profiles.artObject
  }
  if (/(software|agent|memory|protocol|api|code|model|signal|ledger|machine|algorithm|network|system)/.test(text)) {
    return profiles.signalTechnical
  }
  if (/(archive|library|book|ledger|paper|document|folio|cabinet|map|catalogue|index|print|reader)/.test(text)) {
    return profiles.archiveReader
  }
  if (/(shrine|theatre|stage|ritual|folklore|procession|altar|loom|assemblage|workshop|studio|watchpost)/.test(text)) {
    return profiles.constructedWorld
  }
  return profiles.constructedWorld
}

function projectAboutParagraph() {
  return 'Daily Frontpage is a daily generated interactive front page. Each edition starts from recent saved signals and source research, becomes a new image-led scene, and stays explorable in the archive. The image is the interface: visible marks, objects, and surfaces in the scene open the real sources that shaped the day.'
}

function conciseSceneDescription(scenePrompt) {
  const cleaned = sanitizeSourceText(scenePrompt, '', 900)
  const sentences = cleaned.match(/[^.!?]+[.!?]+/g)?.map((sentence) => sentence.trim()) || []
  const summary = sentences.length ? sentences.slice(0, 2).join(' ') : cleaned
  return summary.length > 320 ? `${summary.slice(0, 317).trim()}...` : summary
}

function buildAboutRecord({ editionId, payload, researchField, signalHarvest, analysis, maxContentItems }) {
  const sourceByUrl = buildSourceLookup(researchField.sources)
  const visualReference = researchField.visual_reference
  const visualReferenceTitle = visualReference ? getSourceDisplayTitle(visualReference, domain(visualReference?.url || '')) : ''
  const sourceTitles = payload.artifacts.map((artifact) => getSourceDisplayTitle(sourceByUrl.get(artifact.source_url), artifact.label))
  const packagedObjectCount = Math.min(analysis.detected_objects?.length || 0, payload.artifacts.length, maxContentItems)
  const detectedLabels = analysis.detected_objects?.slice(0, packagedObjectCount).map((object) => object.label) || []
  const surfaceLabels = Array.isArray(analysis.usable_surfaces) ? analysis.usable_surfaces : []
  const visualObjects = sentenceList([...surfaceLabels, ...detectedLabels], 3)
  const sourcePhrase = sourceTitles.length > 2
    ? `${sentenceList(sourceTitles, 2)}, plus ${sourceTitles.length - 2} more`
    : sentenceList(sourceTitles, 2)

  const visualSeedSentence = visualReferenceTitle
    ? `A source image from ${domain(visualReference?.image_url || visualReference?.url || '') || 'the research set'} helped set the palette, contrast, edge behavior, and gesture.`
    : 'No single source image was strong enough to carry the visual direction, so the scene came from the researched source field as a whole.'
  const mappingPhrase = analysis.inspection_mode === 'planned-artifact-fallback'
    ? 'After the image was made, the mask pass used geometry and contour candidates to attach source windows to the visible marks.'
    : `After the image was made, a plate-reading pass mapped ${packagedObjectCount} visible regions and the mask audit tightened them against ${visualObjects || 'the chosen surfaces'}.`
  const iterationParagraph = [
    `This iteration began with ${signalHarvest.notes_scanned} recent saved-signal files and ${researchField.source_count} captured links, then narrowed the page to ${payload.artifacts.length} source windows around ${sourcePhrase || 'the final source set'}.`,
    visualSeedSentence,
    `The scene became ${payload.edition_title}: ${conciseSceneDescription(payload.scene_prompt)}`,
    mappingPhrase,
  ].join(' ')

  return {
    about_id: `about-${editionId}`,
    label: 'About',
    title: `About ${payload.edition_title}`,
    short_blurb: 'A daily generated front page where the image is the interface.',
    body: [
      projectAboutParagraph(),
      iterationParagraph,
    ],
    typography: chooseAboutTypography(payload),
  }
}

async function isPackageEligibleSourceUrl(url) {
  if (!url) return false
  if (!isYouTubeVideoUrl(url)) return true
  return await youtubeEmbedStatus(url) !== 'unavailable'
}

export async function assembleEditionPackage({
  root = process.cwd(),
  options,
  payload,
  researchField,
  signalHarvest,
  plate,
  analysis,
  runDir,
  maxContentItems = DEFAULT_MAX_CONTENT_ITEMS,
}, stepMeta = {}) {
  const manifestPath = path.join(root, 'public', 'editions', 'index.json')
  const manifest = await readJson(manifestPath)
  const slugBase = slugify(payload.slug_base || payload.scene_family)
  const version = nextVersion(manifest, options.date, slugBase)
  const slug = `${slugBase}-v${version}`
  const editionId = `${options.date}-${slug}`
  const editionDir = path.join(root, 'public', 'editions', editionId)
  const assetsDir = path.join(editionDir, 'assets')
  await fs.mkdir(assetsDir, { recursive: true })

  await fs.copyFile(plate.outputPath, path.join(assetsDir, 'plate.png'))
  await fs.copyFile(plate.outputPath, path.join(assetsDir, 'preview.png'))

  const sourceByUrl = buildSourceLookup(researchField.sources)
  const eligibleArtifacts = []
  for (const artifact of payload.artifacts) {
    if (!artifact.source_url) continue
    if (!await isPackageEligibleSourceUrl(artifact.source_url)) continue
    eligibleArtifacts.push(artifact)
    if (eligibleArtifacts.length >= maxContentItems) break
  }
  const sourceUrls = eligibleArtifacts.map((artifact) => artifact.source_url)
  const objects = packageDetectedObjects(analysis, eligibleArtifacts, maxContentItems)
  const fallbackDetectedObjectCount = Math.max(0, objects.length - (analysis.detected_objects?.length || 0))
  const packageAnalysis = {
    ...analysis,
    detected_objects: objects,
    fallback_detected_object_count: fallbackDetectedObjectCount,
    ...(fallbackDetectedObjectCount > 0
      ? { mapping_note: 'Package assembly filled unmapped source pockets from planned artifact surfaces because plate inspection returned too few detected objects.' }
      : {}),
  }
  const usedArtifactIds = new Set()
  const artifactMapArtifacts = objects.map((object, index) => {
    const kind = index < 2 ? 'hero' : 'module'
    const id = uniqueArtifactId(object.label, index, kind, usedArtifactIds)
    const bounds = object.bounds
    return {
      id,
      kind,
      label: object.label,
      artifact_type: object.artifact_type,
      bounds,
      z_index: kind === 'hero' ? 10 + index : 20 + index,
      polygon: object.polygon || rectPolygon(bounds),
      cluster_id: payload.scene_family,
      mask_path: `/editions/${editionId}/assets/masks/${id}.svg`,
      source_binding_ids: [`binding-${id}`],
      geometry: {
        safe_hover_origin_px: safeOrigin(bounds, 'hover'),
        safe_stage_window_origin_px: safeOrigin(bounds, 'stage'),
        preferred_expansion_label: expansionLabel(bounds),
      },
    }
  })
  await writeArtifactSvgMasks(editionDir, editionId, artifactMapArtifacts, parseImageSize(options.imageSize), { root })

  const usedBindingTitles = new Set()
  const bindings = await Promise.all(artifactMapArtifacts.map(async (artifact, index) => {
    const url = sourceUrls[index]
    const source = sourceByUrl.get(url)
    const classification = classifySource(url)
    const sourceImageUrl = getSourceImageForBinding(source, researchField, signalHarvest)
    const sourceMedia = getSourceMediaForBinding(source, sourceImageUrl)
    const displayTitle = getDistinctSourceDisplayTitle(source, eligibleArtifacts[index]?.label || artifact.label, usedBindingTitles)
    const embedStatus = classification.source_type === 'youtube' ? await youtubeEmbedStatus(url) : null
    return {
      id: `binding-${artifact.id}`,
      artifact_id: artifact.id,
      source_type: classification.source_type,
      source_url: url,
      window_type: classification.window_type,
      hover_behavior: 'preview',
      click_behavior: 'pin-open',
      playback_persistence: true,
      fallback_type: 'rich-preview',
      title: displayTitle,
      kicker: domain(url) || classification.source_type,
      excerpt: sanitizeSourceText(source?.description, eligibleArtifacts[index]?.role || signalHarvest.notes_selected[0]?.title || 'Saved source from the daily signal field.', 360),
      source_title: displayTitle || undefined,
      source_summary: source?.description ? sanitizeSourceText(source.description, '', 520) : undefined,
      source_domain: domain(url),
      source_meta: source?.note_title || undefined,
      source_embed_html: source?.source_embed_html || undefined,
      source_image_url: sourceImageUrl || undefined,
      source_image_alt: sourceImageUrl ? `${getSourceDisplayTitle(source, artifact.label)} preview image` : undefined,
      source_media_url: sourceMedia.mediaUrl || undefined,
      source_media_type: sourceMedia.mediaType || undefined,
      ...(embedStatus === 'unavailable' ? { embed_status: 'unavailable' } : {}),
    }
  }))

  const edition = {
    edition_id: editionId,
    date: options.date,
    status: options.publish ? 'approved' : 'review',
    slug,
    title: payload.edition_title,
    scene_family: payload.scene_family,
    brief_id: `brief-${editionId}`,
    plate_id: `plate-${editionId}`,
    artifact_map_id: `map-${editionId}`,
    source_binding_set_id: `bindings-${editionId}`,
    ambiance_recipe_id: `ambiance-${editionId}`,
    review_state_id: `review-${editionId}`,
    publish_state: {
      is_live: Boolean(options.publish),
      published_at: options.publish ? new Date().toISOString() : null,
      archive_path: `/archive/${slug}`,
    },
    plate_asset_path: `/editions/${editionId}/assets/plate.png`,
  }

  const brief = {
    brief_id: edition.brief_id,
    date: options.date,
    signal_cluster_ids: signalHarvest.notes_selected.slice(0, 8).map((note) => note.id),
    research_node_ids: researchField.sources.slice(0, 12).map((source, index) => `research-${index + 1}-${crypto.createHash('sha1').update(source.url).digest('hex').slice(0, 8)}`),
    mood: payload.mood,
    material_language: payload.material_language,
    lighting: payload.lighting,
    object_inventory: payload.object_inventory,
    interaction_grammar: {
      hero_count: 2,
      module_count: artifactMapArtifacts.length - 2,
      window_strategy: 'source-window',
    },
    negative_constraints: payload.negative_constraints,
  }

  const artifactMap = {
    artifact_map_id: edition.artifact_map_id,
    viewport: {
      base_width: 1536,
      base_height: 1024,
      aspect_ratio: '1536:1024',
    },
    default_cluster_id: payload.scene_family,
    default_artifact_id: artifactMapArtifacts[0]?.id,
    artifacts: artifactMapArtifacts,
  }

  const sourceBindings = {
    source_binding_set_id: edition.source_binding_set_id,
    bindings,
  }

  const ambiance = {
    ambiance_recipe_id: edition.ambiance_recipe_id,
    motion_system: payload.ambiance.motion_system,
    color_drift: payload.ambiance.color_drift,
    glow_behavior: payload.ambiance.glow_behavior,
    audio_posture: payload.ambiance.audio_posture,
    webgl_mode: payload.ambiance.webgl_mode,
    research_inputs: brief.research_node_ids,
  }

  const review = {
    review_state_id: edition.review_state_id,
    geometry_status: 'pending',
    clickability_status: 'pending',
    behavior_status: 'pending',
    editorial_status: options.publish ? 'approved' : 'pending',
    notes: [
      `Generated by npm run daily:process at ${new Date().toISOString()}.`,
      `Run artifacts are stored at ${path.relative(root, runDir)}.`,
    ],
  }

  const about = buildAboutRecord({ root, editionId, payload: { ...payload, artifacts: eligibleArtifacts }, researchField, signalHarvest, analysis: packageAnalysis, runDir, maxContentItems })

  const packageFiles = {
    'edition.json': edition,
    'brief.json': brief,
    'artifact-map.json': artifactMap,
    'source-bindings.json': sourceBindings,
    'ambiance.json': ambiance,
    'review.json': review,
    'analysis.json': {
      ...packageAnalysis,
      analysis_id: `analysis-${editionId}`,
      edition_id: editionId,
    },
    'about.json': about,
  }

  for (const [fileName, value] of Object.entries(packageFiles)) {
    await writeJson(path.join(editionDir, fileName), value)
  }

  const manifestItem = {
    edition_id: editionId,
    date: options.date,
    slug,
    title: payload.edition_title,
    path: `/editions/${editionId}`,
    scene_family: payload.scene_family,
    motif_tags: payload.motif_tags,
    preview_asset_path: `/editions/${editionId}/assets/preview.png`,
    is_live: Boolean(options.publish),
  }

  const filtered = manifest.editions.filter((item) => item.edition_id !== editionId)
  if (options.publish) {
    for (const item of filtered) item.is_live = false
    manifest.current_edition_id = editionId
  }
  manifest.editions = [manifestItem, ...filtered]
  await writeJson(manifestPath, manifest)

  await writeJson(path.join(runDir, 'edition-package-summary.json'), {
    edition_id: editionId,
    slug,
    route: options.publish ? '/' : `/archive/${slug}`,
    edition_dir: editionDir,
    published: Boolean(options.publish),
    ...stepMeta,
  })

  return {
    editionId,
    slug,
    route: options.publish ? '/' : `/archive/${slug}`,
    editionDir,
    published: Boolean(options.publish),
  }
}
