import fs from 'node:fs/promises'
import path from 'node:path'
import net from 'node:net'
import { spawn } from 'node:child_process'
import { createHash } from 'node:crypto'
import { isDeepStrictEqual } from 'node:util'
import sharp from 'sharp'
import { chromium } from 'playwright'
import { independentReviewExpectation } from './independent-visual-review.mjs'
import { fetchVettedImage } from './fetch-vetted-image.mjs'

const digest = bytes => createHash('sha256').update(bytes).digest('hex')
const readJson = async file => JSON.parse(await fs.readFile(file, 'utf8'))
const viewports = [{ name: 'desktop', width: 1440, height: 1000 }, { name: 'mobile', width: 375, height: 667 }, { name: 'mobile-landscape', width: 852, height: 393 }]
async function freePort() {
  const server = net.createServer()
  await new Promise((resolve, reject) => { server.once('error', reject); server.listen(0, '127.0.0.1', resolve) })
  const port = server.address().port
  await new Promise(resolve => server.close(resolve))
  return port
}
async function captureCandidate({ options, directory, bindings }) {
  const port = await freePort()
  const server = spawn(process.execPath, ['node_modules/vite/bin/vite.js', 'preview', '--host', '127.0.0.1', '--port', String(port), '--strictPort'], { cwd: options.worktreeDir, stdio: ['ignore', 'pipe', 'pipe'] })
  let diagnostics = ''
  server.stdout.on('data', bytes => { diagnostics += bytes }); server.stderr.on('data', bytes => { diagnostics += bytes })
  let browser
  try {
    const url = `http://127.0.0.1:${port}/?edition=${encodeURIComponent(options.editionId)}`
    let ready = false
    for (let i = 0; i < 80; i++) {
      if (server.exitCode !== null) throw Error(`Review preview exited: ${diagnostics}`)
      try { if ((await fetch(url, { signal: AbortSignal.timeout(1000) })).ok) { ready = true; break } } catch { /* bounded startup */ }
      await new Promise(resolve => setTimeout(resolve, 100))
    }
    if (!ready) throw Error('Review preview did not become ready')
    const expected = independentReviewExpectation(options)
    for (const [name, hash] of Object.entries(expected.candidate_files)) {
      const response = await fetch(`http://127.0.0.1:${port}/editions/${options.editionId}/${name}`, { signal: AbortSignal.timeout(10000) })
      if (!response.ok || digest(Buffer.from(await response.arrayBuffer())) !== hash) throw Error(`Review served candidate bytes differ from exact retained package (stale build): ${name}`)
    }
    browser = await chromium.launch({ headless: true })
    const map = await readJson(path.join(options.worktreeDir, 'public/editions', options.editionId, 'artifact-map.json'))
    const rows = []
    for (const viewport of viewports) {
      const context = await browser.newContext({ viewport, hasTouch: viewport.name !== 'desktop', permissions: [] })
      // Never touch native camera/microphone hardware, including accidental app regressions.
      await context.addInitScript(() => {
        if (typeof MediaDevices !== 'undefined') MediaDevices.prototype.getUserMedia = async () => { throw new DOMException('Independent review: sensor capture denied', 'NotAllowedError') }
      })
      const page = await context.newPage()
      for (const [index, binding] of bindings.entries()) {
        await page.goto(url, { waitUntil: 'domcontentloaded' })
        await page.waitForFunction(() => { const image = document.querySelector('img.plate'); return image?.complete && image.naturalWidth > 100 }, null, { timeout: 20000 })
        await page.locator('button.artifact').first().waitFor({ timeout: 20000 })
        if (index === 0) {
          const file = `${viewport.name}-live.png`
          await page.screenshot({ path: path.join(directory, file) })
          rows.push({ file, viewport: viewport.name, binding_id: null, role: 'closed live-mode complete viewport' })
        }
        const artifactIndex = map.artifacts.findIndex(row => row.id === binding.artifact_id)
        if (artifactIndex < 0) throw Error('Review source has no actual artifact')
        const button = page.locator('button.artifact').nth(artifactIndex)
        await button.focus(); await page.keyboard.press('Enter')
        // Attribute selector uses JSON quoting; binding ids are packaged data, not executable code.
        const source = page.locator(`.source-window[data-binding-id=${JSON.stringify(binding.id)}]`).last()
        await source.waitFor({ state: 'visible', timeout: 15000 })
        await page.waitForTimeout(800)
        const file = `${viewport.name}-source-${index + 1}.png`
        await page.screenshot({ path: path.join(directory, file) })
        rows.push({ file, viewport: viewport.name, binding_id: binding.id, role: 'actual opened-source full viewport screenshot' })
      }
      await context.close()
    }
    return rows
  } finally {
    await browser?.close()
    server.kill('SIGTERM')
    await new Promise(resolve => { if (server.exitCode !== null) resolve(); else server.once('close', resolve) })
  }
}

export async function collectReviewEvidence(options, { capture = captureCandidate } = {}) {
  const binding = independentReviewExpectation(options)
  const directory = path.join(options.runDir, 'automatic-review')
  await fs.mkdir(directory, { mode: 0o700 })
  const refs = []
  const retain = async (file, bytes, role, metadata = {}) => {
    await fs.writeFile(path.join(directory, file), bytes, { flag: 'wx', mode: 0o600 })
    const ref = { path: `automatic-review/${file}`, sha256: digest(bytes), role }
    refs.push(ref)
    return { ...ref, ...metadata }
  }
  const plate = await fs.readFile(path.join(options.worktreeDir, 'public/editions', options.editionId, 'assets/plate.png'))
  await retain('plate.png', plate, 'exact final packaged complete plate')
  let snapshot = { path: null, sha256: null, unavailable_reason: 'Source-field mode: no valid dominant source image applies.' }
  if (binding.source_image_url) {
    try {
      const { body, response } = await fetchVettedImage(binding.source_image_url)
      if (!response.ok) throw Error(`Source image HTTP ${response.status}`)
      await sharp(body).raw().toBuffer() // actual complete pixel decode, not MIME/header trust
      const ref = await retain('source.png', await sharp(body).png().toBuffer(), 'source image decoded from exact bound URL; original retained separately')
      await retain('source-original.bin', body, 'exact source URL response bytes')
      snapshot = { path: ref.path, sha256: ref.sha256, unavailable_reason: null }
    } catch (error) { snapshot = { path: null, sha256: null, unavailable_reason: error.message } }
  }
  const sources = await readJson(path.join(options.worktreeDir, 'public/editions', options.editionId, 'source-bindings.json'))
  const shots = await capture({ options, directory, bindings: sources.bindings })
  for (const viewport of viewports) for (const source of sources.bindings) {
    if (!shots.some(row => row.viewport === viewport.name && row.binding_id === source.id)) throw Error('Missing complete desktop/mobile source evidence')
  }
  for (const shot of shots) {
    if (path.basename(shot.file) !== shot.file || !shot.file.endsWith('.png')) throw Error('Unsafe review screenshot path')
    const bytes = await fs.readFile(path.join(directory, shot.file))
    refs.push({ path: `automatic-review/${shot.file}`, sha256: digest(bytes), role: `${shot.viewport}: ${shot.role}; binding=${shot.binding_id || 'closed'}` })
  }
  if (!isDeepStrictEqual(binding, independentReviewExpectation(options))) throw Error('Candidate changed during evidence capture')
  // Overview is only an index. Reviewer must inspect the full-resolution files.
  const thumbnails = []
  for (const ref of refs.filter(row => row.path.endsWith('.png'))) thumbnails.push(await sharp(await fs.readFile(path.join(options.runDir, ref.path))).resize({ width: 720, height: 500, fit: 'contain', background: '#202020' }).png().toBuffer())
  const overview = await sharp({ create: { width: 1440, height: Math.ceil(thumbnails.length / 2) * 500, channels: 3, background: '#202020' } }).composite(thumbnails.map((input, i) => ({ input, left: i % 2 * 720, top: Math.floor(i / 2) * 500 }))).png().toBuffer()
  await retain('overview.png', overview, 'visual evidence index; full-resolution originals are authoritative')
  const manifest = { binding, evidence: refs, source_snapshot: snapshot, screenshots: shots }
  await fs.writeFile(path.join(directory, 'evidence.json'), JSON.stringify(manifest, null, 2), { flag: 'wx', mode: 0o600 })
  return manifest
}
