import { expect, test, type Page } from '@playwright/test'
import { MIN_SOURCE_WINDOWS } from '../../src/lib/sourceWindowCountContract.mjs'

const edition = '2026-09-28-the-edge-outlasts-the-day-v1'
// Four colored edges make cropping observable; normalized marks occupy the
// top, middle and bottom of the original portrait, not viewport coordinates.
const plate = '<svg xmlns="http://www.w3.org/2000/svg" width="1024" height="1536"><rect width="1024" height="1536" fill="#69552f"/><path d="M0 0H1024" stroke="#ff0000" stroke-width="32"/><path d="M0 1536H1024" stroke="#0000ff" stroke-width="32"/><path d="M0 0V1536" stroke="#00ff00" stroke-width="32"/><path d="M1024 0V1536" stroke="#ffff00" stroke-width="32"/></svg>'

async function fixture(page: Page) {
  await page.route('**/assets/plate.png', route => route.fulfill({ contentType: 'image/svg+xml', body: plate }))
  await page.route('**/artifact-map.json', async route => {
    const response = await route.fetch(), data = await response.json()
    data.artifacts.forEach((a: any, i: number) => {
      const x = .1 + (i % 3) * .3, y = .12 + Math.floor(i / 3) * .28
      a.bounds = { x, y, w: .2, h: .12 }
      a.polygon = [[x, y], [x + .2, y], [x + .2, y + .12], [x, y + .12]]
      delete a.interaction_mesh
    })
    await route.fulfill({ response, json: data })
  })
  await page.route('**/source-bindings.json', async route => {
    const response = await route.fetch(), data = await response.json()
    data.bindings = data.bindings.map((b: any) => ({ id: b.id, artifact_id: b.artifact_id, source_type: 'web', window_type: 'web', source_url: 'https://example.test/art', title: 'Original art', excerpt: 'Original composition', kicker: 'fixture', playback_persistence: false, source_media_type: 'image', source_media_url: 'https://media.example.test/extensionless', hover_behavior: 'preview', click_behavior: 'pin-open', fallback_type: 'rich-preview' }))
    await route.fulfill({ response, json: data })
  })
  await page.route('https://media.example.test/extensionless', route => route.fulfill({ contentType: 'image/svg+xml', body: plate }))
}

for (const viewport of [{ name: 'desktop', width: 1440, height: 980 }, { name: 'portrait', width: 393, height: 852 }, { name: 'landscape', width: 852, height: 393 }]) {
  for (const lab of [false, true]) {
    test(`whole portrait plate and ${lab ? 'lab' : 'actual'} hits align on ${viewport.name}`, async ({ page }, info) => {
      await page.setViewportSize(viewport)
      await page.emulateMedia({ reducedMotion: 'reduce' })
      await fixture(page)
      await page.goto(`/?edition=${edition}${lab ? '&interaction-lab=1' : ''}`)
      await page.locator('img.plate').evaluate((img: HTMLImageElement) => img.decode())
      const geometry = await page.locator('img.plate').evaluate((img: HTMLImageElement) => ({ rect: img.getBoundingClientRect().toJSON(), fit: getComputedStyle(img).objectFit, natural: [img.naturalWidth, img.naturalHeight] }))
      const scale = Math.min(viewport.width / 1024, viewport.height / 1536)
      expect(geometry.natural).toEqual([1024, 1536])
      expect(geometry.rect.width).toBeCloseTo(1024 * scale, 0)
      expect(geometry.rect.height).toBeCloseTo(1536 * scale, 0)
      expect(geometry.rect.x).toBeCloseTo((viewport.width - 1024 * scale) / 2, 0)
      expect(geometry.rect.y).toBeCloseTo((viewport.height - 1536 * scale) / 2, 0)
      expect(geometry.fit).toBe('contain')
      await expect(page.locator('.runtime-topbar, .side-rail, .artifact-lists')).toHaveCount(0)
      await expect(page.locator('.source-window')).toHaveCount(0)
      if (!lab) await expect(page.locator('[data-interaction-lab]')).toHaveCount(0)
      const marks = page.locator(lab ? '[data-interaction-lab-artifact]' : 'button.artifact')
      const all = await marks.evaluateAll(nodes => nodes.map(node => {
        const r = node.getBoundingClientRect(), style = (node as HTMLElement).style
        const x = r.x + r.width / 2, y = r.y + r.height / 2
        const hit = document.elementFromPoint(x, y)
        return { rect: r.toJSON(), nx: parseFloat(style.left) / 100, ny: parseFloat(style.top) / 100, nw: parseFloat(style.width) / 100, nh: parseFloat(style.height) / 100, hit: hit === node || node.contains(hit) }
      }))
      expect(all.length).toBeGreaterThanOrEqual(MIN_SOURCE_WINDOWS)
      for (const mark of all) {
        expect(mark.rect.x).toBeCloseTo(geometry.rect.x + mark.nx * geometry.rect.width, 0)
        expect(mark.rect.y).toBeCloseTo(geometry.rect.y + mark.ny * geometry.rect.height, 0)
        expect(mark.rect.width).toBeCloseTo(mark.nw * geometry.rect.width, 0)
        expect(mark.rect.height).toBeCloseTo(mark.nh * geometry.rect.height, 0)
        expect(mark.hit).toBe(true)
      }
      await info.attach('whole-plate', { body: await page.screenshot(), contentType: 'image/png' })
      const target = marks.last()
      await target.click()
      if (lab) { await expect(target).toHaveAttribute('data-lab-revealed', 'true'); await target.click() }
      const surface = page.locator('.source-window[data-source-window-mode="primary"]')
      await expect(surface).toBeVisible()
      await surface.locator('.source-window__close').click()
      await expect(surface).toHaveCount(0)
    })
  }
}
