import fs from 'node:fs/promises'
import path from 'node:path'
import { randomUUID } from 'node:crypto'

export function localPublicationDate(now = new Date()) {
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'America/New_York', year: 'numeric', month: '2-digit', day: '2-digit' }).format(now)
}

export async function assertDiskHeadroom(target, { requiredBytes = 5 * 1024 ** 3, statfs = fs.statfs } = {}) {
  if (!Number.isSafeInteger(requiredBytes) || requiredBytes < 0) throw new Error('Invalid disk headroom requirement')
  let root = path.resolve(target)
  let stats
  for (;;) {
    try { stats = await statfs(root); break } catch (error) {
      if (error.code !== 'ENOENT' || root === path.dirname(root)) throw error
      root = path.dirname(root)
    }
  }
  const available = Number(stats.bavail) * Number(stats.bsize)
  if (!Number.isFinite(available) || available < requiredBytes) throw new Error(`Insufficient disk headroom: available=${available} required=${requiredBytes}; evidence retained`)
  return { available, requiredBytes }
}

export async function evidenceBytes(target) {
  let stat
  try { stat = await fs.lstat(target) } catch (error) { if (error.code === 'ENOENT') return 0; throw error }
  if (!stat.isDirectory()) return stat.size
  let bytes = stat.size
  for (const child of await fs.readdir(target)) bytes += await evidenceBytes(path.join(target, child))
  return bytes
}

export function selectRecovery(records, expectedDate) {
  // Collapse successive proof/recovery invocations of the exact same run.
  const groups = new Map()
  for (const record of records) {
    const s = record.summary
    const key = s.latest_run_dir || record.file
    const previous = groups.get(key)
    if (previous) {
      const p = previous.summary
      if ((p.local_edition_id && s.local_edition_id && p.local_edition_id !== s.local_edition_id)
        || (p.commit && s.commit && p.commit !== s.commit)) throw new Error('Conflicting recovery identity for the same retained run')
    }
    if (!previous || String(s.updated_at || '') > String(previous.summary.updated_at || '')) groups.set(key, record)
  }
  const pending = [...groups.values()].filter(({ summary: s }) => s.ok !== true || s.local_edition_id?.startsWith(expectedDate))
  if (!pending.length) return {}
  if (pending.length !== 1) throw new Error('ambiguous recovery checkpoints; preserve evidence and reconcile explicitly')
  const { file, summary: s } = pending[0]
  if (!s.local_edition_id?.startsWith(`${expectedDate}-`)) throw new Error('Recovery date boundary or missing candidate identity; explicit operator recovery required')
  if (s.push_succeeded === true) {
    if (!/^[a-f0-9]{40}$/.test(s.commit || '')) throw new Error('Malformed pushed recovery identity')
    return { proofOnly: file }
  }
  if (!s.latest_run_dir || !s.worktree_dir) throw new Error('Missing exact candidate identity')
  return { resumeCandidate: file }
}

export async function discoverRecovery(directory, expectedDate, worktree) {
  let names
  try { names = await fs.readdir(directory) } catch (error) { if (error.code === 'ENOENT') return {}; throw error }
  const records = []
  for (const name of names.filter(name => name.endsWith('.json')).sort()) {
    const file = path.join(directory, name)
    const summary = JSON.parse(await fs.readFile(file, 'utf8'))
    if (summary.worktree_dir !== path.resolve(worktree) && summary.push_succeeded !== true) continue
    if (!summary.local_edition_id && summary.latest_run_dir) {
      const root = path.join(path.resolve(worktree), 'tmp', 'daily-process-runs') + path.sep
      if (!summary.latest_run_dir.startsWith(root) || path.resolve(summary.latest_run_dir) !== summary.latest_run_dir) throw new Error('Unsafe candidate run identity')
      try {
        const pkg = JSON.parse(await fs.readFile(path.join(summary.latest_run_dir, 'edition-package-summary.json'), 'utf8'))
        summary.local_edition_id = pkg.edition_id
      } catch (error) { if (error.code !== 'ENOENT') throw error }
    }
    records.push({ file, summary })
  }
  return selectRecovery(records, expectedDate)
}

export function publicationOutcome(summary, expectedDate) {
  const verified = summary.push_succeeded === true && summary.remote_matches === true
  const value = {
    schema_version: 1, expected_date: expectedDate,
    edition_id: summary.local_edition_id || null, commit: summary.commit || null,
    execution: summary.ok === true ? 'succeeded' : 'failed',
    publication: verified ? (summary.local_edition_id?.startsWith(`${expectedDate}-`) ? 'verified' : 'other-date') : 'unverified',
    scheduler_delivery: 'unknown', agent_delivery: 'unknown',
    checkpoint_path: summary.checkpoint_path, recorded_at: new Date().toISOString(),
  }
  if (!/^\d{4}-\d{2}-\d{2}$/.test(expectedDate) || (value.commit !== null && !/^[a-f0-9]{40}$/.test(value.commit)) || (verified && !/^\d{4}-\d{2}-\d{2}-[a-z0-9-]+-v\d+$/.test(value.edition_id || ''))) throw new Error('Invalid publication outcome schema')
  return value
}

export async function writePublicationOutcome(file, summary, expectedDate) {
  const outcome = publicationOutcome(summary, expectedDate)
  await fs.mkdir(path.dirname(file), { recursive: true })
  const temporary = `${file}.${randomUUID()}.tmp`
  await fs.writeFile(temporary, JSON.stringify(outcome, null, 2) + '\n', { flag: 'wx' })
  await fs.rename(temporary, file)
}
