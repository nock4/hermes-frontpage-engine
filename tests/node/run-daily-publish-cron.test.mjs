import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'

import { describe, expect, it } from 'vitest'

import { allocateCronUxPort, isSafeCronWorktreePath, parseArgs, parsePidList, resolveInspirationOverridePath } from '../../scripts/run-daily-publish-cron.mjs'

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

  it('parses lsof pid output for stale preview cleanup', () => {
    expect(parsePidList('36394\n36422\nnot-a-pid\n')).toEqual([36394, 36422])
  })

  it('allocates a cron-specific UX port away from the legacy fixed port', () => {
    const originalPort = process.env.DFE_UX_PORT
    delete process.env.DFE_UX_PORT

    try {
      expect(allocateCronUxPort(1234)).toBe('45234')
    } finally {
      if (originalPort === undefined) delete process.env.DFE_UX_PORT
      else process.env.DFE_UX_PORT = originalPort
    }
  })

  it('honors an explicit UX port override', () => {
    const originalPort = process.env.DFE_UX_PORT
    process.env.DFE_UX_PORT = '45678'

    try {
      expect(allocateCronUxPort(1234)).toBe('45678')
    } finally {
      if (originalPort === undefined) delete process.env.DFE_UX_PORT
      else process.env.DFE_UX_PORT = originalPort
    }
  })

  it('accepts only the dedicated sibling cron worktree shape', () => {
    const repoRoot = process.cwd()
    const primaryRoot = path.basename(repoRoot) === 'hermes-frontpage-engine-cron'
      ? path.join(path.dirname(repoRoot), 'hermes-frontpage-engine')
      : repoRoot
    const parent = path.resolve(primaryRoot, '..')

    expect(isSafeCronWorktreePath(path.join(parent, 'hermes-frontpage-engine-cron'), primaryRoot)).toBe(true)
    expect(isSafeCronWorktreePath(primaryRoot, primaryRoot)).toBe(false)
    expect(isSafeCronWorktreePath(os.homedir(), primaryRoot)).toBe(false)
    expect(isSafeCronWorktreePath(path.parse(primaryRoot).root, primaryRoot)).toBe(false)
    expect(isSafeCronWorktreePath(path.join(parent, 'frontpage-scratch'), primaryRoot)).toBe(false)
    expect(isSafeCronWorktreePath(path.join(parent, 'my-frontpage-cron-backup'), primaryRoot)).toBe(false)
    expect(isSafeCronWorktreePath(path.join(parent, 'foo', 'hermes-frontpage-engine-cron'), primaryRoot)).toBe(false)
    expect(isSafeCronWorktreePath(path.resolve(parent, '..', 'hermes-frontpage-engine-cron'), primaryRoot)).toBe(false)
  })
})
