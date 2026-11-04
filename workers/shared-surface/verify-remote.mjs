// Explicit opt-in remote acceptance against the unchanged, live edition.
// Usage: node workers/shared-surface/verify-remote.mjs https://…workers.dev
import { chromium } from 'playwright'
import { expect } from '@playwright/test'
import assert from 'node:assert/strict'
import fs from 'node:fs/promises'
const endpoint = process.argv[2]
assert.match(endpoint || '', /^https:\/\/[a-z0-9.-]+\.workers\.dev$/)
const publishedConfig = process.argv.includes('--published-config')
const origin = 'https://daily.nockgarden.com', out = publishedConfig ? 'tmp/shared-production/published' : 'tmp/shared-production'
await fs.mkdir(out, { recursive: true })
const evidence = { endpoint, started: new Date().toISOString(), configRouteOnly: !publishedConfig, protocol: {}, browsers: [] }
const pause = (ms) => new Promise((r) => setTimeout(r, ms))
const room = `acceptance_${Date.now()}`
const call = (method = 'GET', body, headers = {}, path = `/surface?room=${room}`) => fetch(endpoint + path, { method, headers: { Origin: origin, ...(method === 'POST' ? { 'Content-Type': 'application/json', 'X-Surface': 'touch' } : {}), ...headers }, ...(body === undefined ? {} : { body }), signal: AbortSignal.timeout(135000) })
async function protocol() {
  const p = evidence.protocol
  p.foreignOrigin = (await call('GET', undefined, { Origin: 'https://evil.example' })).status; assert.equal(p.foreignOrigin, 403)
  p.absentOrigin = (await fetch(endpoint + `/surface?room=${room}`)).status; assert.equal(p.absentOrigin, 403)
  p.invalidRoom = (await call('GET', undefined, {}, '/surface?room=invalid.room')).status; assert.equal(p.invalidRoom, 400)
  p.invalidPath = (await call('GET', undefined, {}, '/proxy?room=a')).status; assert.equal(p.invalidPath, 400)
  p.badPreflight = (await call('OPTIONS', undefined, { 'Access-Control-Request-Method': 'POST', 'Access-Control-Request-Headers': 'Authorization' })).status; assert.equal(p.badPreflight, 400)
  p.goodPreflight = (await call('OPTIONS', undefined, { 'Access-Control-Request-Method': 'POST', 'Access-Control-Request-Headers': 'Content-Type,X-Surface' })).status; assert.equal(p.goodPreflight, 204)
  const a = await call(), b = await call(); assert.equal(a.status, 200); assert.equal(b.status, 200)
  const ar = a.body.getReader(), br = b.body.getReader()
  await ar.read(); await br.read()
  p.exchange = (await call('POST', '{"x":0.12345,"y":0.98765}')).status; assert.equal(p.exchange, 204)
  for (const r of [ar, br]) assert.equal(new TextDecoder().decode((await r.read()).value), 'data: {"x":0.123,"y":0.988}\n\n')
  await ar.cancel()
  await pause(100)
  p.invalidJSON = (await call('POST', 'null')).status; assert.equal(p.invalidJSON, 400)
  await pause(100)
  p.invalidSize = (await call('POST', ' '.repeat(129))).status; assert.equal(p.invalidSize, 413)
  // Same IP, same room, concurrent admission: at most one successful reservation.
  await pause(100)
  p.concurrentRates = await Promise.all(Array.from({ length: 4 }, () => call('POST', '{"x":0.2,"y":0.8}').then((r) => r.status)))
  assert.equal(p.concurrentRates.filter((s) => s === 204).length, 1); assert.equal(p.concurrentRates.filter((s) => s === 429).length, 3)
  await br.read()
  p.leaveCancelled = true
  p.ttlStart = Date.now()
  const ttl = await call('GET', undefined, {}, `/surface?room=${room}_ttl`), tr = ttl.body.getReader(); await tr.read()
  const end = await tr.read(); p.ttlElapsedMs = Date.now() - p.ttlStart; p.ttlClosed = end.done
  assert.equal(end.done, true); assert.ok(p.ttlElapsedMs >= 119000 && p.ttlElapsedMs < 130000)
  await br.cancel()
}
async function browsers() {
  const browser = await chromium.launch({ headless: true })
  try {
    for (const [name, viewport, mobile] of [['desktop', { width: 1440, height: 980 }, false], ['mobile', { width: 390, height: 844 }, true]]) {
      const contexts = await Promise.all([browser.newContext({ viewport, isMobile: mobile, hasTouch: mobile }), browser.newContext({ viewport, isMobile: mobile, hasTouch: mobile })])
      const result = { name, configFetches: [0, 0], relayRequests: [0, 0], pageErrors: [] }
      evidence.browsers.push(result)
      try {
        const pages = await Promise.all(contexts.map((c) => c.newPage()))
        for (const [i, page] of pages.entries()) {
          await contexts[i].tracing.start({ screenshots: true, snapshots: true, sources: false })
          page.on('pageerror', (e) => result.pageErrors.push(e.message))
          page.on('request', (r) => {
            if (r.url().startsWith(endpoint)) result.relayRequests[i]++
            if (new URL(r.url()).pathname === '/effects-config.json') result.configFetches[i]++
          })
          if (!publishedConfig)
            await page.route('**/effects-config.json', (r) => r.fulfill({ json: { shared_endpoint: endpoint } }))
          await page.mouse.move(0, 0)
          await page.goto(origin + '/?qaEffects=1', { waitUntil: 'networkidle' })
          await expect(page.getByRole('button', { name: 'Experience shared' })).toBeVisible()
          await expect(page.locator('img.plate')).toBeVisible()
        }
        assert.deepEqual(result.configFetches, [0, 0]); assert.deepEqual(result.relayRequests, [0, 0]); result.explicitJoinNoNetwork = true
        const manifest = await pages[0].evaluate(async () => (await fetch('/editions/index.json')).json())
        assert.equal(manifest.current_edition_id, '2026-11-04-an-opening-in-the-rhythm-v1')
        result.edition = manifest.current_edition_id
        result.liveContract = await pages[0].evaluate(async (id) => (await fetch(`/editions/${id}/effects.json`)).json(), manifest.current_edition_id)
        assert.deepEqual(result.liveContract.effects.map((e) => e.kind), ['shared'])
        for (const page of pages) {
          await page.mouse.move(0, 0)
          const mark = page.getByRole('button', { name: 'Experience shared' })
          if (mobile) await mark.tap(); else await mark.click()
          await expect(page.locator('.edition-effect-status')).toContainText('SHARED ON')
          await expect(page.locator('.edition-effect-paint canvas.is-painted')).toBeVisible()
        }
        const snapshot = (page) => page.evaluate(() => window.__effectsQA.shared())
        const pixels = (page) => page.evaluate(() => {
          const c = document.querySelector('.edition-effect-paint canvas'), gl = c.getContext('webgl')
          const data = new Uint8Array(c.width * c.height * 4)
          gl.readPixels(0, 0, c.width, c.height, gl.RGBA, gl.UNSIGNED_BYTE, data)
          let hash = 2166136261, nonzero = 0
          for (let i = 0; i < data.length; i += 4) { hash = Math.imul(hash ^ data[i], 16777619); if (data[i] || data[i + 1] || data[i + 2]) nonzero++ }
          return { hash: hash >>> 0, nonzero, error: gl.getError() }
        })
        await pause(600)
        result.pixelsBefore = await pixels(pages[1]); assert.ok(result.pixelsBefore.nonzero > 100)
        result.before = await snapshot(pages[1])
        const field = await pages[0].locator('.plate-field').boundingBox()
        await pages[0].mouse.move(field.x + field.width * 0.35, Math.min(viewport.height - 100, field.y + field.height * 0.35))
        await expect.poll(async () => (await snapshot(pages[1])).received).toBeGreaterThan(result.before.received)
        result.after = await snapshot(pages[1]); assert.equal(result.after.active, true)
        result.pixelsAfter = await pixels(pages[1]); assert.equal(result.pixelsAfter.error, 0); assert.notEqual(result.pixelsAfter.hash, result.pixelsBefore.hash)
        await pages[1].screenshot({ path: `${out}/${name}-shared-joined.png` })
        // Leave with real input; the remaining sender must not resurrect receipt.
        await pages[1].getByRole('button', { name: 'Stop experience' }).click()
        await expect(pages[1].locator('.edition-effect-status')).toContainText('Off')
        const left = await snapshot(pages[1]); await pause(150)
        await pages[0].mouse.move(field.x + field.width * 0.45, Math.min(viewport.height - 110, field.y + field.height * 0.4))
        await pause(400)
        result.left = await snapshot(pages[1]); assert.equal(result.left.received, left.received); assert.equal(result.left.active, false)
        await pages[1].screenshot({ path: `${out}/${name}-shared-off.png` })
        // Explicitly labelled simulated hidden lifecycle; production handler is real.
        await pages[0].evaluate(() => { Object.defineProperty(document, 'hidden', { configurable: true, value: true }); document.dispatchEvent(new Event('visibilitychange')); delete document.hidden })
        result.simulatedHidden = await snapshot(pages[0]); assert.equal(result.simulatedHidden.active, false)
        const network = [...result.relayRequests]; await pause(1400); assert.deepEqual(result.relayRequests, network); result.noAutoReconnect = true
        assert.deepEqual(result.configFetches, [1, 1]); assert.deepEqual(result.pageErrors, [])
      } finally {
        for (const [i, context] of contexts.entries()) { await context.tracing.stop({ path: `${out}/${name}-${i}-trace.zip` }); await context.close() }
      }
    }
  } finally { await browser.close() }
}
try { await Promise.all([protocol(), browsers()]); evidence.passed = true }
catch (error) { evidence.passed = false; evidence.error = error.stack; process.exitCode = 1 }
finally { evidence.finished = new Date().toISOString(); await fs.writeFile(`${out}/remote-evidence.json`, JSON.stringify(evidence, null, 2)); console.log(JSON.stringify(evidence, null, 2)) }
