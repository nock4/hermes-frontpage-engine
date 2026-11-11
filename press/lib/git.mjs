// Publishing is a git commit and push of the files the press wrote. The branch
// of the checkout decides what that means: on main the push deploys the site,
// on any other branch it is a shadow run that production never sees.

import { execFile } from 'node:child_process'
import fs from 'node:fs'
import path from 'node:path'

const PUBLISHED_PATHS = ['public/editions', 'public/press', 'press/data/ledger.json']

function git(repo, args) {
  return new Promise((resolve, reject) => {
    execFile('git', ['-C', repo, ...args], { maxBuffer: 16 * 1024 * 1024, timeout: 300_000 }, (error, stdout, stderr) => {
      if (error) reject(new Error(`git ${args[0]} failed: ${(stderr || error.message).trim().split('\n').slice(-2).join(' ').slice(0, 300)}`))
      else resolve(stdout.trim())
    })
  })
}

export function currentBranch(repo) {
  return git(repo, ['rev-parse', '--abbrev-ref', 'HEAD'])
}

// Commit whatever the press changed, then push if this checkout is ahead.
// Safe to repeat: a run with nothing new does nothing, and a push that failed
// last time goes out on the next run.
export async function publish(repo, message) {
  const paths = PUBLISHED_PATHS.filter((entry) => fs.existsSync(path.join(repo, entry)))
  await git(repo, ['add', '-A', '--', ...paths])
  const staged = await git(repo, ['diff', '--cached', '--name-only', '--', ...paths])
  if (staged) await git(repo, ['commit', '-q', '-m', message, '--', ...paths])

  const branch = await currentBranch(repo)
  const onRemote = await git(repo, ['rev-parse', '--verify', '-q', `refs/remotes/origin/${branch}`]).then(() => true, () => false)
  const ahead = onRemote ? Number(await git(repo, ['rev-list', '--count', `origin/${branch}..HEAD`])) : 1
  if (!ahead) return { committed: Boolean(staged), pushed: false, branch }
  try {
    await git(repo, ['push', '-q', '-u', 'origin', `HEAD:refs/heads/${branch}`])
  } catch {
    // Someone else pushed first: replay our commits on top and try once more.
    await git(repo, ['pull', '-q', '--rebase', 'origin', branch])
    await git(repo, ['push', '-q', '-u', 'origin', `HEAD:refs/heads/${branch}`])
  }
  return { committed: Boolean(staged), pushed: true, branch }
}
