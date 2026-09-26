import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'

import { describe, expect, it } from 'vitest'

import { assembleEditionPackage } from '../../scripts/lib/edition-package-assembly.mjs'

async function readJson(filePath) {
  return JSON.parse(await fs.readFile(filePath, 'utf8'))
}

describe('edition package assembly', () => {
  it('writes a self-contained edition package and updates the manifest', async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), 'dfe-package-'))
    const publicEditionsDir = path.join(root, 'public', 'editions')
    const runDir = path.join(root, 'tmp', 'run')
    const platePath = path.join(runDir, 'plate.png')
    await fs.mkdir(publicEditionsDir, { recursive: true })
    await fs.mkdir(runDir, { recursive: true })
    await fs.writeFile(path.join(publicEditionsDir, 'index.json'), JSON.stringify({
      current_edition_id: null,
      editions: [],
    }))
    await fs.writeFile(platePath, 'fake image bytes')

    const sourceUrl = 'https://example.com/gallery/story'
    const result = await assembleEditionPackage({
      root,
      options: {
        date: '2026-04-27',
        publish: false,
        imageSize: '1536x1024',
      },
      payload: {
        slug_base: 'Quiet Test Room',
        scene_family: 'quiet-test-room',
        edition_title: 'Quiet Test Room',
        mood: 'minimal gallery atmosphere',
        lighting: 'soft side light',
        scene_prompt: 'A clean expressionist room with one visible paper field.',
        material_language: ['paper', 'light'],
        object_inventory: ['paper field'],
        motif_tags: ['test'],
        negative_constraints: ['no dashboard chrome'],
        ambiance: {
          motion_system: 'still',
          color_drift: 'none',
          glow_behavior: 'none',
          audio_posture: 'silent',
          webgl_mode: 'none',
        },
        artifacts: [{
          label: 'Paper Field',
          role: 'A saved visual source.',
          source_url: sourceUrl,
        }],
      },
      researchField: {
        source_count: 1,
        sources: [{
          url: sourceUrl,
          source_url: sourceUrl,
          final_url: sourceUrl,
          title: 'Gallery Story',
          description: 'A concise visual reference for the package test.',
          image_url: 'https://example.com/gallery/lead.jpg',
          media_url: 'https://example.com/gallery/logo.jpg',
          media_type: 'image',
          note_title: 'Gallery bookmark',
        }],
        selected_image_material: [
          {
            page_url: sourceUrl,
            image_url: 'https://example.com/gallery/wordmark.jpg',
            title: 'Matéria logo wordmark',
            lineage: 'primary_anchor_image',
            width: 1200,
            height: 342,
          },
          {
            page_url: sourceUrl,
            image_url: 'https://example.com/gallery/artwork.jpg',
            title: 'DABLS painting',
            caption: 'DABLS abstract artwork detail',
            lineage: 'direct_link',
          },
        ],
        visual_reference: {
          url: sourceUrl,
          image_url: 'https://example.com/gallery/lead.jpg',
          title: 'Gallery Story',
        },
      },
      signalHarvest: {
        notes_scanned: 1,
        notes_selected: [{
          id: 'note-1',
          title: 'Gallery bookmark',
          urls: [sourceUrl],
        }],
      },
      plate: {
        outputPath: platePath,
      },
      analysis: {
        inspection_mode: 'vision',
        detected_objects: [{
          label: 'Paper Field',
          artifact_type: 'paper',
          bounds: { x: 0.2, y: 0.2, w: 0.35, h: 0.4 },
          polygon: [[0.2, 0.2], [0.55, 0.2], [0.55, 0.6], [0.2, 0.6]],
        }],
        usable_surfaces: ['paper field'],
      },
      runDir,
      maxContentItems: 10,
    }, { test_step: true })

    expect(result).toMatchObject({
      editionId: '2026-04-27-quiet-test-room-v1',
      slug: 'quiet-test-room-v1',
      route: '/archive/quiet-test-room-v1',
      published: false,
    })

    const editionDir = path.join(publicEditionsDir, result.editionId)
    const edition = await readJson(path.join(editionDir, 'edition.json'))
    const artifactMap = await readJson(path.join(editionDir, 'artifact-map.json'))
    const bindings = await readJson(path.join(editionDir, 'source-bindings.json'))
    const about = await readJson(path.join(editionDir, 'about.json'))
    const manifest = await readJson(path.join(publicEditionsDir, 'index.json'))
    const summary = await readJson(path.join(runDir, 'edition-package-summary.json'))

    expect(edition.title).toBe('Quiet Test Room')
    expect(artifactMap.artifacts).toHaveLength(1)
    expect(artifactMap.artifacts[0].mask_path).toContain('/assets/masks/hero-paper-field.svg')
    expect(bindings.bindings[0]).toMatchObject({
      source_url: sourceUrl,
      title: 'Gallery Story',
      source_image_url: 'https://example.com/gallery/artwork.jpg',
      source_image_alt: 'DABLS painting',
      source_media_url: 'https://example.com/gallery/artwork.jpg',
      source_media_type: 'image',
    })
    expect(about.body).toHaveLength(2)
    expect(manifest.editions[0].edition_id).toBe(result.editionId)
    expect(summary.test_step).toBe(true)
    await expect(fs.readFile(path.join(editionDir, 'assets', 'masks', 'hero-paper-field.svg'), 'utf8')).resolves.toContain('<polygon')
  })

  it('backfills planned source pockets when plate inspection maps too few objects', async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), 'dfe-package-fallback-'))
    const publicEditionsDir = path.join(root, 'public', 'editions')
    const runDir = path.join(root, 'tmp', 'run')
    const platePath = path.join(runDir, 'plate.png')
    await fs.mkdir(publicEditionsDir, { recursive: true })
    await fs.mkdir(runDir, { recursive: true })
    await fs.writeFile(path.join(publicEditionsDir, 'index.json'), JSON.stringify({
      current_edition_id: null,
      editions: [],
    }))
    await fs.writeFile(platePath, 'fake image bytes')

    const artifacts = Array.from({ length: 7 }, (_, index) => ({
      label: `Pocket ${index + 1}`,
      role: `Source pocket ${index + 1}`,
      source_url: `https://example.com/source-${index + 1}`,
    }))
    const sources = artifacts.map((artifact, index) => ({
      url: artifact.source_url,
      source_url: artifact.source_url,
      final_url: artifact.source_url,
      title: `Source ${index + 1}`,
      description: `Source description ${index + 1}`,
      image_url: `https://example.com/source-${index + 1}.jpg`,
    }))

    const result = await assembleEditionPackage({
      root,
      options: {
        date: '2026-04-27',
        publish: false,
        imageSize: '1536x1024',
      },
      payload: {
        slug_base: 'Minimal Sparse Plate',
        scene_family: 'minimal-sparse-plate',
        edition_title: 'Minimal Sparse Plate',
        mood: 'minimal',
        lighting: 'dim',
        scene_prompt: 'A sparse image with one dominant threshold and several usable marks.',
        material_language: ['paper', 'light'],
        object_inventory: ['threshold', 'marks'],
        motif_tags: ['test'],
        negative_constraints: [],
        ambiance: {
          motion_system: 'still',
          color_drift: 'none',
          glow_behavior: 'none',
          audio_posture: 'silent',
          webgl_mode: 'none',
        },
        artifacts,
      },
      researchField: {
        source_count: sources.length,
        sources,
        visual_reference: sources[0],
      },
      signalHarvest: {
        notes_scanned: 1,
        notes_selected: [{ id: 'note-1', title: 'Signals', urls: artifacts.map((artifact) => artifact.source_url) }],
      },
      plate: { outputPath: platePath },
      analysis: {
        inspection_mode: 'vision',
        detected_objects: [{
          label: 'Dominant threshold',
          artifact_type: 'threshold',
          bounds: { x: 0.3, y: 0.25, w: 0.35, h: 0.45 },
          polygon: [[0.3, 0.25], [0.65, 0.25], [0.65, 0.7], [0.3, 0.7]],
        }],
        usable_surfaces: ['dominant threshold', 'pinlight', 'lower slit'],
      },
      runDir,
      maxContentItems: 10,
    })

    const editionDir = path.join(publicEditionsDir, result.editionId)
    const artifactMap = await readJson(path.join(editionDir, 'artifact-map.json'))
    const bindings = await readJson(path.join(editionDir, 'source-bindings.json'))
    const analysis = await readJson(path.join(editionDir, 'analysis.json'))

    expect(artifactMap.artifacts).toHaveLength(7)
    expect(bindings.bindings).toHaveLength(7)
    expect(artifactMap.artifacts[0].label).toBe('Dominant threshold')
    expect(artifactMap.artifacts[1].label).toBe('Pocket 2')
    expect(analysis.fallback_detected_object_count).toBe(6)
    expect(analysis.mapping_note).toContain('filled unmapped source pockets')
  })
})
