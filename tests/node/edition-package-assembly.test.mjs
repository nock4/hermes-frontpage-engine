import fs from 'node:fs/promises'
import { platePng } from '../fixtures/plate-png.mjs'
import { inspectedDecision } from '../fixtures/creative-inspection.mjs'
import os from 'node:os'
import path from 'node:path'

import { describe, expect, it } from 'vitest'

import { assembleEditionPackage } from '../../scripts/lib/edition-package-assembly.mjs'

async function readJson(filePath) {
  return JSON.parse(await fs.readFile(filePath, 'utf8'))
}

describe('edition package assembly', () => {
  it.each([0, 11])('rejects %s source artifacts before package writes', async (count) => {
    await expect(assembleEditionPackage({ payload: { artifacts: Array(count).fill({ source_url: 'https://example.com/work' }) } })).rejects.toThrow(/1–10 distinct source artifacts/)
  })
  it.each([1, 2, 5, 6, 10])('writes a self-contained %s-source edition package and updates the manifest', async (count) => {
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
    await fs.writeFile(platePath, platePng(1536, 1024))

    const sourceUrl = 'https://example.com/gallery/story'
    const input = {
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
        autoresearch: { source_decisions: [inspectedDecision({url: sourceUrl, image_url: 'https://example.com/gallery/lead.jpg'})] },
        source_count: 1,
        sources: [{
          url: sourceUrl,
          source_url: sourceUrl,
          final_url: sourceUrl,
          title: 'Gallery Story',
          description: 'A concise visual reference for the package test.',
          image_url: 'https://example.com/gallery/lead.jpg',
          source_image_aliases: ['https://origin.example/lead.jpg', 'https://redirect.example/lead.jpg'],
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
    }
    for (let index = 1; index < count; index += 1) {
      const url = `https://example.com/gallery/artwork-${index}`
      const source = { url, title: `Artwork ${index}`, image_url: `${url}.jpg` }
      input.payload.artifacts.push({ label: source.title, source_url: url })
      input.researchField.sources.push(source)
      input.researchField.autoresearch.source_decisions.push(inspectedDecision(source))
      input.analysis.detected_objects.push({
        label: `Detected mark ${index}`, artifact_type: 'pigment',
        bounds: { x: index * 0.1, y: 0.7, w: 0.05, h: 0.1 },
      })
    }
    const result = await assembleEditionPackage(input, { test_step: true })

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
    expect(artifactMap.artifacts).toHaveLength(count)
    const brief = await readJson(path.join(editionDir, 'brief.json'))
    expect(brief.interaction_grammar.hero_count).toBe(Math.min(2, count))
    expect(brief.interaction_grammar.module_count).toBe(Math.max(0, count - 2))
    expect(artifactMap.artifacts[0].mask_path).toContain('/assets/masks/hero-paper-field.svg')
    expect(bindings.bindings[0]).toMatchObject({
      source_url: sourceUrl,
      title: 'Gallery Story',
      source_image_url: 'https://example.com/gallery/artwork.jpg',
      source_image_aliases: expect.arrayContaining(['https://origin.example/lead.jpg', 'https://redirect.example/lead.jpg']),
      source_image_alt: 'DABLS painting',
      source_media_url: 'https://example.com/gallery/artwork.jpg',
      source_media_type: 'image',
    })
    expect(about.body).toHaveLength(2)
    expect(manifest.editions[0].edition_id).toBe(result.editionId)
    expect(summary.test_step).toBe(true)
    await expect(fs.readFile(path.join(editionDir, 'assets', 'masks', 'hero-paper-field.svg'), 'utf8')).resolves.toContain('<polygon')
  })

  it.each([
    { count: 0, publish: false }, { count: 2, publish: true },
    { count: 5, publish: false }, { count: 7, publish: true, mode: 'planned-artifact-fallback' },
    { count: 7, publish: false, fallbackCount: 4 },
    { count: 6, publish: false, invalidBounds: true },
    { count: 6, publish: false }, { count: 7, publish: true },
    { count: 7, publish: false, portrait: true },
    { count: 7, publish: true, portrait: true },
    { count: 7, publish: true, square: true },
    { count: 7, publish: true, corrupt: true },
    { count: 6, publish: false, analysisPortrait: true },
  ])('requires real mapped objects before writes: %j', async ({ count, publish, mode = 'vision', fallbackCount = 0, portrait = false, square = false, corrupt = false, analysisPortrait = false, invalidBounds = false }) => {
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
    await fs.writeFile(platePath, platePng(1536, 1024))

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

    const input = {
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
        autoresearch: { source_decisions: sources.map(source => inspectedDecision(source)) },
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
    }
    input.options.publish = publish
    input.analysis.inspection_mode = mode
    input.analysis.fallback_detected_object_count = fallbackCount
    input.analysis.detected_objects = Array.from({ length: count }, (_, index) => ({
      label: `Detected mark ${index + 1}`, artifact_type: 'pigment',
      bounds: { x: 0.1 + index * 0.1, y: 0.2, w: 0.05, h: 0.1 },
      confidence: 0.9, visual_evidence: `Distinct pigment mark ${index + 1}`,
    }))
    if (invalidBounds) delete input.analysis.detected_objects[0].bounds
    if (portrait || square || corrupt) {
      // Actual bytes override both requested size and stale analysis.
      await fs.writeFile(platePath, corrupt ? platePng().subarray(0, 24) : platePng(1024, square ? 1024 : 1536))
      input.analysis.viewport = { base_width: 1536, base_height: 1024, aspect_ratio: '1536:1024' }
    }
    if (analysisPortrait) {
      input.analysis.viewport = { base_width: 1024, base_height: 1536, aspect_ratio: '1024:1536' }
      await fs.writeFile(platePath, platePng(1200, 800))
    }
    const beforeManifest = await fs.readFile(path.join(publicEditionsDir, 'index.json'), 'utf8')
    if (count < 1 || mode === 'planned-artifact-fallback' || fallbackCount || invalidBounds) {
      await expect(assembleEditionPackage(input)).rejects.toThrow(/at least 1 real detected mapped objects/i)
      expect(await fs.readdir(publicEditionsDir)).toEqual(['index.json'])
      expect(await fs.readFile(path.join(publicEditionsDir, 'index.json'), 'utf8')).toBe(beforeManifest)
      expect(await fs.readdir(runDir)).toEqual(['plate.png'])
      return
    }
    if (portrait || square || corrupt) {
      await expect(assembleEditionPackage(input)).rejects.toThrow(/landscape/i)
      expect(await fs.readdir(publicEditionsDir)).toEqual(['index.json'])
      expect(await fs.readFile(path.join(publicEditionsDir, 'index.json'), 'utf8')).toBe(beforeManifest)
      return
    }
    const result = await assembleEditionPackage(input)
    const editionDir = path.join(publicEditionsDir, result.editionId)
    const artifactMap = await readJson(path.join(editionDir, 'artifact-map.json'))
    const bindings = await readJson(path.join(editionDir, 'source-bindings.json'))
    const analysis = await readJson(path.join(editionDir, 'analysis.json'))

    expect(artifactMap.artifacts).toHaveLength(count)
    expect(bindings.bindings).toHaveLength(count)
    expect(analysis.detected_objects).toEqual(input.analysis.detected_objects)
    expect(analysis.fallback_detected_object_count || 0).toBe(0)
    expect(analysis.mapping_note).toBeUndefined()
    expect(artifactMap.viewport).toEqual(analysisPortrait
      ? { base_width: 1200, base_height: 800, aspect_ratio: '1200:800' }
      : { base_width: 1536, base_height: 1024, aspect_ratio: '1536:1024' })
    expect(analysis.viewport).toEqual(artifactMap.viewport)
    if (analysisPortrait) {
      const first = artifactMap.artifacts[0]
      expect(first.geometry.safe_hover_origin_px).toEqual([150, 194])
      expect(first.geometry.safe_stage_window_origin_px).toEqual([155, 200])
      const mask = await fs.readFile(path.join(editionDir, 'assets', 'masks', `${first.id}.svg`), 'utf8')
      expect(mask).toContain('viewBox="0 0 1200 800"')
      expect(mask).toContain('points="120,160 180,160 180,240 120,240"')
    }
  })
})
