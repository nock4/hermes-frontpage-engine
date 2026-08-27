import { describe, expect, it } from 'vitest'

import { classifyCronFailure, planPressDoctorActions } from '../../scripts/lib/press-doctor.mjs'

describe('press doctor failure classifier', () => {
  it('classifies source-floor collapses as a specific recurring source-bed incident', () => {
    const incident = classifyCronFailure([
      'Error: Source research produced 3 non-duplicate renderable content sources; expected at least 6.',
      '{\n  "ok": false,\n  "error": "npm run daily:process -- --publish failed with exit code 1",\n  "latest_run_dir": "/tmp/daily-process-run"\n}',
    ].join('\n'))

    expect(incident.kind).toBe('source_floor_failed')
    expect(incident.stage).toBe('source research / source-window floor')
    expect(planPressDoctorActions(incident).map((step) => step.id)).toEqual([
      'read_source_research',
      'measure_dropouts',
      'rebalance_source_bed',
      'run_focused_tests',
      'rerun_existing_cron',
      'verify_press_proof',
    ])
  })

  it('classifies green-but-tooling source editions as editorial failures', () => {
    const incident = classifyCronFailure([
      'Source bindings show AI & Agents, Claude Code, MCP workflow, datacenter surfaces.',
      '{\n  "ok": true,\n  "local_publish_status": "live",\n  "remote_matches": true\n}',
      'Press proof: green',
    ].join('\n'))

    expect(incident.kind).toBe('editorial_source_failed')
    expect(incident.next_action).toBe('quarantine_tooling_sources_and_recut_from_art_music_field')
  })

  it('classifies source-fidelity generation failures as repair-and-rerun incidents', () => {
    const incident = classifyCronFailure([
      'Stage: daily:publish:cron',
      'Source-image fidelity QA failed: warning lists multiple missing critical source elements',
      '{\n  "ok": false,\n  "error": "npm run daily:process -- --input-mode obsidian-allowlist --publish failed with exit code 1",\n  "latest_run_dir": "/tmp/daily-process-run"\n}',
    ].join('\n'))

    expect(incident.kind).toBe('source_fidelity_failed')
    expect(incident.next_action).toBe('repair_source_contract_then_rerun_cron')
    expect(planPressDoctorActions(incident).map((step) => step.id)).toEqual([
      'read_failed_audit',
      'repair_prompt_or_source_contract',
      'run_focused_tests',
      'rerun_existing_cron',
      'verify_press_proof',
    ])
  })

  it('classifies source-contract prompt conflicts separately from generic generation failure', () => {
    const incident = classifyCronFailure([
      'Error: source contract prompt conflicts: source-preserve contract conflicts with macro/landscape replacement language',
      '{\n  "ok": false,\n  "latest_run_dir": "/tmp/run"\n}',
    ].join('\n'))

    expect(incident.kind).toBe('source_contract_conflict')
    expect(incident.next_action).toBe('repair_source_contract_conflict_then_rerun_cron')
  })

  it('classifies stale proof after publish separately from publish failure', () => {
    const incident = classifyCronFailure([
      '{\n  "ok": true,\n  "local_edition_id": "edition-v1",\n  "local_publish_status": "live",\n  "remote_matches": true\n}',
      'Live proof captured stale edition after retries',
    ].join('\n'))

    expect(incident.kind).toBe('proof_failed_after_publish')
    expect(incident.next_action).toBe('recapture_or_fix_live_proof_without_regenerating_plate')
  })

  it('does not mistake a recovered source-fidelity retry for the final failed stage', () => {
    const incident = classifyCronFailure([
      '[source-fidelity] Source-image fidelity QA failed: vision verdict failed; regenerating recovery plate 1/2 with audit-guided preserve cues',
      '{\n  "ok": false,\n  "local_edition_id": "2026-08-16-midnight-carcass-field-v1",\n  "local_publish_status": "live",\n  "push_succeeded": true,\n  "remote_matches": false,\n  "remote_verification": { "ok": false, "error": "remote current_edition_id=old expected=2026-08-16-midnight-carcass-field-v1" }\n}',
    ].join('\n'))

    expect(incident.kind).toBe('publish_failed')
    expect(incident.stage).toBe('publish / remote verification')
  })
})
