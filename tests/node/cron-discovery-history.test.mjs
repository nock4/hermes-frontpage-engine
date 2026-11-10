import { it, expect } from 'vitest'
import fs from 'node:fs/promises'
import path from 'node:path'
import os from 'node:os'
import { discoverRecovery } from '../../scripts/lib/cron-reliability.mjs'

// Synthetic filesystem fixtures exercise the real production discovery boundary.
async function history(check) {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'discovery-history-'))
  try {
    const work = path.join(root, 'work'), store = path.join(root, 'checkpoints')
    const proofs = path.join(work, 'tmp/cron-checkpoints')
    await fs.mkdir(store, { recursive: true }); await fs.mkdir(proofs, { recursive: true })
    const run = path.join(work, 'tmp/daily-process-runs/refreshed-away')
    const state = path.join(root, 'review-state.json')
    const candidate = { worktreeDir: work, runDir: run, editionId: '2026-11-09-light-loses-count-v1' }
    await fs.writeFile(state, JSON.stringify({ schema_version: 1, initial: candidate, current: candidate, repairs: 0, blocked_plate_sha256: [], pending_repair: null }))
    const failed = { worktree_dir: work, latest_run_dir: run, local_edition_id: candidate.editionId, review_continuation_state: state, ok: false, push_succeeded: false, remote_matches: false, commit: null, updated_at: '2026-11-09T09:00:00Z' }
    const accepted = { ...failed, ok: true, push_succeeded: true, remote_matches: true, commit: 'a'.repeat(40), updated_at: '2026-11-09T13:00:00Z' }
    const write = async (file, value) => { await fs.writeFile(file, JSON.stringify(value)); return file }
    const failedFile = await write(path.join(store, '01-failed.json'), failed)
    await check({ root, work, store, proofs, run, state, failed, accepted, failedFile, write })
  } finally { await fs.rm(root, { recursive: true, force: true }) }
}

it('collapses accepted exact-run history before dereferencing a refreshed-away review run', async () => {
  await history(async ({ work, store, proofs, failed, accepted, failedFile, write }) => {
    const original = await fs.readFile(failedFile, 'utf8')
    const proof = await write(path.join(proofs, '02-accepted.json'), accepted)
    await write(path.join(store, '03-later-failed-proof.json'), { ...accepted, ok: false, remote_matches: false, updated_at: '2026-11-10T01:00:00Z' })
    await write(path.join(store, '04-today-before-package.json'), { ...failed, local_edition_id: null, review_continuation_state: null, latest_run_dir: path.join(work, 'tmp/daily-process-runs/today') })
    expect(await discoverRecovery(store, '2026-11-10', work)).toEqual({})
    const retained = path.join(store, '02-accepted.json')
    expect(await fs.readFile(retained, 'utf8')).toBe(await fs.readFile(proof, 'utf8'))
    expect(await discoverRecovery(store, '2026-11-09', work)).toEqual({ proofOnly: retained })
    expect(await fs.readFile(failedFile, 'utf8')).toBe(original)
  })
})

it.each([
  { ok: false }, { push_succeeded: false }, { remote_matches: false },
  { commit: null }, { commit: 'invalid' }, { local_edition_id: null },
])('does not retire a missing continuation with incomplete accepted proof %j', async mutation => {
  await history(async ({ work, store, proofs, accepted, write }) => {
    await write(path.join(proofs, 'accepted.json'), { ...accepted, ...mutation })
    await expect(discoverRecovery(store, '2026-11-10', work)).rejects.toThrow(/ENOENT/)
  })
})

it('does not hide an older invalid continuation behind a newer unverified checkpoint', async () => {
  await history(async ({ work, store, failed, write }) => {
    await write(path.join(store, 'newer.json'), { ...failed, review_continuation_state: null, updated_at: '2026-11-09T16:00:00Z' })
    await expect(discoverRecovery(store, '2026-11-10', work)).rejects.toThrow(/ENOENT/)
  })
})

it('rejects conflicting exact-run worktree identities', async () => {
  await history(async ({ root, work, store, proofs, accepted, write }) => {
    await write(path.join(proofs, 'accepted.json'), { ...accepted, worktree_dir: path.join(root, 'other') })
    await expect(discoverRecovery(store, '2026-11-10', work)).rejects.toThrow(/worktree identity/)
  })
})

it('does not suppress an unresolved missing continuation on either day', async () => {
  await history(async ({ work, store }) => {
    for (const date of ['2026-11-09', '2026-11-10']) {
      await expect(discoverRecovery(store, date, work)).rejects.toThrow(/ENOENT/)
    }
  })
})

it('does not equate a same-edition different run with an accepted run', async () => {
  await history(async ({ work, store, proofs, accepted, write }) => {
    await write(path.join(proofs, 'accepted.json'), { ...accepted, latest_run_dir: path.join(work, 'tmp/daily-process-runs/other') })
    await expect(discoverRecovery(store, '2026-11-10', work)).rejects.toThrow(/ENOENT/)
  })
})

it('retains contradictory exact-run edition and commit identities as blockers', async () => {
  await history(async ({ work, store, proofs, failed, accepted, failedFile, write }) => {
    await write(path.join(proofs, 'accepted.json'), accepted)
    await write(failedFile, { ...failed, local_edition_id: '2026-11-09-different-v1' })
    await expect(discoverRecovery(store, '2026-11-10', work)).rejects.toThrow(/identity/)
    await write(failedFile, { ...failed, commit: 'b'.repeat(40) })
    await expect(discoverRecovery(store, '2026-11-10', work)).rejects.toThrow(/identity/)
  })
})

it('keeps multiple unresolved same-day candidates ambiguous and old candidates blocked', async () => {
  await history(async ({ work, store, failed, failedFile, write }) => {
    await write(failedFile, { ...failed, review_continuation_state: null })
    await expect(discoverRecovery(store, '2026-11-10', work)).rejects.toThrow(/date boundary/)
    await write(path.join(store, 'other.json'), { ...failed, review_continuation_state: null, latest_run_dir: path.join(work, 'tmp/daily-process-runs/other') })
    await expect(discoverRecovery(store, '2026-11-09', work)).rejects.toThrow(/ambiguous/)
  })
})

it('does not swallow malformed unresolved continuation state beside accepted history', async () => {
  await history(async ({ work, store, proofs, state, failed, accepted, failedFile, write }) => {
    await write(path.join(proofs, 'accepted.json'), accepted)
    await write(failedFile, { ...failed, latest_run_dir: path.join(work, 'tmp/daily-process-runs/unresolved') })
    await fs.writeFile(state, '{broken json')
    await expect(discoverRecovery(store, '2026-11-10', work)).rejects.toThrow()
  })
})
