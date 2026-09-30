import { expect, test } from '@playwright/test'

for (const [width, height, artifactId] of [
  [375, 667, 'module-foreground-violet-flower-spikes'],
  [852, 393, 'module-pink-flowers-at-the-right-bank-tip'],
] as const) {
  test(`provider preview ${width}px dismisses on the first close tap without promoting`, async ({ browser, baseURL }) => {
    const page = await browser.newPage({ baseURL, viewport: { width, height }, isMobile: true, hasTouch: true })
    try {
      await page.route('https://video.twimg.com/**', route => route.fulfill({ status: 403, body: 'Forbidden' }))
      // Deterministic cross-origin provider document; actual playback is verified separately.
      await page.route('https://platform.twitter.com/embed/Tweet.html?**', route => route.fulfill({
        contentType: 'text/html', body: '<div style="height:400px">Full source post</div><button style="width:100%;height:150px" onclick="this.textContent=\'Playing\'">Play</button>',
      }))
      await page.goto('/?edition=2026-09-30-where-the-water-turns-v1')
      await page.waitForSelector('button.artifact')
      const artifacts = await (await page.request.get('/editions/2026-09-30-where-the-water-turns-v1/artifact-map.json')).json()
      const index = artifacts.artifacts.findIndex((a: { id: string }) => a.id === artifactId)
      const point = await page.locator('button.artifact').nth(index).evaluate(e => {
        const r = e.getBoundingClientRect()
        for (let a = .05; a < 1; a += .05) for (let b = .05; b < 1; b += .05) {
          const x = r.x + r.width * a, y = r.y + r.height * b, hit = document.elementFromPoint(x, y)
          if (hit === e || e.contains(hit)) return { x, y }
        }
        return null
      })
      expect(point).not.toBeNull()
      await page.touchscreen.tap(point!.x, point!.y)
      const win = page.locator(`.source-window[data-artifact-id="${artifactId}"]`)
      await expect(win).toHaveAttribute('data-source-window-mode', 'preview')
      const play = win.frameLocator('iframe[data-video-fallback="provider"]').getByRole('button', { name: 'Play' })
      await play.tap()
      await expect(win.frameLocator('iframe').getByRole('button', { name: 'Playing' })).toBeVisible()
      await win.locator('.source-window__close').tap()
      await expect(win).toHaveCount(0)
    } finally {
      await page.close()
    }
  })
}


for (const viewport of [{ width: 390, height: 844 }, { width: 852, height: 393 }]) {
test(`denied direct video ${viewport.width}px switches to the canonical provider, not a dead player`, async ({ page }) => {
  await page.setViewportSize(viewport)
  await page.route('**/source-bindings.json', async route => {
    const response = await route.fetch()
    const data = await response.json()
    for (const binding of data.bindings) Object.assign(binding, {
      source_type: 'tweet', window_type: 'social', source_url: 'https://x.com/akiraxtwo/status/2048486473490678173',
      source_media_type: 'video', source_media_url: 'https://video.twimg.com/denied-test.mp4',
    })
    await route.fulfill({ response, json: data })
  })
  await page.route('https://video.twimg.com/denied-test.mp4', route => route.fulfill({ status: 403, body: 'Forbidden' }))
  await page.goto('/')
  await page.waitForSelector('button.artifact')
  const point = await page.locator('button.artifact').evaluateAll(nodes => {
    for (const node of nodes) {
      const r = node.getBoundingClientRect()
      for (let a = .1; a < 1; a += .1) for (let b = .1; b < 1; b += .1) {
        const x = r.x + r.width * a, y = r.y + r.height * b
        const hit = document.elementFromPoint(x, y)
        if (hit === node || node.contains(hit)) return { x, y }
      }
    }
    return null
  })
  expect(point).not.toBeNull()
  await page.mouse.click(point!.x, point!.y)
  await expect(page.locator('.source-window [data-video-fallback="provider"]')).toBeVisible()
  const scroll = page.locator('.source-window .provider-video-scroll')
  await expect(scroll).toBeVisible()
  expect(await scroll.evaluate(el => getComputedStyle(el).overflowY)).toBe('auto')
  expect(await scroll.evaluate(el => el.scrollHeight > el.clientHeight)).toBe(true)
  await expect(page.locator('.source-window a[href="https://x.com/akiraxtwo/status/2048486473490678173"]').first()).toBeVisible()
  await expect(page.locator('.source-window video')).toHaveCount(0)
  await expect(page.locator('.source-window [data-video-fallback="provider"]')).toHaveAttribute('src', /platform.twitter.com\/embed\/Tweet.html.*2048486473490678173/)
})

}
