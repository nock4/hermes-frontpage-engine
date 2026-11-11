// Assemble: turn a source, brief, plate and map into the edition package the
// viewer already reads. Returns files in memory (store key -> Buffer); nothing
// here touches disk, git or the network.

import crypto from 'node:crypto'
import sharp from 'sharp'

import { expansionLabel, safeOrigin } from '../../scripts/lib/edition-geometry.mjs'
import { sanitizeSourceText } from '../../shared/source-text.js'
import { generateEnhancementPlan } from '../../src/lib/generateEnhancementPlan.ts'
import { generateInterpretation } from '../../src/lib/generateInterpretation.ts'
import { slugify } from '../../scripts/lib/string-utils.mjs'
import { chooseAboutTypography } from './typography.mjs'

const json = (value) => Buffer.from(`${JSON.stringify(value, null, 2)}\n`, 'utf8')

function nextVersion(existingIds, date, slugBase) {
  const prefix = `${date}-${slugBase}-v`
  const versions = [...existingIds].filter((id) => id.startsWith(prefix)).map((id) => Number(id.slice(prefix.length))).filter(Number.isInteger)
  return versions.length ? Math.max(...versions) + 1 : 1
}

function firstSentences(value, limit = 320) {
  const cleaned = sanitizeSourceText(value, '', 900)
  const sentences = cleaned.match(/[^.!?]+[.!?]+/g)?.map((sentence) => sentence.trim()) || []
  const summary = sentences.length ? sentences.slice(0, 2).join(' ') : cleaned
  return summary.length > limit ? `${summary.slice(0, limit - 3).trim()}...` : summary
}

function maskSvg(polygon, width, height) {
  const points = polygon.map(([x, y]) => `${Number((x * width).toFixed(2))},${Number((y * height).toFixed(2))}`).join(' ')
  return Buffer.from(`<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${width} ${height}">\n  <polygon points="${points}" fill="white"/>\n</svg>\n`, 'utf8')
}

export async function assembleEdition({ date, goLiveAt, source, brief, plate, map, existingIds, builtAt = new Date().toISOString(), provenance = {} }) {
  const slug = `${brief.slug_base}-v${nextVersion(existingIds, date, brief.slug_base)}`
  const editionId = `${date}-${slug}`
  const base = `/editions/${editionId}`
  const dimensions = { width: plate.width, height: plate.height }
  const object = map.object
  const artifactId = `hero-${slugify(object.label).slice(0, 36) || 'artifact-1'}`
  const bindingId = `binding-${artifactId}`
  const domain = new URL(source.url).hostname.replace(/^www\./, '')
  const excerpt = sanitizeSourceText(source.text, source.title, 360)
  const notes = [...(map.notes || []), ...(provenance.notes || [])]

  const edition = {
    edition_id: editionId,
    date,
    status: 'approved',
    slug,
    title: brief.edition_title,
    scene_family: brief.scene_family,
    brief_id: `brief-${editionId}`,
    plate_id: `plate-${editionId}`,
    artifact_map_id: `map-${editionId}`,
    source_binding_set_id: `bindings-${editionId}`,
    ambiance_recipe_id: `ambiance-${editionId}`,
    review_state_id: `review-${editionId}`,
    publish_state: { is_live: true, published_at: goLiveAt, archive_path: `/archive/${slug}` },
    plate_asset_path: `${base}/assets/plate.png`,
  }

  const researchId = `research-1-${crypto.createHash('sha1').update(source.url).digest('hex').slice(0, 8)}`
  const briefRecord = {
    brief_id: edition.brief_id,
    date,
    signal_cluster_ids: [crypto.createHash('sha256').update(source.key).digest('hex').slice(0, 12)],
    research_node_ids: [researchId],
    mood: brief.mood,
    material_language: brief.material_language,
    lighting: brief.lighting,
    object_inventory: [brief.anchor.label],
    interaction_grammar: { hero_count: 1, module_count: 0, window_strategy: 'source-window' },
    negative_constraints: brief.negative_constraints,
  }

  const artifact = {
    id: artifactId,
    kind: 'hero',
    label: object.label,
    artifact_type: object.artifact_type,
    bounds: object.bounds,
    z_index: 10,
    polygon: object.polygon,
    cluster_id: brief.scene_family,
    mask_path: `${base}/assets/masks/${artifactId}.svg`,
    source_binding_ids: [bindingId],
    geometry: {
      safe_hover_origin_px: safeOrigin(object.bounds, 'hover', dimensions),
      safe_stage_window_origin_px: safeOrigin(object.bounds, 'stage', dimensions),
      preferred_expansion_label: expansionLabel(object.bounds),
    },
  }
  const artifactMap = {
    artifact_map_id: edition.artifact_map_id,
    viewport: { base_width: plate.width, base_height: plate.height, aspect_ratio: `${plate.width}:${plate.height}` },
    default_cluster_id: brief.scene_family,
    default_artifact_id: artifactId,
    artifacts: [artifact],
  }

  const posterPath = `${base}/assets/source-posters/${bindingId}.jpg`
  const sourceBindings = {
    source_binding_set_id: edition.source_binding_set_id,
    bindings: [{
      id: bindingId,
      artifact_id: artifactId,
      source_type: 'tweet',
      source_url: source.url,
      window_type: 'social',
      hover_behavior: 'preview',
      click_behavior: 'pin-open',
      playback_persistence: true,
      fallback_type: 'rich-preview',
      title: source.title,
      kicker: domain,
      excerpt,
      source_title: source.title,
      source_summary: excerpt,
      source_domain: domain,
      source_meta: source.title,
      source_image_url: source.image.url,
      source_image_aliases: [source.image.url],
      source_image_alt: source.title,
      source_media_url: source.image.url,
      source_media_type: 'image',
      source_visual: {
        poster_asset_path: posterPath,
        render_mode: 'contain',
        crop_risk: 'low',
        image_width: source.image.width,
        image_height: source.image.height,
      },
    }],
  }

  const ambiance = { ambiance_recipe_id: edition.ambiance_recipe_id, ...brief.ambiance, research_inputs: [researchId] }
  const review = {
    review_state_id: edition.review_state_id,
    geometry_status: 'pending',
    clickability_status: 'pending',
    behavior_status: 'pending',
    editorial_status: 'approved',
    notes: [`Built by the press at ${builtAt}.`, ...notes],
  }
  const analysis = {
    analysis_id: `analysis-${editionId}`,
    edition_id: editionId,
    inspection_mode: map.inspection_mode,
    inspection_error: null,
    scene_summary: map.scene_summary || brief.scene_prompt,
    usable_surfaces: map.usable_surfaces,
    detected_objects: [object],
    viewport: artifactMap.viewport,
  }
  const about = {
    about_id: `about-${editionId}`,
    label: 'About',
    title: `About ${brief.edition_title}`,
    short_blurb: 'A daily generated front page where the image is the interface.',
    body: [
      'Daily Frontpage is a daily generated interactive front page. Each edition starts from a saved source, becomes a new image-led scene, and stays explorable in the archive. The image is the interface: a visible mark in the scene opens the real source that shaped the day.',
      [
        `This edition began with one saved post, ${source.title}.`,
        `Its image from ${new URL(source.image.url).hostname} set the palette, contrast, edge behavior, and gesture.`,
        `The scene became ${brief.edition_title}: ${firstSentences(brief.scene_prompt)}`,
        map.inspection_mode === 'vision'
          ? `After the image was made, a plate-reading pass mapped the source to ${object.label}.`
          : 'After the image was made, the plate-reading pass could not isolate a mark, so the whole plate opens the source.',
      ].join(' '),
    ],
    typography: chooseAboutTypography({ ...brief, object_inventory: [brief.anchor.label] }),
  }

  const interpretation = generateInterpretation({ edition, brief: briefRecord, artifactMap, sourceBindings, motifTags: brief.motif_tags, analysis, plateReadTimestamp: builtAt })
  const enhancementPlan = generateEnhancementPlan({ editionId, interpretation, brief: briefRecord, artifactMap, sourceBindings, analysisId: interpretation.analysis_id })

  const preview = await sharp(plate.png).resize({ width: 768 }).png().toBuffer()
  const poster = await sharp(source.image.jpeg).jpeg({ quality: 86 }).toBuffer()

  const key = (name) => `editions/${editionId}/${name}`
  const files = new Map([
    [key('edition.json'), json(edition)],
    [key('brief.json'), json(briefRecord)],
    [key('artifact-map.json'), json(artifactMap)],
    [key('source-bindings.json'), json(sourceBindings)],
    [key('ambiance.json'), json(ambiance)],
    [key('review.json'), json(review)],
    [key('analysis.json'), json(analysis)],
    [key('about.json'), json(about)],
    [key('effects.json'), json({ schema_version: 1, edition_id: editionId, effects: [] })],
    [key('interpretation.json'), json(interpretation)],
    [key('enhancement-plan.json'), json(enhancementPlan)],
    [key('press.json'), json({ built_at: builtAt, go_live_at: goLiveAt, source_key: source.key, source_url: source.url, image_prompt: plate.prompt || null, model_calls: provenance.calls || [], notes })],
    [key('assets/plate.png'), plate.png],
    [key('assets/preview.png'), preview],
    [key(`assets/masks/${artifactId}.svg`), maskSvg(object.polygon, plate.width, plate.height)],
    [key(`assets/source-posters/${bindingId}.jpg`), poster],
  ])

  const manifestItem = {
    edition_id: editionId,
    date,
    slug,
    title: brief.edition_title,
    path: base,
    scene_family: brief.scene_family,
    motif_tags: brief.motif_tags,
    preview_asset_path: `${base}/assets/preview.png`,
    is_live: false,
  }
  return { editionId, slug, files, manifestItem, notes }
}
