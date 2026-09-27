import { expect, test } from '@playwright/test'

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
