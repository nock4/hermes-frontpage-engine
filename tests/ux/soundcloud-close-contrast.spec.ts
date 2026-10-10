import { expect, test } from '@playwright/test'

for (const viewport of [{ width: 375, height: 667 }, { width: 852, height: 393 }, { width: 1440, height: 900 }]) {
  test(`SoundCloud primary close separates from provider artwork at ${viewport.width}`, async ({ page }) => {
    await page.setViewportSize(viewport)
    // Inject a stable native-audio binding into the current edition; keep the real runtime/CSS.
    await page.route('**/source-bindings.json', async route => {
      const response = await route.fetch()
      const data = await response.json()
      data.bindings[0] = {
        ...data.bindings[0], source_type: 'audio', window_type: 'audio',
        source_url: 'https://soundcloud.com/ashra-official/ocean-of-tenderness',
        embed_status: undefined, source_embed_html: undefined,
      }
      await route.fulfill({ response, json: data })
    })
    await page.route('https://w.soundcloud.com/**', route => route.fulfill({ contentType: 'text/html', body: '<button>Play</button>' }))
    await page.goto('/', { waitUntil: 'domcontentloaded' })
    const artifact = page.locator('button.artifact').first()
    await artifact.focus()
    await artifact.press('Enter')
    const surface = page.locator('.stage-overlay-windows--live .source-window[data-source-window-kind="soundcloud-embed"][data-source-window-mode="primary"]')
    await expect(surface).toBeVisible()
    const close = surface.locator('.source-window__close')
    const style = await close.evaluate(el => {
      const s = getComputedStyle(el)
      const components = s.backgroundColor.match(/[\d.]+/g)!.map(Number)
      return { alpha: components.length === 4 ? components[3] : 1, color: s.color }
    })
    // A translucent 4%-white chip allows provider letters to cross the cream ×.
    expect(style.alpha).toBeGreaterThanOrEqual(0.9)
    await close.click()
    await expect(surface).toHaveCount(0)
  })
}
