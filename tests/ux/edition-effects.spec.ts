import { test, expect } from '@playwright/test'
import { buildEffectsCandidate } from '../fixtures/effects-candidate.mjs'
import { createSurfaceServer } from '../../scripts/services/shared-surface.mjs'
import fs from 'node:fs'
const manifest = JSON.parse(fs.readFileSync('public/editions/index.json', 'utf8'))
const current = manifest.editions.find((e: any) => e.edition_id === manifest.current_edition_id)
const map = JSON.parse(fs.readFileSync(`public${current.path}/artifact-map.json`, 'utf8'))
const bindings = JSON.parse(fs.readFileSync(`public${current.path}/source-bindings.json`, 'utf8'))
const artifact = map.artifacts[0],
  binding = bindings.bindings.find((b: any) => b.artifact_id === artifact.id)
async function fixture(page: any, kind: string) {
  const media = ['projection', 'castlight'].includes(kind)
  if (media) {
    await page.route('**/editions/qa-effects/assets/native-video.webm', (r: any) =>
      r.fulfill({ contentType: 'video/webm', path: 'tests/fixtures/native-video-controls.webm' }),
    )
    await page.route(`**${current.path}/source-bindings.json`, (r: any) =>
      r.fulfill({
        json: {
          ...bindings,
          bindings: bindings.bindings.map((b: any) =>
            b.id === binding.id
              ? {
                  ...b,
                  source_type: 'video',
                  window_type: 'video',
                  source_media_type: 'video',
                  source_media_url: '/editions/qa-effects/assets/native-video.webm',
                }
              : b,
          ),
        },
      }),
    )
  }
  await page.route(`**${current.path}/effects.json`, (r: any) =>
    r.fulfill({
      json: {
        schema_version: 1,
        edition_id: current.edition_id,
        effects: [
          {
            kind,
            artifact_id: artifact.id,
            binding_id: binding.id,
            evidence: {
              artifact_id: artifact.id,
              binding_id: binding.id,
              material: 'metal',
              observation: 'SYNTHETIC QA material admission; current original bytes unchanged',
              modalities: [
                'reflective',
                'resonant',
                'depth',
                'fracture',
                'touch',
                ...(media ? ['video'] : []),
              ],
              ...(media
                ? {
                    video: {
                      url: '/editions/qa-effects/assets/native-video.webm',
                      owner_url: binding.source_url,
                      verified_native: true,
                      cors_safe: true,
                    },
                  }
                : {}),
            },
          },
        ],
      },
    }),
  )
  // A fresh fixture must not inherit a prior study's idle mouse over a source
  // territory: that legitimately opens a preview before this study's first input.
  await page.mouse.move(0, 0)
  await page.goto('/?qaEffects=1')
  await expect(page.locator('img.plate')).toBeVisible()
}
for (const kind of ['refraction', 'camera', 'resonance', 'depth', 'shared', 'rupture', 'sound'])
  test(`${kind}: integrated opt-in, stop and source territory preserved`, async ({ page }, info) => {
    await fixture(page, kind)
    const mark = page.getByRole('button', { name: `Experience ${kind}` })
    await expect(mark).toBeVisible()
    expect(await page.evaluate(() => !!(window as any).__effectsQA)).toBe(true)
    await mark.click()
    await expect(page.locator('.edition-effect-status')).toBeVisible()
    if (kind === 'shared')
      await expect(page.locator('.edition-effect-status')).toContainText('not configured')
    await page.getByRole('button', { name: 'Stop experience' }).click()
    await expect(page.locator('.edition-effect-status')).toContainText('Off')
    await expect(page.locator('button.artifact').first()).toBeAttached()
    // Keyboard source open/close remains independent of the decorative canvas.
    await page.locator('button.artifact').first().focus()
    await page.keyboard.press('Enter')
    await expect(page.locator('.source-window').first()).toBeVisible()
    await page.locator('.source-window__close').first().click()
    await expect(page.locator('.source-window')).toHaveCount(0)
    if (kind === 'resonance')
      await page.screenshot({ path: `tmp/effects-qa/${info.project.name || 'desktop'}-integrated.png` })
  })
for (const kind of ['camera', 'resonance'])
  test(`pending ${kind} cancelled by stop never reacquires and late stream is stopped`, async ({ page }) => {
    await page.addInitScript(() => {
      let resolve: any
      let calls = 0,
        stopped = 0
      Object.defineProperty(navigator, 'mediaDevices', {
        value: {
          getUserMedia: () => {
            calls++
            return new Promise((r) => (resolve = r))
          },
        },
      })
      ;(window as any).sensorQA = {
        get calls() {
          return calls
        },
        get stopped() {
          return stopped
        },
        resolve: () =>
          resolve({
            getTracks: () => [
              {
                stop() {
                  stopped++
                },
              },
            ],
          }),
      }
    })
    await fixture(page, kind)
    await page.getByRole('button', { name: `Experience ${kind}` }).click()
    await expect(page.locator('.edition-effect-status')).toContainText('pending')
    await page.getByRole('button', { name: 'Stop experience' }).click()
    await page.evaluate(() => (window as any).sensorQA.resolve())
    await expect.poll(() => page.evaluate(() => (window as any).sensorQA.stopped)).toBe(1)
    expect(await page.evaluate(() => (window as any).sensorQA.calls)).toBe(1)
  })
test('two explicitly joined browser contexts exchange real ephemeral coordinates', async ({
  browser,
  baseURL,
}) => {
  const server = createSurfaceServer({ origins: [baseURL!] })
  await new Promise<void>((r) => server.listen(0, '127.0.0.1', r))
  const endpoint = `http://127.0.0.1:${(server.address() as any).port}`
  const contexts = await Promise.all([browser.newContext(), browser.newContext()])
  try {
    const pages = await Promise.all(contexts.map((c) => c.newPage()))
    for (const p of pages) {
      await p.route('**/effects-config.json', (r) => r.fulfill({ json: { shared_endpoint: endpoint } }))
      await fixture(p, 'shared')
    }
    await pages[0].getByRole('button', { name: 'Experience shared' }).click()
    await expect(pages[0].locator('.edition-effect-status')).toContainText('SHARED ON')
    expect(await pages[1].evaluate(() => (window as any).__effectsQA.shared().received)).toBe(0)
    await pages[1].getByRole('button', { name: 'Experience shared' }).click()
    await expect(pages[1].locator('.edition-effect-status')).toContainText('SHARED ON')
    const box = await pages[0].locator('.plate-field').boundingBox()
    await pages[0].mouse.move(box!.x + box!.width * 0.3, box!.y + box!.height * 0.3)
    await expect
      .poll(() => pages[1].evaluate(() => (window as any).__effectsQA.shared().received))
      .toBeGreaterThan(0)
    await pages[1].getByRole('button', { name: 'Stop experience' }).click()
    const count = await pages[1].evaluate(() => (window as any).__effectsQA.shared().received)
    await pages[0].waitForTimeout(120)
    await pages[0].mouse.move(box!.x + box!.width * 0.4, box!.y + box!.height * 0.4)
    await pages[1].waitForTimeout(150)
    expect(await pages[1].evaluate(() => (window as any).__effectsQA.shared().received)).toBe(count)
  } finally {
    await Promise.all(contexts.map((c) => c.close()))
    server.closeAllConnections()
    await new Promise<void>((r) => server.close(() => r()))
  }
})

test('SYNTHETIC held microphone drives real analyser and shader for twelve seconds, then high release', async ({
  page,
}) => {
  test.setTimeout(45000)
  await page.addInitScript(() => {
    Object.defineProperty(navigator, 'mediaDevices', {
      value: {
        getUserMedia: async () => {
          const ctx = new AudioContext(),
            osc = ctx.createOscillator(),
            gain = ctx.createGain(),
            dest = ctx.createMediaStreamDestination()
          osc.frequency.value = 90
          gain.gain.value = 0.06
          osc.connect(gain)
          gain.connect(dest)
          osc.start()
          await ctx.resume()
          ;(window as any).toneQA = { ctx, osc, gain }
          return dest.stream
        },
      },
    })
  })
  await fixture(page, 'resonance')
  await page.getByRole('button', { name: 'Experience resonance' }).click()
  await expect
    .poll(() => page.evaluate(() => (window as any).__effectsQA.resonance().energy))
    .toBeGreaterThan(0.4)
  const pixels = () =>
    page.locator('.edition-effect-paint canvas').evaluate((c: HTMLCanvasElement) => {
      const gl = c.getContext('webgl')!
      const p = new Uint8Array(c.width * c.height * 4)
      gl.readPixels(0, 0, c.width, c.height, gl.RGBA, gl.UNSIGNED_BYTE, p)
      let sum = 0
      for (let i = 0; i < p.length; i += 97) sum += p[i]
      return sum
    })
  const first = await pixels()
  await page.waitForTimeout(100)
  expect(await pixels()).not.toBe(first)
  await page.screenshot({ path: 'tmp/effects-qa/SYNTHETIC-desktop-held-bass.png' })
  await page.waitForTimeout(12000)
  const held = await page.evaluate(() => (window as any).__effectsQA.resonance())
  expect(held.energy).toBeGreaterThan(0.4)
  expect(held.weight).toBeGreaterThan(0.9)
  expect(held.context).toBe('running')
  await page.evaluate(() => {
    const q = (window as any).toneQA
    q.osc.frequency.setValueAtTime(880, q.ctx.currentTime)
  })
  await expect
    .poll(() => page.evaluate(() => (window as any).__effectsQA.resonance().weight))
    .toBeLessThan(0.01)
  await expect
    .poll(() => page.evaluate(() => (window as any).__effectsQA.resonance().density))
    .toBeGreaterThan(30)
  await page.screenshot({ path: 'tmp/effects-qa/SYNTHETIC-desktop-held-high.png' })
  await page.evaluate(() => {
    const q = (window as any).toneQA
    q.gain.gain.setValueAtTime(0, q.ctx.currentTime)
  })
  await expect
    .poll(() => page.evaluate(() => (window as any).__effectsQA.resonance().energy))
    .toBeLessThan(0.005)
  expect(await page.evaluate(() => (window as any).__effectsQA.resonance().weight)).toBeLessThan(0.01)
  await page.getByRole('button', { name: 'Stop experience' }).click()
  await page.evaluate(() => (window as any).toneQA.ctx.close())
})

test('SYNTHETIC camera reflects real canvas stream, tilt responds, and material sound graph stops', async ({
  page,
}) => {
  await page.addInitScript(() => {
    Object.defineProperty(navigator, 'mediaDevices', {
      value: {
        getUserMedia: async () => {
          const c = document.createElement('canvas')
          c.width = 160
          c.height = 120
          const g = c.getContext('2d')!
          g.fillStyle = 'cyan'
          g.fillRect(0, 0, 160, 120)
          return c.captureStream(20)
        },
      },
    })
  })
  await fixture(page, 'camera')
  await page.getByRole('button', { name: 'Experience camera' }).click()
  await expect(page.locator('video.edition-effect-video--camera')).toBeVisible()
  expect(
    await page
      .locator('video.edition-effect-video--camera')
      .evaluate((v: HTMLVideoElement) => v.srcObject instanceof MediaStream && v.videoWidth > 0),
  ).toBe(true)
  await page.getByRole('button', { name: 'Stop experience' }).click()
  await expect(page.locator('video.edition-effect-video--camera')).toHaveCount(0)
  await fixture(page, 'depth')
  await page.getByRole('button', { name: 'Experience depth' }).click()
  await expect(page.locator('.edition-effect-status')).toContainText('DEPTH ON')
  await page.evaluate(() =>
    window.dispatchEvent(new DeviceOrientationEvent('deviceorientation', { gamma: 25, beta: 50 })),
  )
  await expect(page.locator('.edition-effect-paint canvas')).toHaveClass('is-painted')
  await fixture(page, 'sound')
  await page.getByRole('button', { name: 'Experience sound' }).click()
  await expect(page.locator('.edition-effect-status')).toContainText('SOUND ON')
  const box = await page.locator('.plate-field').boundingBox()
  await page.mouse.move(box!.x + box!.width * 0.3, box!.y + box!.height * 0.3)
  await expect.poll(() => page.evaluate(() => (window as any).__effectsQA.sound().voices)).toBeGreaterThan(0)
  expect(await page.evaluate(() => (window as any).__effectsQA.sound().context)).toBe('running')
  await page.getByRole('button', { name: 'Stop experience' }).click()
  expect(await page.evaluate(() => (window as any).__effectsQA.sound().context)).toBe('absent')
})

test('reduced motion and mobile keep original surfaces reachable without sensor activation', async ({
  page,
}) => {
  await page.setViewportSize({ width: 390, height: 844 })
  await page.emulateMedia({ reducedMotion: 'reduce' })
  await fixture(page, 'resonance')
  await page.getByRole('button', { name: 'Experience resonance' }).click()
  await expect(page.locator('.edition-effect-status')).toContainText('reduced motion')
  expect(await page.evaluate(() => (window as any).__effectsQA.resonance().active)).toBe(false)
  await page.locator('button.artifact').first().focus()
  await page.keyboard.press('Enter')
  await expect(page.locator('.source-window').first()).toBeVisible()
  const windowBox = await page.locator('.source-window').first().boundingBox()
  expect(windowBox!.x).toBeGreaterThanOrEqual(0)
  expect(windowBox!.x + windowBox!.width).toBeLessThanOrEqual(391)
  await page.screenshot({ path: 'tmp/effects-qa/mobile-integrated-source-open.png' })
  await page.locator('.source-window__close').first().click()
  await expect(page.locator('.source-window')).toHaveCount(0)
  await page.screenshot({ path: 'tmp/effects-qa/mobile-integrated-closed.png' })
})

test('SYNTHETIC native video projection and castlight sample actual decoded frames without changing source openclose', async ({
  page,
}) => {
  for (const kind of ['projection', 'castlight']) {
    await fixture(page, kind)
    await page.getByRole('button', { name: `Experience ${kind}` }).click()
    await expect(page.locator('.edition-effect-status')).toContainText(`${kind.toUpperCase()} ON`)
    if (kind === 'projection') {
      const video = page.locator('.edition-effect-video--projection')
      await expect(video).toBeVisible()
      const before = await video.evaluate((v: HTMLVideoElement) => v.currentTime)
      await expect.poll(() => video.evaluate((v: HTMLVideoElement) => v.currentTime)).toBeGreaterThan(before)
    } else {
      await expect
        .poll(() => page.evaluate(() => (window as any).__effectsQA.castlight().samples))
        .toBeGreaterThan(2)
      expect(
        await page.evaluate(() => (window as any).__effectsQA.castlight().light.some((n: number) => n > 0)),
      ).toBe(true)
    }
    await page.locator('button.artifact').first().focus()
    await page.keyboard.press('Enter')
    await expect(page.locator('.source-window').first()).toBeVisible()
    expect(await page.evaluate((k) => (window as any).__effectsQA[k]().active, kind)).toBe(false)
    const native = page.locator('.source-window video')
    await expect(native).toBeVisible()
    expect(await native.getAttribute('src')).toContain('native-video.webm')
    await page.locator('.source-window__close').first().click()
    await expect(page.locator('.source-window')).toHaveCount(0)
  }
})

test('no WebGL fails to the untouched plate while the original source stays usable', async ({ page }) => {
  await page.addInitScript(() => {
    const original = HTMLCanvasElement.prototype.getContext
    HTMLCanvasElement.prototype.getContext = function (type: any, ...args: any[]) {
      if (type === 'webgl') return null
      return (original as any).call(this, type, ...args)
    } as any
  })
  await fixture(page, 'refraction')
  await page.getByRole('button', { name: 'Experience refraction' }).click()
  await expect(page.locator('.edition-effect-status')).toContainText('renderer unavailable')
  await expect(page.locator('img.plate')).toBeVisible()
  await page.locator('button.artifact').first().focus()
  await page.keyboard.press('Enter')
  await expect(page.locator('.source-window').first()).toBeVisible()
})

test('fresh candidate travels through real packager, loader and integrated runtime without an effect override', async ({
  page,
}) => {
  const candidate = await buildEffectsCandidate()
  try {
    await page.route('**/editions/**', async (r) => {
      const path = new URL(r.request().url()).pathname,
        file = `${candidate.root}/public${path}`
      if (fs.existsSync(file))
        await r.fulfill({
          path: file,
          contentType: path.endsWith('.json')
            ? 'application/json'
            : path.endsWith('.svg')
              ? 'image/svg+xml'
              : 'image/png',
        })
      else await r.fulfill({ status: 404, body: '' })
    })
    const packaged = JSON.parse(
      fs.readFileSync(`${candidate.root}/public/editions/${candidate.id}/effects.json`, 'utf8'),
    )
    await page.goto('/?qaEffects=1')
    await expect(page.locator('main.runtime-shell')).toHaveAttribute('data-edition-id', candidate.id)
    await expect(page.locator('.edition-effect-mark')).toHaveCount(packaged.effects.length)
    expect(packaged.effects.length).toBeGreaterThan(0)
    expect(packaged.effects.length).toBeLessThanOrEqual(3)
    for (const effect of packaged.effects)
      await expect(page.getByRole('button', { name: `Experience ${effect.kind}` })).toBeVisible()
    await page.getByRole('button', { name: `Experience ${packaged.effects[0].kind}` }).click()
    await expect(page.locator('.edition-effect-status')).toBeVisible()
    await page.locator('button.artifact').focus()
    await page.keyboard.press('Enter')
    await expect(page.locator('.source-window')).toBeVisible()
    await page.locator('.source-window__close').click()
    await expect(page.locator('.source-window')).toHaveCount(0)
  } finally {
    await candidate.cleanup()
  }
})

test('only one experience owns activation; switching cancels pending sensors and keeps one off control', async ({
  page,
}) => {
  await fixture(page, 'camera')
  await page.route(`**${current.path}/effects.json`, (r) =>
    r.fulfill({
      json: {
        schema_version: 1,
        edition_id: current.edition_id,
        effects: ['camera', 'sound'].map((kind) => ({
          kind,
          artifact_id: artifact.id,
          binding_id: binding.id,
          evidence: {
            artifact_id: artifact.id,
            binding_id: binding.id,
            material: 'metal',
            observation: 'SYNTHETIC QA material',
            modalities: ['reflective', 'resonant'],
          },
        })),
      },
    }),
  )
  await page.reload()
  await page.getByRole('button', { name: 'Experience camera' }).click()
  await page.getByRole('button', { name: 'Experience sound' }).click()
  await expect(page.locator('.edition-effect-status')).toHaveCount(1)
  expect(await page.evaluate(() => (window as any).__effectsQA.camera().active)).toBe(false)
})

test('context loss stops the active renderer and leaves the original source reachable', async ({ page }) => {
  await fixture(page, 'refraction')
  await page.getByRole('button', { name: 'Experience refraction' }).click()
  await expect(page.locator('.edition-effect-paint canvas')).toHaveClass('is-painted')
  await page
    .locator('.edition-effect-paint canvas')
    .evaluate((c) => c.dispatchEvent(new Event('webglcontextlost')))
  await expect(page.locator('.edition-effect-status')).toContainText('renderer lost')
  expect(await page.evaluate(() => (window as any).__effectsQA.refraction().active)).toBe(false)
  await expect(page.locator('img.plate')).toBeVisible()
})

test('held Space offers sustained resonance without microphone permission and never requests on release', async ({
  page,
}) => {
  await page.addInitScript(() => {
    let calls = 0
    Object.defineProperty(navigator, 'mediaDevices', {
      value: {
        getUserMedia: () => {
          calls++
          return Promise.reject(Error('not allowed in local fallback'))
        },
      },
    })
    ;(window as any).sensorCalls = () => calls
  })
  await fixture(page, 'resonance')
  await page.getByRole('button', { name: 'Experience resonance' }).focus()
  await page.keyboard.down('Space')
  await expect
    .poll(() => page.evaluate(() => (window as any).__effectsQA.resonance().energy))
    .toBeGreaterThan(0.4)
  await page.waitForTimeout(1000)
  expect(await page.evaluate(() => (window as any).sensorCalls())).toBe(0)
  await page.keyboard.up('Space')
  await expect
    .poll(() => page.evaluate(() => (window as any).__effectsQA.resonance().energy))
    .toBeLessThan(0.01)
  expect(await page.evaluate(() => (window as any).sensorCalls())).toBe(0)
})

test('unsupported effect admission fails closed without hiding plate or breaking original sources', async ({
  page,
}) => {
  await fixture(page, 'refraction')
  await page.route(`**${current.path}/effects.json`, (r) =>
    r.fulfill({
      json: {
        schema_version: 1,
        edition_id: current.edition_id,
        effects: [
          {
            kind: 'projection',
            artifact_id: artifact.id,
            binding_id: binding.id,
            evidence: {
              artifact_id: artifact.id,
              binding_id: binding.id,
              material: 'metal',
              observation: 'SYNTHETIC invalid still-video claim',
              modalities: ['video'],
              video: {
                url: '/generated-still.mp4',
                owner_url: binding.source_url,
                verified_native: false,
                cors_safe: true,
              },
            },
          },
        ],
      },
    }),
  )
  await page.reload()
  await expect(page.locator('img.plate')).toBeVisible()
  await expect(page.locator('.edition-effect-mark')).toHaveCount(0)
  await page.locator('button.artifact').first().focus()
  await page.keyboard.press('Enter')
  await expect(page.locator('.source-window').first()).toBeVisible()
  await page.locator('.source-window__close').first().click()
  await expect(page.locator('.source-window')).toHaveCount(0)
})

test('SYNTHETIC pointer, orientation and once-only rupture actually change shader pixels', async ({
  page,
}) => {
  const signature = () =>
    page.locator('.edition-effect-paint canvas').evaluate((c: HTMLCanvasElement) => {
      const gl = c.getContext('webgl')!
      const p = new Uint8Array(c.width * c.height * 4)
      gl.readPixels(0, 0, c.width, c.height, gl.RGBA, gl.UNSIGNED_BYTE, p)
      let sum = 0
      for (let i = 0; i < p.length; i += 97) sum += p[i]
      return sum
    })
  for (const kind of ['refraction', 'depth', 'rupture']) {
    await fixture(page, kind)
    await page.getByRole('button', { name: `Experience ${kind}` }).click()
    await expect(page.locator('.edition-effect-paint canvas')).toHaveClass('is-painted')
    const before = await signature()
    if (kind === 'depth')
      await page.evaluate(() =>
        window.dispatchEvent(new DeviceOrientationEvent('deviceorientation', { gamma: 30, beta: 60 })),
      )
    if (kind === 'refraction') {
      const field = await page.locator('.plate-field').boundingBox()
      await page.mouse.move(
        field!.x + field!.width * (artifact.bounds.x + artifact.bounds.w / 2),
        field!.y + field!.height * (artifact.bounds.y + artifact.bounds.h / 2),
      )
    }
    await expect.poll(signature).not.toBe(before)
    if (kind === 'rupture') {
      await page.waitForTimeout(3900)
      await page.getByRole('button', { name: 'Experience rupture' }).click()
      await expect(page.locator('.edition-effect-status')).toContainText('once per edition visit')
      expect(await page.evaluate(() => (window as any).__effectsQA.rupture().active)).toBe(false)
    }
  }
})

for (const view of [
  { width: 390, height: 844 },
  { width: 852, height: 393 },
])
  test(`SYNTHETIC native video stays unclipped after projection at ${view.width}`, async ({ page }) => {
    await page.setViewportSize(view)
    await fixture(page, 'projection')
    await page.getByRole('button', { name: 'Experience projection' }).click()
    await expect(page.locator('.edition-effect-video--projection')).toBeVisible()
    await page.locator('button.artifact').first().focus()
    await page.keyboard.press('Enter')
    const source = page.locator('.source-window').first()
    await expect(source.locator('video')).toBeVisible()
    const r = await source.boundingBox()
    expect(r!.x).toBeGreaterThanOrEqual(0)
    expect(r!.y).toBeGreaterThanOrEqual(0)
    expect(r!.x + r!.width).toBeLessThanOrEqual(view.width + 1)
    expect(r!.y + r!.height).toBeLessThanOrEqual(view.height + 1)
    await expect(page.locator('.edition-effect-status')).toHaveCount(0)
    await page.screenshot({ path: `tmp/effects-qa/SYNTHETIC-native-source-${view.width}.png` })
    await source.locator('.source-window__close').click()
    await expect(page.locator('.source-window')).toHaveCount(0)
  })

test('QA numerical snapshots do not expose mutable renderer state', async ({ page }) => {
  await fixture(page, 'refraction')
  expect(
    await page.evaluate(() => {
      const snapshot = (window as any).__effectsQA.refraction()
      snapshot.light[0] = 999
      return (window as any).__effectsQA.refraction().light[0]
    }),
  ).not.toBe(999)
})

test('archive has no experience marks without a contract or QA diagnostics', async ({ page }) => {
  await page.goto('/')
  await expect(page.locator('img.plate')).toBeVisible()
  await expect(page.locator('.edition-effect-mark')).toHaveCount(0)
  expect(await page.evaluate(() => !!(window as any).__effectsQA)).toBe(false)
})


test.describe('collision-safe quiet edge marks', () => {
  test.use({ hasTouch: true })
  for (const view of [{width:390,height:844},{width:320,height:568},{width:852,height:393}])
    for (const edge of ['left','right','corner'])
      for (const count of [2,3])
        test(`marks ${count} ${edge} ${view.width} remain independently pointer/touch reachable after resize`, async ({page}, info) => {
          await page.setViewportSize(view)
          await fixture(page, 'refraction')
          const x = edge === 'left' ? 0.01 : 0.97, y = edge === 'corner' ? 0.97 : 0.5
          await page.route(`**${current.path}/artifact-map.json`, r => r.fulfill({json:{...map,artifacts:map.artifacts.map((a:any)=>a.id===artifact.id?{...a,bounds:{x,y,w:0.02,h:0.02},polygon:[[x,y],[x+.02,y],[x+.02,y+.02],[x,y+.02]]}:a)}}))
          const kinds = ['refraction','depth','rupture'].slice(0,count)
          await page.route(`**${current.path}/effects.json`, r=>r.fulfill({json:{schema_version:1,edition_id:current.edition_id,effects:kinds.map(kind=>({kind,artifact_id:artifact.id,binding_id:binding.id,evidence:{artifact_id:artifact.id,binding_id:binding.id,material:'metal',observation:'SYNTHETIC tiny edge artifact',modalities:['reflective','depth','fracture']}}))}}))
          await page.reload()
          await expect(page.locator('.edition-effect-mark')).toHaveCount(count)
          const verify = async () => {
            const rects = await page.locator('.edition-effect-mark').evaluateAll(nodes=>nodes.map(n=>{const r=n.getBoundingClientRect();return {x:r.x,y:r.y,w:r.width,h:r.height,hit:document.elementFromPoint(r.x+r.width/2,r.y+r.height/2)===n}}))
            const size = page.viewportSize()!
            for (const r of rects) { expect(r.w).toBeGreaterThanOrEqual(44);expect(r.h).toBeGreaterThanOrEqual(44);expect(r.x).toBeGreaterThanOrEqual(0);expect(r.y).toBeGreaterThanOrEqual(0);expect(r.x+r.w).toBeLessThanOrEqual(size.width+1);expect(r.y+r.h).toBeLessThanOrEqual(size.height+1);expect(r.hit).toBe(true) }
            for(let i=0;i<rects.length;i++)for(let j=i+1;j<rects.length;j++){const a=rects[i],b=rects[j];expect(a.x+a.w<=b.x||b.x+b.w<=a.x||a.y+a.h<=b.y||b.y+b.h<=a.y).toBe(true)}
          }
          await verify()
          await page.setViewportSize({width:view.width-8,height:view.height-8})
          await expect.poll(async()=>{try{await verify();return true}catch{return false}}).toBe(true)
          await page.screenshot({path:info.outputPath('multiple-quiet-marks.png')})
          for (const kind of kinds) {
            const mark=page.getByRole('button',{name:`Experience ${kind}`})
            await mark.click();await expect(page.locator('.edition-effect-status')).toBeVisible();await page.getByRole('button',{name:'Stop experience'}).click()
            await mark.tap();await expect(page.locator('.edition-effect-status')).toBeVisible();await page.getByRole('button',{name:'Stop experience'}).tap()
          }
          await page.locator('button.artifact').first().focus();await page.keyboard.press('Enter');await expect(page.locator('.source-window').first()).toBeVisible()
          await page.screenshot({path:info.outputPath('source-open.png')})
        })
})
