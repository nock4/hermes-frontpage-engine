import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { expect, it, vi } from 'vitest'
import { platePng } from '../fixtures/plate-png.mjs'
import { remapExistingEditionPlate } from '../../scripts/pipeline/remap-existing-edition.mjs'

async function withEdition(run) {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'dfe-remap-'))
  const editionId = 'remap-fixture'
  const editionDir = path.join(root, 'public', 'editions', editionId)
  const readJson = async (file) => JSON.parse(await fs.readFile(file, 'utf8'))
  const writeJson = vi.fn(async (file, data) => fs.writeFile(file, JSON.stringify(data)))
  try {
    await fs.mkdir(path.join(editionDir, 'assets', 'masks'), { recursive: true })
    const files = {
      'edition.json': { title: 'Existing edition', plate_asset_path: `/editions/${editionId}/assets/plate.png` },
      'artifact-map.json': { artifacts: [{ id: 'hero', label: 'Existing mark', kind: 'hero', artifact_type: 'paint', bounds: { x: 0.1, y: 0.1, w: 0.2, h: 0.2 }, polygon: [[0.1, 0.1], [0.3, 0.1], [0.2, 0.3]], mask_path: 'assets/masks/hero.svg' }] },
      'analysis.json': { inspection_mode: 'existing-accepted-analysis', detected_objects: ['preserve me'] },
      'about.json': { short_blurb: 'Existing blurb', body: ['Original introduction', 'Original mapping description'] },
    }
    for (const [name, data] of Object.entries(files)) await fs.writeFile(path.join(editionDir, name), JSON.stringify(data))
    await fs.writeFile(path.join(editionDir, 'assets/masks/hero.svg'), '<svg>existing refined mask</svg>')
    await fs.writeFile(path.join(editionDir, 'assets/masks/retained.svg'), '<svg>existing extra mask</svg>')
    await fs.writeFile(path.join(editionDir, 'assets/plate.png'), platePng(1536, 1024))
    await run({ root, editionId, editionDir, readJson, writeJson, generationName: 'test-remap' })
  } finally {
    await fs.rm(root, { recursive: true, force: true })
  }
}

async function snapshot(dir) {
  const entries = await fs.readdir(dir, { recursive: true, withFileTypes: true })
  const result = {}
  for (const entry of entries.filter((entry) => entry.isFile())) {
    const file = path.join(entry.parentPath, entry.name)
    const stat = await fs.stat(file, { bigint: true })
    result[path.relative(dir, file)] = { bytes: await fs.readFile(file), mtimeNs: stat.mtimeNs }
  }
  return result
}

it.each([
  { inspection_mode: 'inspection-failed' },
  { inspection_mode: 'inspection-failed', inspection_error: 'Vision unavailable' },
  { inspection_mode: 'vision', inspection_error: 'Partial inspection failed' },
  { inspection_mode: 'planned-artifact-fallback', inspection_error: 'Legacy failure' },
  { inspection_mode: 'planned-artifact-fallback' },
])('preserves every edition file without writes for $inspection_mode / $inspection_error', async (failure) => {
  await withEdition(async (options) => {
    const before = await snapshot(options.editionDir)
    const result = await remapExistingEditionPlate({
      ...options,
      inspectGeneratedPlate: async () => ({ ...failure, detected_objects: [] }),
    })
    expect(await snapshot(options.editionDir)).toEqual(before)
    expect(options.writeJson).not.toHaveBeenCalled()
    expect(result).toMatchObject({ edition_id: options.editionId, inspection_mode: failure.inspection_mode, detected_objects: 0, mapped_artifacts: 1, skipped_artifact_map_update: true })
  })
})

it.each([platePng(8, 12), platePng(8, 8), platePng().subarray(0, 24)])('rejects invalid recovered plate before remapping or writes', async (bytes) => {
  await withEdition(async (options) => {
    await fs.writeFile(path.join(options.editionDir, 'assets/plate.png'), bytes)
    const before = await snapshot(options.editionDir)
    const inspectGeneratedPlate = vi.fn(async () => ({ inspection_mode: 'inspection-failed', detected_objects: [] }))
    await expect(remapExistingEditionPlate({ ...options, inspectGeneratedPlate })).rejects.toThrow(/landscape/i)
    expect(inspectGeneratedPlate).not.toHaveBeenCalled()
    expect(options.writeJson).not.toHaveBeenCalled()
    expect(await snapshot(options.editionDir)).toEqual(before)
  })
})

it('writes corrected analysis, geometry, masks and about text after valid inspection', async () => {
  await withEdition(async (options) => {
    const object = { label: 'Observed mark', artifact_type: 'ink', bounds: { x: 0.25, y: 0.25, w: 0.5, h: 0.5 }, polygon: [[0.25, 0.25], [0.75, 0.25], [0.5, 0.75]] }
    const result = await remapExistingEditionPlate({ ...options, inspectGeneratedPlate: async () => ({ inspection_mode: 'vision', detected_objects: [object] }) })
    expect(result).toMatchObject({ inspection_mode: 'vision', detected_objects: 1, mapped_artifacts: 1 })
    expect(result.skipped_artifact_map_update).not.toBe(true)
    expect(options.writeJson).toHaveBeenCalledTimes(3)
    const artifactMap = await options.readJson(path.join(options.editionDir, 'artifact-map.json'))
    expect(artifactMap.artifacts[0]).toMatchObject({ ...object, id: 'hero' })
    expect(await options.readJson(path.join(options.editionDir, 'analysis.json'))).toMatchObject({ inspection_mode: 'vision', detected_objects: [object] })
    expect(await fs.readFile(path.join(options.editionDir, 'assets/masks/hero.svg'), 'utf8')).toContain('points="384,256 1152,256 768,768"')
    expect((await options.readJson(path.join(options.editionDir, 'about.json'))).body.join(' ')).toContain('Observed mark')
  })
})
