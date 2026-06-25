import fs from 'node:fs/promises'
import path from 'node:path'

import { sanitizeSourceText } from './source-text.mjs'

const literalCopyRule = 'Do not reproduce logos, legible text, identifiable subjects, or page chrome from this source image.'

function cleanText(value, fallback = '') {
  return sanitizeSourceText(value, fallback, 280)
}

function textForCandidate(candidate) {
  return [
    candidate?.title,
    candidate?.caption,
    candidate?.visual_reason,
    candidate?.image_url,
    candidate?.page_url,
    candidate?.lineage,
  ].filter(Boolean).join(' ').toLowerCase()
}

function unique(values, fallback = []) {
  const result = []
  const seen = new Set()
  for (const value of values) {
    const clean = String(value || '').trim()
    if (!clean || seen.has(clean)) continue
    seen.add(clean)
    result.push(clean)
  }
  return result.length ? result : fallback
}

function paletteCues(text) {
  return unique([
    /(acid|neon|fluorescent|electric|lime|hot pink|cyan)/.test(text) ? 'acid / neon saturation' : '',
    /(black|shadow|charcoal|noir|dark|smoke)/.test(text) ? 'dark shadow pressure' : '',
    /(red|crimson|scarlet|blood)/.test(text) ? 'red heat accents' : '',
    /(blue|azure|cobalt|ultramarine)/.test(text) ? 'blue / cobalt field' : '',
    /(green|lime|verdant|garden)/.test(text) ? 'green field pressure' : '',
    /(yellow|gold|amber|sun)/.test(text) ? 'warm yellow / amber lift' : '',
    /(monochrome|black.?and.?white|grayscale|grey|gray)/.test(text) ? 'monochrome contrast' : '',
  ], ['source-derived dominant colors'])
}

function surfaceCues(text) {
  return unique([
    /(gloss|glare|flash|reflect|specular|chrome)/.test(text) ? 'gloss / flash glare' : '',
    /(scan|scanner|archive|grain|halftone|xerox|photocopy)/.test(text) ? 'scan grain / archive noise' : '',
    /(paper|poster|zine|magazine|sleeve|cover|print)/.test(text) ? 'printed paper / sleeve surface' : '',
    /(fabric|textile|cloth|denim|silk|wool|leather)/.test(text) ? 'textile or wearable material' : '',
    /(pixel|game|sprite|8-bit|16-bit|low-res)/.test(text) ? 'pixel / low-resolution texture' : '',
    /(film|video|vhs|still|thumbnail|frame)/.test(text) ? 'video still / compression bloom' : '',
  ], ['material surface visible enough to steer the plate'])
}

function compositionMoves(text) {
  return unique([
    /(diagonal|slash|tilt|angle)/.test(text) ? 'hard diagonal crop or seam' : '',
    /(torn|rip|fold|crease|edge|border|margin)/.test(text) ? 'torn or irregular edge behavior' : '',
    /(negative space|empty|blank|field|minimal|spare)/.test(text) ? 'large negative field with small source pressure marks' : '',
    /(macro|close.?up|detail|crop)/.test(text) ? 'macro crop that turns source detail into terrain' : '',
    /(grid|tile|contact sheet|array|sequence)/.test(text) ? 'tile or contact-sheet rhythm without becoming UI cards' : '',
    /(blur|motion|smear|gesture|hand|body)/.test(text) ? 'gestural smear or body-scale interruption' : '',
    /(frame|window|aperture|hole|portal)/.test(text) ? 'aperture framing that can hold source windows' : '',
  ], ['source image crop logic translated into source-bearing marks'])
}

function roleForIndex(index) {
  if (index === 0) return 'dominant plate seed'
  if (index === 1) return 'counter-move plate seed'
  if (index === 2) return 'surface cue plate seed'
  return 'supporting plate seed'
}

export function buildSourceImageFingerprints(selectedImageMaterial = [], { limit = 5 } = {}) {
  return (selectedImageMaterial || [])
    .filter((candidate) => candidate?.image_url)
    .slice(0, limit)
    .map((candidate, index) => {
      const text = textForCandidate(candidate)
      return {
        title: cleanText(candidate.title || candidate.caption || `Source image ${index + 1}`, `Source image ${index + 1}`),
        image_url: candidate.image_url,
        page_url: candidate.page_url || null,
        lineage: candidate.lineage || null,
        source_role: roleForIndex(index),
        visual_reason: cleanText(candidate.visual_reason || candidate.caption || '', ''),
        palette_cues: paletteCues(text).slice(0, 3),
        surface_cues: surfaceCues(text).slice(0, 3),
        composition_moves: compositionMoves(text).slice(0, 4),
        do_not_copy_literally: [literalCopyRule],
        score: candidate.score || null,
      }
    })
}

function escapeXml(value) {
  return String(value || '')
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
}

function rowForFingerprint(fingerprint, index) {
  const x = 32 + (index % 2) * 576
  const y = 72 + Math.floor(index / 2) * 300
  const title = escapeXml(fingerprint.title || `Source image ${index + 1}`)
  const role = escapeXml(fingerprint.source_role || roleForIndex(index))
  const imageUrl = escapeXml(fingerprint.image_url || '')
  const palette = escapeXml((fingerprint.palette_cues || []).join(' · '))
  const moves = escapeXml((fingerprint.composition_moves || []).join(' · '))
  return `
  <g transform="translate(${x} ${y})">
    <rect width="520" height="252" rx="18" fill="#121212" stroke="#3a3a3a"/>
    <image href="${imageUrl}" x="16" y="16" width="220" height="180" preserveAspectRatio="xMidYMid slice"/>
    <text x="256" y="36" fill="#f4f1e8" font-size="20" font-family="Arial, sans-serif" font-weight="700">${title}</text>
    <text x="256" y="66" fill="#aaa392" font-size="13" font-family="Arial, sans-serif">${role}</text>
    <text x="256" y="112" fill="#cfc7b6" font-size="14" font-family="Arial, sans-serif">palette: ${palette}</text>
    <text x="256" y="146" fill="#cfc7b6" font-size="14" font-family="Arial, sans-serif">moves: ${moves}</text>
  </g>`
}

export function buildSourceImageContactSheetSvg(fingerprints = []) {
  const rows = Math.max(1, Math.ceil((fingerprints || []).length / 2))
  const height = 104 + rows * 300
  return `<svg xmlns="http://www.w3.org/2000/svg" width="1184" height="${height}" viewBox="0 0 1184 ${height}">
  <rect width="1184" height="${height}" fill="#070707"/>
  <text x="32" y="40" fill="#f4f1e8" font-size="24" font-family="Arial, sans-serif" font-weight="700">Source image plate seeds</text>
  ${(fingerprints || []).map(rowForFingerprint).join('\n')}
</svg>
`
}

export async function writeSourceImageArtifacts(runDir, selectedImageMaterial = []) {
  const fingerprints = buildSourceImageFingerprints(selectedImageMaterial)
  const fingerprintPath = path.join(runDir, 'source-image-fingerprints.json')
  const contactSheetPath = path.join(runDir, 'source-image-contact-sheet.svg')
  await fs.writeFile(fingerprintPath, `${JSON.stringify({ generated_at: new Date().toISOString(), fingerprints }, null, 2)}\n`, 'utf8')
  if (fingerprints.length) {
    await fs.writeFile(contactSheetPath, buildSourceImageContactSheetSvg(fingerprints), 'utf8')
  }
  return {
    source_image_fingerprints: fingerprints,
    source_image_fingerprints_path: fingerprintPath,
    source_image_contact_sheet_path: fingerprints.length ? contactSheetPath : null,
  }
}
