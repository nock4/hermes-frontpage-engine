import { inspectedDecision } from '../fixtures/creative-inspection.mjs'
import { readFileSync } from 'node:fs'
import { describe, it, expect } from 'vitest'
import { selectContentSources } from '../../scripts/lib/source-selection-policy.mjs'
import { getResearchContentSources } from '../../scripts/lib/source-research.mjs'
import { assembleEditionPackage } from '../../scripts/lib/edition-package-assembly.mjs'
const { content_sources: sources, autoresearch } = JSON.parse(readFileSync(new URL('../fixtures/source-eligibility-sept30.json', import.meta.url)))

autoresearch.source_decisions.push(inspectedDecision(sources[0])) // synthetic contract fixture, not production proof

describe('September 30 evidence-backed creative eligibility', () => {
  it('does not refill with unreviewed products, sponsored events or unverified conceptual UI', () => {
    expect(selectContentSources(sources, { autoresearch })).toEqual([sources[0]])
    expect(getResearchContentSources({ sources, content_sources: sources, autoresearch }).map(s => s.url)).toEqual([sources[0].url])
  })
  it('fails closed for unknown evidence, even with a decoded-looking image and high score', () => {
    expect(selectContentSources([sources[0]], { autoresearch: { source_decisions: [] } })).toEqual([])
  })
  it('retains inspected AI artwork without banning AI language or its host', () => {
    expect(selectContentSources([sources[0]], { autoresearch })).toEqual([sources[0]])
  })
  it('accepts an inspected actual game artifact, not the sponsored game-jam advertisement', () => {
    const game = { url: 'https://new-artist.example/game', title: 'AI-made game', image_url: 'https://new-artist.example/scene.jpg', description: 'A playable hand-painted garden game' }
    const research = { source_decisions: [inspectedDecision(game, 'game')] }
    expect(selectContentSources([game], { autoresearch: research })).toEqual([game])
  })
  it.each([sources[1], sources[2], sources[4], sources[5], { url: 'https://unknown.example/art', image_url: 'https://unknown.example/art.jpg' }])('fails package assembly before any filesystem writes for $url', async (source) => {
    await expect(assembleEditionPackage({ root: '/does-not-exist-test-root', options: {}, payload: { artifacts: [{ source_url: source.url }] }, researchField: { sources, content_sources: sources, autoresearch }, signalHarvest: {} })).rejects.toThrow(/editorial/i)
  })
})
