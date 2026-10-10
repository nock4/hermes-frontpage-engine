import { expect, test, type Locator, type Page } from '@playwright/test'
import fs from 'node:fs'

const edition = '2026-10-10-the-weight-between-v1'
const bindings = JSON.parse(fs.readFileSync(`public/editions/${edition}/source-bindings.json`, 'utf8')).bindings
const artifacts = JSON.parse(fs.readFileSync(`public/editions/${edition}/artifact-map.json`, 'utf8')).artifacts

// Same exposed-center, real-pointer sequence as the run7 proof. Locator taps
// include normal scroll-into-view/focus behavior; DOM dispatch would miss this.
async function hit(target: Locator, mobile: boolean) {
  const point = await target.evaluate(el => {
    const r = el.getBoundingClientRect(), points = []
    for (let y = Math.max(3, Math.ceil(r.top)); y < Math.min(innerHeight - 3, r.bottom); y += 3) {
      for (let x = Math.max(3, Math.ceil(r.left)); x < Math.min(innerWidth - 3, r.right); x += 3) {
        if ([[0, 0], [2, 0], [-2, 0], [0, 2], [0, -2]].every(([dx, dy]) => {
          const h = document.elementFromPoint(x + dx, y + dy)
          return h === el || el.contains(h)
        })) points.push({ x: x - r.x, y: y - r.y, d: (x - r.x - r.width / 2) ** 2 + (y - r.y - r.height / 2) ** 2 })
      }
    }
    return points.sort((a, b) => a.d - b.d)[0]
  })
  expect(point, 'exposed real-pointer target').toBeTruthy()
  await target[mobile ? 'tap' : 'click']({ position: point })
}

async function settle(page: Page) {
  await page.evaluate(async () => {
    await Promise.all(document.getAnimations().filter(a => a.effect?.getComputedTiming().iterations !== Infinity).map(a => a.finished.catch(() => {})))
  })
}

for (const view of [
  { name: 'desktop', width: 1440, height: 980, mobile: false },
  { name: 'portrait', width: 390, height: 844, mobile: true },
  { name: 'landscape', width: 852, height: 393, mobile: true },
]) {
  test(`contained plate source sequence stays in bounds in ${view.name}`, async ({ browser, baseURL }) => {
    const context = await browser.newContext({ viewport: view, hasTouch: view.mobile, isMobile: view.mobile, reducedMotion: 'reduce' })
    const page = await context.newPage()
    // This focused regression verifies native iframe selection/geometry, not
    // provider playback. The separate real proof exercises actual YouTube.
    await page.route('https://www.youtube-nocookie.com/**', route => route.fulfill({ contentType: 'text/html', body: '<button>Native player fixture</button>' }))
    const primary = page.locator('.source-window[data-source-window-mode="primary"]')
    const verify = async (binding: { id: string; artifact_id: string; source_type: string }) => {
      await expect(primary).toHaveAttribute('data-binding-id', binding.id)
      await expect(primary).toHaveAttribute('data-artifact-id', binding.artifact_id)
      await settle(page)
      if (binding.source_type === 'youtube') await expect(primary.locator('iframe')).toHaveAttribute('src', /\/embed\/FBJnKQCFtes/)
      const geometry = await primary.evaluate(node => ({
        rects: [node, ...node.querySelectorAll('iframe, .visual-source-card__figure, .source-window__close')].map(n => n.getBoundingClientRect().toJSON()),
        scroll: [document.querySelector('.stage')!.scrollLeft, document.querySelector('.stage')!.scrollTop],
      }))
      for (const r of geometry.rects) {
        expect.soft(r.left, binding.id).toBeGreaterThanOrEqual(-1)
        expect.soft(r.top, binding.id).toBeGreaterThanOrEqual(-1)
        expect.soft(r.right, binding.id).toBeLessThanOrEqual(view.width + 1)
        expect.soft(r.bottom, binding.id).toBeLessThanOrEqual(view.height + 1)
      }
      expect.soft(geometry.scroll, 'decorative overscan must never scroll the stage').toEqual([0, 0])
      await hit(primary.locator('.source-window__close'), view.mobile)
      await expect(primary).toHaveCount(0)
    }
    for (const lab of [false, true]) {
      await page.goto(`${baseURL}/?edition=${edition}${lab ? '&interaction-lab=1' : ''}`)
      await expect(page.locator('[data-edition-id]')).toHaveAttribute('data-edition-id', edition)
      await page.locator('img.plate').evaluate(async (img: HTMLImageElement) => img.decode())
      await settle(page)
      if (!lab) {
        for (const binding of bindings) {
          await page.mouse.move(1, 1)
          await hit(page.locator('button.artifact').nth(artifacts.findIndex((a: { id: string }) => a.id === binding.artifact_id)), view.mobile)
          await settle(page)
          if (await primary.count() === 0) {
            // A hover/focus preview can consume the opening gesture. Promote
            // that exact visible preview with a second real gesture, not Enter.
            const preview = page.locator(`.source-window[data-source-window-mode="preview"][data-binding-id="${binding.id}"]`)
            await expect(preview).toBeVisible()
            await hit(preview.locator('.source-window__body'), view.mobile)
          }
          await verify(binding)
        }
      } else {
        const marks = page.locator('[data-interaction-lab-artifact]')
        await expect(marks).toHaveCount(6)
        for (let i = 0; i < 6; i++) {
          const mark = marks.nth(i)
          const id = await mark.getAttribute('data-interaction-lab-artifact')
          const binding = bindings.find((b: { artifact_id: string }) => b.artifact_id === id)
          await hit(mark, view.mobile)
          await expect(mark).toHaveAttribute('data-lab-revealed', 'true')
          await expect(page.locator('.source-window')).toHaveCount(0)
          await settle(page)
          await hit(mark, view.mobile)
          await verify(binding)
        }
      }
    }
    await context.close()
  })
}
