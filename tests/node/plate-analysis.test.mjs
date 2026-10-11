import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { afterEach, expect, it, vi } from 'vitest'
import { openAiJson } from '../../scripts/lib/openai-json.mjs'
import { inspectGeneratedPlate } from '../../scripts/lib/plate-analysis.mjs'

vi.mock('../../scripts/lib/openai-json.mjs', () => ({ openAiJson: vi.fn() }))
afterEach(() => vi.restoreAllMocks())

it.each(['empty', 'error'])('never invents detected objects after %s inspection', async (mode) => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'dfe-inspection-'))
  try {
    const platePath = path.join(root, 'plate.png')
    const header = Buffer.alloc(24)
    Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]).copy(header)
    header.writeUInt32BE(1024, 16)
    header.writeUInt32BE(1536, 20)
    await fs.writeFile(platePath, header)
    if (mode === 'error') openAiJson.mockRejectedValueOnce(new Error('Inspection unavailable'))
    else openAiJson.mockResolvedValueOnce({ detected_objects: [], usable_surfaces: ['paint'] })
    vi.spyOn(console, 'warn').mockImplementation(() => {})
    const analysis = await inspectGeneratedPlate({
      platePath,
      payload: { scene_prompt: 'Painted field', material_language: ['paint'], artifacts: Array.from({ length: 7 }, (_, index) => ({ label: `Planned ${index}` })) },
    }, root, { writeJson: async (file, data) => fs.writeFile(file, JSON.stringify(data)), minContentItems: 6, maxContentItems: 10 })
    expect(analysis.detected_objects).toEqual([])
    expect(analysis.viewport).toEqual({ base_width: 1024, base_height: 1536, aspect_ratio: '1024:1536' })
  } finally {
    await fs.rm(root, { recursive: true, force: true })
  }
})
