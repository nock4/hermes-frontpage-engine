import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'

import { buildExactAnchorSourceMaterialBlocker, isExactAnchorOverride } from '../../scripts/lib/source-research.mjs'

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
})
