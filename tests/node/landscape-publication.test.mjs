import { execFileSync } from 'node:child_process'
import { it, expect } from 'vitest'
import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { platePng } from '../fixtures/plate-png.mjs'
import { assertLandscapePublication } from '../../scripts/lib/landscape-policy.mjs'
import { readImageDimensions } from '../../scripts/lib/edition-geometry.mjs'
import { commitPublishedArtifacts } from '../../scripts/run-daily-publish-cron.mjs'

const editionId = '2026-10-16-landscape-a-v1'
const otherId = '2026-10-16-portrait-b-v1'
const record = (id) => ({ edition_id: id, path: `/editions/${id}`, preview_asset_path: `/editions/${id}/assets/preview.png`, is_live: true })
async function fixture(root) {
  for (const id of [editionId, otherId]) {
    const dir = path.join(root, 'public', 'editions', id)
    await fs.mkdir(path.join(dir, 'assets'), { recursive: true })
    for (const asset of ['plate.png', 'preview.png']) await fs.writeFile(path.join(dir, 'assets', asset), id === editionId ? platePng() : platePng(8, 12))
    await fs.writeFile(path.join(dir, 'edition.json'), JSON.stringify({ edition_id: id, plate_asset_path: `/editions/${id}/assets/plate.png` }))
  }
  const manifest = { current_edition_id: editionId, editions: [record(editionId)] }
  await fs.writeFile(path.join(root, 'public', 'editions', 'index.json'), JSON.stringify(manifest))
  return manifest
}

it.each([
  ['different current target', (m) => { m.current_edition_id = otherId; m.editions = [record(otherId)] }],
  ['different live target', (m) => { m.editions = [{ ...record(editionId), is_live: false }, record(otherId)] }],
  ['multiple live targets', (m) => { m.editions.push(record(otherId)) }],
  ['duplicate current record', (m) => { m.editions.push({ ...record(editionId), is_live: false }) }],
  ['missing live target', (m) => { m.editions[0].is_live = false }],
  ['different edition path', (m) => { m.editions[0].path = `/editions/${otherId}` }],
  ['different preview path', (m) => { m.editions[0].preview_asset_path = `/editions/${otherId}/assets/preview.png` }],
])('commit boundary rejects %s before git', async (_label, mutate) => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'dfe-manifest-binding-'))
  try {
    const manifest = await fixture(root)
    mutate(manifest)
    const target = path.join(root, 'public', 'editions', 'index.json')
    const before = JSON.stringify(manifest)
    await fs.writeFile(target, before)
    await expect(commitPublishedArtifacts(root, editionId, 'main')).rejects.toThrow(/publication target/i)
    expect(await fs.readFile(target, 'utf8')).toBe(before)
  } finally { await fs.rm(root, { recursive: true, force: true }) }
})

it.each(['edition_id', 'plate_asset_path'])('commit boundary rejects mismatched edition %s before git', async (field) => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'dfe-edition-binding-'))
  try {
    await fixture(root)
    const target = path.join(root, 'public', 'editions', editionId, 'edition.json')
    const edition = JSON.parse(await fs.readFile(target, 'utf8'))
    edition[field] = field === 'edition_id' ? otherId : `/editions/${otherId}/assets/plate.png`
    await fs.writeFile(target, JSON.stringify(edition))
    await expect(commitPublishedArtifacts(root, editionId, 'main')).rejects.toThrow(/publication target/i)
  } finally { await fs.rm(root, { recursive: true, force: true }) }
})

it.each(['index.json', `${editionId}/assets/plate.png`, `${editionId}/assets/preview.png`])('validates actual staged %s after git clean filters', async (target) => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'dfe-staged-binding-'))
  try {
    await fixture(root)
    await fs.rm(path.join(root, 'public', 'editions', otherId), { recursive: true })
    const git = (...args) => execFileSync('git', args, { cwd: root, stdio: 'pipe' })
    git('init')
    git('config', 'status.showUntrackedFiles', 'all')
    // Prevent any commit even if the guard regresses; no remote exists.
    await fs.writeFile(path.join(root, '.git/hooks/pre-commit'), '#!/bin/sh\nexit 1\n', { mode: 0o755 })
    await fs.writeFile(path.join(root, '.git/filter.cjs'), target === 'index.json'
      ? `process.stdin.resume();process.stdin.on('end',()=>process.stdout.write(${JSON.stringify(JSON.stringify({ current_edition_id: otherId, editions: [record(otherId)] }))}));`
      : `process.stdin.resume();process.stdin.on('end',()=>process.stdout.write(Buffer.from('${platePng(8, 12).toString('base64')}', 'base64')));`)
    git('config', 'filter.review.clean', `${process.execPath} .git/filter.cjs`)
    git('config', 'filter.review.required', 'true')
    await fs.writeFile(path.join(root, '.git/info/attributes'), `public/editions/${target} filter=review\n`)
    await expect(commitPublishedArtifacts(root, editionId, 'main')).rejects.toThrow(target === 'index.json' ? /publication target/i : /Landscape plate required/i)
    expect(JSON.parse(await fs.readFile(path.join(root, 'public/editions/index.json'), 'utf8')).current_edition_id).toBe(editionId)
    expect(() => git('rev-parse', '--verify', 'HEAD')).toThrow()
  } finally { await fs.rm(root, { recursive: true, force: true }) }
})

it('matching recovered publication reaches git with canonical assets', async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'dfe-valid-binding-'))
  try {
    await fixture(root)
    await expect(commitPublishedArtifacts(root, editionId, 'main')).rejects.toThrow(/git status --short failed with exit code 128/i)
  } finally { await fs.rm(root, { recursive: true, force: true }) }
})

it.each(['plate.png', 'preview.png'])('cron commit/push rejects invalid %s before any git operation', async (asset) => {
  // Deliberately not a git repo: reaching git would fail with a different error.
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'dfe-cron-landscape-'))
  const editionDir = path.join(root, 'public', 'editions', editionId)
  try {
    const manifest = JSON.stringify(await fixture(root))
    for (const bytes of [platePng(8, 12), platePng(8, 8), Buffer.from('corrupt'), platePng().subarray(0, 24)]) {
      await fs.writeFile(path.join(editionDir, 'assets', asset), bytes)
      await expect(commitPublishedArtifacts(root, editionId, 'main')).rejects.toThrow(/landscape/i)
      expect(await fs.readFile(path.join(editionDir, 'assets', asset))).toEqual(bytes)
      expect(await fs.readFile(path.join(root, 'public', 'editions', 'index.json'), 'utf8')).toBe(manifest)
    }
  } finally { await fs.rm(root, { recursive: true, force: true }) }
})

it('retries the exact committed candidate after push failure without a new diff', async () => {
  await fs.mkdir(path.resolve('tmp'), { recursive: true })
  const base = await fs.mkdtemp(path.resolve('tmp/press-push-recovery-'))
  const root = path.join(base, 'repo'), remote = path.join(base, 'remote.git')
  await fs.mkdir(root); await fs.mkdir(remote)
  const git = (...args) => execFileSync('git', args, { cwd: root, encoding: 'utf8', stdio: 'pipe' }).trim()
  try {
    await fixture(root); await fs.rm(path.join(root, 'public/editions', otherId), { recursive: true })
    git('init', '-q'); git('config', 'user.email', 'test@example.invalid'); git('config', 'user.name', 'Fixture'); git('add', '.'); git('commit', '-qm', 'baseline')
    execFileSync('git', ['init', '--bare', '-q', remote])
    git('remote', 'add', 'origin', remote)
    const hook = path.join(remote, 'hooks/pre-receive')
    await fs.writeFile(hook, '#!/bin/sh\nexit 1\n', { mode: 0o755 })
    const file = path.join(root, 'public/editions', editionId, 'edition.json')
    const edition = JSON.parse(await fs.readFile(file, 'utf8')); edition.title = 'retained candidate'
    await fs.writeFile(file, JSON.stringify(edition))
    await expect(commitPublishedArtifacts(root, editionId, 'main')).rejects.toThrow(/push/)
    const commit = git('rev-parse', 'HEAD'); expect(git('status', '--short')).toBe('')
    await fs.unlink(hook)
    const recovered = await commitPublishedArtifacts(root, editionId, 'main')
    expect(recovered.commit).toBe(commit); expect(recovered.push_succeeded).toBe(true)
    expect(git('ls-remote', 'origin', 'refs/heads/main').split(/\s/)[0]).toBe(commit)
  } finally { await fs.rm(base, { recursive: true, force: true }) }
})

it('publication checks both actual assets while archive reading remains portrait-capable', async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'dfe-landscape-publish-'))
  try {
    await fs.mkdir(path.join(root, 'assets'))
    for (const asset of ['plate.png', 'preview.png']) await fs.writeFile(path.join(root, 'assets', asset), platePng())
    await expect(assertLandscapePublication(root)).resolves.toBeUndefined()
    for (const asset of ['plate.png', 'preview.png']) {
      for (const [w, h] of [[8, 12], [8, 8]]) {
        const target = path.join(root, 'assets', asset)
        await fs.writeFile(target, platePng(w, h))
        await expect(assertLandscapePublication(root)).rejects.toThrow(/landscape/i)
        expect(await readImageDimensions(target)).toEqual({ width: w, height: h })
      }
      await fs.writeFile(path.join(root, 'assets', asset), platePng())
    }
    await fs.unlink(path.join(root, 'assets', 'plate.png'))
    await expect(assertLandscapePublication(root)).rejects.toThrow(/landscape/i)
  } finally { await fs.rm(root, { recursive: true, force: true }) }
})
