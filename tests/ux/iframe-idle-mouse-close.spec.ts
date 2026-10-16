import { expect, test } from '@playwright/test'

for (const mark of [
  { id: 'binding-module-pale-angular-cuff-enclosing-a-brown-', x: 416.4576, y: 342.136575 },
]) {
  test(`touch close after mouse enters provider iframe stays closed: ${mark.id}`, async ({ browser }, info) => {
    const context = await browser.newContext({ viewport: { width: 852, height: 393 }, hasTouch: true, isMobile: true, reducedMotion: 'reduce' })
    const page = await context.newPage()
    try {
      // Deterministic provider boundary fixture, not a playback assertion. The
      // separate candidate proof exercises the real provider and advancing video.
      await page.route('https://video.twimg.com/**', route => route.abort())
      await page.route('https://platform.twitter.com/**', route => route.fulfill({ contentType: 'text/html', body: '<!doctype html><style>html,body{margin:0;overflow:hidden}</style><body>Provider boundary fixture</body>' }))
      await page.goto(`${info.project.use.baseURL}/?edition=2026-10-16-the-collar-holds-its-shape-v1`)
      await page.locator('img.plate').evaluate((img: HTMLImageElement) => img.decode())
      await page.evaluate(async () => { await Promise.all(document.getAnimations().filter(a => a.effect?.getComputedTiming().iterations !== Infinity).map(a => a.finished.catch(() => {}))) })
      const windows = page.locator('.source-window')
      const opened = page.locator(`.source-window[data-binding-id="${mark.id}"]`)
      await page.mouse.move(mark.x, mark.y)
      await expect(opened).toHaveAttribute('data-source-window-mode', 'preview')
      await expect(opened.locator('iframe[data-video-fallback="provider"]')).toHaveCount(1)
      await page.touchscreen.tap(422, 307)
      await expect(opened).toHaveAttribute('data-source-window-mode', 'primary')
      const aperture = opened.locator('.provider-video-scroll')
      const r = (await aperture.boundingBox())!
      const idle = { x: r.x + r.width / 2, y: r.y + r.height / 2 }
      // A direct move into a child browsing context sends pointerover to the
      // parent iframe, but pointermove only to its document.
      await page.mouse.move(idle.x, idle.y)
      await page.mouse.wheel(0, 135)
      await expect.poll(() => aperture.evaluate(el => el.scrollTop)).toBeGreaterThan(0)
      await opened.locator('.source-window__close').tap()
      await page.evaluate(() => new Promise<void>(resolve => requestAnimationFrame(() => requestAnimationFrame(() => resolve()))))
      await expect(windows).toHaveCount(0)
      // Dismissal is not a permanent hover lockout, including the exact idle spot.
      await page.mouse.move(1, 1)
      await page.mouse.move(idle.x, idle.y)
      const uncovered = page.locator('.source-window[data-binding-id="binding-hero-rounded-hair-and-eye-fragment-traili"]')
      await expect(uncovered).toHaveAttribute('data-source-window-mode', 'preview')
      await uncovered.locator('.source-window__close').tap()
      await expect(windows).toHaveCount(0)
      await page.touchscreen.tap(mark.x, mark.y)
      await expect(opened).toHaveAttribute('data-source-window-mode', 'preview')
      await page.touchscreen.tap(422, 307)
      await expect(opened).toHaveAttribute('data-source-window-mode', 'primary')
      await opened.locator('.source-window__close').tap()
      await expect(windows).toHaveCount(0)
      await page.locator(`button.artifact[aria-label="${mark.id.includes('pale-angular') ? 'Pale angular cuff enclosing a brown fold and wine-red shadow' : 'Curled dark lining flap with illustrated figures, white dots and colored flecks'}"]`).focus()
      await expect(opened).toHaveAttribute('data-source-window-mode', 'preview')
      await page.keyboard.press('Enter')
      await expect(opened).toHaveAttribute('data-source-window-mode', 'primary')
    } finally { await context.close() }
  })
}
