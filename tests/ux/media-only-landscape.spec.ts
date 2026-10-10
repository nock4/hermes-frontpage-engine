import { expect, test, type Page } from '@playwright/test'

const edition = '2026-09-28-the-edge-outlasts-the-day-v1'
const original = 'https://media.example.test/original-still.svg'
const title = 'Media-only original still'
// A portrait original leaves measurable ambient gutters in a landscape aperture.
const still = '<svg xmlns="http://www.w3.org/2000/svg" width="400" height="800"><rect width="400" height="800" fill="#ff40e0"/><rect x="8" y="8" width="384" height="784" fill="none" stroke="#40ffff" stroke-width="16"/></svg>'

async function fixture(page: Page, nativeVideo = false) {
  await page.setViewportSize({ width: 852, height: 393 })
  await page.route('**/source-bindings.json', async route => {
    const response = await route.fetch()
    const data = await response.json()
    // Replace (rather than spread) metadata: neither source_image_url nor
    // source_visual may accidentally satisfy the regression's missing fallback.
    data.bindings = data.bindings.map((binding: { id: string; artifact_id: string }) => ({
      id: binding.id, artifact_id: binding.artifact_id,
      source_type: nativeVideo ? 'youtube' : 'web',
      window_type: nativeVideo ? 'video' : 'web',
      source_url: nativeVideo ? 'https://www.youtube.com/watch?v=prYhH_jDOVQ' : 'https://example.test/original',
      hover_behavior: 'preview', click_behavior: 'pin-open', fallback_type: 'rich-preview',
      title, source_title: title, kicker: 'fixture', excerpt: 'Original still fixture', playback_persistence: false,
      source_media_type: 'image', source_media_url: original,
    }))
    for (const binding of data.bindings) {
      expect(binding).not.toHaveProperty('source_image_url')
      expect(binding).not.toHaveProperty('source_visual')
    }
    await route.fulfill({ response, json: data })
  })
  await page.route(original, route => route.fulfill({ contentType: 'image/svg+xml', body: still }))
  await page.route('https://www.youtube-nocookie.com/**', route => route.fulfill({ contentType: 'text/html', body: '<button>Native video player</button>' }))
  await page.goto(`/?edition=${edition}`)
}

async function openSurface(page: Page, mode: 'preview' | 'primary') {
  const artifact = page.locator('button.artifact').first()
  await expect(artifact).toBeVisible()
  if (mode === 'preview') await artifact.focus()
  else {
    // Exercise the hit-tested stage interaction, not Enter or DOM dispatch.
    const point = await artifact.evaluate(node => {
      const r = node.getBoundingClientRect()
      for (let a = .1; a < 1; a += .1) for (let b = .1; b < 1; b += .1) {
        const x = r.x + r.width * a, y = r.y + r.height * b
        const hit = document.elementFromPoint(x, y)
        if (hit === node || node.contains(hit)) return { x, y }
      }
      return null
    })
    expect(point).not.toBeNull()
    await page.mouse.click(point!.x, point!.y)
  }
  const surface = page.locator('.stage-overlay-windows--live .source-window')
  await expect(surface).toHaveAttribute('data-source-window-mode', mode)
  await surface.evaluate(async node => {
    await Promise.all(node.getAnimations({ subtree: true }).filter(a => a.effect?.getTiming().iterations !== Infinity).map(a => a.finished))
  })
  return surface
}

for (const mode of ['preview', 'primary'] as const) {
  test(`media-only still is whole with painted ambient in landscape ${mode}`, async ({ page }, testInfo) => {
    await fixture(page)
    const surface = await openSurface(page, mode)
    const card = surface.locator('.visual-source-card')
    const figure = surface.locator('.visual-source-card__figure')
    const image = figure.locator('img')
    await expect(image).toHaveAttribute('src', original)
    await image.evaluate((img: HTMLImageElement) => img.decode())
    await expect.soft(card).toHaveAttribute('data-source-visual-mode', 'raw')
    await expect.soft(figure).toHaveAttribute('data-source-visual-mode', 'raw')
    await expect(figure).toHaveAttribute('data-source-media-type', 'image')
    await expect(image).toHaveCSS('object-fit', 'contain')
    const geometry = await surface.evaluate(node => {
      const figure = node.querySelector('.visual-source-card__figure')!
      const img = figure.querySelector('img')!
      const title = [...node.querySelectorAll('.visual-source-card__title, .visual-source-card__edge-title')].find(el => el.getBoundingClientRect().height > 0)!
      const close = node.querySelector('.source-window__close')!
      const r = close.getBoundingClientRect(), hit = document.elementFromPoint(r.x + r.width / 2, r.y + r.height / 2)
      return {
        figure: figure.getBoundingClientRect().toJSON(), image: img.getBoundingClientRect().toJSON(),
        title: title.getBoundingClientRect().toJSON(), close: r.toJSON(),
        closeHit: hit === close || close.contains(hit),
        natural: [img.naturalWidth, img.naturalHeight],
        ambient: getComputedStyle(figure, '::before').backgroundImage,
      }
    })
    expect(geometry.natural).toEqual([400, 800])
    expect(geometry.ambient).toContain(original)
    expect(geometry.closeHit).toBe(true)
    expect(geometry.close.width).toBeGreaterThanOrEqual(44)
    expect(geometry.title.width).toBeGreaterThan(64)
    expect(geometry.title.height).toBeGreaterThan(12)
    expect(geometry.title.top).toBeGreaterThanOrEqual(geometry.figure.bottom - 1)
    for (const r of [geometry.figure, geometry.image, geometry.title, geometry.close]) {
      expect(r.left).toBeGreaterThanOrEqual(0)
      expect(r.top).toBeGreaterThanOrEqual(0)
      expect(r.right).toBeLessThanOrEqual(852)
      expect(r.bottom).toBeLessThanOrEqual(393)
    }
    expect(geometry.image.left).toBeGreaterThanOrEqual(geometry.figure.left - 1)
    expect(geometry.image.right).toBeLessThanOrEqual(geometry.figure.right + 1)
    expect(geometry.image.top).toBeGreaterThanOrEqual(geometry.figure.top - 1)
    expect(geometry.image.bottom).toBeLessThanOrEqual(geometry.figure.bottom + 1)
    await expect(surface.locator('.visual-source-card__title')).toHaveText(title)
    // Pixel evidence, not merely a CSS variable: suppress only the ambient
    // background and require the empty left gutter's painted pixels to change.
    const painted = (await figure.screenshot()).toString('base64')
    await figure.evaluate(el => (el as HTMLElement).style.setProperty('--source-ambient-image', 'none'))
    const unpainted = (await figure.screenshot()).toString('base64')
    await figure.evaluate((el, url) => (el as HTMLElement).style.setProperty('--source-ambient-image', `url("${url}")`), original)
    const gutterDelta = await page.evaluate(async ({ painted, unpainted }) => {
      const pixels = async (png: string) => {
        const img = new Image(); img.src = `data:image/png;base64,${png}`; await img.decode()
        const canvas = document.createElement('canvas'); canvas.width = img.width; canvas.height = img.height
        const ctx = canvas.getContext('2d')!; ctx.drawImage(img, 0, 0)
        return ctx.getImageData(12, Math.floor(img.height / 2), 8, 8).data
      }
      const a = await pixels(painted), b = await pixels(unpainted)
      return a.reduce((sum, value, i) => sum + Math.abs(value - b[i]), 0) / a.length
    }, { painted, unpainted })
    expect(gutterDelta).toBeGreaterThan(10)
    await testInfo.attach('geometry-and-painted-ambient', { body: JSON.stringify({ geometry, gutterDelta }, null, 2), contentType: 'application/json' })
    await testInfo.attach('landscape-still', { body: await surface.screenshot(), contentType: 'image/png' })
    await surface.locator('.source-window__close').click()
    await expect(surface).toHaveCount(0)
  })
}

test('media-only image metadata does not replace a native primary video', async ({ page }) => {
  await fixture(page, true)
  const surface = await openSurface(page, 'primary')
  await expect(surface.locator('iframe')).toHaveAttribute('src', /youtube.*\/embed\/prYhH_jDOVQ/)
  await expect(surface.locator('iframe')).toBeVisible()
  await expect(surface.locator('.source-window__media-title')).toHaveText(title)
  await expect(surface.locator('.visual-source-card, img')).toHaveCount(0)
  await surface.locator('.source-window__close').click()
  await expect(surface).toHaveCount(0)
})
