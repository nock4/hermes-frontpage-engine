// The three model steps. Each asks once and accepts or rejects the answer with
// plain checks; a rejected answer is retried by the model layer.

import sharp from 'sharp'

import { clamp01, rectPolygon } from '../../scripts/lib/edition-geometry.mjs'
import { slugify } from '../../scripts/lib/string-utils.mjs'
import { briefRequest, imagePrompt, mapRequest } from './prompts.mjs'

const PLATE_SIZE = '1536x1024'
const WHOLE_PLATE_BOUNDS = { x: 0.1, y: 0.1, w: 0.8, h: 0.8 }

const text = (value, fallback = '') => {
  const result = typeof value === 'string' ? value.replace(/\s+/g, ' ').trim() : ''
  return result || fallback
}
const texts = (value, fallback = []) => {
  const result = (Array.isArray(value) ? value : []).map((entry) => text(entry)).filter(Boolean)
  return result.length ? result : fallback
}
const oneOf = (value, allowed, fallback) => (allowed.includes(value) ? value : fallback)

export class UnusableSource extends Error {}

export function acceptBrief(raw) {
  if (raw?.usable === false) throw Object.assign(new UnusableSource(text(raw.unusable_reason, 'model judged the image unusable')), { unusable: true })
  const read = raw?.source_read || {}
  const direction = raw?.visual_direction || {}
  const brief = {
    source_read: {
      visual_summary: text(read.visual_summary),
      palette_cues: texts(read.palette_cues),
      surface_cues: texts(read.surface_cues),
      preserve_cues: texts(read.preserve_cues),
      composition_moves: texts(read.composition_moves),
    },
    edition_title: text(raw?.edition_title).slice(0, 80),
    scene_family: slugify(text(raw?.scene_family, text(raw?.slug_base))).replace(/-v\d+$/, ''),
    slug_base: slugify(text(raw?.slug_base, text(raw?.edition_title))).replace(/-v\d+$/, ''),
    motif_tags: texts(raw?.motif_tags).map((tag) => slugify(tag)).slice(0, 8),
    mood: text(raw?.mood, text(raw?.scene_prompt)),
    material_language: texts(raw?.material_language, texts(read.surface_cues, ['source-led physical surfaces'])).slice(0, 6),
    lighting: text(raw?.lighting, 'source-led light'),
    negative_constraints: texts(raw?.negative_constraints, ['No text, labels, logos, URLs, controls, cards, target rings, pins or debug marks.']).slice(0, 6),
    ambiance: {
      motion_system: text(raw?.ambiance?.motion_system, 'Still by default; a brief local response at the anchor on interaction.'),
      color_drift: text(raw?.ambiance?.color_drift, 'None.'),
      glow_behavior: text(raw?.ambiance?.glow_behavior, 'None.'),
      audio_posture: oneOf(raw?.ambiance?.audio_posture, ['silent', 'ambient', 'reactive'], 'silent'),
      webgl_mode: oneOf(raw?.ambiance?.webgl_mode, ['none', 'particles', 'shader-scene'], 'none'),
    },
    visual_direction: {
      composition_archetype: text(direction.composition_archetype, 'source-led plate'),
      camera_plate_grammar: text(direction.camera_plate_grammar, 'evidence-derived camera grammar'),
      visual_compositional_moves: texts(direction.visual_compositional_moves, texts(read.composition_moves)).slice(0, 3),
      palette_profile: text(direction.palette_profile, texts(read.palette_cues).slice(0, 3).join('; ')),
    },
    scene_prompt: text(raw?.scene_prompt),
    anchor: {
      label: text(raw?.anchor?.label).slice(0, 80),
      artifact_type: slugify(text(raw?.anchor?.artifact_type, 'source-native-mark')),
      role: text(raw?.anchor?.role, 'The single large source-native feature.'),
    },
  }
  const missing = [
    ['edition_title', brief.edition_title], ['scene_prompt', brief.scene_prompt], ['source_read.visual_summary', brief.source_read.visual_summary],
    ['source_read.preserve_cues', brief.source_read.preserve_cues.length], ['anchor.label', brief.anchor.label], ['slug_base', brief.slug_base],
  ].filter(([, value]) => !value).map(([name]) => name)
  if (missing.length) throw new Error(`Brief is missing ${missing.join(', ')}`)
  if (!brief.motif_tags.length) brief.motif_tags = [brief.scene_family]
  return brief
}

export async function composeBrief({ models, date, source, recentEditions }) {
  const { system, user } = briefRequest({ date, source, recentEditions })
  return models.chatJson({
    step: 'brief', system, user,
    imageDataUrl: `data:image/jpeg;base64,${source.image.jpeg.toString('base64')}`,
    accept: acceptBrief,
  })
}

// A plate must decode fully and be landscape. Anything else is a failed attempt.
export async function acceptPlate(buffer) {
  let info
  let format
  try {
    // Decode every pixel: a plausible header is not proof of a readable image.
    ({ format } = await sharp(buffer).metadata());
    ({ info } = await sharp(buffer, { failOn: 'warning' }).raw().toBuffer({ resolveWithObject: true }))
  } catch {
    throw new Error('Plate could not be decoded')
  }
  if (!(info.width > info.height && info.height >= 512)) throw new Error(`Landscape plate required, got ${info.width}x${info.height}`)
  const png = format === 'png' ? buffer : await sharp(buffer).png().toBuffer()
  return { png, width: info.width, height: info.height }
}

export async function generatePlate({ models, brief, source }) {
  const prompt = imagePrompt({ brief, source })
  const plate = await models.generateImage({ step: 'plate', prompt, size: PLATE_SIZE, accept: acceptPlate })
  return { ...plate, prompt }
}

function polygonArea(points) {
  let total = 0
  for (let index = 0; index < points.length; index += 1) {
    const [x1, y1] = points[index]
    const [x2, y2] = points[(index + 1) % points.length]
    total += x1 * y2 - x2 * y1
  }
  return Math.abs(total) / 2
}

// Same acceptance the old plate analysis used: tight bounds, and a polygon that
// actually belongs to those bounds. A bad polygon degrades to the bounds box.
export function acceptMap(raw) {
  const object = raw?.detected_object || raw?.detected_objects?.[0]
  const b = object?.bounds
  if (!b) throw new Error('Map answer held no detected object')
  const x = clamp01(Number(b.x))
  const y = clamp01(Number(b.y))
  const bounds = { x, y, w: Math.min(clamp01(Number(b.w)), 1 - x), h: Math.min(clamp01(Number(b.h)), 1 - y) }
  if (!(bounds.w >= 0.04 && bounds.h >= 0.04)) throw new Error('Mapped region is too small to be a target')
  const round = (value) => Number(value.toFixed(4))
  for (const side of ['x', 'y', 'w', 'h']) bounds[side] = round(bounds[side])

  let polygon = (Array.isArray(object.polygon) ? object.polygon : [])
    .filter((point) => Array.isArray(point) && Number.isFinite(Number(point[0])) && Number.isFinite(Number(point[1])))
    .map(([px, py]) => [round(clamp01(Number(px))), round(clamp01(Number(py)))])
  const padding = Math.max(0.012, Math.max(bounds.w, bounds.h) * 0.16)
  const inside = polygon.filter(([px, py]) => px >= bounds.x - padding && px <= bounds.x + bounds.w + padding && py >= bounds.y - padding && py <= bounds.y + bounds.h + padding).length
  const area = polygon.length >= 3 ? polygonArea(polygon) : 0
  const boundsArea = bounds.w * bounds.h
  const polygonOk = polygon.length >= 3 && inside / polygon.length >= 0.7 && area >= boundsArea * 0.08 && area <= boundsArea * 2.4
  if (!polygonOk) polygon = rectPolygon(bounds)

  const quality = raw?.plate_quality || {}
  return {
    inspection_mode: 'vision',
    scene_summary: text(raw?.scene_summary),
    usable_surfaces: texts(raw?.usable_surfaces).slice(0, 12),
    object: {
      label: text(object.label, 'Visible source mark').slice(0, 80),
      artifact_type: slugify(text(object.artifact_type, 'source-native-mark')),
      role: 'hero-anchor',
      bounds,
      polygon,
      confidence: Number.isFinite(Number(object.confidence)) ? Number(object.confidence) : 0.5,
      visual_evidence: text(object.visual_evidence),
    },
    notes: [
      ...(polygonOk ? [] : ['Map polygon was unusable; the target uses its bounding box.']),
      ...(quality.status === 'weak' ? [`Art flagged weak by the map pass: ${text(quality.note, 'no reason given')}`] : []),
    ],
  }
}

// The page must still be clickable when mapping fails: one hotspot over the
// middle of the plate, and a note saying so.
function wholePlateMap({ brief, reason }) {
  return {
    inspection_mode: 'whole-plate-fallback',
    scene_summary: brief.scene_prompt,
    usable_surfaces: [],
    object: {
      label: brief.anchor.label,
      artifact_type: brief.anchor.artifact_type,
      role: 'hero-anchor',
      bounds: { ...WHOLE_PLATE_BOUNDS },
      polygon: rectPolygon(WHOLE_PLATE_BOUNDS),
      confidence: 0,
      visual_evidence: '',
    },
    notes: [`Mapping failed (${String(reason).slice(0, 160)}); the whole plate is one target.`],
  }
}

export async function mapPlate({ models, brief, plate }) {
  const { system, user } = mapRequest({ brief })
  try {
    return await models.chatJson({
      step: 'map', system, user,
      imageDataUrl: `data:image/png;base64,${plate.png.toString('base64')}`,
      accept: acceptMap,
    })
  } catch (error) {
    return wholePlateMap({ brief, reason: error.message })
  }
}
