import { createHash } from 'node:crypto'
import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { expect, it } from 'vitest'
import { buildHermesQuery, openAiJson } from '../../scripts/lib/openai-json.mjs'

async function withExecutable(script, test) {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'hermes-transport-'))
  const executable = path.join(dir, 'fake-hermes')
  const previous = process.env.HERMES_BIN
  await fs.writeFile(executable, `#!${process.execPath}\n${script}\n`, { mode: 0o700 })
  process.env.HERMES_BIN = executable
  try {
    await test(dir)
  } finally {
    if (previous === undefined) delete process.env.HERMES_BIN
    else process.env.HERMES_BIN = previous
    await fs.rm(dir, { recursive: true, force: true })
  }
}

it('transports a multi-megabyte structured query intact over stdin, not argv', async () => {
  const input = JSON.stringify({ candidate_sources: 'shore 🌊 "quotes" $(literal) `literal`\n'.repeat(60000) })
  const instructions = 'Return strict JSON without dropping any candidate.'
  const query = buildHermesQuery({ instructions, inputText: input, maxOutputTokens: 6000 })
  expect(Buffer.byteLength(query)).toBeGreaterThan(2_000_000)
  await withExecutable(`
    const chunks = []
    process.stdin.on('data', chunk => chunks.push(chunk))
    process.stdin.on('end', () => {
      const query = Buffer.concat(chunks)
      console.log(JSON.stringify({
        bytes: query.length,
        sha256: require('node:crypto').createHash('sha256').update(query).digest('hex'),
        args: process.argv.slice(2),
      }))
    })
  `, async () => {
    const result = await openAiJson({ instructions, input, maxOutputTokens: 6000, timeoutMs: 5000 })
    expect(result).toEqual({
      bytes: Buffer.byteLength(query),
      sha256: createHash('sha256').update(query).digest('hex'),
      args: ['chat', '-Q', '--source', 'tool', '--max-turns', '12', '--query-file', '-'],
    })
  })
})

it('reports an early child failure rather than an unhandled stdin pipe error', async () => {
  await withExecutable("process.stderr.write('adapter refused request'); process.exit(7)", async () => {
    await expect(openAiJson({ input: 'x'.repeat(2_000_000), timeoutMs: 5000 }))
      .rejects.toThrow('adapter refused request')
  })
})

it.each([0, 750])('reaps a timed-out child with blocked stdin after %ims startup delay', async (startupDelayMs) => {
  await withExecutable(`
    // Reproduce startup slower than the old 500ms transport deadline.
    Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ${startupDelayMs})
    const fs = require('node:fs')
    const path = require('node:path')
    process.on('SIGTERM', () => fs.writeFileSync(path.join(__dirname, 'term'), 'SIGTERM'))
    // Readiness means the resistant handler is installed; never read stdin.
    fs.writeFileSync(path.join(__dirname, 'pid'), String(process.pid))
    setTimeout(() => process.exit(0), 15000)
  `, async (dir) => {
    // Startup gets a bounded budget inside the real transport deadline.
    // Observe rejection immediately so readiness polling cannot leave it unhandled.
    const started = performance.now()
    const outcome = openAiJson({ input: 'x'.repeat(2_000_000), timeoutMs: 5000 })
      .then(value => ({ value }), error => ({ error }))
    let pid
    try {
      await expect.poll(async () => {
        try {
          pid = Number(await fs.readFile(path.join(dir, 'pid'), 'utf8'))
          return Number.isInteger(pid) && pid > 0
        } catch (error) {
          if (error.code !== 'ENOENT') throw error
          return false
        }
      }, { timeout: 3000, interval: 25 }).toBe(true)
      const result = await outcome
      // The child's safety exit must not masquerade as SIGKILL escalation.
      expect(performance.now() - started).toBeLessThan(9000)
      expect(result.error).toBeInstanceOf(Error)
      expect(result.error.message).toContain('timed out after 5000ms')
      expect(await fs.readFile(path.join(dir, 'term'), 'utf8')).toBe('SIGTERM')
      expect(() => process.kill(pid, 0)).toThrowError(expect.objectContaining({ code: 'ESRCH' }))
    } finally {
      // Clean up even if an assertion fails before the normal timeout/reap.
      if (pid) {
        try { process.kill(pid, 'SIGKILL') } catch (error) {
          if (error.code !== 'ESRCH') throw error
        }
      }
      await outcome
    }
  })
}, 20000)
