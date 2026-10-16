import { it, expect, vi } from 'vitest'
import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { platePng } from '../fixtures/plate-png.mjs'
import { createGeneratePlateStep } from '../../scripts/pipeline/generate-plate.mjs'
import { createMapArtifactsStep } from '../../scripts/pipeline/map-artifacts.mjs'
import { buildSceneImagePrompt, generateScenePlate } from '../../scripts/lib/scene-generation.mjs'

it.each(['1024x1536', '1024x1024', '1536x1024'])('requests landscape regardless of source and requested %s', async (imageSize) => {
  for (const [width, height] of [[8, 12], [8, 8], [12, 8]]) {
    let requested
    const step = createGeneratePlateStep({ context: { payload: { source_image_fingerprints: [{ width, height }] } },
      options: { imageSize, imageBackend: 'hermes' }, root: '/tmp', runDir: '/tmp', imageAspectRatioFromSize: () => 'landscape',
      generateScenePlate: async (args) => { requested = args.imageSize; return { outputPath: '/tmp/plate.png' } } })
    await step.run()
    expect(requested).toBe('1536x1024')
  }
})

it.each([[8, 12], [8, 8]])('recomposes %sx%s source into landscape without coercing source content', (width, height) => {
  const prompt = buildSceneImagePrompt({ source_image_fingerprints: [{ width, height, image_url: 'https://example.com/a.png', preserve_cues: ['red collar and pale sleeve'] }] })
  expect(prompt).toMatch(/landscape canvas/i)
  expect(prompt).toMatch(/recompos/i)
  expect(prompt).toContain('red collar')
  expect(prompt).not.toContain('Preserve this source aspect and frame orientation')
  expect(prompt).toMatch(/no stretching, cropping, or padding/i)
})

it.each(['hermes', 'openai'])('rejects wrong actual %s provider geometry without altering bytes', async (imageBackend) => {
  const runDir = await fs.mkdtemp(path.join(os.tmpdir(), 'dfe-landscape-'))
  try {
    for (const bytes of [platePng(8, 12), platePng(8, 8), Buffer.from('not an image'), platePng().subarray(0, 24), platePng().subarray(0, 48)]) {
      vi.stubGlobal('fetch', async () => ({ ok: true, json: async () => ({ data: [{ b64_json: bytes.toString('base64') }] }) }))
      await expect(generateScenePlate({ payload: {}, imageBackend, imageSize: '1536x1024' }, runDir, {
        writeJson: async () => {}, sleep: async () => {},
        runHermesImageCommand: async () => { await fs.writeFile(path.join(runDir, 'plate.png'), bytes); return { aspect_ratio: 'landscape' } },
      })).rejects.toThrow(/landscape/i)
      expect(await fs.readFile(path.join(runDir, 'plate.png'))).toEqual(bytes)
    }
  } finally { vi.unstubAllGlobals(); await fs.rm(runDir, { recursive: true, force: true }) }
})

it.each(['hermes', 'openai'])('preserves landscape %s bytes without resizing and overrides portrait requests', async (imageBackend) => {
  const runDir = await fs.mkdtemp(path.join(os.tmpdir(), 'dfe-landscape-pass-'))
  const bytes = platePng(17, 9)
  let record
  try {
    vi.stubGlobal('fetch', async (_url, request) => {
      expect(JSON.parse(request.body).size).toBe('1536x1024')
      return { ok: true, json: async () => ({ data: [{ b64_json: bytes.toString('base64') }] }) }
    })
    await generateScenePlate({ payload: {}, imageBackend, imageSize: '1024x1536' }, runDir, {
      writeJson: async (_file, data) => { record = data }, sleep: async () => {},
      runHermesImageCommand: async (_command, args) => {
        expect(args).toContain('landscape')
        await fs.writeFile(path.join(runDir, 'plate.png'), bytes)
        return { aspect_ratio: 'portrait' }
      },
    })
    expect(await fs.readFile(path.join(runDir, 'plate.png'))).toEqual(bytes)
    expect(record.output_geometry).toMatchObject({ actual_after: { width: 17, height: 9 }, normalized: false })
  } finally { vi.unstubAllGlobals(); await fs.rm(runDir, { recursive: true, force: true }) }
})

it('rejects a portrait before mapping despite landscape metadata', async () => {
  const runDir = await fs.mkdtemp(path.join(os.tmpdir(), 'dfe-landscape-map-'))
  try {
    const outputPath = path.join(runDir, 'plate.png')
    await fs.writeFile(outputPath, platePng(8, 12))
    const inspectGeneratedPlate = vi.fn(async () => ({ detected_objects: [], usable_surfaces: [] }))
    const step = createMapArtifactsStep({ context: { plate: { outputPath, size: '1536x1024' } }, inspectGeneratedPlate, options: {}, root: runDir, runDir })
    await expect(step.run()).rejects.toThrow(/landscape/i)
    expect(inspectGeneratedPlate).not.toHaveBeenCalled()
  } finally { await fs.rm(runDir, { recursive: true, force: true }) }
})
