import { describe, it, expect } from 'vitest'
import fs from 'node:fs/promises'
import path from 'node:path'
import { preserveCronEvidence } from '../../scripts/lib/cron-recovery-state.mjs'
import { EventEmitter } from 'node:events'
import { fetchJson, verifyRemoteManifest } from '../../scripts/run-daily-publish-cron.mjs'
import { assertDiskHeadroom, selectRecovery, publicationOutcome, discoverRecovery, writePublicationOutcome } from '../../scripts/lib/cron-reliability.mjs'

describe('bounded remote requests', () => {
  it('bounds transient retries and never accepts a different edition', async () => {
    let calls = 0
    const result = await verifyRemoteManifest('https://example.com', '2026-10-18-art-v1', { retries: 3, retryDelayMs: 0, fetch: async () => { calls++; if (calls === 1) throw new Error('reset'); return { current_edition_id: '2026-10-17-art-v1' } } })
    expect(result.ok).toBe(false)
    expect(calls).toBe(3)
    calls = 0
    await verifyRemoteManifest('https://example.com', '2026-10-18-art-v1', { retries: 3, retryDelayMs: 0, fetch: async () => { calls++; throw Object.assign(new Error('403'), { permanent: true }) } })
    expect(calls).toBe(1)
  })
  it('aborts a response that sends headers and a partial body then stalls', async () => {
    let destroyed = false
    const get = (_url, _options, callback) => {
      const request = new EventEmitter()
      request.destroy = error => { destroyed = true; request.emit('error', error) }
      queueMicrotask(() => {
        const response = new EventEmitter()
        response.statusCode = 200; response.setEncoding = () => {}
        callback(response); response.emit('data', '{')
      })
      return request
    }
    await expect(fetchJson('https://example.com', { timeoutMs: 10, get })).rejects.toThrow(/deadline/)
    expect(destroyed).toBe(true)
  })
  it('destroys a request that never produces headers', async () => {
    let destroyed = false
    const get = () => { const req = new EventEmitter(); req.destroy = e => { destroyed = true; req.emit('error', e) }; return req }
    await expect(fetchJson('https://example.com', { timeoutMs: 10, get })).rejects.toThrow(/deadline/)
    expect(destroyed).toBe(true)
  })
})
describe('recovery decisions', () => {
  const today = '2026-10-18'
  const base = { worktree_dir: '/press', latest_run_dir: '/press/tmp/daily-process-runs/a', local_edition_id: `${today}-art-v1`, push_succeeded: false }
  it('resumes one exact candidate, proves a pushed candidate, rejects ambiguity', () => {
    expect(selectRecovery([{ file: 'a', summary: base }], today).resumeCandidate).toBe('a')
    expect(selectRecovery([{ file: 'a', summary: { ...base, push_succeeded: true, commit: 'a'.repeat(40) } }], today).proofOnly).toBe('a')
    expect(() => selectRecovery([{ file: 'a', summary: base }, { file: 'b', summary: { ...base, latest_run_dir: '/different' } }], today)).toThrow(/ambiguous/)
  })
  it('rejects contradictory identities for the same retained run', () => {
    expect(() => selectRecovery([{ file: 'a', summary: base }, { file: 'b', summary: { ...base, local_edition_id: `${today}-different-v1` } }], today)).toThrow(/identity/)
  })
  it('never abandons unresolved yesterday or counts old proof as today', () => {
    expect(() => selectRecovery([{ file: 'a', summary: { ...base, local_edition_id: '2026-10-17-art-v1' } }], today)).toThrow(/date/)
    const out = publicationOutcome({ ...base, local_edition_id: '2026-10-17-art-v1', ok: true, remote_matches: true, push_succeeded: true, commit: 'a'.repeat(40) }, today)
    expect(out.publication).toBe('other-date')
    expect(out.scheduler_delivery).toBe('unknown')
  })
  it('discovers packaged interrupted runs and writes a separate machine outcome atomically', async () => {
    const root = await fs.mkdtemp(path.join(path.resolve(process.env.TMPDIR || 'tmp/'), 'recovery-test-'))
    try {
      const work = path.join(root, 'work'), dir = path.join(root, 'checkpoints'), run = path.join(work, 'tmp/daily-process-runs/exact')
      await fs.mkdir(run, { recursive: true }); await fs.mkdir(dir)
      await fs.writeFile(path.join(run, 'edition-package-summary.json'), JSON.stringify({ edition_id: base.local_edition_id }))
      const file = path.join(dir, 'one.json')
      await fs.writeFile(file, JSON.stringify({ ...base, local_edition_id: null, worktree_dir: work, latest_run_dir: run }))
      expect(await discoverRecovery(dir, today, work)).toEqual({ resumeCandidate: file })
      const outcome = path.join(root, 'outcomes/one.json')
      await writePublicationOutcome(outcome, { ...base, checkpoint_path: file }, today)
      expect(JSON.parse(await fs.readFile(outcome, 'utf8')).publication).toBe('unverified')
      expect(await fs.readdir(path.dirname(outcome))).toEqual(['one.json'])
      await expect(writePublicationOutcome(outcome, { ...base, commit: 'bad' }, today)).rejects.toThrow(/schema/)
      expect(JSON.parse(await fs.readFile(outcome, 'utf8')).commit).toBe(null)
    } finally { await fs.rm(root, { recursive: true, force: true }) }
  })
  it('rejects malformed pushed state and permits no history', () => {
    expect(selectRecovery([], today)).toEqual({})
    expect(() => selectRecovery([{ file: 'a', summary: { ...base, push_succeeded: true } }], today)).toThrow()
  })
})
describe('disk guard', () => {
  it('preserves original bytes on low space and mid-copy ENOSPC', async () => {
    const root = await fs.mkdtemp(path.join(path.resolve(process.env.TMPDIR || 'tmp/'), 'disk-test-'))
    try {
      await fs.mkdir(path.join(root, 'work/tmp'), { recursive: true })
      const original = path.join(root, 'work/tmp/evidence')
      await fs.writeFile(original, 'irreplaceable')
      const work = path.join(root, 'work'), archive = path.join(root, 'archive')
      await expect(preserveCronEvidence(work, archive, [], { checkDisk: async () => { throw new Error('low space') } })).rejects.toThrow('low space')
      await expect(fs.access(archive)).rejects.toThrow()
      await expect(preserveCronEvidence(work, archive, [], { checkDisk: async () => {}, copy: async () => { throw Object.assign(new Error('ENOSPC'), { code: 'ENOSPC' }) } })).rejects.toThrow('ENOSPC')
      expect(await fs.readFile(original, 'utf8')).toBe('irreplaceable')
    } finally { await fs.rm(root, { recursive: true, force: true }) }
  })
  it('fails closed before writes when low or invalid', async () => {
    await expect(assertDiskHeadroom('.', { requiredBytes: 100, statfs: async () => ({ bavail: 1, bsize: 1 }) })).rejects.toThrow(/headroom/)
    await expect(assertDiskHeadroom('.', { requiredBytes: NaN })).rejects.toThrow(/headroom/)
  })
})
