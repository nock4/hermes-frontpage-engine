import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { expect, it } from 'vitest'
import { assembleEditionPackage } from '../../scripts/lib/edition-package-assembly.mjs'
import { inspectedDecision } from '../fixtures/creative-inspection.mjs'

it('keeps researched tweet image identity ahead of stale saved-note media during assembly', async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'dfe-media-identity-'))
  try {
    const runDir = path.join(root, 'run')
    await fs.mkdir(runDir)
    await fs.mkdir(path.join(root, 'public/editions'), { recursive: true })
    await fs.writeFile(path.join(root, 'public/editions/index.json'), JSON.stringify({ editions: [] }))
    const platePath = path.join(runDir, 'plate.png')
    await fs.writeFile(platePath, 'fixture plate')
    const sources = Array.from({ length: 6 }, (_, i) => ({
      url: `https://x.com/artist${i}/status/123456789012345678${i}`,
      note_id: `note-${i}`, title: `Artwork ${i}`,
      image_url: `https://pbs.twimg.com/media/art${i}.jpg?name=orig`,
      media_url: `https://pbs.twimg.com/media/art${i}.jpg?name=orig`, media_type: 'image',
    }))
    sources[1].media_type = 'video'
    sources[1].media_url = 'https://video.twimg.com/art1.mp4?tag=12'
    const before = structuredClone(sources)
    const result = await assembleEditionPackage({
      root, runDir, options: { date: '2026-10-16', publish: false, imageSize: '1536x1024' },
      plate: { outputPath: platePath },
      payload: { slug_base: 'identity', scene_family: 'identity', edition_title: 'Identity',
        artifacts: sources.map((s, i) => ({ source_url: s.url, label: `Mark ${i}` })), ambiance: {} },
      researchField: { sources, autoresearch: { source_decisions: sources.map(s => inspectedDecision(s)) } },
      signalHarvest: { notes_selected: sources.map((s, i) => ({ id: s.note_id, title: s.title,
        urls: [s.url, `https://pbs.twimg.com/media/art${i}.jpg`] })) },
      analysis: { inspection_mode: 'vision', detected_objects: sources.map((s, i) => ({
        label: `Mark ${i}`, artifact_type: 'pigment', bounds: { x: i * 0.1, y: 0.2, w: 0.08, h: 0.2 },
      })) },
    })
    const { bindings } = JSON.parse(await fs.readFile(path.join(root, 'public/editions', result.editionId, 'source-bindings.json'), 'utf8'))
    expect(bindings.map(b => b.source_image_url)).toEqual(sources.map(s => s.image_url))
    expect(bindings.map(b => b.source_media_url)).toEqual(sources.map(s => s.media_url))
    expect(bindings[1].source_media_type).toBe('video')
    expect(sources).toEqual(before)
  } finally { await fs.rm(root, { recursive: true, force: true }) }
})
