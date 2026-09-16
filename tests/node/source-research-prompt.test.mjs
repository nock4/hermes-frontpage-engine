import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'

import { buildExactAnchorSourceMaterialBlocker, buildPromotedVisualAnchorMaterial, isAiToolingImageMaterial, isExactAnchorOverride } from '../../scripts/lib/source-research.mjs'

const source = readFileSync(new URL('../../scripts/lib/source-research.mjs', import.meta.url), 'utf8')

describe('source autoresearch prompt', () => {
  it('frames research as aesthetic-field curation rather than tech evidence clustering', () => {
    expect(source).toContain('aesthetic-field autoresearch')
    expect(source).toContain('Over-index on music, visuals, art, memes')
    expect(source).toContain('Downrank AI-agent infrastructure')
    expect(source).toContain('curator of visual culture, music, memes, art, and surfaces')
  })

  it('keeps a broad enough candidate bed to survive archive-wide source dedupe', () => {
    expect(source).toContain('const maxAutoresearchCandidates = 320')
    expect(source).toContain('survive archive-wide')
    expect(source).toContain('instead of falling back to agent chrome')
  })

  it('treats exact-anchor overrides as source-material contracts', () => {
    expect(isExactAnchorOverride({
      source_url: 'https://x.com/artist/status/1',
      prompt_bias_terms: ['artwork-first', 'exact-anchor'],
    })).toBe(true)
    expect(isExactAnchorOverride({
      source_url: 'https://x.com/artist/status/1',
      note: 'Exact rerun anchor requested by Nick.',
    })).toBe(true)
    expect(isExactAnchorOverride({
      source_url: 'https://x.com/artist/status/1',
      prompt_bias_terms: ['soft-inspiration'],
    })).toBe(false)
  })

  it('blocks exact-anchor source-field fallback when anchor media was already used', () => {
    const blocker = buildExactAnchorSourceMaterialBlocker({
      inspirationOverride: {
        title: 'Selected artwork anchor',
        source_url: 'https://x.com/artist/status/1',
        prompt_bias_terms: ['exact-anchor'],
      },
      sourceImageMode: 'skipped-no-valid-dominant-source-image',
      imageSourceMaterial: {
        image_source_candidates: [
          { image_url: 'https://pbs.twimg.com/media/used.jpg', page_url: 'https://x.com/artist/status/1' },
        ],
        selected_image_material: [],
        rejected_reused_image_material: [
          {
            image_url: 'https://pbs.twimg.com/media/used.jpg',
            page_url: 'https://x.com/artist/status/1',
            reason: 'Source material already appeared in a published edition; it cannot anchor another plate.',
          },
        ],
      },
    })

    expect(blocker).toMatchObject({
      status: 'blocked',
      reason: 'exact anchor media was already used by the archive ledger',
      anchor_url: 'https://x.com/artist/status/1',
      candidate_count: 1,
      rejected_reused_material_count: 1,
    })
    expect(blocker.next_action).toContain('choose a genuinely unused anchor')
  })

  it('does not block soft inspiration source-field fallback', () => {
    expect(buildExactAnchorSourceMaterialBlocker({
      inspirationOverride: {
        source_url: 'https://example.com/soft',
        prompt_bias_terms: ['soft-inspiration'],
      },
      sourceImageMode: 'skipped-no-valid-dominant-source-image',
      imageSourceMaterial: { image_source_candidates: [{ image_url: 'https://example.com/image.jpg' }] },
    })).toBe(null)
  })

  it('quarantines auxiliary-model image material before it can become the plate seed', () => {
    expect(isAiToolingImageMaterial({
      page_url: 'https://www.youtube.com/watch?v=NoF-YajElIM',
      image_url: 'https://img.youtube.com/vi/NoF-YajElIM/hqdefault.jpg',
      title: '@Teknium: Tip of the day: Learn about Auxiliary Models and save big money with Hermes Agent',
      visual_reason: 'YouTube thumbnail surfaced from auxiliary model prompt-routing tutorial.',
    })).toBe(true)
  })

  it('promotes a nearby visual anchor when the thesis anchor has no valid image', () => {
    const promoted = buildPromotedVisualAnchorMaterial({
      url: 'https://example.com/visual-story',
      title: 'Blue garden study',
      description: 'A strong image-led alternate from the same source field.',
      image_url: 'https://example.com/blue-garden.jpg',
      visual_reference_score: 44,
      selection_reason: 'Best image-bearing source from the primary inspected source set.',
    }, {
      anchorResearch: {
        anchor_source: {
          url: 'https://x.com/text/status/1',
          title: 'Text-only thesis anchor',
          why_selected: 'Strong editorial thesis but no fresh image.',
        },
      },
      imageSourceMaterial: {
        selected_image_material: [],
        low_fertility_anchor_demoted: {
          reason: 'All selected image material already appeared in a published edition; do not use repeated anchor source material as the dominant plate seed.',
        },
      },
    })

    expect(promoted.candidate).toMatchObject({
      page_url: 'https://example.com/visual-story',
      image_url: 'https://example.com/blue-garden.jpg',
      lineage: 'promoted_visual_anchor',
      promoted_visual_anchor: true,
      thesis_anchor_url: 'https://x.com/text/status/1',
    })
    expect(promoted.relationship).toMatchObject({
      mode: 'thesis-anchor-promoted-visual-anchor',
      thesis_anchor: { url: 'https://x.com/text/status/1' },
      visual_anchor: { image_url: 'https://example.com/blue-garden.jpg' },
    })
  })

  it('does not promote a nearby visual anchor for an exact-anchor contract', () => {
    expect(buildPromotedVisualAnchorMaterial({
      url: 'https://example.com/visual-story',
      image_url: 'https://example.com/blue-garden.jpg',
    }, {
      inspirationOverride: {
        source_url: 'https://x.com/exact/status/1',
        prompt_bias_terms: ['exact-anchor'],
      },
    })).toBe(null)
  })
})
