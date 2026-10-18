import { it, expect } from 'vitest'
import { evaluatePublication } from '../../scripts/publication-monitor.mjs'
it('uses Eastern deadline through winter, summer and DST changes', () => {
  for (const [before, after] of [['2026-10-18T10:59Z','2026-10-18T11:00Z'], ['2026-12-18T11:59Z','2026-12-18T12:00Z'], ['2026-03-08T10:59Z','2026-03-08T11:00Z'], ['2026-11-01T11:59Z','2026-11-01T12:00Z']]) {
    expect(evaluatePublication(null, { now: new Date(before) }).status).toBe('before-deadline')
    expect(evaluatePublication(null, { now: new Date(after) }).status).toBe('unavailable')
  }
})
it('requires exact current record/date, never claims machine start', () => {
  const now = new Date('2026-10-18T12:00Z')
  const id = '2026-10-18-art-v1'
  const manifest = { current_edition_id: id, editions: [{ edition_id: id, is_live: true, path: `/editions/${id}`, preview_asset_path: `/editions/${id}/assets/preview.png` }] }
  expect(evaluatePublication(manifest, { now }).status).toBe('published')
  expect(evaluatePublication({ ...manifest, current_edition_id: '2026-10-17-art-v1' }, { now }).status).toBe('missed')
  expect(evaluatePublication(manifest, { now }).start_state).toBe('unknown-no-heartbeat')
  expect(() => evaluatePublication(manifest, { now, deadline: '25:00' })).toThrow()
})
