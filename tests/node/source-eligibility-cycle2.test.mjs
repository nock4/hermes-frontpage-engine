import { readFileSync } from 'node:fs'
import { describe, it, expect } from 'vitest'
import { isAiToolingContentSource, selectContentSources, sourceHasRenderableCardSurface } from '../../scripts/lib/source-selection-policy.mjs'
import { getResearchContentSources, buildSourceFloorDiagnostics } from '../../scripts/lib/source-research.mjs'
import { buildSourceDecisionAudit, decideAnchorEligibility } from '../../scripts/lib/source-decision-gates.mjs'

const { content_sources: sources, autoresearch } = JSON.parse(readFileSync(new URL('../fixtures/source-eligibility-cycle2.json', import.meta.url)))

describe('failed September source bed: eligibility is not a six-window quota', () => {
  it('blocks the decision audit even with an accepted anchor when public media falls below six', () => {
    const audit = buildSourceDecisionAudit({ contentSources: sources, autoresearch })
    expect(audit.status).toBe('blocked')
    expect(audit.hard_blockers[0].reason_code).toBe('insufficient_eligible_source_media')
  })
  it.each(sources.slice(2))('quarantines explicit workflow/software/model/credential evidence: $note_title', (source) => {
    expect(isAiToolingContentSource(source)).toBe(true)
    expect(selectContentSources([source])).toEqual([])
  })
  it('retains the actual AI-made artwork, not the conceptual UI assigned supporting', () => {
    expect(isAiToolingContentSource(sources[0])).toBe(false)
    expect(selectContentSources(sources, { autoresearch })).toEqual([sources[0]])
    expect(decideAnchorEligibility({ anchorSource: sources[1], autoresearch }).decision).toBe('reject')
  })
  it('does not classify artistic training or mathematical art as model research', () => {
    for (const description of ['AI-made painting, recursively trained on its own synthetic corpus', 'Mathematical art and physics simulations', 'A film made with AI, showing flowers and glass sculpture']) {
      expect(isAiToolingContentSource({ description })).toBe(false)
    }
  })
  it('does not count prose or a text-only tweet iframe as renderable media', () => {
    expect(sourceHasRenderableCardSurface({ ...sources[0], image_url: null, media_url: null, tweet_media_count: 0 })).toBe(false)
    expect(sourceHasRenderableCardSurface({ url: 'https://example.com/art', title: 'Art and music history', visible_text: 'A long aesthetic essay without media', fetch_status: 'fetch-ok' })).toBe(false)
    expect(sourceHasRenderableCardSurface({ ...sources[0], image_url: null, media_type: 'video', media_url: 'https://video.twimg.com/art.mp4' })).toBe(true)
  })
  it('never resurrects rejected or supporting parents via enriched aliases and media', () => {
    const rejected = { ...sources[0], url: 'https://x.com/status/2038835924059271354', source_url: 'https://twitter.com/mccoyspace/status/2038835924059271354', final_url: 'https://x.com/mccoyspace/status/2038835924059271354' }
    const derived = { url: 'https://example.com/art.jpg', image_url: 'https://example.com/art.jpg', parent_source: rejected }
    const field = { autoresearch, sources: [rejected, derived, ...sources], content_sources: [rejected, derived, ...sources] }
    expect(getResearchContentSources(field)).toEqual([expect.objectContaining({ url: sources[0].url })])
    expect(getResearchContentSources({ ...field, content_sources: [] })).toEqual([expect.objectContaining({ url: sources[0].url })])
    expect(buildSourceFloorDiagnostics({ inspected: sources, autoresearch }).buckets.non_duplicate_renderable_surfaces).toBe(1)
  })
  it('does not depend on the names of authors or packages', () => {
    for (const description of ['Deploy these skills to control your notebook using AI', 'pip install unseen-package', 'New research: emotion representations in a large language model', 'A credential manager for agents', 'https://github.com/new-org/agent-secrets']) {
      expect(isAiToolingContentSource({ description })).toBe(true)
    }
  })
})
