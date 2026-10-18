import fs from 'node:fs/promises'
import path from 'node:path'
import { randomUUID } from 'node:crypto'
import { execFile } from 'node:child_process'
import { promisify } from 'node:util'

export async function snapshotCronWorktree(worktree, archive, baseline) {
  const git = async args => (await promisify(execFile)('git', args, { cwd: worktree, timeout: 30000, maxBuffer: 16 * 1024 * 1024 })).stdout
  const changed = await git(['diff', '--name-only', '-z', baseline, '--', 'public/editions'])
  const staged = await git(['diff', '--cached', '--name-only', '-z', '--', 'public/editions'])
  const untracked = await git(['ls-files', '--others', '--exclude-standard', '-z', '--', 'public/editions'])
  const commit = (await git(['rev-parse', 'HEAD'])).trim()
  const indexTree = (await git(['write-tree'])).trim()
  const destination = await preserveCronEvidence(worktree, archive, [...new Set((changed + staged + untracked).split('\0').filter(Boolean))])
  const ref = `refs/dfe-recovery/${path.basename(destination)}`
  await git(['update-ref', ref, commit])
  await git(['update-ref', `${ref}-index`, indexTree])
  await fs.writeFile(path.join(destination, 'git-recovery.json'), JSON.stringify({ commit, ref, index_tree: indexTree, index_ref: `${ref}-index`, baseline }, null, 2))
  return destination
}

export async function preserveCronEvidence(worktree, archive, changedPaths) {
  for (const name of changedPaths) {
    if (!name.startsWith('public/editions/') || name.split(/[\\/]/).includes('..') || path.isAbsolute(name)) throw new Error(`Unsafe evidence path: ${name}`)
  }
  const destination = path.join(archive, `${Date.now()}-${randomUUID()}`)
  await fs.mkdir(destination, { recursive: true })
  // tmp holds prompts, original failures, captures, generated plates and mapping.
  // Refuse to refresh if preservation fails; never silently discard evidence.
  try { await fs.cp(path.join(worktree, 'tmp'), path.join(destination, 'tmp'), { recursive: true, dereference: false }) }
  catch (error) { if (error.code !== 'ENOENT') throw error }
  for (const name of changedPaths) {
    const target = path.join(destination, name)
    await fs.mkdir(path.dirname(target), { recursive: true })
    try { await fs.cp(path.join(worktree, name), target, { recursive: true, dereference: false }) }
    catch (error) { if (error.code !== 'ENOENT') throw error }
  }
  await fs.writeFile(path.join(destination, 'preservation.json'), JSON.stringify({ worktree, changed_paths: changedPaths, created_at: new Date().toISOString() }, null, 2))
  return destination
}

export async function writeCronCheckpoint(file, summary) {
  await fs.mkdir(path.dirname(file), { recursive: true })
  await fs.mkdir(`${file}.history`, { recursive: true })
  const body = JSON.stringify({ ...summary, updated_at: new Date().toISOString() }, null, 2) + '\n'
  const id = `${Date.now()}-${randomUUID()}`
  await fs.writeFile(path.join(`${file}.history`, `${id}.json`), body)
  const temp = `${file}.${id}.tmp`
  await fs.writeFile(temp, body)
  await fs.rename(temp, file)
}

export async function readProofCheckpoint(file) {
  const summary = JSON.parse(await fs.readFile(file, 'utf8'))
  if (summary.push_succeeded !== true || !/^[a-f0-9]{40}$/.test(summary.commit || '') || !/^[a-zA-Z0-9][a-zA-Z0-9._-]+$/.test(summary.local_edition_id || '')) {
    throw new Error('Proof-only requires an exact pushed commit and edition checkpoint; generation is forbidden')
  }
  return summary
}

export async function readCandidateCheckpoint(file, worktree) {
  const summary = JSON.parse(await fs.readFile(file, 'utf8'))
  if (summary.push_succeeded) throw new Error('Already published: use proof-only, never regenerate or republish')
  const root = path.resolve(worktree)
  if (path.resolve(summary.worktree_dir || '.') !== root || !summary.latest_run_dir?.startsWith(path.join(root, 'tmp', 'daily-process-runs') + path.sep) || path.resolve(summary.latest_run_dir) !== summary.latest_run_dir) {
    throw new Error('Candidate recovery requires the exact retained worktree/run directory')
  }
  return summary
}
