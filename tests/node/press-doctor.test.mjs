import { describe, expect, it } from 'vitest'

import { classifyCronFailure, planPressDoctorActions } from '../../scripts/lib/press-doctor.mjs'

describe('press doctor failure classifier', () => {
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

  it('classifies stale proof after publish separately from publish failure', () => {
    const incident = classifyCronFailure([
      '{\n  "ok": true,\n  "local_edition_id": "edition-v1",\n  "local_publish_status": "live",\n  "remote_matches": true\n}',
      'Live proof captured stale edition after retries',
    ].join('\n'))

    expect(incident.kind).toBe('proof_failed_after_publish')
    expect(incident.next_action).toBe('recapture_or_fix_live_proof_without_regenerating_plate')
  })
})
