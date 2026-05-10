import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { spawnSync } from 'node:child_process'

import { describe, expect, it } from 'vitest'

const repoRoot = path.resolve(new URL('../..', import.meta.url).pathname)

describe('set inspiration override CLI', () => {
  it('creates a one-shot text source manifest from a URL without requiring an image', async () => {
    const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'dfe-set-override-'))
    const manifest = path.join(tempDir, 'next-run-inspiration-override.json')
    const sourceUrl = 'https://www.nytimes.com/video/world/asia/100000010886997/robot-monk-gabi-south-korea.html?smid=url-share'

    const result = spawnSync(process.execPath, [
      'scripts/set-inspiration-override.mjs',
      '--manifest', manifest,
      '--title', 'Robot Monk Gabi',
      '--note', 'Temporary next-run bias around ritual interface and machine novice monk.',
      '--source', 'telegram',
      '--source-url', sourceUrl,
      '--bias-terms', 'ritual interface,machine novice monk,soft devotional robotics',
    ], { cwd: repoRoot, encoding: 'utf8' })

    expect(result.status).toBe(0)
    const payload = JSON.parse(await fs.readFile(manifest, 'utf8'))
    expect(payload).toMatchObject({
      active: true,
      title: 'Robot Monk Gabi',
      note: 'Temporary next-run bias around ritual interface and machine novice monk.',
      source: 'telegram',
      source_url: sourceUrl,
      prompt_bias_terms: ['ritual interface', 'machine novice monk', 'soft devotional robotics'],
      consume_after_success: true,
    })
    expect(payload.image_url).toBeUndefined()
    expect(payload.image_path).toBeUndefined()
  })
})
