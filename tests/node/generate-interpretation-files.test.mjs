import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'

import { afterEach, describe, expect, it } from 'vitest'

import { generateInterpretationFiles } from '../../scripts/lib/generate-interpretation-files.mjs'

const tempDirs = []

afterEach(() => {
  while (tempDirs.length) {
    fs.rmSync(tempDirs.pop(), { recursive: true, force: true })
  }
})

function makeTempRepo() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'dfe-interpret-'))
  tempDirs.push(dir)
  fs.mkdirSync(path.join(dir, 'public', 'editions', 'sample-edition'), { recursive: true })
  return dir
}

function writeJson(filePath, value) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true })
  fs.writeFileSync(filePath, JSON.stringify(value, null, 2))
}

describe('generateInterpretationFiles', () => {
  it('writes interpretation.json for editions with the required package files', async () => {
    const repoRoot = makeTempRepo()
    const editionsRoot = path.join(repoRoot, 'public', 'editions')

    writeJson(path.join(editionsRoot, 'index.json'), {
      current_edition_id: 'edition-1',
      editions: [
        {
          edition_id: 'edition-1',
          date: '2026-04-24',
          slug: 'sample-edition',
          title: 'Sample Edition',
          path: '/editions/sample-edition',
          scene_family: 'forest-breath-cabinet',
          motif_tags: ['forest', 'cabinet', 'ambient'],
          preview_asset_path: '/editions/sample-edition/assets/preview.jpg',
          is_live: true,
        },
      ],
    })

    const editionBase = path.join(editionsRoot, 'sample-edition')
    writeJson(path.join(editionBase, 'edition.json'), {
      edition_id: 'edition-1',
      date: '2026-04-24',
      status: 'draft',
      slug: 'sample-edition',
      title: 'Sample Edition',
      scene_family: 'forest-breath-cabinet',
      brief_id: 'brief-1',
      plate_id: 'plate-1',
      artifact_map_id: 'map-1',
      source_binding_set_id: 'bindings-1',
      ambiance_recipe_id: 'amb-1',
      review_state_id: 'review-1',
      publish_state: {
        is_live: false,
        published_at: null,
        archive_path: null,
      },
      plate_asset_path: '/editions/sample-edition/assets/plate.jpg',
    })
    writeJson(path.join(editionBase, 'brief.json'), {
      brief_id: 'brief-1',
      date: '2026-04-24',
      signal_cluster_ids: ['cluster-1'],
      research_node_ids: ['node-1'],
      mood: 'moody cabinet room',
      material_language: ['dark wood', 'paper'],
      lighting: 'soft lamp glow',
      object_inventory: ['placard', 'cabinet'],
      interaction_grammar: {
        hero_count: 1,
        module_count: 2,
        window_strategy: 'source-window',
      },
      negative_constraints: ['no dashboard'],
    })
    writeJson(path.join(editionBase, 'artifact-map.json'), {
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
          label: 'Main cabinet plaque',
          artifact_type: 'catalogue-plaque',
          cluster_id: 'cluster-1',
          bounds: { x: 0.1, y: 0.1, w: 0.2, h: 0.1 },
          polygon: [[0.1, 0.1], [0.3, 0.1], [0.3, 0.2]],
          z_index: 1,
          source_binding_ids: ['binding-1'],
        },
      ],
    })
    writeJson(path.join(editionBase, 'source-bindings.json'), {
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
    })
    writeJson(path.join(editionBase, 'interpretation.json'), {
      plate_read_timestamp: '2026-04-24T17:10:00Z',
    })

    writeJson(path.join(editionBase, 'analysis.json'), {
      analysis_id: 'analysis-1',
      edition_id: 'edition-1',
      scene_summary: 'A dim ecological listening station built around an antique cabinet.',
      detected_objects: [
        { label: 'Environmental Sound Catalogue plaque', role: 'hero-anchor' },
        { label: 'field recordings box', role: 'archive container' },
      ],
      usable_surfaces: ['catalogue plaque', 'field recordings box'],
    })
    writeJson(path.join(editionBase, 'geometry-kit.json'), {
      'artifact-1': {
        artifact_type: 'catalogue-plaque',
        winner: 'depth-semantic',
        scores: {
          'depth-semantic': { total: 0.72 },
        },
      },
    })

    const tmpCandidatePack = path.join(repoRoot, 'tmp', 'automated-mask-generations', 'mask-batch-99', 'edition-1')
    writeJson(path.join(tmpCandidatePack, 'candidate-pack.json'), {
      'artifact-1': {
        artifact_type: 'catalogue-plaque',
        candidates: [
          { name: 'depth-semantic', score: { total: 0.68 } },
        ],
      },
    })

    const result = await generateInterpretationFiles({ repoRoot })

    expect(result.generated).toBe(1)
    const interpretation = JSON.parse(fs.readFileSync(path.join(editionBase, 'interpretation.json'), 'utf8'))
    expect(interpretation.edition_id).toBe('edition-1')
    expect(interpretation.plate_read_timestamp).toBe('2026-04-24T17:10:00Z')
    expect(interpretation.scene_ontology.primary).toBe('object-native')
    expect(interpretation.world_read.summary).toContain('ecological listening station')
    expect(interpretation.artifact_candidates[0].strength).toBeGreaterThan(0.95)
    expect(interpretation.enhancement_bundle.primary).toContain('mechanical-reveal-system')
  })

  it('skips editions missing required packaging files', async () => {
    const repoRoot = makeTempRepo()
    const editionsRoot = path.join(repoRoot, 'public', 'editions')

    writeJson(path.join(editionsRoot, 'index.json'), {
      current_edition_id: 'edition-1',
      editions: [
        {
          edition_id: 'edition-1',
          date: '2026-04-24',
          slug: 'sample-edition',
          title: 'Sample Edition',
          path: '/editions/sample-edition',
          scene_family: 'forest-breath-cabinet',
          motif_tags: ['forest'],
          preview_asset_path: '/editions/sample-edition/assets/preview.jpg',
          is_live: true,
        },
      ],
    })

    const result = await generateInterpretationFiles({ repoRoot })
    expect(result.generated).toBe(0)
    expect(result.skipped).toBe(1)
  })
})
