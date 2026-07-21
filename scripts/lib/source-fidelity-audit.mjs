import { spawn } from 'node:child_process'
import fs from 'node:fs/promises'
import path from 'node:path'

import { openAiJson } from './openai-json.mjs'

function normalizeNumber(value, fallback = 0) {
  const number = Number(value)
  if (!Number.isFinite(number)) return fallback
  return Math.max(0, Math.min(1, number))
}

function normalizeStringArray(value) {
  return Array.isArray(value)
    ? value.map((entry) => String(entry || '').trim()).filter(Boolean).slice(0, 12)
    : []
}

function sourceImageFingerprint(payload) {
  const fingerprints = Array.isArray(payload?.source_image_fingerprints) ? payload.source_image_fingerprints : []
  return fingerprints.find((fingerprint) => fingerprint?.image_url) || null
}

function pythonSourceFidelityScript() {
  return String.raw`
import sys, urllib.request
from PIL import Image, ImageDraw, ImageFont

source_url, plate_path, output_path = sys.argv[1:4]

def open_source(url):
    if url.startswith('file://'):
        return Image.open(urllib.request.url2pathname(url[7:])).convert('RGB')
    if url.startswith('/'):
        return Image.open(url).convert('RGB')
    req = urllib.request.Request(url, headers={
        'User-Agent': 'Mozilla/5.0 (compatible; Hermes/1.0; +https://hermes.local)',
        'Accept': 'image/avif,image/webp,image/png,image/jpeg,image/*,*/*;q=0.5',
    })
    with urllib.request.urlopen(req, timeout=20) as response:
        return Image.open(response).convert('RGB')

def fit(image, max_w, max_h):
    image.thumbnail((max_w, max_h), Image.LANCZOS)
    return image

source = fit(open_source(source_url), 860, 860)
plate = fit(Image.open(plate_path).convert('RGB'), 860, 860)
label_h = 46
gap = 28
w = source.width + gap + plate.width
h = label_h + max(source.height, plate.height)
sheet = Image.new('RGB', (w, h), (245, 245, 242))
draw = ImageDraw.Draw(sheet)
try:
    font = ImageFont.truetype('/System/Library/Fonts/Supplemental/Arial.ttf', 22)
except Exception:
    font = ImageFont.load_default()
draw.text((12, 12), 'LEFT: SOURCE MATERIAL', fill=(20, 20, 20), font=font)
draw.text((source.width + gap + 12, 12), 'RIGHT: GENERATED PLATE', fill=(20, 20, 20), font=font)
sheet.paste(source, (0, label_h))
sheet.paste(plate, (source.width + gap, label_h))
sheet.save(output_path)
print(output_path)
`
}

async function createSourcePlateContactSheet({ sourceImageUrl, platePath, outputPath, runCommand = null }) {
  await fs.mkdir(path.dirname(outputPath), { recursive: true })
  const script = pythonSourceFidelityScript()
  const command = process.env.FRONT_PAGE_PYTHON || 'python3'
  if (runCommand) {
    await runCommand({ command, script, args: [sourceImageUrl, platePath, outputPath] })
    return outputPath
  }
  return new Promise((resolve, reject) => {
    const child = spawn(command, ['-c', script, sourceImageUrl, platePath, outputPath], {
      cwd: process.cwd(),
      env: { ...process.env },
      stdio: ['ignore', 'pipe', 'pipe'],
    })
    let stderr = ''
    child.stderr.on('data', (chunk) => { stderr += chunk.toString() })
    child.on('error', reject)
    child.on('close', (code) => {
      if (code !== 0) {
        reject(new Error((stderr || `${command} exited ${code}`).trim()))
        return
      }
      resolve(outputPath)
    })
  })
}

function normalizeFidelityAudit(raw, { sourceImageUrl, contactSheetPath }) {
  const verdict = ['pass', 'warn', 'fail'].includes(String(raw?.verdict || '').toLowerCase())
    ? String(raw.verdict).toLowerCase()
    : 'fail'
  const normalized = {
    audit_id: `source-fidelity-${Date.now()}`,
    inspection_mode: 'vision-source-plate-contact-sheet',
    source_image_url: sourceImageUrl,
    contact_sheet_path: contactSheetPath,
    verdict,
    resemblance_score: normalizeNumber(raw?.resemblance_score, 0),
    framing_score: normalizeNumber(raw?.framing_score, 0),
    object_relationship_score: normalizeNumber(raw?.object_relationship_score, 0),
    context_score: normalizeNumber(raw?.context_score, 0),
    retained_critical_elements: normalizeStringArray(raw?.retained_critical_elements),
    missing_critical_elements: normalizeStringArray(raw?.missing_critical_elements),
    drift_risks: normalizeStringArray(raw?.drift_risks),
    rationale: String(raw?.rationale || '').trim(),
  }

  const blockers = []
  if (normalized.verdict === 'fail') blockers.push('vision verdict failed')
  if (normalized.resemblance_score < 0.62) blockers.push(`resemblance_score ${normalized.resemblance_score} < 0.62`)
  if (normalized.framing_score < 0.55) blockers.push(`framing_score ${normalized.framing_score} < 0.55`)
  if (normalized.object_relationship_score < 0.55) blockers.push(`object_relationship_score ${normalized.object_relationship_score} < 0.55`)
  if (normalized.context_score < 0.45 && normalized.missing_critical_elements.length >= 2) blockers.push('lost source context and multiple critical elements')
  return {
    ...normalized,
    pass: blockers.length === 0,
    blockers,
  }
}

export async function auditSourceImageFidelity(
  { payload, platePath, apiKey, model },
  runDir,
  { writeJson, openAiJsonImpl = openAiJson, createContactSheetImpl = createSourcePlateContactSheet } = {},
) {
  const fingerprint = sourceImageFingerprint(payload)
  const auditPath = path.join(runDir, 'source-fidelity-audit.json')
  if (!fingerprint?.image_url) {
    const skipped = {
      audit_id: `source-fidelity-${Date.now()}`,
      inspection_mode: 'skipped-no-source-image',
      pass: true,
      verdict: 'pass',
      blockers: [],
      rationale: 'No source_image_fingerprints image_url was present; no source-image fidelity gate was applicable.',
    }
    await writeJson(auditPath, skipped)
    return skipped
  }

  const contactSheetPath = path.join(runDir, 'source-plate-contact-sheet.png')
  try {
    await createContactSheetImpl({
      sourceImageUrl: fingerprint.image_url,
      platePath,
      outputPath: contactSheetPath,
    })
  } catch (error) {
    const failed = {
      audit_id: `source-fidelity-${Date.now()}`,
      inspection_mode: 'contact-sheet-error',
      pass: false,
      verdict: 'fail',
      source_image_url: fingerprint.image_url,
      contact_sheet_path: contactSheetPath,
      blockers: [`could not build source/plate contact sheet: ${error.message}`],
      rationale: 'Source-image fidelity cannot be verified without the source/plate contact sheet.',
    }
    await writeJson(auditPath, failed)
    throw new Error(`Source-image fidelity QA failed: ${failed.blockers.join('; ')}`)
  }

  const prompt = {
    task: 'Compare the LEFT source material image with the RIGHT generated plate. Judge whether the generated plate preserves the source-image composition strongly enough for publication.',
    rules: [
      'This is not a generic style-similarity check. The generated plate may be painterly or abstracted, but it must keep the source framing, camera distance, major object positions, object/figure relationships, and spatial context when a source image is attached.',
      'Treat over-cropping, macro texture replacement, lost room/background context, or replacement with an unrelated metaphor scene as blockers.',
      'A pass requires the right image to visibly read as a transformed edition of the left image, not merely share colors or one object.',
      'Be adversarial: if a human editor would say the source material looks nothing like the plate, return fail.',
    ],
    source_title: fingerprint.title,
    source_image_url: fingerprint.image_url,
    expected_preserve_cues: fingerprint.preserve_cues || [],
    expected_composition_moves: fingerprint.composition_moves || [],
    output_shape: {
      verdict: 'pass|warn|fail',
      resemblance_score: 0.0,
      framing_score: 0.0,
      object_relationship_score: 0.0,
      context_score: 0.0,
      retained_critical_elements: ['short phrases'],
      missing_critical_elements: ['short phrases'],
      drift_risks: ['short phrases'],
      rationale: 'short editorial reason',
    },
  }

  let raw
  try {
    raw = await openAiJsonImpl({
      apiKey,
      model,
      instructions: 'You are an adversarial visual QA editor for an image-led Daily Frontpage plate. Return JSON only.',
      input: [
        {
          role: 'user',
          content: [
            { type: 'input_text', text: JSON.stringify(prompt) },
            { type: 'input_image', image_url: `file://${path.resolve(contactSheetPath)}` },
          ],
        },
      ],
      maxOutputTokens: 2200,
    })
  } catch (error) {
    const failed = {
      audit_id: `source-fidelity-${Date.now()}`,
      inspection_mode: 'vision-error',
      pass: false,
      verdict: 'fail',
      source_image_url: fingerprint.image_url,
      contact_sheet_path: contactSheetPath,
      blockers: [`vision source-fidelity audit failed: ${error.message}`],
      rationale: 'Source-image fidelity cannot be verified because the vision QA pass failed.',
    }
    await writeJson(auditPath, failed)
    throw new Error(`Source-image fidelity QA failed: ${failed.blockers.join('; ')}`)
  }

  const normalized = normalizeFidelityAudit(raw, {
    sourceImageUrl: fingerprint.image_url,
    contactSheetPath: path.relative(process.cwd(), contactSheetPath),
  })
  await writeJson(auditPath, normalized)
  if (!normalized.pass) {
    throw new Error(`Source-image fidelity QA failed: ${normalized.blockers.join('; ')}`)
  }
  return normalized
}
