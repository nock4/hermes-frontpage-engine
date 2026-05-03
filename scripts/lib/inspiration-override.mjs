import fs from 'node:fs/promises'
import path from 'node:path'

const supportedImageExtensions = new Map([
  ['.jpg', 'image/jpeg'],
  ['.jpeg', 'image/jpeg'],
  ['.png', 'image/png'],
  ['.webp', 'image/webp'],
  ['.gif', 'image/gif'],
])

function resolveMaybeRelative(baseDir, value) {
  if (typeof value !== 'string' || !value.trim()) return null
  return path.isAbsolute(value) ? value : path.resolve(baseDir, value)
}

function normalizeString(value) {
  if (typeof value !== 'string') return null
  const trimmed = value.trim()
  return trimmed || null
}

function normalizeStringArray(value) {
  if (!Array.isArray(value)) return []
  return value
    .map((entry) => normalizeString(entry))
    .filter(Boolean)
}

function mimeTypeForImagePath(imagePath) {
  return supportedImageExtensions.get(path.extname(String(imagePath || '')).toLowerCase()) || 'application/octet-stream'
}

async function imagePathToDataUrl(imagePath) {
  const bytes = await fs.readFile(imagePath)
  return `data:${mimeTypeForImagePath(imagePath)};base64,${bytes.toString('base64')}`
}

function buildSelectionReason(override) {
  const biasTerms = override.prompt_bias_terms.length
    ? ` Bias terms: ${override.prompt_bias_terms.join(', ')}.`
    : ''
  return `Use this temporary inspiration override as the strongest visual cue while still researching from the normal saved-signal field.${biasTerms}`
}

export async function loadInspirationOverride({ overridePath, cwd = process.cwd(), date = null } = {}) {
  if (!overridePath) return null
  const resolvedPath = resolveMaybeRelative(cwd, overridePath)
  let raw
  try {
    raw = JSON.parse(await fs.readFile(resolvedPath, 'utf8'))
  } catch (error) {
    if (error?.code === 'ENOENT') return null
    throw error
  }
  if (raw.active === false) return null
  if (date && normalizeString(raw.expires_on) && raw.expires_on < date) return null

  const imagePath = resolveMaybeRelative(path.dirname(resolvedPath), raw.image_path)
  const imageUrl = normalizeString(raw.image_url)
  const imageDataUrl = normalizeString(raw.image_data_url) || (!imageUrl && imagePath ? await imagePathToDataUrl(imagePath) : null)

  if (!imageDataUrl && !imageUrl) {
    throw new Error(`Inspiration override requires image_path, image_url, or image_data_url: ${resolvedPath}`)
  }

  return {
    override_path: resolvedPath,
    title: normalizeString(raw.title) || 'Telegram inspiration override',
    note: normalizeString(raw.note) || '',
    source: normalizeString(raw.source) || 'manual-image-override',
    source_url: normalizeString(raw.source_url),
    received_at: normalizeString(raw.received_at),
    expires_on: normalizeString(raw.expires_on),
    image_path: imagePath,
    image_url: imageUrl,
    image_data_url: imageDataUrl || imageUrl,
    prompt_bias_terms: normalizeStringArray(raw.prompt_bias_terms),
    consume_after_success: raw.consume_after_success !== false,
    selection_reason: normalizeString(raw.selection_reason),
  }
}

export function annotateSignalHarvestWithInspirationOverride(signalHarvest, override) {
  if (!override) return signalHarvest
  return {
    ...signalHarvest,
    manual_inspiration_override: {
      title: override.title,
      note: override.note,
      image_path: override.image_path || null,
      source: override.source,
      source_url: override.source_url || null,
      prompt_bias_terms: override.prompt_bias_terms,
      consume_after_success: override.consume_after_success,
    },
  }
}

export function buildInspirationOverrideVisualReference(override, { fallback = null } = {}) {
  if (!override) return fallback || null
  return {
    ...fallback,
    title: override.title,
    description: override.note || fallback?.description || null,
    selection_reason: override.selection_reason || buildSelectionReason(override),
    url: override.source_url || fallback?.url || null,
    source_url: override.source_url || fallback?.source_url || fallback?.url || null,
    final_url: override.source_url || fallback?.final_url || fallback?.source_url || fallback?.url || null,
    image_url: override.image_data_url || override.image_url || fallback?.image_url || null,
    source_channel: 'manual-image-override',
    source_type: 'manual-inspiration-override',
    visual_reference_score: 999,
    is_temporary_override: true,
    prompt_bias_terms: override.prompt_bias_terms,
  }
}

export async function consumeInspirationOverride(override, {
  status = 'consumed',
  consumedAt = new Date().toISOString(),
} = {}) {
  if (!override?.override_path || !override.consume_after_success) return
  const raw = JSON.parse(await fs.readFile(override.override_path, 'utf8'))
  raw.active = false
  raw.last_status = status
  raw.last_consumed_at = consumedAt
  await fs.writeFile(override.override_path, `${JSON.stringify(raw, null, 2)}\n`, 'utf8')
}
