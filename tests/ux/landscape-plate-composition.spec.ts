import { expect, test } from '@playwright/test'
import fs from 'node:fs'

const edition = '2026-10-15-the-weight-of-a-curl-v2'
const { artifacts } = JSON.parse(fs.readFileSync(`public/editions/${edition}/artifact-map.json`, 'utf8'))
const { bindings } = JSON.parse(fs.readFileSync(`public/editions/${edition}/source-bindings.json`, 'utf8'))

for (const v of [
  { name: 'desktop', width: 1440, height: 980, touch: false },
  { name: '16-by-9', width: 1280, height: 720, touch: false },
  { name: 'portrait', width: 390, height: 844, touch: true },
  { name: 'short-landscape', width: 852, height: 393, touch: true },
]) {
  test(`whole landscape composition and six real mark gestures: ${v.name}`, async ({ browser }, info) => {
    const context = await browser.newContext({ viewport: v, hasTouch: v.touch, isMobile: v.touch, reducedMotion: 'reduce' })
    const page = await context.newPage()
    try {
      await page.goto(`${info.project.use.baseURL}/?edition=${edition}`)
      await page.locator('img.plate').evaluate((img: HTMLImageElement) => img.decode())
      await expect(page.locator('button.artifact')).toHaveCount(6)
      for (const [index, artifact] of artifacts.entries()) {
        // Derive the gesture from the *painted image*, never the hit rectangle.
        // Contain/cover offsets are accounted for so the old cropped runtime
        // cannot falsely pass by stretching its independent normalized mesh.
        const point = await page.locator('img.plate').evaluate((img: HTMLImageElement, a: any) => {
          const r = img.getBoundingClientRect(), style = getComputedStyle(img)
          const scale = style.objectFit === 'cover' ? Math.max(r.width / img.naturalWidth, r.height / img.naturalHeight) : Math.min(r.width / img.naturalWidth, r.height / img.naturalHeight)
          const w = img.naturalWidth * scale, h = img.naturalHeight * scale
          const ox = r.x + (r.width - w) / 2, oy = r.y + (r.height - h) / 2
          const inside = (x: number, y: number) => {
            let yes = false
            for (let i = 0, j = a.polygon.length - 1; i < a.polygon.length; j = i++) {
              const [xi, yi] = a.polygon[i], [xj, yj] = a.polygon[j]
              if ((yi > y) !== (yj > y) && x < (xj - xi) * (y - yi) / (yj - yi) + xi) yes = !yes
            }
            return yes
          }
          // Pick an interior visible-mark point without consulting DOM hits.
          const candidates = []
          for (let y = a.bounds.y + .01; y < a.bounds.y + a.bounds.h; y += .01)
            for (let x = a.bounds.x + .01; x < a.bounds.x + a.bounds.w; x += .01)
              if ([[0,0],[.008,0],[-.008,0],[0,.008],[0,-.008]].every(([dx,dy]) => inside(x+dx,y+dy))) candidates.push({x,y,d:(x-a.bounds.x-a.bounds.w/2)**2+(y-a.bounds.y-a.bounds.h/2)**2})
          const p = candidates.sort((a,b) => a.d-b.d)[0]
          return { x: ox + p.x * w, y: oy + p.y * h }
        }, artifact)
        if (point.y > v.height - 8) {
          await page.evaluate(y => window.scrollBy(0, y - innerHeight / 2), point.y)
          point.y -= await page.evaluate(() => window.scrollY)
        }
        const hit = await page.evaluate(p => document.elementFromPoint(p.x, p.y)?.closest('button.artifact')?.getAttribute('aria-label'), point)
        expect(hit, `painted mark ${artifact.id} must hit its own mesh`).toBe(artifact.label)
        if (v.touch) await page.touchscreen.tap(point.x, point.y)
        else await page.mouse.click(point.x, point.y)
        const binding = bindings.find((candidate: { artifact_id: string }) => candidate.artifact_id === artifact.id)
        expect(binding, `binding for visible mark ${artifact.id}`).toBeDefined()
        const opened = page.locator(`.stage-overlay-windows--live .source-window[data-binding-id="${binding.id}"]`)
        await expect(opened).toBeVisible()
        await expect(opened).toHaveAttribute('data-artifact-id', artifact.id)
        await expect(page.locator('.stage-overlay-windows--live .source-window')).toHaveCount(1)
        await page.waitForTimeout(400)
        const rect = await opened.boundingBox()
        expect(rect!.x).toBeGreaterThanOrEqual(-1)
        expect(rect!.y).toBeGreaterThanOrEqual(-1)
        expect(rect!.x + rect!.width).toBeLessThanOrEqual(v.width + 1)
        expect(rect!.y + rect!.height).toBeLessThanOrEqual(v.height + 1)
        await info.attach(`mark-${index + 1}-open`, { body: await page.screenshot(), contentType: 'image/png' })
        const close = opened.locator('.source-window__close')
        if (v.touch) await close.tap(); else await close.click()
        await page.mouse.move(1, 1)
        await expect(page.locator('.stage-overlay-windows--live .source-window')).toHaveCount(0)
        await page.evaluate(() => window.scrollTo(0, 0))
      }
      const geometry = await page.locator('img.plate').evaluate((img: HTMLImageElement) => ({ rect: img.getBoundingClientRect().toJSON(), w: img.naturalWidth, h: img.naturalHeight, fit: getComputedStyle(img).objectFit }))
      expect(geometry.rect.width).toBeCloseTo(v.width, 0)
      expect(geometry.rect.height).toBeCloseTo(v.width * geometry.h / geometry.w, 0)
      expect(geometry.rect.x).toBeCloseTo(0, 0)
      expect(geometry.fit).toBe('contain')
      expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBe(v.width)
      await expect(page.locator('.runtime-topbar,.side-rail,.artifact--labels-on,[data-interaction-lab],.plate-ambient')).toHaveCount(0)
      await info.attach('whole-live-plate', { body: await page.screenshot({ fullPage: true }), contentType: 'image/png' })
    } finally { await context.close() }
  })
}

test('first close must not hover-open the newly uncovered mark under a stationary pointer', async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 720 })
  await page.emulateMedia({ reducedMotion: 'reduce' })
  await page.goto('/?edition=2026-10-15-the-weight-of-a-curl-v2')
  await page.locator('img.plate').evaluate((img: HTMLImageElement) => img.decode())
  const windows = page.locator('.stage-overlay-windows--live .source-window')
  const lime = page.locator('[data-binding-id="binding-hero-lime-hooked-sweep-with-fluted-relief"]')
  await page.getByRole('button', { name: 'Lime hooked sweep with fluted relief and muted colored seams', exact: true }).focus()
  await expect(lime).toHaveAttribute('data-source-window-mode', 'preview')
  const close = lime.locator('.source-window__close')
  await close.hover()
  const closeRect = (await close.boundingBox())!
  await close.click()
  // Let Chromium perform its post-removal hit-test while the pointer remains
  // over the now-uncovered tongue. Moving away immediately hides this race.
  await page.evaluate(() => new Promise<void>(resolve => requestAnimationFrame(() => requestAnimationFrame(() => resolve()))))
  await expect(windows).toHaveCount(0)
  await page.mouse.move(1, 1)
  await expect(windows).toHaveCount(0)
  // A deliberate fresh hover must still work after dismissal.
  await page.mouse.move(closeRect.x + closeRect.width / 2, closeRect.y + closeRect.height / 2)
  await expect(page.locator('[data-binding-id="binding-module-folded-lime-tongue-with-fine-grooves"]')).toHaveAttribute('data-source-window-mode', 'preview')
})
