import fs from 'node:fs/promises'
import path from 'node:path'

import { clamp01, rectPolygon } from './edition-geometry.mjs'
import { openAiJson } from './openai-json.mjs'
import { slugify } from './string-utils.mjs'

export async function inspectGeneratedPlate(
  { payload, platePath, apiKey, model },
  runDir,
  { writeJson, minContentItems, maxContentItems },
) {
  const base64 = await fs.readFile(platePath, 'base64')
  const prompt = {
    task: 'Inspect this generated daily-frontpage scene plate and identify real visible source-bearing marks, gestures, and surfaces for interaction mapping.',
    rules: [
      'Use only visual features actually visible in the image.',
      'Treat planned_artifacts as a checklist: map each planned source artifact when its label, mark, slit, seam, pinhole cluster, glow, gesture, scar, fleck, stain, void, edge tear, or physical anchor is visible.',
      'Return normalized bounds where x, y, w, h are each between 0 and 1.',
      'For each source-bearing feature, return a normalized polygon with 5 to 18 points that follows the visible contour, edge, or mark outline as closely as possible.',
      'The polygon points must use full-image normalized coordinates, not coordinates relative to the bounds.',
      'Do not return a broad rectangle around a general area. If the visible target is text, a seam, a slit, a fleck, a stain, a scratch, a void, or a tiny light, make the bounds and polygon tightly hug that visible feature.',
      'Do not return a rectangle polygon unless the visible target itself is actually rectangular, and never use generic quadrant fallback geometry.',
      'Do not duplicate one visible feature for multiple planned artifacts unless there are distinct repeated marks for those artifacts.',
      'Prefer visible anchors: pigment-like islands, line breaks, bright flecks, torn edges, dense knots, scratches, pools, voids, marks, cuts, apertures, labels, slits, stains, edge details, small lights, and dominant gestures.',
      'Do not select empty space or arbitrary quadrants.',
      `Return ${minContentItems} to ${maxContentItems} useful artifacts when visible.`,
      'Also judge whether the plate is minimal and expressionist or too visually cluttered.',
    ],
    planned_artifacts: payload.artifacts,
    output_shape: {
      scene_summary: 'string',
      usable_surfaces: ['short surface phrases'],
      detected_objects: [
        {
          label: 'visible source-bearing mark label',
          artifact_type: 'kebab-case mark/gesture/surface type',
          role: 'hero-anchor|source-pocket|label-surface|media-surface|gesture-mark|edge-mark|void-mark|light-mark',
          bounds: { x: 0, y: 0, w: 0, h: 0 },
          polygon: [[0, 0], [0, 0], [0, 0]],
          confidence: 0.0,
          visual_evidence: 'what visible mark, edge, gesture, or surface supports this target',
        },
      ],
      complexity_assessment: {
        status: 'minimal|watch|too-complex',
        dominant_form_count: 0,
        large_region_count: 0,
        mapped_region_coverage: 0.0,
        rationale: 'short visual reason',
      },
    },
  }

  let analysis
  try {
    analysis = await openAiJson({
      apiKey,
      model,
      instructions: 'You are a vision QA pass for an image-led interactive artwork. Return JSON only.',
      input: [
        {
          role: 'user',
          content: [
            { type: 'input_text', text: JSON.stringify(prompt) },
            { type: 'input_image', image_url: `data:image/png;base64,${base64}` },
          ],
        },
      ],
      maxOutputTokens: 7000,
    })
  } catch (error) {
    console.warn(`OpenAI plate inspection failed; using planned artifact geometry fallback. ${error.message}`)
    analysis = fallbackPlateAnalysis(payload, error.message)
  }

  const normalized = normalizePlateAnalysis(analysis, payload, { maxContentItems })
  await writeJson(path.join(runDir, 'plate-analysis.json'), normalized)
  return normalized
}

function fallbackPlateAnalysis(payload, errorMessage = '') {
  const layout = fallbackBounds()
  return {
    inspection_mode: 'planned-artifact-fallback',
    inspection_error: errorMessage,
    scene_summary: payload.scene_prompt,
    usable_surfaces: payload.material_language,
    detected_objects: payload.artifacts.map((artifact, index) => ({
      label: artifact.label,
      artifact_type: artifact.artifact_type,
      role: index < 2 ? 'hero-anchor' : 'gesture-mark',
      bounds: layout[index],
      polygon: rectPolygon(layout[index]),
      confidence: 0.55,
      visual_evidence: 'Planned source-bearing mark from the scene brief.',
    })),
    complexity_assessment: {
      status: 'watch',
      dominant_form_count: 3,
      large_region_count: 3,
      mapped_region_coverage: 0.4,
      rationale: 'Fallback geometry cannot verify the plate complexity directly.',
    },
  }
}

function fallbackBounds() {
  return [
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
}

function normalizePlateAnalysis(analysis, payload, { maxContentItems }) {
  const fallback = fallbackPlateAnalysis(payload)
  const objects = Array.isArray(analysis.detected_objects) ? analysis.detected_objects : []
  const normalized = objects
    .map((object, index) => normalizeDetectedObject(object, index))
    .filter(Boolean)
    .slice(0, maxContentItems)

  if (fallback.inspection_mode === analysis.inspection_mode || normalized.length === 0) {
    for (const object of fallback.detected_objects) {
      if (normalized.length >= maxContentItems) break
      normalized.push(object)
    }
  }

  const complexity = normalizeComplexityAssessment(analysis.complexity_assessment, normalized, { maxContentItems })

  return {
    analysis_id: `analysis-${Date.now()}`,
    inspection_mode: analysis.inspection_mode === 'planned-artifact-fallback' ? 'planned-artifact-fallback' : 'openai-vision',
    inspection_error: analysis.inspection_error || null,
    scene_summary: String(analysis.scene_summary || fallback.scene_summary),
    usable_surfaces: normalizeStringArray(analysis.usable_surfaces, fallback.usable_surfaces).slice(0, 12),
    detected_objects: normalized,
    complexity_assessment: complexity,
  }
}

function normalizeStringArray(value, fallback) {
  if (!Array.isArray(value)) return fallback
  const result = value.map((entry) => String(entry).trim()).filter(Boolean)
  return result.length ? result : fallback
}

function normalizeComplexityAssessment(value, detectedObjects, { maxContentItems }) {
  const objectCount = detectedObjects.length
  const areas = detectedObjects.map((object) => object.bounds.w * object.bounds.h)
  const largeRegionCount = areas.filter((area) => area >= 0.08).length
  const mappedRegionCoverage = Number(areas.reduce((sum, area) => sum + area, 0).toFixed(3))
  const dominantFormCount = Number.isFinite(Number(value?.dominant_form_count)) ? Number(value.dominant_form_count) : largeRegionCount
  const suppliedStatus = String(value?.status || '').toLowerCase()
  const dominantCountIsRestrained = dominantFormCount <= 3
  const inferredStatus = objectCount > maxContentItems || largeRegionCount > 5 || (largeRegionCount > 4 && !dominantCountIsRestrained)
    ? 'too-complex'
    : objectCount >= 9 && largeRegionCount > 4
      ? 'watch'
      : 'minimal'
  const severity = { minimal: 0, watch: 1, 'too-complex': 2 }
  const acceptedSuppliedStatus = ['minimal', 'watch', 'too-complex'].includes(suppliedStatus) ? suppliedStatus : null
  const status = acceptedSuppliedStatus && severity[acceptedSuppliedStatus] > severity[inferredStatus]
    ? acceptedSuppliedStatus
    : inferredStatus

  return {
    status,
    dominant_form_count: dominantFormCount,
    large_region_count: largeRegionCount,
    mapped_region_coverage: mappedRegionCoverage,
    rationale: String(value?.rationale || `Detected ${objectCount} anchors, ${largeRegionCount} large regions, and ${mappedRegionCoverage} mapped-region coverage.`),
  }
}

function normalizeDetectedObject(object, index) {
  const bounds = object?.bounds
  if (!bounds) return null
  const x = clamp01(Number(bounds.x))
  const y = clamp01(Number(bounds.y))
  const w = clamp01(Number(bounds.w))
  const h = clamp01(Number(bounds.h))
  if (w < 0.04 || h < 0.04) return null
  const normalizedBounds = { x, y, w: Math.min(w, 1 - x), h: Math.min(h, 1 - y) }
  const polygon = normalizeDetectedPolygon(object.polygon, normalizedBounds)
  return {
    label: String(object.label || `Visible Source Mark ${index + 1}`),
    artifact_type: slugify(object.artifact_type || 'source-mark'),
    role: String(object.role || 'source-pocket'),
    bounds: normalizedBounds,
    ...(polygon ? { polygon } : {}),
    confidence: Number.isFinite(Number(object.confidence)) ? Number(object.confidence) : 0.5,
    visual_evidence: String(object.visual_evidence || ''),
  }
}

function normalizeDetectedPolygon(value, bounds) {
  if (!Array.isArray(value)) return null
  const points = value
    .map((point) => {
      if (!Array.isArray(point) || point.length < 2) return null
      const x = Number(point[0])
      const y = Number(point[1])
      if (!Number.isFinite(x) || !Number.isFinite(y)) return null
      return [Number(clamp01(x).toFixed(4)), Number(clamp01(y).toFixed(4))]
    })
    .filter(Boolean)

  if (points.length < 3) return null

  const padding = Math.max(0.012, Math.max(bounds.w, bounds.h) * 0.16)
  const insideCount = points.filter(([px, py]) => (
    px >= bounds.x - padding
    && px <= bounds.x + bounds.w + padding
    && py >= bounds.y - padding
    && py <= bounds.y + bounds.h + padding
  )).length
  if (insideCount / points.length < 0.7) return null

  const area = normalizedPointPolygonArea(points)
  const boundsArea = bounds.w * bounds.h
  if (area < boundsArea * 0.08 || area > boundsArea * 2.4) return null

  return points
}

function normalizedPointPolygonArea(points) {
  if (!Array.isArray(points) || points.length < 3) return 0
  let acc = 0
  for (let index = 0; index < points.length; index += 1) {
    const [x1, y1] = points[index]
    const [x2, y2] = points[(index + 1) % points.length]
    acc += x1 * y2 - x2 * y1
  }
  return Math.abs(acc) * 0.5
}
