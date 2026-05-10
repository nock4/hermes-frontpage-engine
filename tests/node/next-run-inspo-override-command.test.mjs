import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { spawnSync } from 'node:child_process'

import { describe, expect, it } from 'vitest'

const repoRoot = path.resolve(new URL('../..', import.meta.url).pathname)
const sourceUrl = 'https://www.nytimes.com/video/world/asia/100000010886997/robot-monk-gabi-south-korea.html?smid=url-share'

function runCommand(args) {
  return spawnSync('npm', ['run', 'next-run:inspo-override', '--', ...args], {
    cwd: repoRoot,
    encoding: 'utf8',
  })
}

describe('next-run inspo override command', () => {
  it('is exposed as a repo-local npm command with explicit URL-first language', () => {
    const result = runCommand(['--help'])

    expect(result.status).toBe(0)
    expect(result.stdout).toContain('npm run next-run:inspo-override -- --url <source-url>')
    expect(result.stdout).toContain('writes tmp/next-run-inspiration-override.json')
    expect(result.stdout).toContain('consumed by npm run daily:publish:cron')
  })

  it('writes the next-run override manifest from a source URL', async () => {
    const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'dfe-next-run-inspo-'))
    const manifest = path.join(tempDir, 'next-run-inspiration-override.json')

    const result = runCommand([
      '--manifest', manifest,
      '--url', sourceUrl,
      '--title', 'Robot Monk Gabi',
      '--note', 'Tomorrow source bias around robot monk ritual interface.',
      '--bias', 'ritual interface,machine novice monk,devotional robotics',
    ])

    expect(result.status).toBe(0)
    expect(result.stdout).toContain('next-run inspiration override installed')
    const payload = JSON.parse(await fs.readFile(manifest, 'utf8'))
    expect(payload).toMatchObject({
      active: true,
      title: 'Robot Monk Gabi',
      note: 'Tomorrow source bias around robot monk ritual interface.',
      source: 'next-run-inspo-override-command',
      source_url: sourceUrl,
      prompt_bias_terms: ['ritual interface', 'machine novice monk', 'devotional robotics'],
      consume_after_success: true,
    })
  })
})
