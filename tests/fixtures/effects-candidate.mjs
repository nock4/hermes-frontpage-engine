import fs from 'node:fs/promises'
import path from 'node:path'
import { assembleEditionPackage } from '../../scripts/lib/edition-package-assembly.mjs'
import { inspectedDecision } from './creative-inspection.mjs'
import { platePng } from './plate-png.mjs'
/** Entirely synthetic candidate, real packager, no generation/provider calls. */
export async function buildEffectsCandidate() {
  const scratch = process.env.TMPDIR || path.resolve('tmp')
  const root = await fs.mkdtemp(path.join(scratch, 'dfe-effects-candidate-')),
    runDir = path.join(root, 'run')
  await fs.mkdir(path.join(root, 'public', 'editions'), { recursive: true })
  await fs.mkdir(runDir)
  await fs.writeFile(
    path.join(root, 'public', 'editions', 'index.json'),
    JSON.stringify({ current_edition_id: null, editions: [] }),
  )
  const platePath = path.join(runDir, 'plate.png')
  await fs.writeFile(platePath, platePng(1536, 1024))
  const url = 'https://effects-fixture.example/work',
    image = 'https://effects-fixture.example/original.png'
  const result = await assembleEditionPackage({
    root,
    runDir,
    options: { date: '2026-11-03', publish: false, imageSize: '1536x1024' },
    payload: {
      slug_base: 'Synthetic Effects Candidate',
      scene_family: 'synthetic-effects',
      edition_title: 'SYNTHETIC effects candidate',
      mood: 'sculptural',
      lighting: 'side light',
      scene_prompt: 'Synthetic test plate, not source footage',
      material_language: ['metal'],
      object_inventory: ['ridge'],
      motif_tags: ['qa'],
      negative_constraints: ['no UI'],
      ambiance: {
        motion_system: 'still',
        color_drift: 'none',
        glow_behavior: 'none',
        audio_posture: 'silent',
        webgl_mode: 'none',
      },
      artifacts: [{ label: 'Ridge', role: 'SYNTHETIC source', source_url: url }],
    },
    researchField: {
      autoresearch: { source_decisions: [inspectedDecision({ url, image_url: image })] },
      source_count: 1,
      sources: [
        {
          url,
          source_url: url,
          final_url: url,
          title: 'SYNTHETIC original work',
          description: 'Synthetic test evidence only',
          image_url: image,
          media_url: image,
          media_type: 'image',
        },
      ],
      selected_image_material: [
        { page_url: url, image_url: image, title: 'SYNTHETIC original', width: 1536, height: 1024 },
      ],
    },
    signalHarvest: {
      notes_selected: [{ id: 'synthetic', title: 'SYNTHETIC fixture', content: 'Synthetic evidence only' }],
      links: [],
    },
    plate: { outputPath: platePath },
    analysis: {
      inspection_mode: 'vision',
      viewport: { base_width: 1536, base_height: 1024, aspect_ratio: '1536:1024' },
      detected_objects: [
        {
          label: 'Ridge',
          artifact_type: 'metal',
          confidence: 0.95,
          bounds: { x: 0.2, y: 0.2, w: 0.6, h: 0.6 },
          polygon: [
            [0.2, 0.2],
            [0.8, 0.2],
            [0.8, 0.8],
            [0.2, 0.8],
          ],
          effect_material: {
            material: 'metal',
            observation: 'SYNTHETIC inspected reflective ridge',
            modalities: ['reflective', 'resonant', 'depth', 'fracture', 'touch'],
          },
        },
      ],
    },
    maxContentItems: 10,
  })
  const manifest = JSON.parse(await fs.readFile(path.join(root, 'public', 'editions', 'index.json'), 'utf8'))
  manifest.current_edition_id = result.editionId
  await fs.writeFile(path.join(root, 'public', 'editions', 'index.json'), JSON.stringify(manifest))
  return {
    root,
    id: result.editionId,
    manifest,
    cleanup: () => fs.rm(root, { recursive: true, force: true }),
  }
}
