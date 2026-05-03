import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'

import { describe, expect, it } from 'vitest'

import {
  annotateSignalHarvestWithInspirationOverride,
  buildInspirationOverrideVisualReference,
  consumeInspirationOverride,
  loadInspirationOverride,
} from '../../scripts/lib/inspiration-override.mjs'

describe('inspiration override', () => {
  it('returns null when the default manifest path does not exist yet', async () => {
    const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'dfe-override-missing-'))
    const override = await loadInspirationOverride({ overridePath: path.join(tempDir, 'missing.json') })
    expect(override).toBeNull()
  })

  it('loads a local image override manifest and builds a data URL', async () => {
    const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'dfe-override-'))
    const imagePath = path.join(tempDir, 'seed.png')
    const overridePath = path.join(tempDir, 'override.json')
    await fs.writeFile(imagePath, Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO5Wz48AAAAASUVORK5CYII=', 'base64'))
    await fs.writeFile(overridePath, JSON.stringify({
      title: 'Telegram trend seed',
      note: 'Bias toward the feeling of this image, but still research from normal saved signals.',
      image_path: './seed.png',
      prompt_bias_terms: ['trend', 'news cycle', 'urgent texture'],
      source: 'telegram',
      source_url: 'telegram://message/123',
    }))

    const override = await loadInspirationOverride({ overridePath })

    expect(override).toMatchObject({
      title: 'Telegram trend seed',
      note: 'Bias toward the feeling of this image, but still research from normal saved signals.',
      source: 'telegram',
      source_url: 'telegram://message/123',
      consume_after_success: true,
      prompt_bias_terms: ['trend', 'news cycle', 'urgent texture'],
    })
    expect(override.image_path).toBe(imagePath)
    expect(override.image_data_url.startsWith('data:image/png;base64,')).toBe(true)
  })

  it('annotates signal harvest metadata without embedding the image payload', () => {
    const harvest = annotateSignalHarvestWithInspirationOverride({
      generated_at: '2026-05-02T00:00:00.000Z',
      source_candidates: [],
    }, {
      title: 'Telegram trend seed',
      note: 'Use this as the strongest visual cue.',
      image_path: '/tmp/seed.png',
      image_data_url: 'data:image/png;base64,abc123',
      prompt_bias_terms: ['trend', 'urgent'],
      source: 'telegram',
      source_url: 'telegram://message/123',
      consume_after_success: true,
    })

    expect(harvest.manual_inspiration_override).toEqual({
      title: 'Telegram trend seed',
      note: 'Use this as the strongest visual cue.',
      image_path: '/tmp/seed.png',
      source: 'telegram',
      source_url: 'telegram://message/123',
      prompt_bias_terms: ['trend', 'urgent'],
      consume_after_success: true,
    })
    expect(JSON.stringify(harvest)).not.toContain('data:image/png;base64,abc123')
  })

  it('builds a visual reference record from the override image', () => {
    const visualReference = buildInspirationOverrideVisualReference({
      title: 'Telegram trend seed',
      note: 'Let this guide the next edition.',
      image_data_url: 'data:image/png;base64,abc123',
      source_url: 'telegram://message/123',
      prompt_bias_terms: ['trend', 'urgent'],
    })

    expect(visualReference).toMatchObject({
      title: 'Telegram trend seed',
      image_url: 'data:image/png;base64,abc123',
      source_url: 'telegram://message/123',
      source_channel: 'manual-image-override',
      source_type: 'manual-inspiration-override',
    })
    expect(visualReference.selection_reason).toContain('temporary inspiration override')
  })

  it('consumes the override manifest after a successful run', async () => {
    const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'dfe-override-'))
    const imagePath = path.join(tempDir, 'seed.png')
    const overridePath = path.join(tempDir, 'override.json')
    await fs.writeFile(imagePath, Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO5Wz48AAAAASUVORK5CYII=', 'base64'))
    await fs.writeFile(overridePath, JSON.stringify({ image_path: './seed.png' }))

    const override = await loadInspirationOverride({ overridePath })
    await consumeInspirationOverride(override, { status: 'consumed-after-success', consumedAt: '2026-05-02T12:00:00.000Z' })

    const stored = JSON.parse(await fs.readFile(overridePath, 'utf8'))
    expect(stored.active).toBe(false)
    expect(stored.last_status).toBe('consumed-after-success')
    expect(stored.last_consumed_at).toBe('2026-05-02T12:00:00.000Z')
  })
})
