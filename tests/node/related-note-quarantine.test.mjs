import fs from 'node:fs'
import { describe, expect, it } from 'vitest'
import { isAiToolingContentSource, sourceHasRenderableCardSurface, hasCreativeArtifactEvidence, selectContentSources } from '../../scripts/lib/source-selection-policy.mjs'

const fixture = JSON.parse(fs.readFileSync(new URL('../fixtures/related-note-quarantine.json', import.meta.url)))

describe('saved-note Related lists are navigation, not source prose', () => {
  for (const { source, note } of fixture.creative) {
    it(`does not quarantine real creative source ${source.url}`, () => {
      const signals = { notes_selected: [note] }
      const before = JSON.stringify({ source, signals })
      expect(isAiToolingContentSource(source, signals)).toBe(false)
      expect(sourceHasRenderableCardSurface(source, signals)).toBe(true)
      expect(hasCreativeArtifactEvidence(source, {}, signals)).toBe(false)
      expect(selectContentSources([source], { signalHarvest: signals, autoresearch: {} })).toEqual([])
      expect(JSON.stringify({ source, signals })).toBe(before)
    })
  }

  for (const heading of ['## Related', '### Related']) {
    for (const separator of [' ', '\n']) {
      it(`ignores only a wikilink list: ${heading}, ${JSON.stringify(separator)}`, () => {
        const source = { ...fixture.creative[0].source, note_excerpt: `${heading}${separator}- [[storyprotocol]]${separator}- [[AI & Agents]]${separator}A painted landscape.` }
        expect(isAiToolingContentSource(source)).toBe(false)
      })
    }
    for (const prose of ['Use agent credentials to run the workflow.', 'Build on Solana blockchain with smart contracts.', 'Try this prompt.', 'Ask your LLM to structure your response.', 'This is a prompt guide.', 'AI & Agents', 'storyprotocol']) {
      it(`preserves source prose after ${heading}: ${prose}`, () => {
        const note = { ...fixture.creative[0].note, excerpt: `${heading} - [[unrelated-art]] ${prose}` }
        expect(isAiToolingContentSource(fixture.creative[0].source, { notes_selected: [note] })).toBe(true)
      })
    }
  }

  for (const source of fixture.tooling) {
    it(`retains real tooling pitch and parent provenance: ${source.url}`, () => {
      // Use the actual full captured pitch, not keywords standing in for it.
      const note = { id: 'tool', excerpt: `## Related - [[landscapes]]\n${source.description}` }
      const child = { ...fixture.creative[0].source, parent_source: source }
      expect(isAiToolingContentSource(source)).toBe(true)
      expect(isAiToolingContentSource(child)).toBe(true)
      expect(isAiToolingContentSource({ ...fixture.creative[0].source, editorial_evidence: [source] })).toBe(true)
      expect(isAiToolingContentSource({ ...fixture.creative[0].source, note_id: 'tool' }, { notes_selected: [note] })).toBe(true)
      expect(sourceHasRenderableCardSurface(child)).toBe(false)
    })
  }

  it('does not strip headings or wikilinks outside a Related navigation list', () => {
    for (const excerpt of ['## Related\nAsk your LLM to structure your response.', '## Sources - [[storyprotocol]]', 'The work uses [[AI & Agents]].', '## Related - [[art]]\n## Pitch\nTry this prompt.']) {
      expect(isAiToolingContentSource({ note_excerpt: excerpt })).toBe(true)
    }
  })

  it('never sanitizes inspected source prose, even if it resembles note navigation', () => {
    for (const field of ['description', 'visible_text', 'source_summary', 'caption']) {
      expect(isAiToolingContentSource({ [field]: '## Related - [[AI & Agents]]' })).toBe(true)
    }
  })
})
