import { describe, expect, it } from 'vitest'

import { auditPressStability, classifyPressLogText, formatPressStabilityAudit } from '../../scripts/lib/press-stability.mjs'

function logWithSummary(lines, summary = {}) {
  return [
    ...lines,
    JSON.stringify({ ok: false, remote_matches: false, ...summary }, null, 2),
  ].join('\n')
}

describe('press stability audit', () => {
  it('classifies source-floor collapse as the primary recurring source seam', () => {
    const incident = classifyPressLogText(logWithSummary([
      'Error: Source research produced 3 non-duplicate renderable content sources; expected at least 6.',
      'Inspect source-research.json.',
    ]))

    expect(incident.primary).toBe('source_floor')
    expect(incident.failed).toBe(true)
    expect(incident.tags).toContain('source_floor')
  })

  it('marks technically green AI/tooling editions as suspect editorial failures', () => {
    const incident = classifyPressLogText([
      'Final source windows include Claude Code, Anthropic, MCP workflow, datacenter tooling.',
      '{\n  "ok": true,\n  "local_publish_status": "live",\n  "remote_matches": true\n}',
      'Press proof: green',
    ].join('\n'))

    expect(incident.tags).toContain('editorial_ai_tooling_risk')
    expect(incident.tags).toContain('green_publish')
    expect(incident.failed).toBe(true)
  })

  it('separates remote/cache proof from source research', () => {
    const incident = classifyPressLogText(logWithSummary([
      'remote current_edition_id=2026-08-15-old-v1 expected=2026-08-16-new-v1',
    ], { local_edition_id: '2026-08-16-new-v1' }))

    expect(incident.primary).toBe('remote_cache')
    expect(incident.tags).not.toContain('source_floor')
  })

  it('audits a directory of cron logs into recurring seams and recommendation', async () => {
    const dir = await import('node:fs/promises').then(async (fs) => {
      const path = await import('node:path')
      const os = await import('node:os')
      const tmp = await fs.mkdtemp(path.join(os.tmpdir(), 'frontpage-stability-'))
      await fs.writeFile(path.join(tmp, 'daily-frontpage-20260812-040021.log'), logWithSummary([
        'Source research produced 3 non-duplicate renderable content sources; expected at least 6.',
      ]))
      await fs.writeFile(path.join(tmp, 'daily-frontpage-20260813-040052.log'), logWithSummary([
        'Source research produced 2 non-duplicate renderable content sources; expected at least 6.',
      ]))
      await fs.writeFile(path.join(tmp, 'daily-frontpage-20260816-040022.log'), logWithSummary([
        'remote current_edition_id=old expected=2026-08-16-new-v1',
      ]))
      return tmp
    })

    const audit = await auditPressStability({ logsDir: dir, limit: 10 })

    expect(audit.inspected_logs).toBe(3)
    expect(audit.failed_logs).toBe(3)
    expect(audit.counts.source_floor).toBe(2)
    expect(audit.recurring[0].tag).toBe('source_floor')
    expect(formatPressStabilityAudit(audit)).toContain('Press stability: 3/3')
  })
})
