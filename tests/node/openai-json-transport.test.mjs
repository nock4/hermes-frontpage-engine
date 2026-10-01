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

it('reaps a timed-out child even when the large stdin write is blocked', async () => {
  await withExecutable(`
    require('node:fs').writeFileSync(require('node:path').join(__dirname, 'pid'), String(process.pid))
    process.on('SIGTERM', () => {})
    setTimeout(() => process.exit(0), 10000)
  `, async (dir) => {
    await expect(openAiJson({ input: 'x'.repeat(2_000_000), timeoutMs: 500 }))
      .rejects.toThrow('timed out after 500ms')
    const pid = Number(await fs.readFile(path.join(dir, 'pid'), 'utf8'))
    expect(() => process.kill(pid, 0)).toThrow()
  })
}, 5000)
