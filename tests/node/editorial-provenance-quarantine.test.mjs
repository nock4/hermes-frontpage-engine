import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { describe, expect, it } from 'vitest'
import { isAiToolingContentSource, selectContentSources, sourceHasRenderableCardSurface } from '../../scripts/lib/source-selection-policy.mjs'
import { assembleEditionPackage } from '../../scripts/lib/edition-package-assembly.mjs'
import { buildSourceFloorDiagnostics, getResearchContentSources } from '../../scripts/lib/source-research.mjs'

const leakedText = [
  'https://component.gallery/',
  'RIP Higgsfield AI. Someone just open-sourced a full AI cinema and image studio with 200+ models. Lip sync. Text-to-video. Cinema controls. All self-hosted. https://github.com/Anil-matcha/Open-Generative-AI',
  "alright - verdict is in - Motion Design is solved made with HyperFrames + Claude Design btw - HyperFrames is open source, star it on github and I'll send tutorial on how i made this with 2 prompts.",
  "It's called CloakBrowser. A stealth Chromium that passes 14 out of 14 bot detection tests. Drop-in Playwright replacement.",
]
const surface = (i, description = '') => ({ url: `https://x.com/artist/status/${100 + i}`, source_type: 'tweet', window_type: 'social', note_id: `note-${i}`, title: 'Saved visual', description, image_url: `https://images.example/work-${i}.jpg` })

describe('enriched editorial provenance quarantine', () => {
  it.each(leakedText)('rejects the published workflow/library leak: %s', description => {
    const source = surface(0, description)
    expect(isAiToolingContentSource(source)).toBe(true)
    expect(sourceHasRenderableCardSurface(source)).toBe(false)
    expect(selectContentSources([source])).toEqual([])
  })

  it.each(['source_summary', 'source_meta', 'excerpt', 'resolved_url', 'page_url'])('reads enriched %s rather than the renamed title', field => {
    expect(selectContentSources([{ ...surface(0), [field]: 'https://component.gallery/' }])).toEqual([])
  })

  it('reads full parent provenance and saved-note evidence without folder contamination', () => {
    const source = { ...surface(0), parent_source: { description: leakedText[3] } }
    expect(selectContentSources([source])).toEqual([])
    const signalHarvest = { notes_selected: [{ id: 'note-0', excerpt: leakedText[2] }] }
    expect(selectContentSources([surface(0)], { signalHarvest })).toEqual([])
    expect(selectContentSources([{ ...surface(1, 'AI-made textile artwork'), note_path: 'themes/AI & Agents/art.md' }])).toHaveLength(1)
  })

  it('keeps genuine model-assisted artwork and refills only unused creative sources', () => {
    const creative = Array.from({ length: 6 }, (_, i) => surface(i + 10, 'An AI-made animation, made with HyperFrames + Claude Design. A surreal textile landscape.'))
    const spent = surface(50, 'Painting')
    const selected = selectContentSources([...leakedText.map((text, i) => surface(i, text)), spent, ...creative], {
      maxItems: 6, targetItems: 6, recentSourceKeys: new Set(['images.example/work-50.jpg']),
    })
    expect(selected.map(s => s.url)).toEqual(creative.map(s => s.url))
  })

  it('does not lose fetched provenance when a browser record wins deduplication', () => {
    const diagnostics = buildSourceFloorDiagnostics({ inspected: [surface(0)], fetchEvidence: [surface(0, leakedText[2])] })
    expect(diagnostics.buckets.ai_tooling_quarantined).toBe(1)
  })

  it('rechecks cached content selections against enriched research', () => {
    expect(getResearchContentSources({ content_sources: [surface(0)], sources: [surface(0, leakedText[1])] })).toEqual([])
  })

  it.each(leakedText)('fails package assembly before writes when stale artifacts contain %s', async description => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), 'dfe-quarantine-'))
    try {
      const dir = path.join(root, 'public/editions')
      await fs.mkdir(dir, { recursive: true })
      await fs.writeFile(path.join(dir, 'index.json'), JSON.stringify({ editions: [] }))
      const source = surface(0, description)
      await expect(assembleEditionPackage({
        root, options: { date: '2026-09-30' }, payload: { slug_base: 'quarantine', artifacts: [{ source_url: source.url, label: 'Harmless blue fold' }] },
        researchField: { sources: [source] }, signalHarvest: { notes_selected: [] },
        plate: { outputPath: path.join(root, 'deliberately-absent.png') }, analysis: {}, runDir: root,
      })).rejects.toThrow(/editorial quarantine/i)
      expect(await fs.readdir(dir)).toEqual(['index.json'])
    } finally { await fs.rm(root, { recursive: true, force: true }) }
  })
})
