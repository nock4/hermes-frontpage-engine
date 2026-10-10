import dns from 'node:dns/promises'
import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { afterEach, expect, it, vi } from 'vitest'
import { inspectCandidateSource } from '../../scripts/lib/source-inspection.mjs'

const dirs = []
afterEach(async () => {
  vi.restoreAllMocks()
  vi.unstubAllGlobals()
  vi.unstubAllEnvs()
  for (const dir of dirs.splice(0)) await fs.rm(dir, { recursive: true, force: true })
})

async function fixture({ error = 'sent 1011 (internal error) keepalive ping timeout; no close frame received', always = false, restartFails = false, stage = 'goto', finalUrl = 'https://example.com/art' } = {}) {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'source-relay-'))
  dirs.push(dir)
  const log = path.join(dir, 'events.jsonl')
  await fs.writeFile(path.join(dir, 'admin.py'), `import json\ndef event(value):\n    with open(${JSON.stringify(log)}, 'a') as f: f.write(json.dumps(value) + '\\n')\ndef restart_daemon(name=None):\n    event(['restart', name])\n    ${restartFails ? "raise RuntimeError('restart failed')" : 'pass'}\ndef ensure_daemon(wait=60, name=None, env=None):\n    event(['ensure', name, wait, env])\n`)
  const executable = path.join(dir, 'harness')
  await fs.writeFile(executable, `#!/usr/bin/env python3
import sys, json
from admin import event
attempts = 0
def ensure_real_tab(): event(['tab'])
def goto(url):
    global attempts
    attempts += 1
    event(['goto', url])
    if ${JSON.stringify(stage)} == 'goto' and (attempts == 1 or ${always ? 'True' : 'False'}): raise RuntimeError(${JSON.stringify(error)})
def wait_for_load(seconds): pass
def wait(seconds): pass
def js(script):
    if ${JSON.stringify(stage)} == 'js' and (attempts == 1 or ${always ? 'True' : 'False'}): raise RuntimeError(${JSON.stringify(error)})
    return json.dumps({'final_url': ${JSON.stringify(finalUrl)}, 'title': 'Recovered art', 'image_url': ''})
def main():
    exec(sys.stdin.read())
main()
`, { mode: 0o755 })
  vi.stubEnv('DFE_ENABLE_UNTRUSTED_BROWSER_SOURCE_INSPECTION', '1')
  vi.stubEnv('BU_NAME', 'dfe-relay-test')
  vi.stubEnv('BU_CDP_WS', 'ws://127.0.0.1:45678/devtools/browser/test')
  vi.stubEnv('BU_BROWSER_ID', '')
  vi.stubEnv('DFE_TEST_USE_GLOBAL_FETCH', '1')
  vi.spyOn(dns, 'lookup').mockResolvedValue([{ address: '93.184.216.34', family: 4 }])
  vi.stubGlobal('fetch', vi.fn(async () => new Response('<title>Fallback art</title>')))
  return {
    inspect: () => inspectCandidateSource({ url: 'https://example.com/art' }, { sourceTool: 'browser-harness', browserHarness: executable }),
    events: async () => (await fs.readFile(log, 'utf8').catch(() => '')).trim().split('\n').filter(Boolean).map(JSON.parse),
  }
}

it.each(['goto', 'js'])('reconnects the managed relay once after stale %s and repeats the same source navigation', async (stage) => {
  const f = await fixture({ stage })
  const result = await f.inspect()
  expect(result.fetch_status).toBe('browser-harness')
  expect(result.title).toBe('Recovered art')
  expect(await f.events()).toEqual([
    ['tab'], ['goto', 'https://example.com/art'],
    ['restart', 'dfe-relay-test'],
    ['ensure', 'dfe-relay-test', 5, { BU_CDP_WS: 'ws://127.0.0.1:45678/devtools/browser/test', BU_BROWSER_ID: '' }],
    ['tab'], ['goto', 'https://example.com/art'],
  ])
})

it('never retries twice when the reconnected relay is still stale', async () => {
  const f = await fixture({ always: true })
  const result = await f.inspect()
  expect(result.fetch_status).toBe('browser-harness-error-fetch-ok')
  expect(result.browser_error).toContain('keepalive ping timeout')
  const events = await f.events()
  expect(events.filter(e => e[0] === 'restart')).toHaveLength(1)
  expect(events.filter(e => e[0] === 'goto')).toHaveLength(2)
})

it('handles failed relay restart without retry loops', async () => {
  const f = await fixture({ restartFails: true })
  const result = await f.inspect()
  expect(result.fetch_status).toBe('browser-harness-error-fetch-ok')
  expect(result.browser_error).toContain('restart failed')
  expect((await f.events()).filter(e => e[0] === 'restart')).toHaveLength(1)
})

it.each([
  ['BU_NAME', 'default'], ['BU_NAME', 'other-run'], ['BU_NAME', 'dfe-../other'],
  ['BU_CDP_WS', ''], ['BU_CDP_WS', 'wss://remote.example/devtools/browser/test'],
  ['BU_CDP_WS', 'ws://127.0.0.1.evil.test:45678/devtools/browser/test'],
  ['BU_CDP_WS', 'ws://user:password@127.0.0.1:45678/devtools/browser/test'],
  ['BU_CDP_WS', 'ws://127.1:45678/devtools/browser/test'],
  ['BU_CDP_WS', 'ws://2130706433:45678/devtools/browser/test'],
  ['BU_CDP_WS', 'http://127.0.0.1:45678/devtools/browser/test'],
  ['BU_BROWSER_ID', 'remote-browser'],
])('does not restart outside explicit managed local scope: %s=%s', async (key, value) => {
  const f = await fixture()
  vi.stubEnv(key, value)
  expect((await f.inspect()).fetch_status).toBe('browser-harness-error-fetch-ok')
  expect((await f.events()).filter(e => e[0] === 'restart')).toHaveLength(0)
})

it.each(['navigation timed out', 'net::ERR_NAME_NOT_RESOLVED', 'Session with given id not found'])('does not reconnect for ordinary errors: %s', async (error) => {
  const f = await fixture({ error })
  await f.inspect()
  expect((await f.events()).filter(e => e[0] === 'restart')).toHaveLength(0)
})

it('recovers the actual abrupt-WebSocket-close signature', async () => {
  const f = await fixture({ error: 'no close frame received or sent' })
  expect((await f.inspect()).fetch_status).toBe('browser-harness')
  expect((await f.events()).filter(e => e[0] === 'restart')).toHaveLength(1)
})

it('does not restart a healthy relay', async () => {
  const f = await fixture({ stage: 'none' })
  expect((await f.inspect()).fetch_status).toBe('browser-harness')
  expect(await f.events()).toEqual([['tab'], ['goto', 'https://example.com/art']])
})

it('retains the browser opt-in guard', async () => {
  const f = await fixture()
  vi.stubEnv('DFE_ENABLE_UNTRUSTED_BROWSER_SOURCE_INSPECTION', '0')
  expect((await f.inspect()).fetch_status).toBe('browser-harness-disabled-fetch-ok')
  expect(await f.events()).toEqual([])
})

it('retains final URL vetting after recovery', async () => {
  const f = await fixture({ finalUrl: 'http://127.0.0.1/private' })
  expect((await f.inspect()).fetch_status).toBe('browser-harness-blocked-final-url-fetch-ok')
})
