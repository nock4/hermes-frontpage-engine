import { expect, test, type Page } from '@playwright/test'

const original = 'https://media.example.test/whole-original.jpg'
const poster = 'https://media.example.test/cropped-poster.jpg'
const title = 'Whole source composition'
const still = '<svg xmlns="http://www.w3.org/2000/svg" width="800" height="400"><rect width="800" height="400" fill="#ff40e0"/><rect x="8" y="8" width="784" height="384" fill="none" stroke="#40ffff" stroke-width="16"/></svg>'

async function fixture(page: Page, kind: 'still' | 'native' | 'direct' = 'still') {
  await page.setViewportSize({ width: 393, height: 852 })
  await page.route('**/source-bindings.json', async route => {
    const response = await route.fetch()
    const data = await response.json()
    data.bindings = data.bindings.map((binding: { id: string; artifact_id: string }) => ({
      id: binding.id, artifact_id: binding.artifact_id,
      source_type: kind === 'native' ? 'youtube' : kind === 'direct' ? 'tweet' : 'web',
      window_type: kind === 'native' ? 'video' : kind === 'direct' ? 'social' : 'web',
      source_url: kind === 'native' ? 'https://www.youtube.com/watch?v=prYhH_jDOVQ' : kind === 'direct' ? 'https://x.com/example/status/1234567890' : 'https://example.test/original',
      hover_behavior: 'preview', click_behavior: 'pin-open', fallback_type: 'rich-preview',
      title, source_title: title, kicker: 'fixture', excerpt: 'Whole original fixture', playback_persistence: false,
      source_image_url: original,
      source_media_type: kind === 'direct' ? 'video' : 'image',
      ...(kind === 'direct' ? { source_media_url: 'https://media.example.test/original.mp4' } : {}),
      source_visual: { poster_asset_path: poster, render_mode: 'poster-crop', crop_risk: 'low' },
    }))
    await route.fulfill({ response, json: data })
  })
  await page.route(original, route => route.fulfill({ contentType: 'image/svg+xml', headers: { 'access-control-allow-origin': '*' }, body: still }))
  await page.route(poster, route => route.fulfill({ contentType: 'image/svg+xml', headers: { 'access-control-allow-origin': '*' }, body: still.replace('800', '400') }))
  await page.route('https://www.youtube-nocookie.com/**', route => route.fulfill({ contentType: 'text/html', body: '<button>Native video player</button>' }))
  // Hold the media response so a network failure cannot replace the direct player.
  await page.route('https://media.example.test/original.mp4', () => {})
  await page.goto('/?edition=2026-09-28-the-edge-outlasts-the-day-v1')
}

async function openSurface(page: Page, mode: 'preview' | 'primary') {
  const artifact = page.locator('button.artifact').first()
  await expect(artifact).toBeVisible()
  await artifact.focus()
  if (mode === 'primary') await artifact.press('Enter')
  const surface = page.locator('.stage-overlay-windows--live .source-window')
  await expect(surface).toHaveAttribute('data-source-window-mode', mode)
  await surface.evaluate(async node => {
    await Promise.all(node.getAnimations({ subtree: true }).filter(a => a.effect?.getTiming().iterations !== Infinity).map(a => a.finished))
  })
  return surface
}

for (const mode of ['preview', 'primary'] as const) {
  test(`portrait ${mode} contains original, ambient, title and close despite low-risk poster`, async ({ page }, testInfo) => {
    await fixture(page)
    const surface = await openSurface(page, mode)
    const figure = surface.locator('.visual-source-card__figure')
    const image = figure.locator('img')
    await expect.soft(image).toHaveAttribute('src', original)
    await expect.soft(surface.locator('.visual-source-card')).toHaveAttribute('data-source-visual-mode', 'raw')
    await expect.soft(figure).toHaveAttribute('data-source-visual-mode', 'raw')
    await expect.soft(image).toHaveCSS('object-fit', 'contain')
    await image.evaluate((img: HTMLImageElement) => img.decode())
    const geometry = await surface.evaluate(node => {
      const figure = node.querySelector('.visual-source-card__figure')!
      const img = figure.querySelector('img')!
      const title = [...node.querySelectorAll('.visual-source-card__title, .visual-source-card__edge-title')].find(el => el.getBoundingClientRect().height > 0)!
      const close = node.querySelector('.source-window__close')!
      const r = close.getBoundingClientRect(), hit = document.elementFromPoint(r.x + r.width / 2, r.y + r.height / 2)
      return {
        figure: figure.getBoundingClientRect().toJSON(), image: img.getBoundingClientRect().toJSON(),
        title: title.getBoundingClientRect().toJSON(), close: r.toJSON(), titleText: title.textContent,
        closeHit: hit === close || close.contains(hit), natural: [img.naturalWidth, img.naturalHeight],
        ambient: getComputedStyle(figure, '::before').backgroundImage,
      }
    })
    expect(geometry.natural).toEqual([800, 400])
    expect(geometry.ambient).toContain(original)
    expect(geometry.closeHit).toBe(true)
    expect(geometry.close.width).toBeGreaterThanOrEqual(44)
    expect(geometry.titleText).toBe(title)
    expect(geometry.title.height).toBeGreaterThan(12)
    expect(geometry.title.top).toBeGreaterThanOrEqual(geometry.figure.bottom - 1)
    for (const r of [geometry.figure, geometry.image, geometry.title, geometry.close]) {
      expect(r.left).toBeGreaterThanOrEqual(0)
      expect(r.top).toBeGreaterThanOrEqual(0)
      expect(r.right).toBeLessThanOrEqual(393)
      expect(r.bottom).toBeLessThanOrEqual(852)
    }
    for (const key of ['left', 'top'] as const) expect(geometry.image[key]).toBeGreaterThanOrEqual(geometry.figure[key] - 1)
    for (const key of ['right', 'bottom'] as const) expect(geometry.image[key]).toBeLessThanOrEqual(geometry.figure[key] + 1)
    // Contain maps the entire intrinsic rectangle into the aperture, not cover's cropped rectangle.
    const scale = Math.min(geometry.image.width / 800, geometry.image.height / 400)
    expect(scale * 800).toBeLessThanOrEqual(geometry.figure.width + 1)
    expect(scale * 400).toBeLessThan(geometry.figure.height - 20)
    const painted = (await figure.screenshot()).toString('base64')
    await figure.evaluate(el => (el as HTMLElement).style.setProperty('--source-ambient-image', 'none'))
    const unpainted = (await figure.screenshot()).toString('base64')
    await figure.evaluate((el, url) => (el as HTMLElement).style.setProperty('--source-ambient-image', `url("${url}")`), original)
    const gutterDelta = await page.evaluate(async ({ painted, unpainted }) => {
      const pixels = async (png: string) => {
        const img = new Image(); img.src = `data:image/png;base64,${png}`; await img.decode()
        const canvas = document.createElement('canvas'); canvas.width = img.width; canvas.height = img.height
        const ctx = canvas.getContext('2d')!; ctx.drawImage(img, 0, 0)
        return ctx.getImageData(Math.floor(img.width / 2), 12, 8, 8).data
      }
      const a = await pixels(painted), b = await pixels(unpainted)
      return a.reduce((sum, value, i) => sum + Math.abs(value - b[i]), 0) / a.length
    }, { painted, unpainted })
    expect(gutterDelta).toBeGreaterThan(10)
    await testInfo.attach('portrait-geometry', { body: JSON.stringify({ geometry, gutterDelta }, null, 2), contentType: 'application/json' })
    await testInfo.attach('portrait-still', { body: await surface.screenshot(), contentType: 'image/png' })
    await surface.locator('.source-window__close').click()
    await expect(surface).toHaveCount(0)
  })

  test(`portrait direct video stays a player in ${mode}`, async ({ page }) => {
    await fixture(page, 'direct')
    const surface = await openSurface(page, mode)
    await expect(surface.locator('video')).toHaveAttribute('src', 'https://media.example.test/original.mp4')
    await expect(surface.locator('.visual-source-card')).toHaveAttribute('data-source-visual-mode', 'poster-crop')
    await expect(surface.locator('img')).toHaveCount(0)
    await expect(surface.locator('.visual-source-card__figure')).not.toHaveAttribute('style', /--source-ambient-image/)
  })
}

test('portrait native primary video is not replaced with contained imagery', async ({ page }) => {
  await fixture(page, 'native')
  const surface = await openSurface(page, 'primary')
  await expect(surface.locator('iframe')).toHaveAttribute('src', /youtube.*\/embed\/prYhH_jDOVQ/)
  await expect(surface.locator('.source-window__media-title')).toHaveText(title)
  await expect(surface.locator('.visual-source-card, img')).toHaveCount(0)
})
