import { buildPublishProofFromCronLog, classifyPressState, extractLastPublishSummary } from './press-proof.mjs'
import { classifyPressLogText } from './press-stability.mjs'

export function classifyCronFailure(logText) {
  const text = String(logText || '')
  const summary = extractLastPublishSummary(text) || {}
  const stability = classifyPressLogText(text)
  const proof = buildPublishProofFromCronLog(text, { adversarialVisualQa: /adversarial visual qa[^\n]*pass/i.test(text) ? 'pass' : null })
  const pressState = classifyPressState({ summary, proof })

  if (stability.tags.includes('source_floor')) {
    return {
      kind: 'source_floor_failed',
      stage: 'source research / source-window floor',
      summary,
      latest_run_dir: summary.latest_run_dir || stability.latest_run_dir || null,
      next_action: 'widen_or_rebalance_source_bed_then_rerun_press',
      blocker: stability.evidence.source_floor || firstMatchingLine(text, /expected at least 6|non-duplicate renderable content sources/i),
      stability,
    }
  }

  if (stability.tags.includes('editorial_ai_tooling_risk') && stability.tags.includes('green_publish')) {
    return {
      kind: 'editorial_source_failed',
      stage: 'editorial source selection',
      summary,
      latest_run_dir: summary.latest_run_dir || stability.latest_run_dir || null,
      next_action: 'quarantine_tooling_sources_and_recut_from_art_music_field',
      blocker: stability.evidence.editorial_ai_tooling_risk || firstMatchingLine(text, /ai-tooling-penalized|AI & Agents|Claude Code|Anthropic|datacenter|MCP workflow/i),
      stability,
    }
  }

  if (stability.tags.includes('delivery')) {
    return {
      kind: 'delivery_failed',
      stage: 'Telegram/media delivery',
      summary,
      latest_run_dir: summary.latest_run_dir || stability.latest_run_dir || null,
      next_action: 'copy_media_to_allowed_profile_cache_and_deliver_to_plain_dm',
      blocker: stability.evidence.delivery || firstMatchingLine(text, /Message thread not found|Skipping unsafe MEDIA|Telegram send failed/i),
      stability,
    }
  }

  if ((pressState === 'generation_failed' || pressState === 'unknown_failed') && /Source-image fidelity QA failed|source[- ]image fidelity.*failed|missing critical source elements/i.test(text)) {
    return {
      kind: 'source_fidelity_failed',
      stage: 'source-image fidelity audit',
      summary,
      latest_run_dir: summary.latest_run_dir || null,
      next_action: 'repair_source_contract_then_rerun_cron',
      blocker: firstMatchingLine(text, /Source-image fidelity QA failed|missing critical source elements/i),
    }
  }

  if (/source contract prompt conflicts/i.test(text)) {
    return {
      kind: 'source_contract_conflict',
      stage: 'source contract / prompt contradiction gate',
      summary,
      latest_run_dir: summary.latest_run_dir || null,
      next_action: 'repair_source_contract_conflict_then_rerun_cron',
      blocker: firstMatchingLine(text, /source contract prompt conflicts/i),
    }
  }

  if (pressState === 'proof_failed_after_publish' || /Live proof captured stale edition|loaded plate image.*not loaded|success screenshot/i.test(text) && summary.ok === true) {
    return {
      kind: 'proof_failed_after_publish',
      stage: 'success screenshot / live proof',
      summary,
      latest_run_dir: summary.latest_run_dir || null,
      next_action: 'recapture_or_fix_live_proof_without_regenerating_plate',
      blocker: proof.blockers?.[0] || firstMatchingLine(text, /Live proof|screenshot|preload/i),
    }
  }

  if (pressState === 'qa_failed') {
    return { kind: 'qa_failed', stage: 'qa:publish', summary, latest_run_dir: summary.latest_run_dir || null, next_action: 'fix_qa_then_rerun_cron' }
  }
  if (pressState === 'publish_failed') {
    return { kind: 'publish_failed', stage: 'publish / remote verification', summary, latest_run_dir: summary.latest_run_dir || null, next_action: 'repair_publish_remote_then_verify_without_regenerating_if_possible' }
  }
  if (pressState === 'generation_failed') {
    return { kind: 'generation_failed', stage: 'daily:process', summary, latest_run_dir: summary.latest_run_dir || null, next_action: 'inspect_generation_artifacts_then_repair_and_rerun' }
  }
  if (pressState === 'green') {
    return { kind: 'green', stage: 'press proof', summary, latest_run_dir: summary.latest_run_dir || null, next_action: 'none' }
  }
  return { kind: 'unknown_failed', stage: 'unknown', summary, latest_run_dir: summary.latest_run_dir || null, next_action: 'read_log_tail_and_classify_manually' }
}

export function planPressDoctorActions(incident) {
  if (incident?.kind === 'source_floor_failed') {
    return [
      { id: 'read_source_research', action: 'read latest_run_dir/source-research.json and source-candidate-evidence.json' },
      { id: 'measure_dropouts', action: 'count browser/renderability/no-repeat/tooling dropouts before changing thresholds' },
      { id: 'rebalance_source_bed', action: 'patch source mining/selection so at least 6 real non-duplicate source windows survive; never pad with summary cards' },
      { id: 'run_focused_tests', action: 'run source-research and source-selection regression tests' },
      { id: 'rerun_existing_cron', action: 'rerun the configured Daily Frontpage cron job without overlap' },
      { id: 'verify_press_proof', action: 'require publish-proof green, screenshot, preload, QA, and adversarial visual proof' },
    ]
  }
  if (incident?.kind === 'editorial_source_failed') {
    return [
      { id: 'read_bindings_and_research', action: 'read source-bindings.json, source-research.json, and scene-prompt.txt for thesis/window mismatch' },
      { id: 'repair_editorial_gate', action: 'deterministically quarantine rejected tooling/datacenter sources or rerank art/music surfaces ahead of them' },
      { id: 'run_focused_tests', action: 'run source-selection, anchor-source-research, and scene prompt tests' },
      { id: 'recut_from_top', action: 'rerun the press from source research, not by hand-editing artifacts' },
      { id: 'verify_visual_qa', action: 'open actual source windows on desktop and mobile; closed marks alone are not blockers' },
    ]
  }
  if (incident?.kind === 'delivery_failed') {
    return [
      { id: 'verify_files_exist', action: 'stat screenshot/source/prompt proof files' },
      { id: 'copy_safe_media', action: 'copy proof files into the frontpage profile allowed media/document cache' },
      { id: 'fix_delivery_target', action: 'send to the plain Telegram DM/home channel, not a stale thread' },
    ]
  }
  if (incident?.kind === 'source_fidelity_failed') {
    return [
      { id: 'read_failed_audit', action: 'read latest_run_dir/source-fidelity-audit.json plus scene-prompt/source research' },
      { id: 'repair_prompt_or_source_contract', action: 'patch source contract, prompt recovery, or source selection path; never bypass fidelity gate' },
      { id: 'run_focused_tests', action: 'run source-contract, scene-generation, run-from-scratch, and source-fidelity tests' },
      { id: 'rerun_existing_cron', action: 'rerun the configured Daily Frontpage cron job, not a parallel publish path' },
      { id: 'verify_press_proof', action: 'require publish-proof green, screenshot, preload, QA, and adversarial visual proof' },
    ]
  }
  if (incident?.kind === 'proof_failed_after_publish') {
    return [
      { id: 'preserve_published_plate', action: 'do not regenerate if remote publish is already green' },
      { id: 'recapture_live_proof', action: 'clear cache/localStorage and recapture screenshot/preload proof for expected edition' },
      { id: 'fix_proof_script', action: 'patch proof capture only if recapture reproduces blocker' },
      { id: 'verify_press_proof', action: 'write publish-proof.json and rerun proof checker' },
    ]
  }
  return [
    { id: 'read_log', action: 'read cron log and latest run artifacts' },
    { id: 'classify_manually', action: 'identify failed stage and blocker before changing code' },
  ]
}

function firstMatchingLine(text, regex) {
  return text.split(/\r?\n/).find((line) => regex.test(line)) || null
}
