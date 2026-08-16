import { buildPublishProofFromCronLog, classifyPressState, extractLastPublishSummary } from './press-proof.mjs'

export function classifyCronFailure(logText) {
  const text = String(logText || '')
  const summary = extractLastPublishSummary(text) || {}
  const proof = buildPublishProofFromCronLog(text, { adversarialVisualQa: /adversarial visual qa[^\n]*pass/i.test(text) ? 'pass' : null })
  const pressState = classifyPressState({ summary, proof })

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
