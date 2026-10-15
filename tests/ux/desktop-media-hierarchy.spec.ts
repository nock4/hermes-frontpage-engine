import { expect, test } from '@playwright/test'

const original = 'https://media.example.test/full-landscape.jpg'
const title = 'Color Intersection M-II | The Art Institute of Chicago — Collection of Modern Textile Art'
const svg = (w: number, h: number) => `<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}"><rect width="100%" height="100%" fill="#906434"/><rect x="4" y="4" width="${w - 8}" height="${h - 8}" fill="#396b89" stroke="#ffffad" stroke-width="8"/></svg>`

for (const mode of ['preview', 'primary'] as const) {
  test(`desktop ${mode}: landscape original dominates long title on portrait plate`, async ({ page }, info) => {
    await page.setViewportSize({ width: 1440, height: 980 })
    await page.route('**/assets/plate.png', r => r.fulfill({ contentType: 'image/svg+xml', body: svg(1024, 1536) }))
    await page.route(original, r => r.fulfill({ contentType: 'image/svg+xml', body: svg(1200, 450) }))
    await page.route('**/source-bindings.json', async route => {
      const response = await route.fetch(), data = await response.json()
      data.bindings = data.bindings.map((b: { id: string; artifact_id: string }) => ({
        id: b.id, artifact_id: b.artifact_id, source_type: 'web', window_type: 'web',
        source_url: 'https://example.test/collection/art', title, source_title: title,
        excerpt: 'Synthetic hierarchy fixture', kicker: 'Collection', playback_persistence: false,
        source_media_type: 'image', source_media_url: original,
        hover_behavior: 'preview', click_behavior: 'pin-open', fallback_type: 'rich-preview',
      }))
      await route.fulfill({ response, json: data })
    })
    await page.goto('/?edition=2026-09-28-the-edge-outlasts-the-day-v1')
    await page.locator('img.plate').evaluate((img: HTMLImageElement) => img.decode())
    const artifact = page.locator('button.artifact').first()
    await artifact.focus()
    if (mode === 'primary') await artifact.press('Enter')
    const surface = page.locator('.stage-overlay-windows--live .source-window')
    await expect(surface).toHaveAttribute('data-source-window-mode', mode)
    const image = surface.locator('img.visual-source-card__image')
    await image.evaluate((img: HTMLImageElement) => img.decode())
    await surface.evaluate(async node => { await Promise.all(node.getAnimations({ subtree: true }).filter(a => a.effect?.getTiming().iterations !== Infinity).map(a => a.finished)) })
    const metrics = await surface.evaluate(node => {
      const img = node.querySelector('img.visual-source-card__image') as HTMLImageElement
      const label = Array.from(node.querySelectorAll('.visual-source-card__title, .visual-source-card__edge-title')).find(el => el.getBoundingClientRect().height > 0)!
      const r = img.getBoundingClientRect(), scale = Math.min(r.width / img.naturalWidth, r.height / img.naturalHeight)
      return { shell: node.getBoundingClientRect().toJSON(), figure: img.closest('figure')!.getBoundingClientRect().toJSON(), image: r.toJSON(), caption: label.getBoundingClientRect().toJSON(), font: parseFloat(getComputedStyle(label).fontSize), painted: { width: img.naturalWidth * scale, height: img.naturalHeight * scale } }
    })
    await info.attach('hierarchy-metrics', { body: JSON.stringify(metrics), contentType: 'application/json' })
    await info.attach('hierarchy', { body: await page.screenshot(), contentType: 'image/png' })
    await expect(image).toHaveAttribute('src', original)
    await expect(image).toHaveCSS('object-fit', 'contain')
    expect(await image.evaluate((img: HTMLImageElement) => [img.naturalWidth, img.naturalHeight])).toEqual([1200, 450])
    await expect(surface.locator('.visual-source-card__edge-title')).toBeVisible()
    await expect(surface.locator('.visual-source-card__edge-title')).toHaveText(title)
    const close = surface.locator('.source-window__close')
    expect(await close.evaluate(node => {
      const r = node.getBoundingClientRect(), hit = document.elementFromPoint(r.x + r.width / 2, r.y + r.height / 2)
      return node === hit || node.contains(hit)
    })).toBe(true)
    expect.soft(metrics.painted.width).toBeGreaterThanOrEqual(440)
    expect.soft(metrics.painted.height / metrics.caption.height).toBeGreaterThanOrEqual(5)
    expect.soft(metrics.painted.width * metrics.painted.height / (metrics.shell.width * metrics.shell.height)).toBeGreaterThan(0.65)
    expect.soft(metrics.font).toBeLessThanOrEqual(14)
    expect(metrics.font).toBeGreaterThanOrEqual(11)
    for (const r of [metrics.shell, metrics.figure, metrics.image, metrics.caption]) {
      expect(r.left).toBeGreaterThanOrEqual(0); expect(r.top).toBeGreaterThanOrEqual(0)
      expect(r.right).toBeLessThanOrEqual(1440); expect(r.bottom).toBeLessThanOrEqual(980)
      expect(r.left).toBeGreaterThanOrEqual(metrics.shell.left - 1)
      expect(r.right).toBeLessThanOrEqual(metrics.shell.right + 1)
      expect(r.bottom).toBeLessThanOrEqual(metrics.shell.bottom + 1)
    }
    await expect(page.locator('.runtime-topbar, .side-rail, .artifact-lists')).toHaveCount(0)
    await surface.locator('.source-window__close').click()
    await expect(surface).toHaveCount(0)
  })
}
