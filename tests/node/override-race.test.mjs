import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { promisify } from 'node:util'
import { execFile, spawn } from 'node:child_process'
import { afterEach, expect, it, vi } from 'vitest'
import { loadInspirationOverride, consumeInspirationOverride } from '../../scripts/lib/inspiration-override.mjs'

const exec = promisify(execFile)
const root = path.resolve(new URL('../..', import.meta.url).pathname)
const dirs = []
afterEach(async () => {
  vi.restoreAllMocks()
  await Promise.all(dirs.splice(0).map(dir => fs.rm(dir, { recursive: true, force: true })))
})
async function fixture(payload = { active: true, note: 'A', source_url: 'https://example.test/same', consume_after_success: true }) {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'override-race-'))
  dirs.push(dir)
  const manifest = path.join(dir, 'override.json')
  await fs.writeFile(manifest, JSON.stringify(payload))
  return manifest
}
function deferred() {
  let resolve
  const promise = new Promise(done => { resolve = done })
  return { promise, resolve }
}

// Observe a child's actual EEXIST contention; do not replace its filesystem result.
function observedCommand(manifest, args, script = 'next-run-inspo-override') {
  const attempted = deferred()
  const child = spawn(process.execPath, ['--input-type=module', '-e', `
    import fs from 'node:fs/promises';
    const mkdir = fs.mkdir.bind(fs);
    fs.mkdir = async (...args) => {
      try { return await mkdir(...args); }
      catch (error) {
        if (String(args[0]).endsWith('.inspiration-override.lock') && error.code === 'EEXIST') process.send('lock-blocked');
        throw error;
      }
    };
    process.argv = [process.execPath, 'scripts/${script}.mjs', ...JSON.parse(process.env.OVERRIDE_TEST_ARGS)];
    await import('./scripts/${script}.mjs');
    process.channel.unref();
  `], { cwd: root, env: { ...process.env, OVERRIDE_TEST_ARGS: JSON.stringify(['--manifest', manifest, ...args]) }, stdio: ['ignore', 'pipe', 'pipe', 'ipc'] })
  let stderr = ''
  child.stderr.on('data', chunk => { stderr += chunk })
  child.on('message', () => attempted.resolve('attempt'))
  const done = new Promise((resolve, reject) => {
    child.on('error', reject)
    child.on('exit', code => { attempted.resolve('exit'); resolve({ code, stderr }) })
  })
  return { attempted: attempted.promise, done }
}

function command(manifest, args = [], script = 'next-run-inspo-override') {
  return exec(process.execPath, [`scripts/${script}.mjs`, '--manifest', manifest, ...args], { cwd: root, timeout: 10000 })
}

it('load A → normal install B → consume returned A preserves B active and byte-for-byte', async () => {
  const manifest = await fixture()
  const a = await loadInspirationOverride({ overridePath: manifest })
  await command(manifest, ['--url', 'https://example.test/B', '--note', 'B'])
  const b = await fs.readFile(manifest)
  await consumeInspirationOverride(a)
  expect(JSON.parse(await fs.readFile(manifest, 'utf8')).active).toBe(true)
  expect(await fs.readFile(manifest)).toEqual(b)
})

it.each([
  ['next-run-inspo-override', ['--url', 'https://example.test/B', '--note', 'B'], false],
  ['set-inspiration-override', ['--source-url', 'https://example.test/B', '--note', 'B'], false],
  ['next-run-inspo-override', ['--url', 'https://example.test/B', '--note', 'B'], true],
])('serializes %s %j (symlink=%s) between consumption read and write without losing B', async (script, args, viaAlias) => {
  const manifest = await fixture()
  const loadPath = viaAlias ? path.join(path.dirname(manifest), 'alias.json') : manifest
  if (viaAlias) await fs.symlink(manifest, loadPath)
  const a = await loadInspirationOverride({ overridePath: loadPath })
  const read = deferred()
  const release = deferred()
  const readFile = fs.readFile.bind(fs)
  const spy = vi.spyOn(fs, 'readFile').mockImplementation(async (...args) => {
    const bytes = await readFile(...args)
    if (args[0] === loadPath) { read.resolve(); await release.promise }
    return bytes
  })
  const consume = consumeInspirationOverride(a)
  await read.promise
  const writer = observedCommand(manifest, args, script)
  let event
  try { event = await writer.attempted } finally { release.resolve(); spy.mockRestore() }
  await consume
  expect(await writer.done).toEqual({ code: 0, stderr: '' })
  const b = JSON.parse(await fs.readFile(manifest, 'utf8'))
  expect(b.note).toBe('B')
  expect(b.active).toBe(true)
  expect(event).toBe('attempt')
})

it.each([
  ['note', { note: 'new instructions' }],
  ['bias', { prompt_bias_terms: ['new bias'] }],
  ['title', { title: 'new title' }],
  ['persistent mode', { consume_after_success: false }],
])('same URL with changed %s is a different exact version', async (_label, change) => {
  const manifest = await fixture()
  const a = await loadInspirationOverride({ overridePath: manifest })
  const raw = JSON.parse(await fs.readFile(manifest, 'utf8'))
  const b = `${JSON.stringify({ ...raw, ...change }, null, 2)}\n`
  await fs.writeFile(manifest, b)
  const before = await fs.stat(manifest)
  await consumeInspirationOverride(a)
  expect(await fs.readFile(manifest, 'utf8')).toBe(b)
  expect((await fs.stat(manifest)).mtimeMs).toBe(before.mtimeMs)
})

it('same URL replacement through normal CLI retains new note, title and bias', async () => {
  const manifest = await fixture()
  const a = await loadInspirationOverride({ overridePath: manifest })
  await command(manifest, ['--url', a.source_url, '--note', 'B', '--title', 'B title', '--bias', 'new,bias'])
  const b = await fs.readFile(manifest)
  await consumeInspirationOverride(a)
  expect(await fs.readFile(manifest)).toEqual(b)
  expect(JSON.parse(b)).toMatchObject({ active: true, note: 'B', title: 'B title', prompt_bias_terms: ['new', 'bias'] })
})

it('format-only replacement is conservatively treated as a new exact byte version', async () => {
  const manifest = await fixture()
  const a = await loadInspirationOverride({ overridePath: manifest })
  const b = `${await fs.readFile(manifest, 'utf8')}\n`
  await fs.writeFile(manifest, b)
  await consumeInspirationOverride(a)
  expect(await fs.readFile(manifest, 'utf8')).toBe(b)
})

it('unchanged A consumes once with explicit metadata and preserves file mode', async () => {
  const manifest = await fixture()
  await fs.chmod(manifest, 0o600)
  const a = await loadInspirationOverride({ overridePath: manifest })
  const original = JSON.parse(await fs.readFile(manifest, 'utf8'))
  await consumeInspirationOverride(a, { status: 'consumed-after-success', consumedAt: '2026-11-07T12:00:00.000Z' })
  const consumed = await fs.readFile(manifest, 'utf8')
  expect(JSON.parse(consumed)).toEqual({ ...original, active: false, last_status: 'consumed-after-success', last_consumed_at: '2026-11-07T12:00:00.000Z' })
  expect((await fs.stat(manifest)).mode & 0o777).toBe(0o600)
  await consumeInspirationOverride(a, { status: 'second-attempt' })
  expect(await fs.readFile(manifest, 'utf8')).toBe(consumed)
})

it('persistent loaded override never disables even if caller changes public fields', async () => {
  const manifest = await fixture({ active: true, consume_after_success: false, note: 'persistent' })
  const a = await loadInspirationOverride({ overridePath: manifest })
  const before = await fs.readFile(manifest)
  a.consume_after_success = true
  await consumeInspirationOverride(a)
  expect(await fs.readFile(manifest)).toEqual(before)
})

it.each([
  ['inactive', { active: false }],
  ['expired', { active: true, expires_on: '2026-11-06' }],
])('%s manifests remain ineligible without a write', async (_label, payload) => {
  const manifest = await fixture(payload)
  const before = await fs.readFile(manifest)
  const a = await loadInspirationOverride({ overridePath: manifest, date: '2026-11-07' })
  expect(a).toBeNull()
  await consumeInspirationOverride(a)
  expect(await fs.readFile(manifest)).toEqual(before)
})

it('expiry boundary remains eligible and loading alone (failed run) never consumes', async () => {
  const manifest = await fixture({ active: true, expires_on: '2026-11-07' })
  const before = await fs.readFile(manifest)
  expect(await loadInspirationOverride({ overridePath: manifest, date: '2026-11-07' })).not.toBeNull()
  expect(await fs.readFile(manifest)).toEqual(before)
})

it('deleted A is not recreated by stale consumption', async () => {
  const manifest = await fixture()
  const a = await loadInspirationOverride({ overridePath: manifest })
  await fs.unlink(manifest)
  await consumeInspirationOverride(a)
  expect(await loadInspirationOverride({ overridePath: manifest })).toBeNull()
  expect(await fs.readdir(path.dirname(manifest))).toEqual([])
})

it('malformed replacement stays untouched and malformed load still rejects', async () => {
  const manifest = await fixture()
  const a = await loadInspirationOverride({ overridePath: manifest })
  await fs.writeFile(manifest, '{ broken B')
  await consumeInspirationOverride(a)
  expect(await fs.readFile(manifest, 'utf8')).toBe('{ broken B')
  await expect(loadInspirationOverride({ overridePath: manifest })).rejects.toThrow(SyntaxError)
  expect(await fs.readdir(path.dirname(manifest))).toEqual(['override.json'])
})

it('raw, copied, serialized and unknown objects cannot authorize consumption', async () => {
  const manifest = await fixture()
  const a = await loadInspirationOverride({ overridePath: manifest })
  const before = await fs.readFile(manifest)
  for (const candidate of [undefined, null, {}, { override_path: manifest, consume_after_success: true }, { ...a }, JSON.parse(JSON.stringify(a))]) {
    await consumeInspirationOverride(candidate)
  }
  expect(await fs.readFile(manifest)).toEqual(before)
})

it('caller cannot redirect trusted A to another manifest', async () => {
  const manifest = await fixture()
  const other = await fixture({ active: true, note: 'B' })
  const a = await loadInspirationOverride({ overridePath: manifest })
  const b = await fs.readFile(other)
  a.override_path = other
  await consumeInspirationOverride(a)
  expect(await fs.readFile(other)).toEqual(b)
  expect(JSON.parse(await fs.readFile(manifest, 'utf8')).active).toBe(false)
})

it('write errors propagate, release the lock, and allow the next normal command', async () => {
  const manifest = await fixture()
  const a = await loadInspirationOverride({ overridePath: manifest })
  const spy = vi.spyOn(fs, 'writeFile').mockRejectedValueOnce(Object.assign(new Error('injected write failure'), { code: 'EIO' }))
  await expect(consumeInspirationOverride(a)).rejects.toMatchObject({ code: 'EIO' })
  spy.mockRestore()
  expect(await fs.readdir(path.dirname(manifest))).toEqual(['override.json'])
  await command(manifest, ['--note', 'after error'])
  expect(JSON.parse(await fs.readFile(manifest, 'utf8')).note).toBe('after error')
})

it('failed read propagates without consuming and releases its lock', async () => {
  const manifest = await fixture()
  const a = await loadInspirationOverride({ overridePath: manifest })
  const before = await fs.readFile(manifest)
  const spy = vi.spyOn(fs, 'readFile').mockRejectedValueOnce(Object.assign(new Error('injected read failure'), { code: 'EACCES' }))
  await expect(consumeInspirationOverride(a)).rejects.toMatchObject({ code: 'EACCES' })
  spy.mockRestore()
  expect(await fs.readFile(manifest)).toEqual(before)
  expect(await fs.readdir(path.dirname(manifest))).toEqual(['override.json'])
})

it.each([
  ['next-run-inspo-override', ['--note', 'B']],
  ['next-run-inspo-override', ['--clear']],
  ['set-inspiration-override', ['--note', 'B']],
])('%s %j fails bounded without stealing an existing lock', async (script, args) => {
  const manifest = await fixture()
  const before = await fs.readFile(manifest)
  const lock = `${await fs.realpath(manifest)}.inspiration-override.lock`
  await fs.mkdir(lock)
  await fs.writeFile(path.join(lock, 'owner'), 'original owner')
  const start = performance.now()
  await expect(command(manifest, args, script)).rejects.toMatchObject({ code: 1, stderr: expect.stringContaining('Timed out waiting for inspiration override lock') })
  expect(performance.now() - start).toBeLessThan(6000)
  expect(await fs.readFile(path.join(lock, 'owner'), 'utf8')).toBe('original owner')
  expect(await fs.readFile(manifest)).toEqual(before)
  await fs.rm(lock, { recursive: true }) // test owns this deliberately pre-existing lock
  await command(manifest, args, script)
  expect(await fs.readdir(path.dirname(manifest))).toEqual(['override.json'])
}, 10000)

it('clear parse failure releases the lock without repairing a malformed manifest', async () => {
  const manifest = await fixture()
  await fs.writeFile(manifest, '{broken')
  await expect(command(manifest, ['--clear'])).rejects.toMatchObject({ code: 1 })
  expect(await fs.readFile(manifest, 'utf8')).toBe('{broken')
  expect(await fs.readdir(path.dirname(manifest))).toEqual(['override.json'])
  await command(manifest, ['--note', 'replacement'])
})

it('missing parent load and show do not create directories', async () => {
  const manifest = path.join(path.dirname(await fixture()), 'missing-parent', 'override.json')
  expect(await loadInspirationOverride({ overridePath: manifest })).toBeNull()
  const shown = await command(manifest, ['--show'])
  expect(JSON.parse(shown.stdout).active).toBe(false)
  await expect(fs.stat(path.dirname(manifest))).rejects.toMatchObject({ code: 'ENOENT' })
})
