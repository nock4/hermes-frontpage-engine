import { describe, expect, it } from 'vitest'
import { archiveRolesForSourceUrls, archiveSourceRepeatViolations, SUPPORTING_REPEAT_POLICY_START } from '../../scripts/lib/archive-source-policy.mjs'
import { sourceContentKey } from '../../scripts/lib/source-selection-policy.mjs'

// Manifest order is newest first, like public/editions/index.json.
const edition = (edition_id, date, bindings) => ({ edition_id, date, bindings })
const b = (source_url, archive_role, extra = {}) => ({ source_url, ...(archive_role ? { archive_role } : {}), ...extra })
const check = editions => archiveSourceRepeatViolations(editions, { sourceContentKey, effectiveDate: '2026-11-14' })

describe('archive validation: anchor never repeats, supporting windows cool down', () => {
  it('accepts a supporting repeat outside 30 days that was not in the previous edition', () => {
    expect(check([
      edition('new', '2026-11-20', [b('https://x.com/a/status/1', 'anchor'), b('https://l.bandcamp.com/track/old', 'supporting')]),
      edition('prev', '2026-11-19', [b('https://x.com/a/status/2', 'anchor')]),
      edition('old', '2026-09-01', [b('https://x.com/a/status/0', 'anchor'), b('https://l.bandcamp.com/track/old', 'supporting')]),
    ])).toEqual([])
  })

  it('accepts a former anchor reused as supporting after cooldown', () => {
    expect(check([
      edition('new', '2026-11-20', [b('https://x.com/a/status/1', 'anchor'), b('https://x.com/a/status/0', 'supporting')]),
      edition('prev', '2026-11-19', []),
      edition('old', '2026-09-01', [b('https://x.com/a/status/0', 'anchor')]),
    ])).toEqual([])
  })

  it.each([
    ['source_url', b('https://x.com/a/status/0', 'anchor')],
    ['other-username tweet family', b('https://twitter.com/i/web/status/0', 'anchor')],
    ['image', b('https://x.com/a/status/9', 'anchor', { source_image_url: 'https://pbs.twimg.com/media/OLD.jpg' })],
    ['resolved_url', b('https://short.example/x', 'anchor', { resolved_url: 'https://gallery.example/work' })],
    ['missing role (strict default)', b('https://x.com/a/status/0')],
  ])('rejects an anchor repeat through %s at any age', (_, anchor) => {
    const violations = check([
      edition('new', '2026-11-20', [anchor]),
      edition('ancient', '2025-01-01', [b('https://x.com/a/status/0', 'supporting', { source_image_url: 'https://pbs.twimg.com/media/OLD.jpg' }), b('https://gallery.example/work', 'supporting')]),
    ])
    expect(violations).toHaveLength(1)
    expect(violations[0]).toMatch(/anchor/)
  })

  it('rejects a same-date anchor repeat', () => {
    expect(check([
      edition('v2', '2026-11-20', [b('https://x.com/a/status/5', 'anchor')]),
      edition('v1', '2026-11-20', [b('https://x.com/a/status/5', 'supporting')]),
    ])).toHaveLength(1)
  })

  it.each([
    ['within 30 days', '2026-10-25', [edition('prev', '2026-11-19', [])]],
    ['in the previous edition, even after a gap', '2026-08-01', []],
  ])('rejects a supporting repeat %s', (_, oldDate, between) => {
    const violations = check([
      edition('new', '2026-11-20', [b('https://x.com/a/status/1', 'anchor'), b('https://l.bandcamp.com/track/t', 'supporting')]),
      ...between,
      edition('earlier', oldDate, [b('https://l.bandcamp.com/track/t', 'supporting')]),
    ])
    expect(violations).toHaveLength(1)
    expect(violations[0]).toMatch(/supporting/)
  })

  it('rejects duplicate source families inside one edition', () => {
    expect(check([
      edition('new', '2026-11-20', [b('https://x.com/a/status/1', 'anchor'), b('https://twitter.com/b/status/1', 'supporting')]),
    ])).toHaveLength(1)
  })

  it('does not rewrite legacy editions before the policy start', () => {
    expect(SUPPORTING_REPEAT_POLICY_START).toMatch(/^\d{4}-\d{2}-\d{2}$/)
    expect(check([
      edition('legacy-b', '2026-04-02', [b('https://l.bandcamp.com/track/t')]),
      edition('legacy-a', '2026-04-01', [b('https://l.bandcamp.com/track/t')]),
    ])).toEqual([])
  })
})

describe('package archive roles', () => {
  const urls = ['https://www.youtube.com/watch?v=abc', 'https://x.com/painter/status/42', 'https://l.bandcamp.com/track/t']
  it('marks the researched anchor binding (by family) as anchor and the rest as supporting', () => {
    expect(archiveRolesForSourceUrls(urls, { anchor_research: { anchor_source: { url: 'https://twitter.com/i/web/status/42' } } }))
      .toEqual(['supporting', 'anchor', 'supporting'])
  })
  it('falls back to the dominant plate source page, then to the first (hero) binding', () => {
    expect(archiveRolesForSourceUrls(urls, { selected_image_material: [{ page_url: urls[2], image_url: 'https://f4.bcbits.com/a.jpg' }] }))
      .toEqual(['supporting', 'supporting', 'anchor'])
    expect(archiveRolesForSourceUrls(urls, {})).toEqual(['anchor', 'supporting', 'supporting'])
  })
})
