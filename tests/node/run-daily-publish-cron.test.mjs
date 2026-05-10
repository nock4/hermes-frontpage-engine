import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'

import { describe, expect, it } from 'vitest'

import { parseArgs, resolveInspirationOverridePath } from '../../scripts/run-daily-publish-cron.mjs'

describe('daily publish cron wrapper', () => {
  it('parses an explicit inspiration override option', () => {
    const options = parseArgs(['--inspiration-override', '/tmp/manual-override.json'])

    expect(options.inspirationOverride).toBe('/tmp/manual-override.json')
  })

  it('passes through an existing explicit inspiration override path', async () => {
    const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'dfe-cron-override-'))
    const overridePath = path.join(tempDir, 'override.json')
    await fs.writeFile(overridePath, '{}')

    await expect(resolveInspirationOverridePath({ inspirationOverride: overridePath })).resolves.toBe(overridePath)
  })
})
