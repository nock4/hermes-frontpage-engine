import { describe, it, expect } from 'vitest'
import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { execFileSync } from 'node:child_process'
import { preserveCronEvidence, snapshotCronWorktree, writeCronCheckpoint, readProofCheckpoint, readCandidateCheckpoint } from '../../scripts/lib/cron-recovery-state.mjs'
async function fixture() { await fs.mkdir(path.resolve('tmp'), { recursive: true }); return fs.mkdtemp(path.resolve('tmp/cron-state-')) }
describe('durable cron recovery', () => {
  it('resumes only the exact unpushed candidate worktree, never a published or foreign run', async () => {
    const root = await fixture(), file = path.join(root, 'candidate.json')
    const summary = { worktree_dir: root, latest_run_dir: path.join(root, 'tmp/daily-process-runs/exact'), push_succeeded: false }
    await fs.writeFile(file, JSON.stringify(summary))
    expect((await readCandidateCheckpoint(file, root)).latest_run_dir).toBe(summary.latest_run_dir)
    await expect(readCandidateCheckpoint(file, path.join(root, 'other'))).rejects.toThrow('exact')
    await fs.writeFile(file, JSON.stringify({ ...summary, push_succeeded: true }))
    await expect(readCandidateCheckpoint(file, root)).rejects.toThrow('proof-only')
  })
  it('discovers staged and clean unpublished commits and keeps a durable git ref', async () => {
    const root = await fixture(), repo = path.join(root, 'repo')
    await fs.mkdir(path.join(repo, 'public/editions'), { recursive: true })
    const git = (...args) => execFileSync('git', args, { cwd: repo, encoding: 'utf8' }).trim()
    git('init', '-q'); git('config', 'user.email', 'test@example.invalid'); git('config', 'user.name', 'Fixture')
    await fs.writeFile(path.join(repo, 'public/editions/index.json'), 'baseline'); git('add', '.'); git('commit', '-qm', 'baseline'); git('branch', 'baseline')
    await fs.writeFile(path.join(repo, 'public/editions/index.json'), 'unpublished'); git('add', '.'); git('commit', '-qm', 'unpublished')
    await fs.writeFile(path.join(repo, 'public/editions/staged.json'), 'staged'); git('add', '.')
    await fs.writeFile(path.join(repo, 'public/editions/staged.json'), 'unstaged')
    const saved = await snapshotCronWorktree(repo, path.join(root, 'archive'), 'baseline')
    expect(await fs.readFile(path.join(saved, 'public/editions/index.json'), 'utf8')).toBe('unpublished')
    expect(await fs.readFile(path.join(saved, 'public/editions/staged.json'), 'utf8')).toBe('unstaged')
    const meta = JSON.parse(await fs.readFile(path.join(saved, 'git-recovery.json'), 'utf8'))
    expect(git('rev-parse', meta.ref)).toBe(git('rev-parse', 'HEAD'))
    expect(git('show', `${meta.index_ref}:public/editions/staged.json`)).toBe('staged')
  })
  it('retains failed run, plate and dirty candidate before worktree removal', async () => {
    const root = await fixture(), worktree = path.join(root, 'worktree'), archive = path.join(root, 'retained')
    await fs.mkdir(path.join(worktree, 'tmp/run'), { recursive: true }); await fs.writeFile(path.join(worktree, 'tmp/run/audit.json'), '{"pass":false}')
    await fs.mkdir(path.join(worktree, 'public/editions/candidate/assets'), { recursive: true }); await fs.writeFile(path.join(worktree, 'public/editions/candidate/assets/plate.png'), 'original bytes')
    const saved = await preserveCronEvidence(worktree, archive, ['public/editions/candidate/assets/plate.png'])
    await fs.rm(worktree, { recursive: true })
    expect(await fs.readFile(path.join(saved, 'tmp/run/audit.json'), 'utf8')).toContain('false')
    expect(await fs.readFile(path.join(saved, 'public/editions/candidate/assets/plate.png'), 'utf8')).toBe('original bytes')
  })
  it('rejects unsafe preservation paths before copying', async () => {
    const root = await fixture()
    await expect(preserveCronEvidence(root, path.join(root, 'retained'), ['../secret'])).rejects.toThrow('Unsafe')
  })
  it('keeps each checkpoint and refuses proof-only without exact pushed identity', async () => {
    const root = await fixture(), file = path.join(root, 'run.json')
    await writeCronCheckpoint(file, { stage: 'generation', push_succeeded: false })
    await expect(readProofCheckpoint(file)).rejects.toThrow('pushed')
    await writeCronCheckpoint(file, { stage: 'remote', push_succeeded: true, local_edition_id: '2026-10-18-test-v1', commit: 'a'.repeat(40) })
    expect((await readProofCheckpoint(file)).local_edition_id).toBe('2026-10-18-test-v1')
    expect((await fs.readdir(file + '.history')).length).toBe(2)
  })
})
