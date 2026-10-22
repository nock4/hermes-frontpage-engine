/// <reference types="vite/client" />
import { describe, expect, it } from 'vitest'
import { MIN_SOURCE_WINDOWS, MAX_SOURCE_WINDOWS } from './sourceWindowCountContract.mjs'
import manifest from '../../public/editions/index.json'
import charcoalArtifactMap from '../../public/editions/2026-04-27-charcoal-spiral-observatory-v1/artifact-map.json'
import vermilionArtifactMap from '../../public/editions/2026-04-27-vermilion-arc-astrolabe-v1/artifact-map.json'
import magentaArtifactMap from '../../public/editions/2026-04-26-magenta-quiet-gate-v1/artifact-map.json'

type ArtifactMap = { artifacts: unknown[] }
type SourceBinding = { source_url?: string | null; source_title?: string | null; title: string }
type SourceBindings = { bindings: SourceBinding[] }

const liveEditionId = manifest.current_edition_id
const artifactMapModules = import.meta.glob('../../public/editions/*/artifact-map.json', { eager: true, import: 'default' }) as Record<string, ArtifactMap>
const sourceBindingModules = import.meta.glob('../../public/editions/*/source-bindings.json', { eager: true, import: 'default' }) as Record<string, SourceBindings>
const currentArtifactMap = artifactMapModules[`../../public/editions/${liveEditionId}/artifact-map.json`]
const currentSourceBindings = sourceBindingModules[`../../public/editions/${liveEditionId}/source-bindings.json`]

if (!currentArtifactMap || !currentSourceBindings) {
  throw new Error(`Missing packaged test fixtures for live edition ${liveEditionId}`)
}

const packagedArtifactMaps = [
  currentArtifactMap,
  charcoalArtifactMap,
  vermilionArtifactMap,
  magentaArtifactMap,
]

describe('live edition curation rules', () => {
  it('keeps the current live edition within the shared count contract with no duplicate urls', () => {
    expect(manifest.current_edition_id).toBe(liveEditionId)

    const urls = currentSourceBindings.bindings
      .map((binding: { source_url?: string | null }) => binding.source_url)
      .filter(Boolean) as string[]

    expect(currentArtifactMap.artifacts.length).toBeGreaterThanOrEqual(MIN_SOURCE_WINDOWS)
    expect(currentArtifactMap.artifacts.length).toBeLessThanOrEqual(MAX_SOURCE_WINDOWS)
    expect(new Set(urls).size).toBe(urls.length)
  })

  it('keeps serious packaged iterations within the shared artifact range', () => {
    for (const artifactMap of packagedArtifactMaps) {
      expect(artifactMap.artifacts.length).toBeGreaterThanOrEqual(MIN_SOURCE_WINDOWS)
      expect(artifactMap.artifacts.length).toBeLessThanOrEqual(MAX_SOURCE_WINDOWS)
    }
  })

  it('keeps the current live edition source set populated with distinct titles', () => {
    const distinctTitles = new Set(
      currentSourceBindings.bindings.map((binding: { source_title?: string | null; title: string }) => binding.source_title || binding.title),
    )

    expect(distinctTitles.size).toBeGreaterThanOrEqual(MIN_SOURCE_WINDOWS)
    expect(distinctTitles.size).toBe(currentSourceBindings.bindings.length)
  })
})
