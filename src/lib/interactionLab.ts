export interface Encounter {
  artifactId: string
  sourceUrl: string | null
  sourceTitle: string
  order: number
  discoveredAt: number
}

export interface InteractionState {
  revealedArtifactIds: string[]
  trail: Encounter[]
  openSourceUrl: string | null
}

type Bounds = { x: number; y: number; w: number; h: number }
type Point = [number, number]
type GeometryArtifact = {
  bounds: Bounds
  polygon: Point[]
  interaction_mesh?: { hover_bounds?: Bounds; hover_polygon?: Point[] }
}

const polygonClip = (polygon: Point[] | undefined, bounds: Bounds) => {
  if (!polygon || polygon.length < 3 || bounds.w <= 0 || bounds.h <= 0) return undefined
  const percent = (value: number) => Number((value * 100).toFixed(6))
  return `polygon(${polygon.map(([x, y]) => `${percent((x - bounds.x) / bounds.w)}% ${percent((y - bounds.y) / bounds.h)}%`).join(', ')})`
}

const isValidBounds = (bounds: Bounds | undefined): bounds is Bounds => {
  if (!bounds) return false
  return Number.isFinite(bounds.x)
    && Number.isFinite(bounds.y)
    && Number.isFinite(bounds.w)
    && Number.isFinite(bounds.h)
    && bounds.w > 0
    && bounds.h > 0
}

const clampUnit = (value: number) => Math.min(1, Math.max(0, Number.isFinite(value) ? value : 0))

export const getInteractionGeometry = (artifact: GeometryArtifact) => {
  const hasValidVisibleBounds = isValidBounds(artifact.bounds)
  const visibleBounds = hasValidVisibleBounds ? artifact.bounds : { x: 0, y: 0, w: 1, h: 1 }
  const hasValidHoverBounds = hasValidVisibleBounds && isValidBounds(artifact.interaction_mesh?.hover_bounds)
  const targetBounds = hasValidHoverBounds ? artifact.interaction_mesh!.hover_bounds! : visibleBounds
  const targetPolygon = hasValidHoverBounds ? artifact.interaction_mesh?.hover_polygon : artifact.polygon
  const visualLeft = clampUnit((visibleBounds.x - targetBounds.x) / targetBounds.w)
  const visualTop = clampUnit((visibleBounds.y - targetBounds.y) / targetBounds.h)
  const visualRight = clampUnit((visibleBounds.x + visibleBounds.w - targetBounds.x) / targetBounds.w)
  const visualBottom = clampUnit((visibleBounds.y + visibleBounds.h - targetBounds.y) / targetBounds.h)
  return {
    target: { bounds: targetBounds, clipPath: polygonClip(targetPolygon, targetBounds) },
    visual: {
      bounds: {
        x: visualLeft,
        y: visualTop,
        w: visualRight - visualLeft,
        h: visualBottom - visualTop,
      },
      clipPath: hasValidVisibleBounds ? polygonClip(artifact.polygon, visibleBounds) : undefined,
    },
  }
}

const hasUnsafePathEncoding = (path: string) => {
  let decoded = path
  for (let depth = 0; depth < 16; depth += 1) {
    if (/%(?:2e|2f|5c)/i.test(decoded)) return true
    let next: string
    try {
      next = decodeURIComponent(decoded)
    } catch {
      return true
    }
    if (/[?#\\]/.test(next)) return true
    if (next === decoded) return false
    decoded = next
  }
  return true
}

const isPackagedPath = (path: string | undefined, prefix: string) => {
  if (typeof path !== 'string' || !path.startsWith(prefix) || path.length <= prefix.length) return false
  if (/[?#\\]/.test(path) || hasUnsafePathEncoding(path)) return false
  try {
    const parsed = new URL(path, 'https://packaged.invalid')
    return parsed.origin === 'https://packaged.invalid'
      && parsed.pathname === path
      && parsed.search === ''
      && parsed.hash === ''
      && parsed.pathname.startsWith(prefix)
  } catch {
    return false
  }
}

export const getPackagedMaterialPath = (posterPath: string | undefined, editionId: string, platePath: string) => {
  if (!editionId || encodeURIComponent(editionId) !== editionId) return null
  const assetPrefix = `/editions/${editionId}/assets/`
  const posterPrefix = `${assetPrefix}source-posters/`
  if (isPackagedPath(posterPath, posterPrefix)) return posterPath!
  return isPackagedPath(platePath, assetPrefix) ? platePath : null
}

type StorageLike = Pick<Storage, 'getItem' | 'setItem' | 'removeItem'>

type InteractionAction =
  | { type: 'activate'; encounter: Encounter }
  | { type: 'hydrate'; trail: Encounter[] }
  | { type: 'source-opened' }
  | { type: 'clear' }

export const isInteractionLabMode = (search: string) => new URLSearchParams(search).get('interaction-lab') === '1'

export const pickLabArtifacts = <T extends { id: string }>(artifacts: T[], boundArtifactIds: Set<string>) =>
  artifacts.filter((artifact) => boundArtifactIds.has(artifact.id)).slice(0, 6)

export const createInteractionState = (): InteractionState => ({ revealedArtifactIds: [], trail: [], openSourceUrl: null })

export const interactionReducer = (state: InteractionState, action: InteractionAction): InteractionState => {
  if (action.type === 'clear') return createInteractionState()
  if (action.type === 'source-opened') return { ...state, openSourceUrl: null }
  if (action.type === 'hydrate') return {
    revealedArtifactIds: action.trail.map(({ artifactId }) => artifactId),
    trail: action.trail,
    openSourceUrl: null,
  }

  if (state.revealedArtifactIds.includes(action.encounter.artifactId)) {
    return { ...state, openSourceUrl: action.encounter.sourceUrl }
  }
  return {
    revealedArtifactIds: [...state.revealedArtifactIds, action.encounter.artifactId],
    trail: [...state.trail, { ...action.encounter, order: state.trail.length + 1 }],
    openSourceUrl: null,
  }
}

export const storageKey = (editionId: string) => `daily-frontpage:interaction-lab:v1:${editionId}`

const isEncounter = (value: unknown): value is Encounter => {
  if (!value || typeof value !== 'object') return false
  const item = value as Record<string, unknown>
  return typeof item.artifactId === 'string'
    && (typeof item.sourceUrl === 'string' || item.sourceUrl === null)
    && typeof item.sourceTitle === 'string'
    && Number.isInteger(item.order)
    && typeof item.discoveredAt === 'number'
}

export const loadEncounterTrail = (storage: StorageLike, editionId: string): Encounter[] => {
  try {
    const raw = storage.getItem(storageKey(editionId))
    if (!raw) return []
    const parsed = JSON.parse(raw) as { version?: unknown; trail?: unknown }
    if (parsed.version !== 1 || !Array.isArray(parsed.trail) || !parsed.trail.every(isEncounter)) return []
    return parsed.trail
  } catch {
    return []
  }
}

export const saveEncounterTrail = (storage: StorageLike, editionId: string, trail: Encounter[]) => {
  try {
    storage.setItem(storageKey(editionId), JSON.stringify({ version: 1, trail }))
  } catch {
    // Persistence is optional; interaction must remain available when storage is blocked.
  }
}

export const clearEncounterTrail = (storage: StorageLike, editionId: string) => {
  try {
    storage.removeItem(storageKey(editionId))
  } catch {
    // Clearing UI state must remain available when storage is blocked.
  }
}
