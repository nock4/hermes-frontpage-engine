import { spawn } from 'node:child_process'
import path from 'node:path'
import os from 'node:os'
import { fileURLToPath } from 'node:url'

export const bookmarkCacheDir = () => process.env.DFE_BOOKMARK_CACHE_DIR || path.join(os.homedir(), '.hermes/profiles/frontpage/cache/artwork-bookmarks-v1')

// Isolate filesystem calls in a killable process: Promise.race alone leaves a
// blocked libuv open/scandir alive and can keep the entire press from exiting.
export function runVaultWorker(options, { timeoutMs = 20000, workerCode } = {}) {
  return new Promise((resolve, reject) => {
    const args = workerCode ? ['-e', workerCode] : [fileURLToPath(new URL('./bookmark-vault-worker.mjs', import.meta.url))]
    const child = spawn(process.execPath, args, { stdio: ['pipe', 'pipe', 'pipe'] })
    let stdout = '', lastOperation = '', timedOut = false, oversized = false
    child.stdout.on('data', chunk => { stdout += chunk; if (stdout.length > 8_000_000) { oversized = true; child.kill('SIGKILL') } })
    child.stderr.on('data', chunk => { lastOperation = (lastOperation + chunk).slice(-2000) })
    child.stdin.on('error', () => {})
    child.stdin.end(JSON.stringify({ ...options, recentSourceKeys: [...(options.recentSourceKeys || [])] }))
    const timer = setTimeout(() => { timedOut = true; child.kill('SIGKILL') }, timeoutMs)
    child.once('error', error => { clearTimeout(timer); reject(error) })
    child.once('close', code => {
      clearTimeout(timer)
      if (timedOut) return reject(new Error(`Vault access timeout after ${timeoutMs}ms; last operation: ${lastOperation.trim()}. Verify directory AND direct note reads in this execution context; cached metadata is not live vault access proof.`))
      if (oversized || code !== 0) return reject(new Error(`Vault intake failed (${code}): ${lastOperation.trim()}`))
      try { resolve(JSON.parse(stdout)) } catch (error) { reject(error) }
    })
  })
}

export function loadBookmarkBatch(options) {
  // Index local metadata completely under worker byte/time/file bounds; only
  // maxNotes limits model-facing nomination. Legacy maxReads is not an index
  // coverage limit: a folder prefix cannot establish the available artwork.
  return runVaultWorker({ maxNotes: 24, ...options, cacheDir: options.cacheDir || bookmarkCacheDir() })
}
