import { expect, test } from '@playwright/test'

const original = 'https://media.example.test/whole-original.jpg'
const poster = 'https://media.example.test/cropped-poster.jpg'
const title = 'Cure Nailhouse — full composition'
const svg = '<svg xmlns="http://www.w3.org/2000/svg" width="800" height="550"><rect width="800" height="550" fill="#672276"/><rect x="8" y="8" width="784" height="534" fill="none" stroke="#40ffff" stroke-width="16"/></svg>'

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
