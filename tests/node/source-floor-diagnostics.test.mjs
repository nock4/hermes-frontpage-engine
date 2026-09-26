import { describe, expect, it } from 'vitest'

import { buildSourceFloorDiagnostics } from '../../scripts/lib/source-research.mjs'

describe('source floor diagnostics', () => {
  it('names archive repeat pressure before the six-window floor fails', () => {
    const sources = Array.from({ length: 6 }, (_, index) => ({
      url: `https://example.com/art-${index}.jpg`,
      final_url: `https://example.com/art-${index}.jpg`,
      title: `Archive artwork ${index}`,
      fetch_status: 'fetch-ok',
      source_channel: 'chrome-bookmark',
      note_score: 80,
      image_url: `https://example.com/art-${index}.jpg`,
    }))
    const diagnostics = buildSourceFloorDiagnostics({
      inspected: sources,
      contentSources: [],
      recentSourceKeys: new Set(sources.map((source) => `example.com/art-${source.title.split(' ').at(-1)}.jpg`)),
    })

    expect(diagnostics.primary_constraint).toBe('archive_repeat_ledger')
    expect(diagnostics.buckets.renderable_surfaces).toBe(6)
    expect(diagnostics.buckets.non_duplicate_renderable_surfaces).toBe(0)
    expect(diagnostics.recommended_action).toContain('downrank repeated notes before maxNotes')
  })

  it('counts one saved page once when the final URL differs by slug', () => {
    const original = {
      url: 'https://store.steampowered.com/app/3799530/Eye_of_the_Match/',
      source_url: 'https://store.steampowered.com/app/3799530/Eye_of_the_Match/',
      final_url: 'https://store.steampowered.com/app/3799530/Eye_of_the_Match_The_VAR_Game/',
      title: 'Eye of the Match: The VAR Game',
      fetch_status: 'fetch-ok',
      source_channel: 'twitter-bookmark',
      source_type: 'article',
      note_score: 80,
      image_url: 'https://shared.steamstatic.com/capsule.jpg',
    }
    const duplicate = {
      ...original,
      final_url: 'https://store.steampowered.com/app/3799530/Eye_of_the_Match/',
      image_url: 'https://shared.steamstatic.com/header.jpg',
    }
    const diagnostics = buildSourceFloorDiagnostics({ inspected: [original, duplicate], contentSources: [] })

    expect(diagnostics.buckets.renderable_surfaces).toBe(1)
    expect(diagnostics.buckets.non_duplicate_renderable_surfaces).toBe(1)
  })

  it('names AI/tooling quarantine when renderable surfaces are deliberately excluded', () => {
    const sources = Array.from({ length: 4 }, (_, index) => ({
      url: `https://x.com/tooling/status/${index}`,
      title: `Claude Code MCP workflow ${index}`,
      description: 'AI agent workflow and API docs',
      fetch_status: 'fetch-ok',
      source_channel: 'twitter-bookmark',
      source_type: 'tweet',
      window_type: 'social',
      note_score: 90,
    }))
    const diagnostics = buildSourceFloorDiagnostics({ inspected: sources, contentSources: [] })

    expect(diagnostics.primary_constraint).toBe('ai_tooling_quarantine')
    expect(diagnostics.buckets.ai_tooling_quarantined).toBe(4)
    expect(diagnostics.buckets.non_duplicate_renderable_surfaces).toBe(0)
    expect(diagnostics.recommended_action).toContain('keep AI/tooling quarantine')
  })
})
