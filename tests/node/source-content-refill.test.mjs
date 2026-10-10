import { describe, expect, it } from 'vitest'
import { selectContentSources, selectSourceCandidatesForInspection, sourceContentKey } from '../../scripts/lib/source-selection-policy.mjs'

// Synthetic unit stamps only; real capture integrity is checked in the diagnostic replay.
const page = (host, extra = {}) => ({
  url: `https://${host}/work`, source_channel: 'chrome-bookmark', source_type: 'article',
  note_id: 'collection', note_title: 'Saved photographs', note_score: 120,
  image_url: `https://${host}/photograph.jpg`, fetch_status: 'fetch-ok', ...extra,
})
const owners = () => ['alpha.test', 'beta.test', 'gamma.test', 'delta.test', 'epsilon.test', 'zeta.test'].map(host => page(host))
const decision = s => ({ url: s.url, role: 'content', confidence: 'high', inspection: {
  version: 1, inspector: 'creative-artifact-vision', status: 'verified', confidence: 'high',
  artifact_kind: 'photography', source_url: s.url, media_url: s.image_url,
  observation: 'Unit fixture photograph.', capture_sha256: 'a'.repeat(64), capture_path: '/unit-fixture-only.jpg',
} })
const select = (sources, options = {}, decisions = sources.map(decision)) => selectContentSources(sources, {
  maxItems: 6, targetItems: 6, autoresearch: { source_decisions: decisions }, ...options,
})

describe('vacant content refill for independently owned collection pages', () => {
  it.each(['intake', 'content'])('does not turn a skipped redirect bridge into another family (%s)', lane => {
    const seed = owners().slice(0, 3).map(s => ({ ...s, source_channel: 'saved-link', note_title: 'Saved reading', note_score: 600 }))
    const bridge = page('bridge.test', { final_url: seed[0].url, source_channel: 'saved-link', note_title: 'Saved reading' })
    const alias = page('alias.test', { final_url: bridge.url, source_channel: 'saved-link', note_title: 'Saved reading' })
    const sources = [...seed, bridge, alias]
    expect(lane === 'intake' ? selectSourceCandidatesForInspection({ source_candidates: sources }, 6) : select(sources)).toEqual(seed)
  })

  it('admits six eligible independent owners without inventing note identities', () => {
    const sources = owners()
    expect(select(sources)).toEqual(sources)
    expect(select(sources).map(sourceContentKey)).toEqual(select(sources.map((s, i) => ({ ...s, note_id: `separate-${i}` }))).map(sourceContentKey))
    expect(new Set(select(sources).map(sourceContentKey)).size).toBe(6)
  })

  it('preserves the existing three-per-note first pass before appending only vacant slots', () => {
    const sources = owners()
    const other = page('other.test', { note_id: 'other', note_score: 0 })
    const prefix = [...sources.slice(0, 3), other]
    expect(select([...sources, other], { maxItems: 4, targetItems: 4 })).toEqual(prefix)
    expect(select([...sources, other])).toEqual([...prefix, ...sources.slice(3, 5)])
    expect(select(sources, { maxItems: 0 })).toEqual([])
  })

  it('does not count tweet attachments or redirect aliases as new publishers', () => {
    const seed = owners().slice(0, 3)
    seed.forEach(s => { s.note_score = 600 }) // keep media score bonuses out of the established prefix
    seed[0].final_url = 'https://redirect.test/work'
    const aliases = [
      page('redirect.test'),
      page('alias.test', { final_url: seed[1].url }),
      page('canonical.test', { source_url: seed[2].url }),
      page('opaque.test', { page_url: seed[0].url, parent_source: seed[0] }),
      page('x.com', { url: 'https://x.com/artist/status/123', source_type: 'tweet' }),
      page('cdn.test', { url: 'https://cdn.test/attachment.jpg' }),
    ]
    const fresh = owners().slice(3)
    expect(select([...seed, ...aliases, ...fresh])).toEqual([...seed, ...fresh])
  })

  it('tracks aliases and media of newly appended families', () => {
    const seed = owners().slice(0, 3)
    const fresh = page('fresh.test', { resolved_url: 'https://resolved.test/work', image_url: 'https://opaque.test/work' })
    expect(select([...seed, fresh, page('resolved.test'), page('opaque.test')])).toEqual([...seed, fresh])
  })

  it('bounds refill by three per owning domain', () => {
    const seed = owners().slice(0, 3)
    const same = Array.from({ length: 5 }, (_, i) => page('same.test', { url: `https://same.test/work-${i}`, image_url: `https://same.test/photo-${i}.jpg` }))
    expect(select([...seed, ...same], { maxItems: 10 })).toEqual([...seed, ...same.slice(0, 3)])
  })

  it('retains archive, owning rejection, editorial, and exact high-confidence pixel gates', () => {
    const seed = owners().slice(0, 3)
    const invalid = [
      page('spent.test'), page('redirect-spent.test', { final_url: 'https://spent.test/work' }),
      page('parent.test', { parent_source: { url: 'https://rejected.test/work' } }),
      page('tool.test', { description: 'AI assistant prompt guide' }),
      page('medium.test'), page('unknown.test'), page('changed.test'),
    ]
    const fresh = page('fresh.test')
    const decisions = [...seed, ...invalid, fresh].map(decision)
    decisions.find(d => d.url === invalid[4].url).inspection.confidence = 'medium'
    decisions.find(d => d.url === invalid[5].url).inspection.status = 'ambiguous'
    decisions.find(d => d.url === invalid[6].url).inspection.media_url = 'https://changed.test/old.jpg'
    decisions.push({ url: 'https://rejected.test/work', role: 'reject' })
    expect(select([...seed, ...invalid, fresh], { recentSourceKeys: new Set([sourceContentKey(invalid[0])]) }, decisions)).toEqual([...seed, fresh])
    expect(select([...seed, fresh], {}, [])).toEqual([])
  })
})
