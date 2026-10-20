import { expect, test, type Locator } from '@playwright/test'

const edition = '2026-10-20-the-fracture-keeps-its-depth-v1'
const videos = ['module-chunky-projecting-ivory-ledge-across', 'module-detached-rust-red-shelf-with-rough-g']

// Use exposed real marks and the exact preview body's nearest exposed center.
// No focus, forced events, retry taps, or alternate caption targets.
async function hit(target: Locator, mobile: boolean) {
  const point = await target.evaluate(el => {
    const r = el.getBoundingClientRect()
    const points = []
    for (let y = Math.max(3, Math.ceil(r.top)); y < Math.min(innerHeight - 3, r.bottom); y += 3) {
      for (let x = Math.max(3, Math.ceil(r.left)); x < Math.min(innerWidth - 3, r.right); x += 3) {
        if ([[0, 0], [2, 0], [-2, 0], [0, 2], [0, -2]].every(([dx, dy]) => {
          const e = document.elementFromPoint(x + dx, y + dy)
          return e === el || (e !== null && el.contains(e))
        })) points.push({ x: x - r.x, y: y - r.y, d: (x - r.x - r.width / 2) ** 2 + (y - r.y - r.height / 2) ** 2 })
      }
    }
    return points.sort((a, b) => a.d - b.d)[0]
  })
  expect(point, 'target must have an exposed trusted input point').toBeTruthy()
  if (mobile) await target.tap({ position: point })
  else await target.click({ position: point })
}

for (const view of [
  { width: 390, height: 844, mobile: true },
  { width: 852, height: 393, mobile: true },
  { width: 1440, height: 980, mobile: false },
]) {
  test(`native video preview promotes once and preserves controls ${view.width}`, async ({ browser, baseURL }, testInfo) => {
    const page = await browser.newPage({ baseURL, viewport: view, isMobile: view.mobile, hasTouch: view.mobile, reducedMotion: 'reduce' })
    try {
      // Deterministic native-control transport fixture, not provider playback proof.
      // The separate deployed proof retains the unmocked source URLs and frames.
      await page.route('https://video.twimg.com/**', route => route.fulfill({
        contentType: 'video/webm', path: 'tests/fixtures/native-video-controls.webm',
      }))
      await page.goto(`/?edition=${edition}`)
      await page.locator('img.plate').evaluate((img: HTMLImageElement) => img.decode())
      const { artifacts } = await (await page.request.get(`/editions/${edition}/artifact-map.json`)).json()
      for (const artifactId of videos) {
        const artifact = page.locator('button.artifact').nth(artifacts.findIndex((a: { id: string }) => a.id === artifactId))
        if (view.mobile) await hit(artifact, true)
        else await artifact.hover()
        const preview = page.locator(`.source-window[data-artifact-id="${artifactId}"][data-source-window-mode="preview"]`)
        await expect(preview).toBeVisible()
        await expect(preview.locator('video')).toBeVisible()
        // Dismiss is exempt from promotion and must work on the first tap.
        await hit(preview.locator('.source-window__close'), view.mobile)
        await expect(page.locator('.source-window')).toHaveCount(0)
        if (!view.mobile) await page.mouse.move(1, 1)
        if (view.mobile) await hit(artifact, true)
        else await artifact.hover()
        await expect(preview).toBeVisible()
        await page.waitForTimeout(250)
        await hit(preview.locator('.source-window__body'), view.mobile)
        const primary = page.locator(`.source-window[data-artifact-id="${artifactId}"][data-source-window-mode="primary"]`)
        await expect(primary).toBeVisible()
        await expect(page.locator('.source-window')).toHaveCount(1)
        const video = primary.locator('video')
        await expect.poll(() => video.evaluate((v: HTMLVideoElement) => v.readyState), { timeout: 30000 }).toBeGreaterThanOrEqual(2)
        const before = await video.evaluate((v: HTMLVideoElement) => ({ time: v.currentTime, frames: v.getVideoPlaybackQuality().totalVideoFrames }))
        const box = (await video.boundingBox())!
        if (view.mobile) await page.touchscreen.tap(box.x + 25, box.y + box.height - 48)
        else await page.mouse.click(box.x + 25, box.y + box.height - 48)
        await expect.poll(() => video.evaluate((v: HTMLVideoElement) => v.currentTime)).toBeGreaterThan(before.time)
        await expect.poll(() => video.evaluate((v: HTMLVideoElement) => v.getVideoPlaybackQuality().totalVideoFrames)).toBeGreaterThan(before.frames)
        await expect(primary).toBeVisible()
        await page.screenshot({ path: testInfo.outputPath(`${artifactId}.png`) })
        await hit(primary.locator('.source-window__close'), view.mobile)
        await expect(page.locator('.source-window')).toHaveCount(0)
        if (!view.mobile) await page.mouse.move(1, 1)
      }
    } finally {
      await page.close()
    }
  })
}
