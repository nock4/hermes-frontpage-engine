import { describe, it, expect } from 'vitest'
import { spawn, spawnSync } from 'node:child_process'
import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
const supervisor = path.resolve('scripts/press-owner.py')
const sleep = ms => new Promise(r => setTimeout(r, ms))
async function fixture() { await fs.mkdir(path.resolve('tmp'), { recursive: true }); return fs.mkdtemp(path.resolve('tmp/press-owner-')) }
function run(root, code, extra = []) {
  return spawn('python3', [supervisor, '--state-dir', root, ...extra, '--', 'python3', '-c', code], { stdio: ['ignore', 'pipe', 'pipe'] })
}
async function result(child) {
  let output = ''; child.stdout.on('data', b => { output += b }); child.stderr.on('data', b => { output += b })
  const code = await new Promise(r => child.on('close', r)); return { code, output }
}
async function waitFile(file) { for (let i = 0; i < 100; i++) { try { return await fs.readFile(file, 'utf8') } catch { await sleep(20) } } throw new Error(`Missing ${file}`) }
describe('press ownership supervisor (real subprocess injection)', () => {
  it('reaps orphan descendants after early parent completion', async () => {
    const root = await fixture(), pidfile = path.join(root, 'orphan')
    const code = `import subprocess,pathlib; p=subprocess.Popen(['python3','-c','import time; time.sleep(60)']); pathlib.Path(${JSON.stringify(pidfile)}).write_text(str(p.pid))`
    expect((await result(run(root, code, ['--kill-grace', '0.1']))).code).toBe(0)
    const pid = Number(await fs.readFile(pidfile, 'utf8'))
    expect(spawnSync('ps', ['-p', String(pid), '-o', 'stat='], { encoding: 'utf8' }).stdout.trim()).toMatch(/^Z|^$/)
  })
  it('keeps a guardian until descendants exit when supervisor is killed', async () => {
    const root = await fixture(), pidfile = path.join(root, 'orphan')
    const child = run(root, `import pathlib,os,time; pathlib.Path(${JSON.stringify(pidfile)}).write_text(str(os.getpid())); time.sleep(60)`, ['--kill-grace', '0.1'])
    const done = result(child)
    const pid = Number(await waitFile(pidfile)); child.kill('SIGKILL'); await done
    await sleep(200)
    expect(spawnSync('ps', ['-p', String(pid), '-o', 'stat='], { encoding: 'utf8' }).stdout.trim()).toMatch(/^Z|^$/)
    expect((await result(run(root, 'pass'))).code).toBe(0)
  })
  it('propagates failure and retains exact command/status evidence', async () => {
    const root = await fixture(); const out = await result(run(root, 'raise SystemExit(23)'))
    expect(out.code).toBe(23)
    const status = JSON.parse(await fs.readFile(path.join(root, 'latest.json'), 'utf8'))
    expect(status.exit_code).toBe(23); expect(status.status).toBe('failed'); expect(status.publication).toBe('unverified')
  })
  it('rejects overlapping owners without running the second command', async () => {
    const root = await fixture(); const first = run(root, 'import time; time.sleep(1)'); const done = result(first)
    await waitFile(path.join(root, 'owner.json'))
    const second = await result(run(root, 'print("MUST_NOT_RUN")'))
    expect(second.code).toBe(75); expect(second.output).not.toContain('MUST_NOT_RUN')
    expect((await done).code).toBe(0)
  })
  it('recovers dead stale metadata without age-based theft of a live lock', async () => {
    const root = await fixture(); await fs.writeFile(path.join(root, 'owner.json'), JSON.stringify({ pid: 99999999, run_id: 'dead' }))
    expect((await result(run(root, 'print("recovered")'))).code).toBe(0)
    const status = JSON.parse(await fs.readFile(path.join(root, 'latest.json'), 'utf8')); expect(status.previous_owner.run_id).toBe('dead')
  })
  it('bounds hangs and kills descendants before releasing ownership', async () => {
    const root = await fixture(); const pidfile = path.join(root, 'descendant')
    const code = `import subprocess,time,pathlib; p=subprocess.Popen(['python3','-c','import time; time.sleep(60)']); pathlib.Path(${JSON.stringify(pidfile)}).write_text(str(p.pid)); time.sleep(60)`
    const out = await result(run(root, code, ['--timeout', '0.4', '--kill-grace', '0.1']))
    expect(out.code).toBe(124)
    const pid = Number(await fs.readFile(pidfile, 'utf8')); await sleep(100)
    expect(spawnSync('ps', ['-p', String(pid), '-o', 'stat='], { encoding: 'utf8' }).stdout.trim()).toMatch(/^Z|^$/)
    expect((await result(run(root, 'pass'))).code).toBe(0)
  })
  it('permits authenticated nested entrypoints without a second lock', async () => {
    const root = await fixture()
    const code = `import subprocess; raise SystemExit(subprocess.call(['python3',${JSON.stringify(supervisor)},'--state-dir',${JSON.stringify(root)},'--','python3','-c','raise SystemExit(19)']))`
    expect((await result(run(root, code))).code).toBe(19)
  })
  it('does not equate command exit zero with verified publication', async () => {
    const root = await fixture(); expect((await result(run(root, 'print("prompt dump")'))).code).toBe(0)
    const status = JSON.parse(await fs.readFile(path.join(root, 'latest.json'), 'utf8'))
    expect(status.status).toBe('command_completed'); expect(status.publication).toBe('unverified')
  })
})
