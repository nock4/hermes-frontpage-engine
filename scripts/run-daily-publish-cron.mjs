import { spawn } from 'node:child_process'
import fs from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import https from 'node:https'

const primaryRoot = path.resolve(fileURLToPath(new URL('..', import.meta.url)))
const defaultVaultRoot = '/Users/nickgeorge-studio/Documents/nicks-mind-map'
const defaultWorktreeDir = process.env.DFE_CRON_WORKTREE_DIR || path.resolve(primaryRoot, '..', 'hermes-frontpage-engine-cron')
const remoteManifestUrl = 'https://daily.nockgarden.com/editions/index.json'

function parseArgs(argv) {
  const options = {
    inputRoot: defaultVaultRoot,
    worktreeDir: defaultWorktreeDir,
    branch: 'main',
    remote: 'origin',
    remoteUrl: remoteManifestUrl,
    retries: 5,
    retryDelayMs: 5000,
  }

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index]
    const readValue = () => {
      const value = argv[index + 1]
      if (!value || value.startsWith('--')) throw new Error(`Missing value for ${arg}`)
      index += 1
      return value
    }

    if (arg === '--input-root') options.inputRoot = readValue()
    else if (arg === '--worktree-dir') options.worktreeDir = readValue()
    else if (arg === '--branch') options.branch = readValue()
    else if (arg === '--remote') options.remote = readValue()
    else if (arg === '--remote-url') options.remoteUrl = readValue()
    else if (arg === '--retries') options.retries = Number.parseInt(readValue(), 10)
    else if (arg === '--retry-delay-ms') options.retryDelayMs = Number.parseInt(readValue(), 10)
    else if (arg === '--help') {
      console.log('Usage: node scripts/run-daily-publish-cron.mjs [--input-root <path>] [--worktree-dir <path>] [--branch <name>] [--remote <name>] [--remote-url <url>]')
      process.exit(0)
    } else {
      throw new Error(`Unknown option: ${arg}`)
    }
  }

  if (!Number.isFinite(options.retries) || options.retries < 1) throw new Error('--retries must be >= 1')
  if (!Number.isFinite(options.retryDelayMs) || options.retryDelayMs < 0) throw new Error('--retry-delay-ms must be >= 0')
  return options
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

function run(command, args, { cwd = primaryRoot, capture = false, allowFailure = false, env = process.env } = {}) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, {
      cwd,
      env,
      stdio: capture ? ['ignore', 'pipe', 'pipe'] : 'inherit',
    })

    let stdout = ''
    let stderr = ''
    if (capture) {
      child.stdout.on('data', (chunk) => {
        stdout += chunk.toString()
      })
      child.stderr.on('data', (chunk) => {
        stderr += chunk.toString()
      })
    }

    child.on('error', reject)
    child.on('close', (code) => {
      const result = { code: code ?? 1, stdout, stderr }
      if (code === 0 || allowFailure) {
        resolve(result)
        return
      }
      const error = new Error(`${command} ${args.join(' ')} failed with exit code ${code}`)
      error.result = result
      reject(error)
    })
  })
}

async function exists(targetPath) {
  try {
    await fs.access(targetPath)
    return true
  } catch {
    return false
  }
}

async function ensureNodeModulesLink(worktreeDir) {
  const sourceNodeModules = path.join(primaryRoot, 'node_modules')
  const targetNodeModules = path.join(worktreeDir, 'node_modules')
  if (!(await exists(sourceNodeModules))) {
    throw new Error(`Primary repo is missing node_modules at ${sourceNodeModules}`)
  }
  if (await exists(targetNodeModules)) return
  await fs.symlink(sourceNodeModules, targetNodeModules, 'junction')
}

async function ensureWorktree({ worktreeDir, remote, branch }) {
  await run('git', ['fetch', remote, branch, '--prune'], { cwd: primaryRoot })

  const worktreeGitDir = path.join(worktreeDir, '.git')
  if (!(await exists(worktreeGitDir))) {
    if (await exists(worktreeDir)) {
      await fs.rm(worktreeDir, { recursive: true, force: true })
    }
    await run('git', ['worktree', 'add', '--force', '--detach', worktreeDir, `${remote}/${branch}`], { cwd: primaryRoot })
  }

  await ensureNodeModulesLink(worktreeDir)
  await run('git', ['fetch', remote, branch, '--prune'], { cwd: worktreeDir })
  await run('git', ['checkout', '--detach', `${remote}/${branch}`], { cwd: worktreeDir })
  await run('git', ['reset', '--hard', `${remote}/${branch}`], { cwd: worktreeDir })
  await run('git', ['clean', '-fdx', '-e', 'node_modules'], { cwd: worktreeDir })
}

async function readJson(filePath) {
  return JSON.parse(await fs.readFile(filePath, 'utf8'))
}

async function latestRunDir(worktreeDir) {
  const runsRoot = path.join(worktreeDir, 'tmp', 'daily-process-runs')
  if (!(await exists(runsRoot))) return null
  const entries = await fs.readdir(runsRoot, { withFileTypes: true })
  const dirs = []
  for (const entry of entries) {
    if (!entry.isDirectory()) continue
    const fullPath = path.join(runsRoot, entry.name)
    const stat = await fs.stat(fullPath)
    dirs.push({ path: fullPath, mtimeMs: stat.mtimeMs })
  }
  dirs.sort((a, b) => b.mtimeMs - a.mtimeMs)
  return dirs[0]?.path || null
}

async function verifyRemoteManifest(remoteUrl, expectedEditionId, { retries, retryDelayMs }) {
  let lastError = null
  for (let attempt = 1; attempt <= retries; attempt += 1) {
    try {
      const payload = await fetchJson(remoteUrl)
      if (payload?.current_edition_id === expectedEditionId) {
        return {
          ok: true,
          attempt,
          current_edition_id: payload.current_edition_id,
        }
      }
      lastError = new Error(`remote current_edition_id=${payload?.current_edition_id || 'null'} expected=${expectedEditionId}`)
    } catch (error) {
      lastError = error
    }
    if (attempt < retries) await sleep(retryDelayMs)
  }
  return {
    ok: false,
    error: lastError?.message || 'remote verification failed',
  }
}

function fetchJson(url) {
  return new Promise((resolve, reject) => {
    const request = https.get(url, (response) => {
      const statusCode = response.statusCode || 0
      if (statusCode < 200 || statusCode >= 300) {
        response.resume()
        reject(new Error(`HTTP ${statusCode} for ${url}`))
        return
      }
      let body = ''
      response.setEncoding('utf8')
      response.on('data', (chunk) => {
        body += chunk
      })
      response.on('end', () => {
        try {
          resolve(JSON.parse(body))
        } catch (error) {
          reject(error)
        }
      })
    })
    request.on('error', reject)
  })
}

function parseStatusLines(stdout) {
  return stdout
    .split(/\r?\n/)
    .map((line) => line.trimEnd())
    .filter(Boolean)
}

function allowedStatusPath(line) {
  const candidate = line.slice(3).trim()
  return candidate === 'public/editions' || candidate.startsWith('public/editions/')
}

async function commitPublishedArtifacts(worktreeDir, editionId, branch) {
  const status = await run('git', ['status', '--short'], { cwd: worktreeDir, capture: true })
  const lines = parseStatusLines(status.stdout)
  if (!lines.length) {
    return { committed: false, commit: null, changed_paths: [] }
  }
  const unexpected = lines.filter((line) => !allowedStatusPath(line))
  if (unexpected.length) {
    throw new Error(`Unexpected changed paths in cron worktree: ${unexpected.join(', ')}`)
  }

  await run('git', ['add', 'public/editions'], { cwd: worktreeDir })
  const cached = await run('git', ['diff', '--cached', '--name-only'], { cwd: worktreeDir, capture: true })
  const cachedPaths = parseStatusLines(cached.stdout)
  if (!cachedPaths.length) {
    return { committed: false, commit: null, changed_paths: [] }
  }

  const commitMessage = `feat: publish daily edition ${editionId}`
  await run('git', ['commit', '-m', commitMessage], { cwd: worktreeDir })
  const head = await run('git', ['rev-parse', 'HEAD'], { cwd: worktreeDir, capture: true })
  const commit = head.stdout.trim()
  await run('git', ['push', 'origin', `HEAD:${branch}`], { cwd: worktreeDir })
  return { committed: true, commit, changed_paths: cachedPaths }
}

async function main() {
  const options = parseArgs(process.argv.slice(2))
  const summary = {
    ok: false,
    worktree_dir: path.resolve(options.worktreeDir),
    input_root: path.resolve(options.inputRoot),
    local_edition_id: null,
    local_publish_status: null,
    commit: null,
    push_succeeded: false,
    remote_matches: false,
    remote_url: options.remoteUrl,
    latest_run_dir: null,
  }

  try {
    await ensureWorktree(options)

    await run('npm', ['run', 'daily:process', '--', '--input-mode', 'obsidian-allowlist', '--input-root', options.inputRoot, '--publish'], {
      cwd: options.worktreeDir,
    })
    await run('npm', ['run', 'qa:publish'], { cwd: options.worktreeDir })

    const manifest = await readJson(path.join(options.worktreeDir, 'public', 'editions', 'index.json'))
    summary.local_edition_id = manifest.current_edition_id || null
    const liveEdition = Array.isArray(manifest.editions)
      ? manifest.editions.find((edition) => (edition.id || edition.edition_id) === manifest.current_edition_id)
      : null
    summary.local_publish_status = liveEdition?.is_live === true ? 'live' : 'not-live'

    const commitResult = await commitPublishedArtifacts(options.worktreeDir, summary.local_edition_id || new Date().toISOString().slice(0, 10), options.branch)
    summary.commit = commitResult.commit
    summary.push_succeeded = true
    summary.changed_paths = commitResult.changed_paths

    const remoteVerification = await verifyRemoteManifest(options.remoteUrl, summary.local_edition_id, options)
    summary.remote_matches = remoteVerification.ok
    summary.remote_verification = remoteVerification
    summary.ok = summary.local_publish_status === 'live' && summary.push_succeeded && summary.remote_matches
    console.log(JSON.stringify(summary, null, 2))
    if (!summary.ok) process.exit(1)
  } catch (error) {
    summary.error = error.message
    summary.latest_run_dir = await latestRunDir(options.worktreeDir)
    console.log(JSON.stringify(summary, null, 2))
    process.exit(1)
  }
}

main()