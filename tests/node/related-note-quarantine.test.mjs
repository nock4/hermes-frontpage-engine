import fs from 'node:fs'
import { describe, expect, it } from 'vitest'
import { isAiToolingContentSource, sourceHasRenderableCardSurface, hasCreativeArtifactEvidence, selectContentSources } from '../../scripts/lib/source-selection-policy.mjs'

const fixture = JSON.parse(fs.readFileSync(new URL('../fixtures/related-note-quarantine.json', import.meta.url)))

describe('saved-note Related lists are navigation, not source prose', () => {
  it('keeps actual artist posts eligible for inspection despite saved taxonomy tags and bare related links', () => {
    const captured = JSON.parse(fs.readFileSync(new URL('../fixtures/artist-note-taxonomy.json', import.meta.url)))
    const before = JSON.stringify(captured)
    for (const source of captured.sources) {
      expect(isAiToolingContentSource(source, captured)).toBe(false)
      expect(sourceHasRenderableCardSurface(source, captured)).toBe(true)
      expect(hasCreativeArtifactEvidence(source, {}, captured)).toBe(false)
      const note = captured.notes_selected.find(n => n.id === source.note_id)
      for (const pitch of ['Try this prompt.', 'Use agent credentials to run the workflow.']) {
        expect(isAiToolingContentSource(source, { notes_selected: [{ ...note, excerpt: `${note.excerpt}\n${pitch}` }] })).toBe(true)
      }
    }
    expect(JSON.stringify(captured)).toBe(before)
  })
  it('still excludes owning NFT mint pitches rather than relying on navigation tags', () => {
    for (const title of ['Mint some on nfts dot gay', 'A rush to mint before mint out in just minutes']) {
      expect(isAiToolingContentSource({title})).toBe(true)
    }
    expect(isAiToolingContentSource({title:'A painting with mint green highlights'})).toBe(false)
  })
  it('does not strip source-body tags or frontmatter descriptions', () => {
    expect(isAiToolingContentSource({note_excerpt:'A note\ntags: AI & Agents'})).toBe(true)
    expect(isAiToolingContentSource({note_excerpt:'---\ntags: [art]\ndescription: Try this prompt.\n---\nPainting'})).toBe(true)
  })
  for (const { source, note } of fixture.creative) {
    const marketplaceRelease = source.url === 'https://x.com/0xassembly/status/2027589835947442483'
    it(`ignores navigation but preserves owning-source quarantine ${source.url}`, () => {
      const signals = { notes_selected: [note] }
      const before = JSON.stringify({ source, signals })
      // The real Paisajitos fixture is a marketplace release, not a Related-list
      // false positive. Keep its verbatim evidence rather than laundering it.
      expect(isAiToolingContentSource(source, signals)).toBe(marketplaceRelease)
      expect(sourceHasRenderableCardSurface(source, signals)).toBe(!marketplaceRelease)
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
