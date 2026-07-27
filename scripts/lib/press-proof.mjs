export function extractLastPublishSummary(text) {
  const source = String(text || '')
  const marker = '{\n  "ok"'
  let searchFrom = source.length
  while (searchFrom > 0) {
    const start = source.lastIndexOf(marker, searchFrom - 1)
    if (start < 0) return null
    const parsed = parseJsonObjectAt(source, start)
    if (parsed) return parsed
    searchFrom = start
  }
  return null
}

function parseJsonObjectAt(text, start) {
  let depth = 0
  let inString = false
  let escaped = false
  for (let index = start; index < text.length; index += 1) {
    const char = text[index]
    if (inString) {
      if (escaped) escaped = false
      else if (char === '\\') escaped = true
      else if (char === '"') inString = false
      continue
    }
    if (char === '"') inString = true
    else if (char === '{') depth += 1
    else if (char === '}') {
      depth -= 1
      if (depth === 0) {
        try {
          return JSON.parse(text.slice(start, index + 1))
        } catch {
          return null
        }
      }
    }
  }
  return null
}

export function buildPublishProof({
  summary = {},
  liveProof = null,
  screenshotPath = null,
  qa = {},
  source = {},
  promptPath = null,
  generatedAt = new Date().toISOString(),
} = {}) {
  const expectedEditionId = summary.local_edition_id || liveProof?.expectedEditionId || null
  const proof = {
    schema_version: 1,
    generated_at: generatedAt,
    expected_edition_id: expectedEditionId,
    status: 'unknown',
    summary,
    live_proof: liveProof,
    screenshot_path: screenshotPath,
    prompt_path: promptPath,
    qa,
    source,
    blockers: [],
  }
  const checked = checkPressProof(proof)
  proof.blockers = checked.blockers
  proof.status = classifyPressState({ summary, proof })
  return proof
}

export function checkPressProof(proof = {}) {
  const blockers = []
  const summary = proof.summary || {}
  const liveProof = proof.live_proof || proof.liveProof || null
  const expectedEditionId = proof.expected_edition_id || summary.local_edition_id || liveProof?.expectedEditionId || null

  if (!summary.ok) blockers.push('daily:publish:cron summary is not ok')
  if (summary.local_publish_status && summary.local_publish_status !== 'live') blockers.push('local edition is not live')
  if (summary.remote_matches !== true) blockers.push('remote manifest does not match local edition')
  if (!expectedEditionId) blockers.push('expected edition id missing')
  if (!proof.screenshot_path) blockers.push('success screenshot missing')
  if (!proof.prompt_path) blockers.push('scene prompt proof missing')
  if (proof.qa?.qaPublishPassed !== true) blockers.push('qa:publish proof missing')
  if (proof.qa?.adversarialVisualQa && proof.qa.adversarialVisualQa !== 'pass') blockers.push('adversarial visual QA did not pass')

  if (!liveProof) {
    blockers.push('live preload proof missing')
  } else {
    if (!Number.isFinite(Number(liveProof.loadedPlateImageCount)) || Number(liveProof.loadedPlateImageCount) < 1) {
      blockers.push('loaded plate image proof missing')
    }
    const plateSrc = liveProof.plate?.src || ''
    const pageEditionId = liveProof.pageEditionId || null
    if (expectedEditionId && !plateSrc.includes(expectedEditionId) && pageEditionId !== expectedEditionId) {
      blockers.push('live plate does not match expected edition')
    }
    const naturalWidth = Number(liveProof.plate?.naturalWidth || 0)
    const naturalHeight = Number(liveProof.plate?.naturalHeight || 0)
    if (liveProof.plate && (naturalWidth <= 100 || naturalHeight <= 100)) {
      blockers.push('loaded plate image has implausible natural dimensions')
    }
  }

  return { green: blockers.length === 0, blockers }
}

export function buildPublishProofFromCronLog(text, options = {}) {
  const logText = String(text || '')
  const summary = extractLastPublishSummary(logText) || {}
  const liveProof = extractJsonAfterLabel(logText, 'Live preload proof:')
  const screenshotPath = extractValueAfterLabel(logText, 'Captured success screenshot:')
    || extractValueAfterLabel(logText, 'Screenshot:')
  const promptPath = extractValueAfterLabel(logText, 'Actual plate prompt:')
    || inferPromptPathFromRunDir(logText, summary)
  const qaPublishPassed = options.qaPublishPassed ?? /qa:publish[\s\S]*?\b10 passed\b|\bqa:publish\b[\s\S]*?Test Files\s+\d+ passed/i.test(logText)
  return buildPublishProof({
    summary,
    liveProof,
    screenshotPath,
    promptPath,
    qa: {
      qaPublishPassed,
      adversarialVisualQa: options.adversarialVisualQa || null,
    },
    source: {
      sourceImageMode: extractSourceImageMode(logText),
      sourceFidelityVerdict: extractSourceFidelityVerdict(logText),
    },
    generatedAt: options.generatedAt || new Date().toISOString(),
  })
}

function extractJsonAfterLabel(text, label) {
  const index = text.lastIndexOf(label)
  if (index < 0) return null
  const start = text.indexOf('{', index + label.length)
  if (start < 0) return null
  return parseJsonObjectAt(text, start)
}

function extractValueAfterLabel(text, label) {
  const index = text.lastIndexOf(label)
  if (index < 0) return null
  const line = text.slice(index + label.length).split(/\r?\n/, 1)[0].trim()
  return line || null
}

function extractSourceImageMode(text) {
  const match = text.match(/Source-image fidelity:\s*([^\n]+)/i)
  return match ? match[1].trim() : null
}

function inferPromptPathFromRunDir(text, summary = {}) {
  const explicit = summary.latest_run_dir
  if (explicit) return `${explicit.replace(/\/$/, '')}/scene-prompt.txt`
  const runDirMatch = text.match(/"runDir"\s*:\s*"(tmp\/daily-process-runs\/[^"]+)"/)
  if (!runDirMatch) return null
  const worktreeDir = summary.worktree_dir || null
  return worktreeDir ? `${worktreeDir.replace(/\/$/, '')}/${runDirMatch[1]}/scene-prompt.txt` : `${runDirMatch[1]}/scene-prompt.txt`
}

function extractSourceFidelityVerdict(text) {
  const match = text.match(/Source-image fidelity:\s*(pass|warn|fail|skipped)[^\n]*/i)
  return match ? match[1].toLowerCase() : null
}

export function classifyPressState({ summary = {}, proof = null } = {}) {
  if (proof) {
    const blockers = Array.isArray(proof.blockers) ? proof.blockers : checkPressProof(proof).blockers
    const publishSucceeded = summary.ok === true && summary.remote_matches === true && summary.local_publish_status === 'live'
    if (!blockers.length) return 'green'
    if (publishSucceeded && blockers.some((blocker) => /screenshot|preload|plate|prompt|visual QA|proof/i.test(blocker))) {
      return 'proof_failed_after_publish'
    }
  }

  if (summary.ok === true && summary.remote_matches === true) return 'green'
  const error = String(summary.error || '')
  if (/daily:process|source-fidelity|Generate AI scene plate|Mine source signals|Deep source autoresearch|daily process/i.test(error)) {
    return 'generation_failed'
  }
  if (/qa:publish|npm audit|validate:editions|test:ux|playwright|vitest|build/i.test(error)) return 'qa_failed'
  if (/commit|push|remote|manifest/i.test(error) || summary.push_succeeded === false && summary.local_edition_id) return 'publish_failed'
  if (summary.local_edition_id && summary.remote_matches !== true) return 'publish_failed'
  return 'unknown_failed'
}
