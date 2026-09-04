import fs from 'node:fs/promises'
import path from 'node:path'

const PRESS_STABILITY_PATTERNS = {
  source_floor: {
    stage: 'source research / source-window floor',
    severity: 'blocker',
    next_action: 'widen_or_rebalance_source_bed_then_rerun_press',
    patterns: [
      /Source research produced \d+ non-duplicate renderable content sources/i,
      /expected at least 6/i,
      /fewer than 6 real source windows/i,
    ],
  },
  editorial_ai_tooling_risk: {
    stage: 'editorial source selection',
    severity: 'editorial_blocker',
    next_action: 'quarantine_tooling_sources_and_recut_from_art_music_field',
    patterns: [
      /ai-tooling-penalized/i,
      /AI & Agents/i,
      /Claude Code|Anthropic|GrokBot|SkillOpt|MCP workflow|agent workflow|datacenter/i,
    ],
  },
  source_fidelity: {
    stage: 'source-image fidelity',
    severity: 'blocker_or_recovery',
    next_action: 'inspect_source_fidelity_audit_and_source_contract',
    patterns: [
      /Source-image fidelity QA failed/i,
      /source[- ]image fidelity.*failed/i,
      /missing critical source elements/i,
      /"verdict"\s*:\s*"fail"/i,
    ],
  },
  qa_audit_media: {
    stage: 'qa:publish / audits / media geometry',
    severity: 'blocker',
    next_action: 'fix_qa_dependency_or_source_window_media_then_rerun_qa_publish',
    patterns: [
      /npm audit report/i,
      /severity vulnerability/i,
      /npm run qa:publish failed/i,
      /Test Files\s+\d+ failed/i,
      /source-window media audit.*failed/i,
      /Knip.*(?:failed|error)|unused.*(?:failed|error)/i,
    ],
  },
  remote_cache: {
    stage: 'publish / remote manifest cache',
    severity: 'blocker_or_retry',
    next_action: 'cache_bust_remote_manifest_and_verify_without_regenerating_if_possible',
    patterns: [
      /remote_matches"?\s*:\s*false/i,
      /remote current_edition_id=.*expected=/i,
      /remote verification.*failed/i,
      /remote manifest.*expected/i,
    ],
  },
  proof_capture: {
    stage: 'success screenshot / live preload proof',
    severity: 'blocker_or_retry',
    next_action: 'recapture_live_proof_and_open_real_source_windows',
    patterns: [
      /Live proof attempt.*Timeout/i,
      /page\.waitForFunction: Timeout/i,
      /Captured success screenshot.*failed/i,
      /press proof.*green:\s*false/i,
      /proof.*missing/i,
      /loaded plate image.*not loaded/i,
    ],
  },
  delivery: {
    stage: 'Telegram/media delivery',
    severity: 'reporting_blocker',
    next_action: 'copy_media_to_allowed_profile_cache_and_deliver_to_plain_dm',
    patterns: [
      /Telegram send failed/i,
      /Message thread not found/i,
      /Skipping unsafe MEDIA directive path/i,
    ],
  },
  image_provider_empty: {
    stage: 'image provider',
    severity: 'provider_blocker_or_retry',
    next_action: 'retry_image_generation_or_switch_to_recovery_prompt_without_bypassing_fidelity',
    patterns: [
      /Codex response contained no image_generation_call result/i,
      /image_generation_call/i,
      /Generate AI scene plate[\s\S]{0,500}Error/i,
    ],
  },
  green_publish: {
    stage: 'green publish proof',
    severity: 'ok',
    next_action: 'none',
    patterns: [
      /"ok"\s*:\s*true[\s\S]{0,1200}"remote_matches"\s*:\s*true/i,
      /remote_matches:\s*true/i,
      /remote_verification[\s\S]{0,160}"ok"\s*:\s*true/i,
      /Press proof:\s*green/i,
    ],
  },
}

export function classifyPressLogText(logText, { file = null } = {}) {
  const text = String(logText || '')
  const tags = []
  const evidence = {}
  for (const [id, rule] of Object.entries(PRESS_STABILITY_PATTERNS)) {
    const line = firstMatchingLine(text, rule.patterns)
    if (!line) continue
    tags.push(id)
    evidence[id] = line.trim().slice(0, 500)
  }
  const primary = pickPrimaryTag(tags)
  return {
    file,
    bytes: text.length,
    tags,
    primary,
    failed: isFailedText(text, tags),
    latest_run_dir: lastMatch(text, /daily-process-\d{4}-\d{2}-\d{2}T[\d-]+Z/g),
    edition_id: lastMatch(text, /\d{4}-\d{2}-\d{2}-[a-z0-9][a-z0-9-]*-v\d+/g),
    evidence,
  }
}

export async function auditPressStability({ logsDir = path.join(process.cwd(), 'tmp', 'cron-logs'), limit = 28 } = {}) {
  let entries = []
  try {
    entries = await fs.readdir(logsDir, { withFileTypes: true })
  } catch {
    return emptyAudit(logsDir)
  }
  const files = entries
    .filter((entry) => entry.isFile() && /^daily-frontpage-.*\.log$/.test(entry.name))
    .map((entry) => path.join(logsDir, entry.name))
    .sort()
    .slice(-limit)
  const incidents = []
  for (const filePath of files) {
    const text = await fs.readFile(filePath, 'utf8')
    incidents.push(classifyPressLogText(text, { file: path.relative(process.cwd(), filePath) }))
  }
  const counts = {}
  for (const incident of incidents) {
    for (const tag of incident.tags) counts[tag] = (counts[tag] || 0) + 1
  }
  const failed = incidents.filter((incident) => incident.failed)
  const recurring = Object.entries(counts)
    .filter(([tag, count]) => tag !== 'green_publish' && count >= 2)
    .map(([tag, count]) => ({ tag, count, ...ruleSummary(tag) }))
    .sort((a, b) => stabilityPriority(a.tag) - stabilityPriority(b.tag) || b.count - a.count || a.tag.localeCompare(b.tag))
  return {
    schema_version: 1,
    generated_at: new Date().toISOString(),
    logs_dir: logsDir,
    inspected_logs: incidents.length,
    failed_logs: failed.length,
    counts,
    recurring,
    latest_failed: failed.at(-1) || null,
    incidents,
    recommendation: buildRecommendation({ failed, recurring, counts }),
  }
}

export function formatPressStabilityAudit(audit) {
  const lines = []
  lines.push(`Press stability: ${audit.failed_logs}/${audit.inspected_logs} inspected logs are red or suspect`)
  if (audit.recurring?.length) {
    lines.push('Recurring seams:')
    for (const item of audit.recurring.slice(0, 6)) {
      lines.push(`- ${item.tag} (${item.count}): ${item.stage}; next=${item.next_action}`)
    }
  } else {
    lines.push('Recurring seams: none detected')
  }
  if (audit.latest_failed) {
    lines.push(`Latest failed/suspect log: ${audit.latest_failed.file}`)
    lines.push(`Primary seam: ${audit.latest_failed.primary || 'unknown'}`)
  }
  lines.push(`Recommendation: ${audit.recommendation}`)
  return lines.join('\n')
}

function emptyAudit(logsDir) {
  return {
    schema_version: 1,
    generated_at: new Date().toISOString(),
    logs_dir: logsDir,
    inspected_logs: 0,
    failed_logs: 0,
    counts: {},
    recurring: [],
    latest_failed: null,
    incidents: [],
    recommendation: 'No cron logs found; run the press once before trend diagnosis.',
  }
}

function firstMatchingLine(text, patterns) {
  const lines = text.split(/\r?\n/)
  for (const pattern of patterns) {
    const line = lines.find((candidate) => pattern.test(candidate))
    if (line) return line
  }
  return null
}

function lastMatch(text, regex) {
  const matches = String(text || '').match(regex)
  return matches?.at(-1) || null
}

function pickPrimaryTag(tags) {
  const order = [
    'source_floor',
    'editorial_ai_tooling_risk',
    'source_fidelity',
    'qa_audit_media',
    'remote_cache',
    'proof_capture',
    'delivery',
    'image_provider_empty',
    'green_publish',
  ]
  return order.find((tag) => tags.includes(tag)) || null
}

function isFailedText(text, tags) {
  if (tags.includes('green_publish')) {
    if (tags.includes('editorial_ai_tooling_risk')) return true
    if (/press proof.*green:\s*false|proof_failed_after_publish|source[- ]image fidelity:\s*(?:fail|warn)/i.test(text)) return true
    return false
  }
  if (/"ok"\s*:\s*false|PRESS_RUN_STATUS=failed|failed with exit code 1|Error: /i.test(text)) return true
  return false
}

function stabilityPriority(tag) {
  const index = [
    'source_floor',
    'editorial_ai_tooling_risk',
    'source_fidelity',
    'qa_audit_media',
    'remote_cache',
    'proof_capture',
    'delivery',
    'image_provider_empty',
  ].indexOf(tag)
  return index === -1 ? 999 : index
}

function ruleSummary(tag) {
  const rule = PRESS_STABILITY_PATTERNS[tag] || {}
  return {
    stage: rule.stage || 'unknown',
    severity: rule.severity || 'unknown',
    next_action: rule.next_action || 'inspect_log_manually',
  }
}

function buildRecommendation({ failed, recurring }) {
  if (!failed.length && !recurring.length) return 'No repeated red seam detected; keep normal proof gates.'
  const latest = failed.at(-1)
  if (latest?.primary && latest.primary !== 'green_publish') {
    const rule = ruleSummary(latest.primary)
    return `${rule.stage}: ${rule.next_action}`
  }
  const top = recurring.find((item) => item.tag !== 'green_publish')
  if (!top) return 'Read latest failed log and classify manually before changing code.'
  return `${top.stage}: ${top.next_action}`
}
