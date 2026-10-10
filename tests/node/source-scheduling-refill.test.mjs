import { describe, it, expect } from 'vitest'
import * as policy from '../../scripts/lib/source-selection-policy.mjs'
const page = (host, extra = {}) => ({ url: `https://${host}/work`, note_id: 'saved-collection', note_title: 'Saved photographs', note_score: 100, source_channel: 'saved-link', ...extra })
const refill = (harvest, candidates, evidence, options) => policy.selectSourceIntakeRefill({ source_candidates: harvest }, candidates, evidence, options)

describe('bounded unscheduled owning-page intake refill', () => {
  it('reaches independent owners after saturated scheduled fetches fail without manufacturing pixel admission', () => {
    const selected = Array.from({ length: 960 }, (_, i) => page(`selected-${i}.example`, { note_id: `note-${i}` }))
    const unscheduled = ['alpha', 'beta', 'gamma', 'delta', 'epsilon', 'zeta'].map(name => page(`${name}.example`))
    const result = refill([...selected, ...unscheduled], selected, selected)
    expect(result).toEqual(unscheduled)
    expect(policy.selectContentSources(result, { autoresearch: { source_decisions: [] } })).toEqual([])
  })
  it('does not refill a healthy field and bounds refill by failed fetch slots and 24 candidates', () => {
    const selected = Array.from({ length: 40 }, (_, i) => page(`selected-${i}.example`, { image_url: `https://selected-${i}.example/art.jpg` }))
    const backlog = Array.from({ length: 40 }, (_, i) => page(`fresh-${i}.example`))
    expect(refill([...selected, ...backlog], selected, selected)).toEqual([])
    expect(refill([...selected, ...backlog], selected, selected.slice(1))).toHaveLength(1)
    expect(refill([...selected, ...backlog], selected, [])).toHaveLength(24)
  })
  it('retains archive aliases, transitive family bridges, attachment ownership and owner bounds', () => {
    const selected = [page('selected.example')]
    const bridge = page('bridge.example', { final_url: selected[0].url })
    const alias = page('alias.example', { final_url: bridge.url })
    const spent = page('spent.example')
    const attachment = page('asset.example', { parent_source: selected[0], page_url: selected[0].url })
    const raw = page('image.example', { url: 'https://image.example/work.png' })
    const fresh = page('fresh.example')
    const result = refill([alias, bridge, spent, attachment, raw, fresh], selected, [], { recentSourceKeys: new Set([policy.sourceContentKey(spent)]) })
    expect(result).toEqual([fresh])
    const failed = Array.from({ length: 8 }, (_, i) => page(`failed-${i}.example`))
    const sameOwner = Array.from({ length: 8 }, (_, i) => page('owner.example', { url: `https://owner.example/work-${i}` }))
    expect(refill(sameOwner, failed, [])).toHaveLength(3)
  })
  it('does not fetch quarantined tooling as a creative replacement', () => {
    const failed = [page('failed.example')]
    const tool = page('tool.example', { title: 'AI agent workflow tutorial and SDK setup guide' })
    expect(refill([tool], failed, [])).toEqual([])
  })
})
