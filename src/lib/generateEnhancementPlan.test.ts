import { describe, expect, it } from 'vitest'

import { generateEnhancementPlan } from './generateEnhancementPlan'
import type { InterpretationRecord } from '../types/interpretation'
import type { ArtifactMapRecord, BriefRecord, SourceBindingSetRecord } from '../types/runtime'

const briefRecord: BriefRecord = {
  brief_id: 'brief-1',
  date: '2026-04-24',
  signal_cluster_ids: ['cluster-1'],
  research_node_ids: ['node-1'],
  mood: 'moody',
  material_language: ['paper'],
  lighting: 'soft',
  object_inventory: ['object'],
  interaction_grammar: {
    hero_count: 1,
    module_count: 2,
    window_strategy: 'source-window',
  },
  negative_constraints: ['no dashboard'],
}

const artifactMapRecord: ArtifactMapRecord = {
  artifact_map_id: 'map-1',
  viewport: {
    base_width: 1440,
    base_height: 900,
    aspect_ratio: '16:10',
  },
  default_cluster_id: 'cluster-1',
  default_artifact_id: 'artifact-1',
  artifacts: [
    {
      id: 'artifact-1',
      kind: 'hero',
      label: 'Hero artifact',
      artifact_type: 'placard',
      cluster_id: 'cluster-1',
      bounds: { x: 0.1, y: 0.2, w: 0.1, h: 0.1 },
      polygon: [[0.1, 0.2], [0.2, 0.2], [0.2, 0.3]],
      z_index: 2,
      source_binding_ids: ['binding-1'],
    },
  ],
}

const sourceBindingsRecord: SourceBindingSetRecord = {
  source_binding_set_id: 'bindings-1',
  bindings: [
    {
      id: 'binding-1',
      artifact_id: 'artifact-1',
      source_type: 'article',
      source_url: 'https://example.com/article',
      window_type: 'web',
      hover_behavior: 'preview',
      click_behavior: 'pin-open',
      playback_persistence: false,
      fallback_type: 'rich-preview',
      title: 'Example article',
      kicker: 'Research',
      excerpt: 'Example excerpt',
    },
  ],
}

function makeInterpretation(overrides: Partial<InterpretationRecord>): InterpretationRecord {
  return {
    interpretation_id: 'interp-1',
    edition_id: 'edition-1',
    plate_read_timestamp: '2026-04-24T17:10:00Z',
    scene_ontology: {
      primary: 'object-native',
      secondary: [],
      confidence: 0.9,
    },
    world_read: {
      summary: 'default summary',
      dominant_spatial_mode: 'contained',
      density: 'medium',
      legibility: 'high',
      mood: ['focused'],
    },
    visual_ecology: {
      dominant_objects: ['placard'],
      dominant_surfaces: ['paper'],
      dominant_structures: ['shelf'],
      negative_space_regions: [],
    },
    interaction_world: {
      class: 'object-native',
      recommended_behaviors: ['cabinet-drawer-behavior', 'object-memory'],
      rejected_behaviors: ['light-path-reaction'],
      reasoning: ['default reasoning'],
    },
    artifact_candidates: [
      {
        id: 'artifact-candidate-1',
        kind: 'hero',
        type: 'placard',
        strength: 0.88,
        bounds: { x: 0.1, y: 0.2, w: 0.1, h: 0.1 },
        supports: ['mechanical-reveal-system', 'hidden-self-aware-note'],
      },
    ],
    field_candidates: [],
    html_surfaces: [
      {
        id: 'surface-1',
        surface_type: 'paper',
        host: 'artifact',
        bounds: { x: 0.1, y: 0.2, w: 0.1, h: 0.1 },
        suitability: 0.87,
        supported_treatments: ['warped-paper-fragment', 'hidden-self-aware-note'],
      },
    ],
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
    release_notes: ['default release note'],
    ...overrides,
  }
}

describe('generateEnhancementPlan', () => {
  it('builds an object-native enhancement plan with artifact targets and runtime-safe subset', () => {
    const interpretation = makeInterpretation({})

    const plan = generateEnhancementPlan({
      editionId: 'edition-1',
      interpretation,
      brief: briefRecord,
      artifactMap: artifactMapRecord,
      sourceBindings: sourceBindingsRecord,
      analysisId: 'analysis-1',
    })

    expect(plan.interaction_world.class).toBe('object-native')
    expect(plan.bundle.primary).toContain('mechanical-reveal-system')
    expect(plan.runtime_safe_subset).not.toContain('hidden-self-aware-note')
    expect(plan.bundle.secondary).not.toContain('hidden-self-aware-note')
    expect(plan.targets.flatMap((target) => target.techniques)).not.toContain('hidden-self-aware-note')
    expect(plan.runtime_safe_subset).toContain('mechanical-reveal-system')
    expect(plan.future_only_subset).not.toContain('mechanical-reveal-system')
    expect(plan.targets.some((target) => target.target_kind === 'artifact')).toBe(true)
    expect(plan.rejected.some((entry) => entry.technique === 'light-path-reveal')).toBe(true)
  })

  it('builds a field-native enhancement plan with field-region targets and rejects drawer logic', () => {
    const interpretation = makeInterpretation({
      scene_ontology: {
        primary: 'field-native',
        secondary: [],
        confidence: 0.93,
      },
      interaction_world: {
        class: 'field-native',
        recommended_behaviors: ['light-path-reaction', 'lens-inspection'],
        rejected_behaviors: ['cabinet-drawer-behavior'],
        reasoning: ['Landscape first'],
      },
      field_candidates: [
        {
          id: 'field-1',
          type: 'water-band',
          strength: 0.82,
          bounds: { x: 0.2, y: 0.55, w: 0.3, h: 0.12 },
          supports: ['light-path-reveal', 'route-overlay'],
        },
      ],
      html_surfaces: [
        {
          id: 'surface-field-1',
          surface_type: 'water',
          host: 'field-region',
          bounds: { x: 0.2, y: 0.55, w: 0.3, h: 0.12 },
          suitability: 0.84,
          supported_treatments: ['ghost-reflection-treatment', 'light-path-reveal'],
        },
      ],
      enhancement_bundle: {
        primary: ['light-path-reveal'],
        secondary: ['route-overlay', 'lens-inspection'],
        wildcard: [],
      },
      scene_wide_behavior: {
        selected: 'light-path-reaction',
      },
      choreography_rule: {
        selected: 'distributed-field-reveal',
      },
    })

    const plan = generateEnhancementPlan({
      editionId: 'edition-1',
      interpretation,
      brief: briefRecord,
      artifactMap: artifactMapRecord,
      sourceBindings: sourceBindingsRecord,
    })

    expect(plan.interaction_world.class).toBe('field-native')
    expect(plan.bundle.primary).toEqual(['light-path-reveal'])
    expect(plan.targets.some((target) => target.target_kind === 'field-region')).toBe(true)
    expect(plan.runtime_safe_subset).toContain('light-path-reveal')
    expect(plan.future_only_subset).not.toContain('light-path-reveal')
    expect(plan.rejected.some((entry) => entry.technique === 'mechanical-reveal-system')).toBe(true)
  })

  it('builds a material-native enhancement plan with painterly techniques and material-friendly rejections', () => {
    const interpretation = makeInterpretation({
      scene_ontology: {
        primary: 'material-native',
        secondary: [],
        confidence: 0.94,
      },
      interaction_world: {
        class: 'material-native',
        recommended_behaviors: ['paint-bleed-reveal', 'restoration-scan'],
        rejected_behaviors: ['cabinet-drawer-behavior'],
        reasoning: ['Painterly surface dominates'],
      },
      html_surfaces: [
        {
          id: 'surface-paint-1',
          surface_type: 'paint',
          host: 'surface-region',
          bounds: { x: 0.15, y: 0.25, w: 0.4, h: 0.35 },
          suitability: 0.89,
          supported_treatments: ['paint-bleed-reveal', 'pigment-crack-annotation'],
        },
      ],
      enhancement_bundle: {
        primary: ['paint-bleed-reveal'],
        secondary: ['restoration-scan', 'pigment-crack-annotation'],
        wildcard: [],
      },
      scene_wide_behavior: {
        selected: 'restoration-scan',
      },
      choreography_rule: {
        selected: 'narrative-reveal-order',
      },
    })

    const plan = generateEnhancementPlan({
      editionId: 'edition-1',
      interpretation,
      brief: briefRecord,
      artifactMap: artifactMapRecord,
      sourceBindings: sourceBindingsRecord,
    })

    expect(plan.interaction_world.class).toBe('material-native')
    expect(plan.bundle.primary).toContain('paint-bleed-reveal')
    expect(plan.targets.some((target) => target.target_kind === 'surface-region')).toBe(true)
    expect(plan.runtime_safe_subset).toContain('restoration-scan')
    expect(plan.future_only_subset).toContain('paint-bleed-reveal')
    expect(plan.future_only_subset).not.toContain('restoration-scan')
    expect(plan.rejected.some((entry) => entry.technique === 'screen-rendered-html')).toBe(true)
  })

  it('carries source classes onto artifact targets when bindings exist', () => {
    const interpretation = makeInterpretation({
      artifact_candidates: [
        {
          id: 'artifact-1',
          kind: 'hero',
          type: 'habitat-vitrine',
          strength: 0.92,
          bounds: { x: 0.1, y: 0.2, w: 0.1, h: 0.1 },
          supports: ['screen-rendered-html', 'threshold-scan-reveal'],
        },
      ],
      enhancement_bundle: {
        primary: ['screen-rendered-html'],
        secondary: ['threshold-scan-reveal'],
        wildcard: [],
      },
    })

    const plan = generateEnhancementPlan({
      editionId: 'edition-1',
      interpretation,
      brief: briefRecord,
      artifactMap: artifactMapRecord,
      sourceBindings: {
        ...sourceBindingsRecord,
        bindings: [
          {
            ...sourceBindingsRecord.bindings[0],
            source_type: 'youtube',
            window_type: 'video',
          },
        ],
      },
    })

    const target = plan.targets.find((entry) => entry.artifact_id === 'artifact-1')
    expect(target?.source_classes).toContain('video')
    expect(target?.source_classes).toContain('youtube')
  })
})
