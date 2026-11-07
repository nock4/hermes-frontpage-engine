import { expect, test } from '@playwright/test'
import { readFile } from 'node:fs/promises'

const original = 'https://media.example.test/whole-original.jpg'
const poster = 'https://media.example.test/cropped-poster.jpg'
const title = 'Cure Nailhouse — full composition'
const svg = '<svg xmlns="http://www.w3.org/2000/svg" width="800" height="550"><rect width="800" height="550" fill="#672276"/><rect x="8" y="8" width="784" height="534" fill="none" stroke="#40ffff" stroke-width="16"/></svg>'

test('route navigation retries a transient manifest failure', async ({ page }) => {
  let manifestAttempts = 0
  let failManifest = true
  await page.route('**/editions/index.json', async route => {
    manifestAttempts += 1
    if (failManifest) await route.fulfill({ status: 503, body: 'Transient failure' })
    else await route.continue()
  })
  await page.goto('/')
  await expect(page.locator('.boot-state')).toContainText('Failed')
  const failedAttempts = manifestAttempts
  failManifest = false
  // Exercise the same popstate entrypoint as Back/Forward after a failed boot.
  await page.evaluate(() => {
    history.pushState({}, '', '/?edition=2026-09-28-the-edge-outlasts-the-day-v1')
    window.dispatchEvent(new PopStateEvent('popstate'))
  })
  await expect(page.locator('.runtime-shell')).toHaveAttribute('data-edition-id', '2026-09-28-the-edge-outlasts-the-day-v1')
  expect(manifestAttempts).toBeGreaterThan(failedAttempts)
  const artifact = page.locator('button.artifact').first()
  await artifact.focus()
  await expect(page.locator('.stage-overlay-windows--live .source-window')).toHaveAttribute('data-source-window-mode', 'preview')
})

// Synthetic rectangular hit geometry isolates route ownership, not polygon layout.
// All interactions still run through the production App and native browser input.
for (const viewport of [{ width: 1440, height: 980 }, { width: 852, height: 393 }]) {
  test.describe(`route fixture ${viewport.width}px`, () => {
  test.use({ viewport, hasTouch: true, contextOptions: { reducedMotion: 'reduce' } })
  test(`route dismissal belongs to its edition at ${viewport.width}px`, async ({ page }, info) => {
    page.on('pageerror', error => console.log('route fixture page error:', error.message))
    page.on('console', message => { if (message.type() === 'error') console.log('route fixture console:', message.text()) })
    const a = '2026-09-28-the-edge-outlasts-the-day-v1'
    const b = '2026-10-16-the-collar-holds-its-shape-v1'
    const windows = page.locator('.stage-overlay-windows--live .source-window')
    const frames = () => page.evaluate(() => new Promise<void>(resolve => requestAnimationFrame(() => requestAnimationFrame(() => resolve()))))
    const navigate = (href: string) => page.evaluate(href => {
      history.pushState({}, '', href)
      window.dispatchEvent(new PopStateEvent('popstate'))
    }, href)
    const inputs: { type: string; trusted: boolean; x: number; y: number; target: string; edition: string }[] = []
    {
      await page.route('**/artifact-map.json', async route => {
        const data = JSON.parse(await readFile(new URL(`../../public${new URL(route.request().url()).pathname}`, import.meta.url), 'utf8'))
        const artifact = data.artifacts[0]
        artifact.bounds = { x: 0.1, y: 0.15, w: 0.8, h: 0.7 }
        artifact.polygon = [[0.1, 0.15], [0.9, 0.15], [0.9, 0.85], [0.1, 0.85]]
        delete artifact.interaction_mesh
        for (const other of data.artifacts.slice(1)) {
          other.bounds = { x: 0.94, y: 0.9, w: 0.01, h: 0.01 }
          other.polygon = [[0.94, 0.9], [0.95, 0.9], [0.95, 0.91], [0.94, 0.91]]
          delete other.interaction_mesh
        }
        data.default_artifact_id = artifact.id
        await route.fulfill({ json: data })
      })
      await page.route('**/source-bindings.json', async route => {
        const data = JSON.parse(await readFile(new URL(`../../public${new URL(route.request().url()).pathname}`, import.meta.url), 'utf8'))
        data.bindings = data.bindings.map((binding: { id: string; artifact_id: string }) => ({
          id: binding.id, artifact_id: binding.artifact_id, source_type: 'web', window_type: 'web',
          source_url: 'https://example.test/route-fixture', hover_behavior: 'preview', click_behavior: 'pin-open',
          fallback_type: 'rich-preview', title, source_title: title, kicker: 'fixture', excerpt: 'Route fixture', playback_persistence: false,
          source_image_url: original, source_media_url: original, source_media_type: 'image',
        }))
        await route.fulfill({ json: data })
      })
      await page.route(original, route => route.fulfill({ contentType: 'image/svg+xml', body: svg }))
      await page.addInitScript(() => {
        for (const type of ['mouseover', 'mousemove', 'click']) document.addEventListener(type, event => {
          const mouse = event as MouseEvent
          const element = event.target instanceof Element ? event.target.closest('button.artifact, .source-window__close') : null
          if (element) console.log('route-input', JSON.stringify({ type, trusted: event.isTrusted, x: mouse.clientX, y: mouse.clientY, target: element.getAttribute('aria-label'), edition: document.querySelector('.runtime-shell')?.getAttribute('data-edition-id') }))
        }, true)
      })
      page.on('console', message => {
        if (message.text().startsWith('route-input ')) {
          inputs.push(JSON.parse(message.text().slice('route-input '.length)))
          console.log(message.text())
        }
      })
      await page.goto(`${info.project.use.baseURL}/?edition=${a}`)
      await expect(page.locator('.runtime-shell')).toHaveAttribute('data-edition-id', a)
      await page.locator('img.plate').evaluate((img: HTMLImageElement) => img.decode())
      const mark = page.locator('button.artifact').first()
      const box = (await mark.boundingBox())!
      const idle = { x: Math.floor(box.x + box.width * 0.12), y: Math.floor(box.y + box.height * 0.7) }
      const hit = () => page.evaluate(point => document.elementFromPoint(point.x, point.y)?.closest('button.artifact')?.getAttribute('aria-label') ?? null, idle)
      expect(await hit()).toBe(await mark.getAttribute('aria-label'))
      await page.mouse.move(idle.x, idle.y)
      await expect(windows).toHaveAttribute('data-source-window-mode', 'preview')
      await mark.focus()
      await page.keyboard.press('Enter')
      await expect(windows).toHaveAttribute('data-source-window-mode', 'primary')
      await windows.locator('.source-window__close').tap()
      await frames()
      await expect(windows).toHaveCount(0)
      expect(await hit()).toBe(await mark.getAttribute('aria-label'))
      await page.screenshot({ path: info.outputPath('same-edition-closed.png') })
      await info.attach('stationary-close', { body: JSON.stringify({ edition: a, idle, hit: await hit(), windows: await windows.count() }), contentType: 'application/json' })
      await navigate(`/?edition=${b}`)
      await expect(page.locator('.runtime-shell')).toHaveAttribute('data-edition-id', b)
      await page.locator('img.plate').evaluate((img: HTMLImageElement) => img.decode())
      // The first native over can already open a window over this coordinate.
      // Verify its actual mark target rather than assuming it stays uncovered.
      const nextMarkLabel = await mark.getAttribute('aria-label')
      await expect.poll(() => inputs.some(event => event.type === 'mouseover' && event.trusted && event.target === nextMarkLabel && event.edition === b && event.x === idle.x && event.y === idle.y)).toBe(true)
      // Same physical coordinate: not a fresh-motion escape from the old guard.
      await page.mouse.move(idle.x, idle.y)
      await frames()
      console.log('causal first hover', JSON.stringify({ edition: b, idle, hit: await hit(), windows: await windows.count() }))
      await info.attach('new-edition-first-hover', { body: JSON.stringify({ edition: b, idle, hit: await hit(), windows: await windows.count() }), contentType: 'application/json' })
      await expect(windows).toHaveAttribute('data-source-window-mode', 'preview')
      await page.screenshot({ path: info.outputPath('new-edition-preview.png') })
      await windows.locator('.source-window__close').tap()
      await frames()
      await expect(windows).toHaveCount(0)
      await page.mouse.move(1, 1)
      await page.mouse.move(idle.x, idle.y)
      await expect(windows).toHaveAttribute('data-source-window-mode', 'preview')
      await windows.locator('.source-window__close').tap()
      await frames()
      await expect(windows).toHaveCount(0)
      await mark.focus()
      await expect(windows).toHaveAttribute('data-source-window-mode', 'preview')
      await page.keyboard.press('Enter')
      await expect(windows).toHaveAttribute('data-source-window-mode', 'primary')
      await windows.locator('.source-window__close').tap()
      await frames()
      await expect(windows).toHaveCount(0)
      await page.goBack()
      await expect(page.locator('.runtime-shell')).toHaveAttribute('data-edition-id', a)
      await page.mouse.move(idle.x, idle.y)
      await expect(windows).toHaveAttribute('data-source-window-mode', 'preview')
      await windows.locator('.source-window__close').tap()
      await frames()
      await expect(windows).toHaveCount(0)
      await page.goForward()
      await expect(page.locator('.runtime-shell')).toHaveAttribute('data-edition-id', b)
      await page.mouse.move(idle.x, idle.y)
      await expect(windows).toHaveAttribute('data-source-window-mode', 'preview')
      await windows.locator('.source-window__close').tap()
      await frames()
      await expect(windows).toHaveCount(0)
      await navigate('/archive')
      await expect(page.locator('.archive-shell')).toBeVisible()
      await navigate(`/archive/${a}`)
      await expect(page.locator('.runtime-shell')).toHaveAttribute('data-edition-id', a)
      await page.mouse.move(idle.x, idle.y)
      await expect(windows).toHaveAttribute('data-source-window-mode', 'preview')
      await windows.locator('.source-window__close').tap()
      await frames()
      await expect(windows).toHaveCount(0)
      let releasePending!: () => void
      let pendingReached!: () => void
      const pending = new Promise<void>(resolve => { releasePending = resolve })
      const reached = new Promise<void>(resolve => { pendingReached = resolve })
      await page.route(`**/${b}/effects.json`, async route => {
        pendingReached()
        await pending
        await route.continue()
      })
      await navigate(`/?edition=${b}`)
      await reached
      await navigate(`/?edition=${a}`)
      await expect(page.locator('.runtime-shell')).toHaveAttribute('data-edition-id', a)
      await page.mouse.move(idle.x, idle.y)
      await expect(windows).toHaveAttribute('data-source-window-mode', 'preview')
      await windows.locator('.source-window__close').tap()
      await frames()
      await expect(windows).toHaveCount(0)
      const lateResponse = page.waitForResponse(response => response.url().endsWith(`/${b}/effects.json`))
      releasePending()
      await (await lateResponse).finished()
      await frames()
      await expect(page.locator('.runtime-shell')).toHaveAttribute('data-edition-id', a)
      await expect(windows).toHaveCount(0)
      // A cancelled load must not erase the current route's close protection.
      await page.mouse.move(idle.x, idle.y)
      await frames()
      await expect(windows).toHaveCount(0)
      await page.mouse.move(1, 1)
      await page.mouse.move(idle.x, idle.y)
      await expect(windows).toHaveAttribute('data-source-window-mode', 'preview')
    }
  })
  })
}

for (const mode of ['preview', 'primary'] as const) {
  for (const kind of ['still', 'image-only', 'direct', 'youtube', 'soundcloud', 'bandcamp', 'tweet'] as const) {
    if (!['still', 'image-only', 'direct'].includes(kind) && mode === 'preview') continue
    test(`desktop ${mode} preserves ${kind} composition or native player`, async ({ page }, testInfo) => {
      await page.setViewportSize({ width: 1440, height: 980 })
      const sources = {
        still: 'https://example.test/nailhouse', 'image-only': 'https://example.test/design-core',
        direct: 'https://x.com/example/status/1234567890', tweet: 'https://x.com/example/status/1234567890',
        youtube: 'https://www.youtube.com/watch?v=prYhH_jDOVQ',
        soundcloud: 'https://soundcloud.com/example/track', bandcamp: 'https://example.bandcamp.com/track/original',
      }
      // Force the CI ordering: first package paints and accepts focus while
      // any duplicate load is still pending, then let that late load finish.
      let packageLoads = 0
      let releaseDuplicate!: () => void
      const duplicateGate = new Promise<void>(resolve => { releaseDuplicate = resolve })
      const exerciseLoadRace = mode === 'preview' && kind === 'still'
      // effects.json is the final package fetch and is not a warmup prefetch.
      await page.route('**/effects.json', async route => {
        packageLoads += 1
        if (exerciseLoadRace && packageLoads > 1) await duplicateGate
        await route.continue()
      })
      await page.route('**/source-bindings.json', async route => {
        const response = await route.fetch(), data = await response.json()
        data.bindings = data.bindings.map((binding: { id: string; artifact_id: string }) => ({
          id: binding.id, artifact_id: binding.artifact_id,
          source_type: kind === 'youtube' ? 'youtube' : ['soundcloud', 'bandcamp'].includes(kind) ? 'audio' : ['tweet', 'direct'].includes(kind) ? 'tweet' : 'web',
          window_type: kind === 'youtube' ? 'video' : ['soundcloud', 'bandcamp'].includes(kind) ? 'audio' : ['tweet', 'direct'].includes(kind) ? 'social' : 'web',
          source_url: sources[kind], hover_behavior: 'preview', click_behavior: 'pin-open', fallback_type: 'rich-preview',
          title, source_title: title, kicker: 'fixture', excerpt: 'Source composition fixture', playback_persistence: false,
          source_image_url: original,
          source_media_type: kind === 'direct' ? 'video' : 'image',
          ...(kind === 'still' ? { source_media_url: original } : kind === 'direct' ? { source_media_url: 'https://media.example.test/original.mp4' } : {}),
          ...(kind === 'bandcamp' ? { source_embed_html: '<iframe src="https://bandcamp.com/EmbeddedPlayer/track=2043450709/size=large/"></iframe>' } : {}),
          source_visual: { poster_asset_path: poster, render_mode: 'poster-crop', crop_risk: 'low', focal_point: { x: 0.5, y: 0.4 }, poster_crop: { x: 0, y: 0.0953, width: 1, height: 0.8166 }, image_width: 800, image_height: 550 },
        }))
        await route.fulfill({ response, json: data })
      })
      await page.route(original, route => route.fulfill({ contentType: 'image/svg+xml', body: svg }))
      await page.route(poster, route => route.fulfill({ contentType: 'image/svg+xml', body: svg.replace('height="550"', 'height="450"') }))
      for (const provider of ['https://www.youtube-nocookie.com/**', 'https://w.soundcloud.com/**', 'https://bandcamp.com/EmbeddedPlayer/**', 'https://platform.twitter.com/**']) {
        await page.route(provider, route => route.fulfill({ contentType: 'text/html', body: '<button>Native provider fixture</button>' }))
      }
      await page.route('https://media.example.test/original.mp4', () => {})
      await page.goto('/?edition=2026-09-28-the-edge-outlasts-the-day-v1')
      const artifact = page.locator('button.artifact').first()
      await artifact.focus()
      if (mode === 'primary') await artifact.press('Enter')
      const surface = page.locator('.stage-overlay-windows--live .source-window')
      await expect(surface).toHaveAttribute('data-source-window-mode', mode)
      if (exerciseLoadRace) {
        if (packageLoads > 1) {
          const lateEffects = page.waitForResponse(response => response.url().endsWith('/effects.json'))
          releaseDuplicate()
          await (await lateEffects).finished()
          await page.evaluate(() => new Promise<void>(resolve => requestAnimationFrame(() => requestAnimationFrame(() => resolve()))))
        }
        await expect(surface).toHaveAttribute('data-source-window-mode', 'preview')
        expect(packageLoads, 'one package load per route; manifest resolution must not reload it').toBe(1)
      }
      await surface.evaluate(async node => { await Promise.all(node.getAnimations({ subtree: true }).filter(a => a.effect?.getTiming().iterations !== Infinity).map(a => a.finished)) })
      // Stage tweets with attached still media intentionally render that image,
      // not a native post; retain this distinction from playable providers.
      if (['still', 'image-only', 'tweet'].includes(kind)) {
        const image = surface.locator('.visual-source-card__image')
        await expect.soft(image).toHaveAttribute('src', original)
        await expect.soft(image).toHaveCSS('object-fit', 'contain')
        await image.evaluate((img: HTMLImageElement) => img.decode())
        const geometry = await image.evaluate((img: HTMLImageElement) => ({ image: img.getBoundingClientRect().toJSON(), figure: img.closest('figure')!.getBoundingClientRect().toJSON(), natural: [img.naturalWidth, img.naturalHeight] }))
        expect(geometry.natural).toEqual([800, 550])
        for (const r of [geometry.image, geometry.figure]) {
          expect(r.left).toBeGreaterThanOrEqual(0); expect(r.top).toBeGreaterThanOrEqual(0)
          expect(r.right).toBeLessThanOrEqual(1440); expect(r.bottom).toBeLessThanOrEqual(980)
        }
        for (const edge of ['left', 'top'] as const) expect(geometry.image[edge]).toBeGreaterThanOrEqual(geometry.figure[edge] - 1)
        for (const edge of ['right', 'bottom'] as const) expect(geometry.image[edge]).toBeLessThanOrEqual(geometry.figure[edge] + 1)
        await testInfo.attach('contained-source', { body: await surface.screenshot(), contentType: 'image/png' })
      } else if (kind === 'direct') {
        await expect(surface.locator('video')).toHaveAttribute('src', 'https://media.example.test/original.mp4')
        await expect(surface.locator('.visual-source-card')).toHaveAttribute('data-source-visual-mode', 'poster-crop')
        await expect(surface.locator('img, iframe')).toHaveCount(0)
      } else {
        const expected = { youtube: /youtube.*\/embed\/prYhH_jDOVQ/, soundcloud: /w.soundcloud.com\/player/, bandcamp: /bandcamp.com\/EmbeddedPlayer\/track=2043450709/, tweet: /platform.twitter.com\/embed\/Tweet.html\?id=1234567890/ }
        await expect(surface.locator('iframe')).toHaveAttribute('src', expected[kind as keyof typeof expected])
        await expect(surface.locator('.visual-source-card, img, video')).toHaveCount(0)
      }
      await surface.locator('.source-window__close').click()
      await expect(surface).toHaveCount(0)
    })
  }
}
