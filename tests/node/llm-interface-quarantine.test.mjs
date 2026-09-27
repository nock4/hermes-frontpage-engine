import { describe, it, expect } from 'vitest'
import { isAiToolingContentSource, sourceHasRenderableCardSurface, selectContentSources } from '../../scripts/lib/source-selection-policy.mjs'
import { selectAnchorSource } from '../../scripts/lib/anchor-source-research.mjs'

const surface = (url, description, image_url = null) => ({ url, source_url: url, final_url: url, title: 'Saved source', description, image_url, fetch_status: 'fetch-ok', source_channel: 'chrome-bookmark', source_type: 'article' })

describe('LLM interface editorial quarantine', () => {
  it.each([
    surface('https://chatjimmy.ai', 'chat jimmy LLM web interface'),
    surface('https://example.com/chat', 'A large language model chat interface'),
    surface('https://example.com/client', 'An AI chatbot for everyday questions'),
    surface('https://chatjimmy.ai/', '', 'https://example.com/preview.jpg'),
    surface('https://example.com/centers', 'The land and water impacts of data centers'),
    surface('https://example.com/autocritic', 'Releasing autocritic an open source system that uses classic art theory'),
  ])('rejects tooling even when it has a preview: $url', (source) => {
    expect(isAiToolingContentSource(source)).toBe(true)
    expect(sourceHasRenderableCardSurface(source)).toBe(false)
    expect(selectContentSources([source])).toEqual([])
    expect(selectAnchorSource([source])).toBeNull()
  })

  it('refills six independent creative surfaces without reusing archived media', () => {
    const creative = Array.from({ length: 6 }, (_, i) => ({ ...surface(`https://gallery${i}.example/work`, 'Painting and textile exhibition', `https://gallery${i}.example/work.jpg`), note_id: `art-${i}` }))
    const spent = surface('https://old.example/new-page', 'Painting', 'https://old.example/spent.jpg')
    const selected = selectContentSources([surface('https://chatjimmy.ai', 'chat jimmy LLM web interface'), spent, ...creative], { recentSourceKeys: new Set(['old.example/spent.jpg']), maxItems: 6, targetItems: 6 })
    expect(selected.map(x => x.url)).toEqual(creative.map(x => x.url))
  })

  it('does not treat AI folders, article substrings, or model-assisted artwork as chatbot products', () => {
    for (const source of [
      surface('https://example.com/art', 'Built with GPT-5.5: a Three.js voxel action-adventure scene', 'https://example.com/art.jpg'),
      surface('https://example.com/article', 'A textile installation about conversation and memory', 'https://example.com/textile.jpg'),
    ]) {
      source.note_path = '01 - Active/themes/AI & Agents/art.md'
      expect(isAiToolingContentSource(source)).toBe(false)
      expect(sourceHasRenderableCardSurface(source)).toBe(true)
    }
  })
})
