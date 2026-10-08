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

export const getInteractionGeometry = (artifact: GeometryArtifact) => {
  const targetBounds = artifact.interaction_mesh?.hover_bounds || artifact.bounds
  const targetPolygon = artifact.interaction_mesh?.hover_polygon || artifact.polygon
  return {
    target: { bounds: targetBounds, clipPath: polygonClip(targetPolygon, targetBounds) },
    visual: {
      bounds: {
        x: (artifact.bounds.x - targetBounds.x) / targetBounds.w,
        y: (artifact.bounds.y - targetBounds.y) / targetBounds.h,
        w: artifact.bounds.w / targetBounds.w,
        h: artifact.bounds.h / targetBounds.h,
      },
      clipPath: polygonClip(artifact.polygon, artifact.bounds),
    },
  }
}

export const getPackagedMaterialPath = (posterPath: string | undefined, editionId: string, platePath: string) => {
  const prefix = `/editions/${editionId}/assets/source-posters/`
  const isPackagedPoster = typeof posterPath === 'string'
    && posterPath.startsWith(prefix)
    && posterPath.length > prefix.length
    && !posterPath.includes('..')
    && !/[?#\\]/.test(posterPath)
  return isPackagedPoster ? posterPath : platePath
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
  storage.setItem(storageKey(editionId), JSON.stringify({ version: 1, trail }))
}

export const clearEncounterTrail = (storage: StorageLike, editionId: string) => storage.removeItem(storageKey(editionId))
