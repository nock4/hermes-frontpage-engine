import { spawn } from 'node:child_process'
import fs from 'node:fs/promises'
import fsSync from 'node:fs'
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

function resolveSourceFidelityPython() {
  const candidates = [
    process.env.FRONT_PAGE_PYTHON,
    process.env.PYTHON,
    '/Users/nickgeorge-studio/Projects/hermes/hermes-agent/venv/bin/python',
    '/Users/nickgeorge-studio/Projects/hermes/hermes-agent/.venv/bin/python',
  ].filter(Boolean)
  return candidates.find((candidate) => fsSync.existsSync(candidate)) || 'python3'
}

async function createSourcePlateContactSheet({ sourceImageUrl, platePath, outputPath, runCommand = null }) {
  await fs.mkdir(path.dirname(outputPath), { recursive: true })
  const script = pythonSourceFidelityScript()
  const command = resolveSourceFidelityPython()
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
    transformation_score: normalizeNumber(raw?.transformation_score, 1),
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
  if (normalized.transformation_score < 0.35) blockers.push(`transformation_score ${normalized.transformation_score} < 0.35`)
  const auditText = [
    ...normalized.missing_critical_elements,
    ...normalized.drift_risks,
    normalized.rationale,
  ].join(' ').toLowerCase()
  const blockerWarningPatterns = [
    {
      label: 'source crop/framing drift',
      pattern: /(crop|framing|camera distance|edge proportion|full[- ]?frame).{0,100}(lost source identity|unrecognizable|no longer reads as|nothing like|not the same source)|(?:unrecognizable|nothing like|not the same source).{0,100}(crop|framing|source|full[- ]?frame)/,
    },
    {
      label: 'square source composition drift',
      pattern: /square.{0,120}(lost source identity|unrecognizable|nothing like|not the same source)|(?:unrecognizable|nothing like|not the same source).{0,80}square/,
    },
    {
      label: 'major source relationship lost',
      pattern: /(major object|object relationship|figure relationship|spatial relationship|source structure|composition|layout|massing).{0,100}(missing|lost|absent|reduced|weakened|flattened|shifted|changed|not preserved)/,
    },
    {
      label: 'defining light structure lost',
      pattern: /(vertical light shafts?|vertical shafts?|light columns?|flare spines?|starbursts?|glint lines?|flare nodes?|horizontal beam).{0,100}(missing|lost|absent|reduced|weakened|flattened|shifted|changed|not preserved)/,
    },
    {
      label: 'source generalized into ambience',
      pattern: /(same palette|shared palette|related palette|related style|similar color|reads as related|ambience|atmosphere).{0,120}(not the same|not same source|rather than|instead of|loses|lost|missing|fails)/,
    },
    {
      label: 'source turned into framed panel/object',
      pattern: /(borderless|no-border|fills? the whole plate|whole plate|cover framing|image-led surface|source surface).{0,120}(frame|framed|panel|perimeter|surround|mat|border|wall|object in space)|(?:frame|framed|panel|perimeter|surround|mat|border|wall|object in space).{0,120}(borderless|source surface|whole plate)/,
    },
    {
      label: 'invented replacement scene',
      pattern: /(invented|unrelated|replacement|metaphor).{0,100}(scene|city|skyline|horizon|figure|character|deep space|macro texture)|(?:city|skyline|horizon|figure|character|deep space|macro texture).{0,100}(not present|invented|unrelated|replacement)/,
    },
    {
      label: 'anchor copied without edition transformation',
      pattern: /(copy|copied|near[- ]?copy|duplicate|reproduction|reproduces|direct transformed edition|same quiet blank field|same centered|same wordmark|same typographic|same still[- ]?life|same arrangement|same object positions|same composition|basically the source|almost identical|too close to the source).{0,180}(no added|without|only|same|close enough|publication|subtle|tiny|minor|not enough|insufficient)|(?:no added|without|only|tiny|minor|subtle|insufficient).{0,120}(source[- ]?window|aperture|cut|seam|interruption|edition[- ]?native|transformation|arrangement change)/,
    },
    {
      label: 'source image recreated instead of borrowed',
      pattern: /(same|identical|near[- ]?identical|almost identical|unchanged).{0,120}(arrangement|object positions|still[- ]?life|three[- ]?vase|camera distance|plinth|composition|layout)|(?:borrow|inspiration|inspired).{0,140}(not enough|insufficient|too literal|same image)/,
    },
  ]
  const passAuditText = [
    ...normalized.drift_risks,
    normalized.rationale,
  ].join(' ').toLowerCase()
  const blockerScopeText = normalized.verdict === 'pass'
    ? passAuditText
      .replace(/contact sheet (?:display|panel)[^.;]*[.;]?/g, ' ')
      .replace(/contact[- ]sheet aspect framing[^.;]*[.;]?/g, ' ')
      .replace(/minor[^.;]*[.;]?/g, ' ')
      .replace(/slight(?:ly)?[^.;]*[.;]?/g, ' ')
      .replace(/no [^.;]*(?:replacement|metaphor|scene|context loss|blocks publication)[^.;]*[.;]?/g, ' preserved ')
      .replace(/not replaced/g, 'preserved')
      .replace(/rather than replaced[^.;]*/g, 'preserved')
      .replace(/does not replace/g, 'preserves')
      .replace(/do not replace/g, 'preserve')
    : auditText
  for (const { label, pattern } of blockerWarningPatterns) {
    if (pattern.test(blockerScopeText) && !blockers.includes(label)) blockers.push(label)
  }
  if (normalized.verdict === 'warn' && normalized.missing_critical_elements.length >= 2) {
    blockers.push('warning lists multiple missing critical source elements')
  }
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
      inspection_mode: 'skipped-no-valid-dominant-source-image',
      source_image_mode: payload?.source_image_mode || 'skipped-no-valid-dominant-source-image',
      gate_applicable: false,
      pass: true,
      editorial_pass: false,
      verdict: 'skipped',
      blockers: [],
      rationale: 'No valid dominant source_image_fingerprints image_url was present; source-image fidelity was not applicable and must be reported as skipped, not passed.',
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
    task: 'Compare the LEFT source material image with the RIGHT generated plate. Judge whether the generated plate borrows recognizable source elements while becoming a new Daily Frontpage plate, not a recreation of the same image.',
    rules: [
      'This is not a generic style-similarity check and not a copy-tolerance check. The generated plate may use the source image as inspiration, but it must not recreate the same photograph/product shot/still life with small marks added.',
      'A pass should borrow source identity: palette, silhouettes, motifs, material behavior, light, edge pressure, or a few object relationships. It should visibly change at least two of arrangement, scale, object count, crop, surface state, or spatial logic.',
      'Do not require exact crop, framing, camera distance, or object layout. Deliberate recomposition is good when the borrowed source identity remains legible.',
      'Treat crop/framing change as a blocker only when it makes the source identity unrecognizable or collapses the plate into unrelated ambience. Treat macro texture replacement, lost room/background context that destroys identity, or replacement with an unrelated metaphor scene as blockers.',
      'Treat warning-level language about lost light/object relationships, framed-panel conversion, or same-palette-not-same-source as blockers; return fail for those cases, not warn. Do not fail merely because the plate changed arrangement, scale, crop, surface state, or spatial logic.',
      'Also block overcopying: if the generated plate is basically the source image again — same still-life arrangement, same object count, same camera distance, same plinth/background, same central mark, or tiny decorative edits — return fail. Fidelity is necessary but a copy is not an edition.',
      'A pass requires the right image to visibly read as a source-inspired edition that borrowed elements from the left image, not the same image with seams or apertures pasted onto it.',
      'Be adversarial: if a human editor would say the source material looks nothing like the plate, return fail.',
      'Be equally adversarial if a human editor would say the plate generation looks identical to the source material; return fail for that too.',
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
      transformation_score: 0.0,
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
