import { describe, expect, it } from 'vitest'
import { clearEncounterTrail, createInteractionState, getInteractionGeometry, getPackagedMaterialPath, interactionReducer, isInteractionLabMode, loadEncounterTrail, pickLabArtifacts, saveEncounterTrail, storageKey, type Encounter } from './interactionLab'

const artifacts = Array.from({ length: 8 }, (_, index) => ({ id: `a-${index}` }))

describe('interaction lab opt-in', () => {
  it('is disabled unless the explicit query flag is one', () => {
    expect(isInteractionLabMode('')).toBe(false)
    expect(isInteractionLabMode('?interaction-lab=0')).toBe(false)
    expect(isInteractionLabMode('?interaction-lab=1')).toBe(true)
  })

  it('selects the same first six bound artifacts in edition order', () => {
    const bound = new Set(['a-0', 'a-1', 'a-2', 'a-3', 'a-4', 'a-5', 'a-6'])
    expect(pickLabArtifacts(artifacts, bound).map(({ id }) => id)).toEqual(['a-0', 'a-1', 'a-2', 'a-3', 'a-4', 'a-5'])
  })
})

describe('ordered artifact actions', () => {
  it('reveals locally first and requests the source second', () => {
    const encounter: Encounter = { artifactId: 'a-0', sourceUrl: 'https://example.com/work', sourceTitle: 'Work', order: 1, discoveredAt: 10 }
    const revealed = interactionReducer(createInteractionState(), { type: 'activate', encounter })
    expect(revealed.revealedArtifactIds).toEqual(['a-0'])
    expect(revealed.openSourceUrl).toBeNull()
    expect(revealed.trail).toEqual([encounter])

    const opened = interactionReducer(revealed, { type: 'activate', encounter: { ...encounter, discoveredAt: 20 } })
    expect(opened.openSourceUrl).toBe('https://example.com/work')
    expect(opened.trail).toHaveLength(1)
  })

  it('clears all per-edition discoveries', () => {
    const state = interactionReducer(createInteractionState(), { type: 'hydrate', trail: [{ artifactId: 'a', sourceUrl: null, sourceTitle: 'A', order: 1, discoveredAt: 1 }] })
    expect(interactionReducer(state, { type: 'clear' })).toEqual(createInteractionState())
  })
})

describe('encounter trail storage', () => {
  it('versions and round-trips valid per-edition encounters', () => {
    const values = new Map<string, string>()
    const storage = { getItem: (key: string) => values.get(key) ?? null, setItem: (key: string, value: string) => values.set(key, value), removeItem: (key: string) => values.delete(key) }
    const trail: Encounter[] = [{ artifactId: 'a', sourceUrl: 'https://example.com', sourceTitle: 'Example', order: 1, discoveredAt: 1 }]
    saveEncounterTrail(storage, 'edition-x', trail)
    expect(JSON.parse(values.get(storageKey('edition-x'))!).version).toBe(1)
    expect(loadEncounterTrail(storage, 'edition-x')).toEqual(trail)
  })

  it.each(['not json', '{"version":2,"trail":[]}', '{"version":1,"trail":[{"artifactId":4}]}'])('rejects corrupt or incompatible storage: %s', (raw) => {
    const storage = { getItem: () => raw, setItem: () => undefined, removeItem: () => true }
    expect(loadEncounterTrail(storage, 'edition-x')).toEqual([])
  })

  it('keeps storage write and clear failures nonblocking', () => {
    const storage = {
      getItem: () => null,
      setItem: () => { throw new DOMException('blocked') },
      removeItem: () => { throw new DOMException('blocked') },
    }
    expect(() => saveEncounterTrail(storage, 'edition-x', [])).not.toThrow()
    expect(() => clearEncounterTrail(storage, 'edition-x')).not.toThrow()
  })
})

describe('interaction geometry', () => {
  it('uses the expanded interaction mesh for the target and visible artifact geometry for the reveal', () => {
    const geometry = getInteractionGeometry({
      bounds: { x: .2, y: .3, w: .2, h: .1 },
      polygon: [[.2, .3], [.4, .3], [.3, .4]],
      interaction_mesh: {
        hover_bounds: { x: .15, y: .25, w: .3, h: .2 },
        hover_polygon: [[.15, .25], [.45, .25], [.4, .45], [.15, .4]],
      },
    })
    expect(geometry.target.bounds).toEqual({ x: .15, y: .25, w: .3, h: .2 })
    expect(geometry.target.clipPath).toBe('polygon(0% 0%, 100% 0%, 83.333333% 100%, 0% 75%)')
    expect(geometry.visual.bounds.x).toBeCloseTo(1 / 6)
    expect(geometry.visual.bounds.y).toBeCloseTo(.25)
    expect(geometry.visual.bounds.w).toBeCloseTo(2 / 3)
    expect(geometry.visual.bounds.h).toBeCloseTo(.5)
    expect(geometry.visual.clipPath).toBe('polygon(0% 0%, 100% 0%, 50% 100%)')
  })

  it('falls back to visible geometry when an expanded mesh is absent', () => {
    const bounds = { x: .2, y: .3, w: .2, h: .1 }
    expect(getInteractionGeometry({ bounds, polygon: [] }).target.bounds).toEqual(bounds)
  })

  it.each([
    { x: .1, y: .1, w: 0, h: .2 },
    { x: .1, y: .1, w: -.2, h: .2 },
    { x: .1, y: .1, w: Number.NaN, h: .2 },
    { x: .1, y: .1, w: .2, h: Number.POSITIVE_INFINITY },
  ])('rejects invalid hover bounds and falls back to valid artifact bounds: %j', (hoverBounds) => {
    const bounds = { x: .2, y: .3, w: .2, h: .1 }
    const geometry = getInteractionGeometry({ bounds, polygon: [], interaction_mesh: { hover_bounds: hoverBounds, hover_polygon: [] } })
    expect(geometry.target.bounds).toEqual(bounds)
    expect(geometry.visual.bounds).toEqual({ x: 0, y: 0, w: 1, h: 1 })
  })

  it.each([
    { x: 0, y: 0, w: 0, h: 1 },
    { x: 0, y: 0, w: 1, h: -1 },
    { x: Number.NaN, y: 0, w: 1, h: 1 },
    { x: 0, y: Number.NEGATIVE_INFINITY, w: 1, h: 1 },
  ])('replaces invalid visible bounds with finite clamped geometry: %j', (bounds) => {
    const geometry = getInteractionGeometry({ bounds, polygon: [], interaction_mesh: { hover_bounds: { x: -.5, y: -.5, w: 2, h: 2 }, hover_polygon: [] } })
    expect(geometry.target.bounds).toEqual({ x: 0, y: 0, w: 1, h: 1 })
    expect(geometry.visual.bounds).toEqual({ x: 0, y: 0, w: 1, h: 1 })
    expect(Object.values(geometry.visual.bounds).every((value) => Number.isFinite(value) && value >= 0 && value <= 1)).toBe(true)
  })
})

describe('material assets', () => {
  it('allows only packaged posters from the active edition', () => {
    const plate = '/editions/edition-a/assets/plate.webp'
    expect(getPackagedMaterialPath('/editions/edition-a/assets/source-posters/poster.jpg', 'edition-a', plate)).toBe('/editions/edition-a/assets/source-posters/poster.jpg')
    for (const unsafe of [
      'https://remote.test/poster.jpg',
      '//remote.test/poster.jpg',
      '/editions/edition-b/assets/source-posters/poster.jpg',
      '/editions/edition-a/assets/source-posters/../../remote.jpg',
      '/editions/edition-a/assets/source-posters/poster.jpg?remote=https://remote.test',
    ]) expect(getPackagedMaterialPath(unsafe, 'edition-a', plate)).toBe(plate)
  })

  it.each([
    '/editions/edition-a/assets/source-posters/%2e%2e/remote.jpg',
    '/editions/edition-a/assets/source-posters/%252e%252e%252fremote.jpg',
    '/editions/edition-a/assets/source-posters/folder%2fremote.jpg',
    '/editions/edition-a/assets/source-posters/folder%5cremote.jpg',
  ])('rejects encoded traversal and separators in poster paths: %s', (poster) => {
    expect(getPackagedMaterialPath(poster, 'edition-a', '/editions/edition-a/assets/plate.webp')).toBe('/editions/edition-a/assets/plate.webp')
  })

  it('preserves safe encoded filename characters', () => {
    const poster = '/editions/edition-a/assets/source-posters/a%20caf%C3%A9.jpg'
    expect(getPackagedMaterialPath(poster, 'edition-a', '/editions/edition-a/assets/plate.webp')).toBe(poster)
  })

  it.each([
    'https://remote.test/plate.webp',
    '//remote.test/plate.webp',
    '/editions/edition-b/assets/plate.webp',
    '/editions/edition-a/assets/%2e%2e/plate.webp',
    '/editions/edition-a/assets/folder%2fplate.webp',
    '/editions/edition-a/assets/plate.webp?cache=1',
  ])('returns null instead of an unsafe plate fallback: %s', (plate) => {
    expect(getPackagedMaterialPath('https://remote.test/poster.jpg', 'edition-a', plate)).toBeNull()
  })
})
