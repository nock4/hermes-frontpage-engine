import dns from 'node:dns/promises'
import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { setTimeout as delay } from 'node:timers/promises'
import { afterEach, expect, it, vi } from 'vitest'

import { inspectCandidateSource } from '../../scripts/lib/source-inspection.mjs'

const fixtures = []
afterEach(async () => {
  vi.restoreAllMocks()
  vi.unstubAllGlobals()
  vi.unstubAllEnvs()
  for (const dir of fixtures.splice(0)) await fs.rm(dir, { recursive: true, force: true })
})

async function harness(body) {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'source-capture-child-'))
  fixtures.push(dir)
  const executable = path.join(dir, 'harness')
  await fs.writeFile(executable, `#!${process.execPath}\n${body}\n`, { mode: 0o755 })
  return { dir, executable }
}

function prepareFetchFallback() {
  vi.stubEnv('DFE_ENABLE_UNTRUSTED_BROWSER_SOURCE_INSPECTION', '1')
  vi.stubEnv('DFE_TEST_USE_GLOBAL_FETCH', '1')
  vi.spyOn(dns, 'lookup').mockResolvedValue([{ address: '93.184.216.34', family: 4 }])
  vi.stubGlobal('fetch', vi.fn(async () => new Response('<title>Fixture source</title>')))
}

function alive(pid) {
  try { process.kill(pid, 0); return true } catch (error) {
    if (error.code === 'ESRCH') return false
    throw error
  }
}

async function waitForReady(file) {
  const deadline = Date.now() + 5000
  while (Date.now() < deadline) {
    try { return Number(await fs.readFile(file, 'utf8')) } catch (error) {
      if (error.code !== 'ENOENT') throw error
    }
    await delay(20)
  }
  throw new Error('Resistant child did not report readiness before the capture deadline')
}

it('reaps a ready SIGTERM-resistant capture child before returning the timeout fallback', async () => {
  prepareFetchFallback()
  const { dir, executable } = await harness(`
const fs = require('node:fs')
const path = require('node:path')
process.on('SIGTERM', () => fs.writeFileSync(path.join(__dirname, 'term'), 'received'))
process.stdin.resume()
setInterval(() => {}, 1000)
fs.writeFileSync(path.join(__dirname, 'ready'), String(process.pid))
`)
  const pending = inspectCandidateSource({ url: 'https://example.com/resistant' }, {
    sourceTool: 'browser-harness', browserHarness: executable,
  })
  let pid
  try {
    pid = await waitForReady(path.join(dir, 'ready'))
    expect(alive(pid)).toBe(true)
    const result = await pending
    expect(result.fetch_status).toBe('browser-harness-error-fetch-ok')
    expect(result.browser_error).toContain('timed out after 18000ms')
    expect(alive(pid), 'capture must reap its child before reporting timeout').toBe(false)
    expect(await fs.readFile(path.join(dir, 'term'), 'utf8')).toBe('received')
  } finally {
    if (pid && alive(pid)) process.kill(pid, 'SIGKILL')
    await pending
  }
}, 30000)

it('preserves successful capture output through the public source adapter', async () => {
  prepareFetchFallback()
  const { executable } = await harness(`
process.stdin.resume()
process.stdin.on('end', () => console.log(JSON.stringify({
  fetch_status: 'browser-harness', final_url: 'https://example.com/art',
  title: 'Captured art', description: 'Observed source', image_url: ''
})))
`)
  const result = await inspectCandidateSource({ url: 'https://example.com/art' }, {
    sourceTool: 'browser-harness', browserHarness: executable,
  })
  expect(result.fetch_status).toBe('browser-harness')
  expect(result.title).toBe('Captured art')
})

it('preserves spawn failure as a handled capture fallback', async () => {
  prepareFetchFallback()
  const { dir } = await harness('process.exit(0)')
  const result = await inspectCandidateSource({ url: 'https://example.com/missing' }, {
    sourceTool: 'browser-harness', browserHarness: path.join(dir, 'missing-executable'),
  })
  expect(result.fetch_status).toBe('browser-harness-error-fetch-ok')
  expect(result.browser_error).toContain('ENOENT')
})

it('handles a real broken stdin pipe without an uncaught stream error', async () => {
  prepareFetchFallback()
  const { executable } = await harness('process.exit(0)')
  // Force a pending write when the child exits without reading stdin.
  const result = await inspectCandidateSource({ url: `https://example.com/${'a'.repeat(2_000_000)}` }, {
    sourceTool: 'browser-harness', browserHarness: executable,
  })
  expect(result.fetch_status).toBe('browser-harness-error-fetch-ok')
  expect(result.browser_error).toMatch(/EPIPE|ECONNRESET|pipe|write/i)
}, 10000)
