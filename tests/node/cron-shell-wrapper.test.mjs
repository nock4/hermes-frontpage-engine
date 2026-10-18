import { describe, it, expect } from 'vitest'
import fs from 'node:fs/promises'
import path from 'node:path'
import os from 'node:os'
import { spawn } from 'node:child_process'
async function sandbox() {
  const script = await fs.readFile('scripts/cron/daily-frontpage-cron.sh', 'utf8')
  // Safety prerequisite: never exercise the legacy hard-coded production root.
  expect(script).toContain('BASH_SOURCE[0]')
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'cron-wrapper-'))
  await fs.mkdir(path.join(root, 'scripts/cron'), { recursive: true })
  for (const file of ['scripts/press-owner.py', 'scripts/cron/daily-frontpage-cron.sh', 'scripts/cron/daily-frontpage-self-healing-cron.sh']) await fs.copyFile(file, path.join(root, file))
  await fs.writeFile(path.join(root, 'package.json'), JSON.stringify({ scripts: { 'check:setup': 'exit 21', 'daily:publish:cron': 'echo MUST_NOT_GENERATE', 'press:doctor': 'echo fixture-doctor', 'press:stability': 'echo fixture-stability' } }))
  return root
}
function run(root, name) {
  return new Promise(resolve => {
    const child = spawn('bash', [path.join(root, 'scripts/cron', name)], { env: { ...process.env, DFE_REPORT_CACHE_DIR: path.join(root, 'reports') } })
    let output = ''; child.stdout.on('data', x => { output += x }); child.stderr.on('data', x => { output += x })
    child.on('close', code => resolve({ code, output }))
  })
}
describe('ordinary shell wrapper isolated injection', () => {
  it('consumes an explicit scheduler proof-only request without generation', async () => {
    const root = await sandbox()
    const script = await fs.readFile(path.join(root, 'scripts/cron/daily-frontpage-self-healing-cron.sh'), 'utf8')
    expect(script).toContain('next-cron-proof-only')
    await fs.mkdir(path.join(root, 'tmp'), { recursive: true })
    await fs.writeFile(path.join(root, 'tmp/next-cron-proof-only'), '/fixture/checkpoint.json\n')
    await fs.writeFile(path.join(root, 'package.json'), JSON.stringify({ scripts: { 'check:setup': 'exit 0', 'daily:publish:cron': 'node -e "console.log(process.argv)" --', 'press:doctor': 'exit 0', 'press:stability': 'exit 0' } }))
    const out = await run(root, 'daily-frontpage-self-healing-cron.sh')
    expect(out.output).toContain('--proof-only'); expect(out.output).toContain('/fixture/checkpoint.json')
    expect(out.output).toContain('PRESS_RUN_STATUS=failed') // no exact publication summary, never a stale screenshot
    await expect(fs.access(path.join(root, 'tmp/next-cron-proof-only'))).rejects.toThrow()
  })
  it('propagates setup failure, records stage/log, never starts generation', async () => {
    const root = await sandbox(), out = await run(root, 'daily-frontpage-cron.sh')
    expect(out.code).toBe(21); expect(out.output).toContain('Stage: check:setup'); expect(out.output).not.toContain('MUST_NOT_GENERATE')
    expect(JSON.parse(await fs.readFile(path.join(root, 'tmp/press-owner/latest.json'), 'utf8')).exit_code).toBe(21)
  })
  it('hands failed evidence to agent without calling publication successful', async () => {
    const root = await sandbox(), out = await run(root, 'daily-frontpage-self-healing-cron.sh')
    expect(out.code).toBe(0); expect(out.output).toContain('PRESS_RUN_STATUS=failed'); expect(out.output).toContain('PRESS_RUN_EXIT_CODE=21')
    expect(out.output).toContain('PUBLICATION_STATUS=unverified'); expect(out.output).not.toContain('MUST_NOT_GENERATE')
  })
})
