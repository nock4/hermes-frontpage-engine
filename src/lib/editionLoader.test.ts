import { afterEach, describe, expect, it, vi } from 'vitest'
import { loadEditionPackage, loadManifest } from './editionLoader'
import type {
  AmbianceRecord,
  ArtifactMapRecord,
  BriefRecord,
  EditionManifest,
  EditionRecord,
  GeometryKitRecord,
  ReviewRecord,
  SourceBindingSetRecord,
  EnhancementPlanRecord,
} from '../types/runtime'
import type { AboutRecord } from '../types/about'
import type { InterpretationRecord } from '../types/interpretation'

afterEach(() => {
  vi.unstubAllGlobals()
})

type MockJsonPayload =
  | EditionManifest
  | EditionRecord
  | BriefRecord
  | ArtifactMapRecord
  | SourceBindingSetRecord
  | AmbianceRecord
  | ReviewRecord
  | GeometryKitRecord
  | EnhancementPlanRecord
  | AboutRecord
  | InterpretationRecord
  | {
      enhancement_plan_id: string
      edition_id: string
      global_recommendation: string[]
      html_in_canvas_candidates: Array<{
        artifact_id: string
        techniques: string[]
        reason?: string
      }>
      runtime_note?: string
    }
  | { current_edition_id: string; editions: string[] }
  | {
      source_binding_set_id: string
      bindings: Array<Omit<SourceBindingSetRecord['bindings'][number], 'window_type'> & { window_type: 'iframe' }>
    }

type MockFetchResponse = Pick<Response, 'ok' | 'headers' | 'json'>

const editionRecord: EditionRecord = {
  edition_id: 'ed-1',
  date: '2026-04-18',
  status: 'published',
  slug: 'test-edition',
  title: 'Test Edition',
  scene_family: 'signal-desk',
  brief_id: 'brief-1',
  plate_id: 'plate-1',
  artifact_map_id: 'map-1',
  source_binding_set_id: 'set-1',
  ambiance_recipe_id: 'amb-1',
  review_state_id: 'rev-1',
  publish_state: {
    is_live: true,
    published_at: '2026-04-18T12:00:00Z',
    archive_path: '/archive/test-edition',
  },
  plate_asset_path: '/plates/test-edition.webp',
}

const briefRecord: BriefRecord = {
  brief_id: 'brief-1',
  date: '2026-04-18',
  signal_cluster_ids: ['signal-1'],
  research_node_ids: ['node-1'],
  mood: 'luminous',
  material_language: ['paper'],
  lighting: 'warm',
  object_inventory: ['book'],
  interaction_grammar: {
    hero_count: 1,
    module_count: 1,
    window_strategy: 'pinboard',
  },
  negative_constraints: ['no dashboards'],
}

const artifactMapRecord: ArtifactMapRecord = {
  artifact_map_id: 'map-1',
  viewport: { base_width: 1280, base_height: 720, aspect_ratio: '16:9' },
  default_cluster_id: 'cluster-1',
  default_artifact_id: 'artifact-1',
  artifacts: [{
    id: 'artifact-1',
    kind: 'module',
    label: 'Artifact 1',
    artifact_type: 'paper-note',
    cluster_id: 'cluster-1',
    bounds: { x: 0.1, y: 0.2, w: 0.1, h: 0.1 },
    polygon: [[0.1, 0.2], [0.2, 0.2], [0.2, 0.3]],
    z_index: 1,
    source_binding_ids: ['binding-1'],
  }],
}

const sourceBindingsRecord: SourceBindingSetRecord = {
  source_binding_set_id: 'set-1',
  bindings: [{
    id: 'binding-1',
    artifact_id: 'artifact-1',
    source_type: 'article',
    source_url: 'https://example.com/story',
    window_type: 'web',
    hover_behavior: 'preview',
    click_behavior: 'pin-open',
    playback_persistence: false,
    fallback_type: 'rich-preview',
    title: 'Test Source',
    kicker: 'Research',
    excerpt: 'Test excerpt',
    source_title: 'Example Source',
    source_summary: 'Summary',
    source_domain: 'example.com',
    source_meta: '2026',
  }],
}

const ambianceRecord: AmbianceRecord = {
  ambiance_recipe_id: 'amb-1',
  motion_system: 'drift',
  color_drift: 'blue',
  glow_behavior: 'soft',
  audio_posture: 'quiet',
  webgl_mode: 'off',
  research_inputs: ['note'],
}

const reviewRecord: ReviewRecord = {
  review_state_id: 'rev-1',
  geometry_status: 'validated',
  clickability_status: 'validated',
  behavior_status: 'validated',
  editorial_status: 'validated',
  notes: ['Looks good'],
}

const geometryKitRecord: GeometryKitRecord = {
  'artifact-1': {
    geometry: {
      safe_stage_window_origin_px: [100, 120],
      safe_hover_origin_px: [90, 110],
      preferred_expansion_label: 'left',
    },
  },
}

const legacyEnhancementPlanPayload = {
  enhancement_plan_id: 'enhance-1',
  edition_id: 'ed-1',
  global_recommendation: ['screen-rendered-html'],
  html_in_canvas_candidates: [
    {
      artifact_id: 'artifact-1',
      techniques: ['screen-rendered-html', 'threshold-scan-reveal'],
      reason: 'Monitor surface',
    },
  ],
  runtime_note: 'Test enhancement plan',
}

const aboutRecord: AboutRecord = {
  about_id: 'about-1',
  label: 'About',
  kicker: 'Scene note',
  title: 'About this page',
  short_blurb: 'A concise note about the edition.',
  body: ['Paragraph one', 'Paragraph two'],
}

const interpretationRecord: InterpretationRecord = {
  interpretation_id: 'interp-1',
  edition_id: 'ed-1',
  plate_read_timestamp: '2026-04-24T17:10:00Z',
  scene_ontology: {
    primary: 'object-native',
    secondary: [],
    confidence: 0.91,
  },
  world_read: {
    summary: 'Cabinet-like scene with paper and glass surfaces.',
    dominant_spatial_mode: 'contained',
    density: 'medium',
    legibility: 'high',
    mood: ['quiet', 'archival'],
  },
  visual_ecology: {
    dominant_objects: ['cabinet', 'placard'],
    dominant_surfaces: ['paper', 'glass'],
    dominant_structures: ['shelves'],
    negative_space_regions: [],
  },
  interaction_world: {
    class: 'object-native',
    recommended_behaviors: ['cabinet-drawer-behavior', 'object-memory'],
    rejected_behaviors: ['light-path-reaction'],
    reasoning: ['Discrete container logic dominates the plate.'],
  },
  artifact_candidates: [],
  field_candidates: [],
  html_surfaces: [],
  enhancement_bundle: {
    primary: ['mechanical-reveal-system'],
    secondary: ['hidden-self-aware-note'],
    wildcard: [],
  },
  per_region_assignments: [],
  scene_wide_behavior: {
    selected: 'object-memory',
  },
  choreography_rule: {
    selected: 'anchor-and-satellites',
  },
  release_notes: ['Prefer object-bound interaction.'],
}

const createJsonResponse = (payload: MockJsonPayload): MockFetchResponse => ({
  ok: true,
  headers: new Headers({ 'content-type': 'application/json' }),
  json: async () => payload,
})

const createMissingResponse = (): MockFetchResponse => ({
  ok: false,
  headers: new Headers({ 'content-type': 'application/json' }),
  json: async () => ({}),
})

describe('loadEditionPackage', () => {
  it('loads optional geometry kit and merges geometry onto matching artifacts', async () => {
    const responses = new Map<string, MockJsonPayload>()
    responses.set('/editions/test/edition.json', editionRecord)
    responses.set('/editions/test/brief.json', briefRecord)
    responses.set('/editions/test/artifact-map.json', artifactMapRecord)
    responses.set('/editions/test/source-bindings.json', sourceBindingsRecord)
    responses.set('/editions/test/ambiance.json', ambianceRecord)
    responses.set('/editions/test/review.json', reviewRecord)
    responses.set('/editions/test/geometry-kit.json', geometryKitRecord)
    responses.set('/editions/test/enhancement-plan.json', legacyEnhancementPlanPayload)
    responses.set('/editions/test/about.json', aboutRecord)
    responses.set('/editions/test/interpretation.json', interpretationRecord)

    vi.stubGlobal('fetch', vi.fn(async (path: string): Promise<MockFetchResponse> => responses.has(path)
      ? createJsonResponse(responses.get(path)!)
      : createMissingResponse()))

    const loaded = await loadEditionPackage('/editions/test')
    expect(loaded.artifactMap.artifacts[0].geometry?.safe_stage_window_origin_px).toEqual([100, 120])
    expect(loaded.geometryKit?.['artifact-1']?.geometry?.preferred_expansion_label).toBe('left')
    expect(loaded.enhancementPlan?.targets[0]?.techniques).toContain('screen-rendered-html')
    expect(loaded.about?.title).toBe('About this page')
    expect(loaded.interpretation?.scene_ontology.primary).toBe('object-native')
    expect(loaded.interpretation?.enhancement_bundle.primary).toContain('mechanical-reveal-system')
  })

  it('treats non-json optional geometry responses as missing instead of parsing html', async () => {
    const responses = new Map<string, MockJsonPayload>()
    responses.set('/editions/test/edition.json', editionRecord)
    responses.set('/editions/test/brief.json', briefRecord)
    responses.set('/editions/test/artifact-map.json', artifactMapRecord)
    responses.set('/editions/test/source-bindings.json', sourceBindingsRecord)
    responses.set('/editions/test/ambiance.json', ambianceRecord)
    responses.set('/editions/test/review.json', reviewRecord)

    vi.stubGlobal('fetch', vi.fn(async (path: string): Promise<MockFetchResponse> => {
      if (path === '/editions/test/geometry-kit.json') {
        return {
          ok: true,
          headers: new Headers({ 'content-type': 'text/html' }),
          json: async () => {
            throw new Error('should not parse html as json')
          },
        }
      }

      return responses.has(path)
        ? createJsonResponse(responses.get(path)!)
        : createMissingResponse()
    }))

    const loaded = await loadEditionPackage('/editions/test')
    expect(loaded.geometryKit).toBeNull()
    expect(loaded.artifactMap.artifacts[0].geometry).toBeUndefined()
    expect(loaded.about).toBeNull()
  })

  it('strips logged-out platform shell text from source excerpts', async () => {
    const noisySourceBindingsPayload: MockJsonPayload = {
      source_binding_set_id: sourceBindingsRecord.source_binding_set_id,
      bindings: [{
        ...sourceBindingsRecord.bindings[0],
        source_url: 'https://x.com/example/status/123',
        excerpt: 'Don\u2019t miss what\u2019s happening People on X are the first to know. Log in Sign up Post See new posts Conversation Example @example A clean post about visible source material. New to X? Sign up now to get your own personalized timeline! Terms of Service | Privacy Policy',
        source_summary: 'Don\u2019t miss what\u2019s happening People on X are the first to know. Log in Sign up Post See new posts Conversation Example @example A clean post about visible source material. New to X? Sign up now to get your own personalized timeline! Terms of Service | Privacy Policy',
      }],
    }

    const responses = new Map<string, MockJsonPayload>()
    responses.set('/editions/test/edition.json', editionRecord)
    responses.set('/editions/test/brief.json', briefRecord)
    responses.set('/editions/test/artifact-map.json', artifactMapRecord)
    responses.set('/editions/test/source-bindings.json', noisySourceBindingsPayload)
    responses.set('/editions/test/ambiance.json', ambianceRecord)
    responses.set('/editions/test/review.json', reviewRecord)

    vi.stubGlobal('fetch', vi.fn(async (path: string): Promise<MockFetchResponse> => responses.has(path)
      ? createJsonResponse(responses.get(path)!)
      : createMissingResponse()))

    const loaded = await loadEditionPackage('/editions/test')
    expect(loaded.sourceBindings.bindings[0].excerpt).toBe('Example @example A clean post about visible source material.')
    expect(loaded.sourceBindings.bindings[0].source_summary).toBe('Example @example A clean post about visible source material.')
  })

  it('rejects structurally invalid source binding payloads', async () => {
    const invalidSourceBindingsPayload: MockJsonPayload = {
      source_binding_set_id: sourceBindingsRecord.source_binding_set_id,
      bindings: [{
        id: sourceBindingsRecord.bindings[0].id,
        artifact_id: sourceBindingsRecord.bindings[0].artifact_id,
        source_type: sourceBindingsRecord.bindings[0].source_type,
        source_url: sourceBindingsRecord.bindings[0].source_url,
        window_type: 'iframe',
        hover_behavior: sourceBindingsRecord.bindings[0].hover_behavior,
        click_behavior: sourceBindingsRecord.bindings[0].click_behavior,
        playback_persistence: sourceBindingsRecord.bindings[0].playback_persistence,
        fallback_type: sourceBindingsRecord.bindings[0].fallback_type,
        title: sourceBindingsRecord.bindings[0].title,
        kicker: sourceBindingsRecord.bindings[0].kicker,
        excerpt: sourceBindingsRecord.bindings[0].excerpt,
        source_title: sourceBindingsRecord.bindings[0].source_title,
        source_summary: sourceBindingsRecord.bindings[0].source_summary,
        source_domain: sourceBindingsRecord.bindings[0].source_domain,
        source_meta: sourceBindingsRecord.bindings[0].source_meta,
      }],
    }

    const responses = new Map<string, MockJsonPayload>()
    responses.set('/editions/test/edition.json', editionRecord)
    responses.set('/editions/test/brief.json', briefRecord)
    responses.set('/editions/test/artifact-map.json', artifactMapRecord)
    responses.set('/editions/test/source-bindings.json', invalidSourceBindingsPayload)
    responses.set('/editions/test/ambiance.json', ambianceRecord)
    responses.set('/editions/test/review.json', reviewRecord)

    vi.stubGlobal('fetch', vi.fn(async (path: string): Promise<MockFetchResponse> => responses.has(path)
      ? createJsonResponse(responses.get(path)!)
      : createMissingResponse()))

    await expect(loadEditionPackage('/editions/test')).rejects.toThrow(/window_type/)
  })
  it('rejects source binding payloads with unsafe source url schemes', async () => {
    const invalidSourceBindingsPayload: MockJsonPayload = {
      source_binding_set_id: sourceBindingsRecord.source_binding_set_id,
      bindings: [{
        ...sourceBindingsRecord.bindings[0],
        source_url: 'javascript:alert(1)',
      }],
    }

    const responses = new Map<string, MockJsonPayload>()
    responses.set('/editions/test/edition.json', editionRecord)
    responses.set('/editions/test/brief.json', briefRecord)
    responses.set('/editions/test/artifact-map.json', artifactMapRecord)
    responses.set('/editions/test/source-bindings.json', invalidSourceBindingsPayload)
    responses.set('/editions/test/ambiance.json', ambianceRecord)
    responses.set('/editions/test/review.json', reviewRecord)

    vi.stubGlobal('fetch', vi.fn(async (path: string): Promise<MockFetchResponse> => responses.has(path)
      ? createJsonResponse(responses.get(path)!)
      : createMissingResponse()))

    await expect(loadEditionPackage('/editions/test')).rejects.toThrow(/source_url/)
  })
})

it('preserves validated literal attested URLs through loader normalization', async () => {
  const bytes = Uint8Array.from([137,80,78,71,13,10,26,10,1,2,3])
  const hash = '7f47b756761a46e6d4a4d96f0d8a4448f8449235009d1f3ad1493f5c773c19e8'
  const source = 'https://Artist.example:443'
  const media = 'https://Artist.example:443/image.png'
  const asset = `/editions/test/assets/source-originals/${hash}.png`
  const responses = new Map<string, unknown>([
    ['/editions/test/edition.json', { ...editionRecord, edition_id: 'test' }],
    ['/editions/test/brief.json', briefRecord],
    ['/editions/test/artifact-map.json', artifactMapRecord],
    ['/editions/test/ambiance.json', ambianceRecord],
    ['/editions/test/review.json', reviewRecord],
    ['/editions/test/source-bindings.json', {
      source_binding_set_id: 'bindings-test', bindings: [{ ...sourceBindingsRecord.bindings[0],
        source_url: source, source_image_url: media, source_media_url: media, source_media_type: 'image',
        source_image_delivery: { version: 1, kind: 'attested-full-original', edition_id: 'test',
          source_url: source, media_url: media, capture_sha256: hash, mime_type: 'image/png',
          byte_length: bytes.length, asset_path: asset },
      }],
    }],
  ])
  vi.stubGlobal('fetch', vi.fn(async (url: string) => url === asset
    ? new Response(bytes, { headers: { 'content-type': 'image/png' } })
    : responses.has(url) ? new Response(JSON.stringify(responses.get(url)), { headers: { 'content-type': 'application/json' } })
      : new Response('', { status: 404 })))
  const loaded = await loadEditionPackage('/editions/test')
  expect(loaded.sourceBindings.bindings[0].source_url).toBe(source)
  expect(loaded.sourceBindings.bindings[0].source_image_url).toBe(media)
})

describe('loadManifest', () => {
  it('rejects invalid manifest payloads instead of trusting casts', async () => {
    vi.stubGlobal('fetch', vi.fn(async (): Promise<MockFetchResponse> => ({
      ok: true,
      headers: new Headers({ 'content-type': 'application/json' }),
      json: async () => ({ current_edition_id: 'ed-1', editions: ['oops'] }),
    })))

    await expect(loadManifest()).rejects.toThrow(/editions\[0\]/)
  })
})
