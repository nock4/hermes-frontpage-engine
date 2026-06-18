import { expect, test } from '@playwright/test'

test('generated edition route renders artwork and opens a source window', async ({ page }) => {
  const route = process.env.DFE_SMOKE_ROUTE || '/'

  await page.goto(route, { waitUntil: 'domcontentloaded' })
  await page.waitForSelector('img.plate', { timeout: 20_000 })
  await page.waitForSelector('button.artifact', { timeout: 20_000 })

  const plateState = await page.locator('img.plate').evaluate((node) => {
    const image = node as HTMLImageElement
    return {
      complete: image.complete,
      naturalWidth: image.naturalWidth,
      naturalHeight: image.naturalHeight,
    }
  })

  expect(plateState.complete).toBe(true)
  expect(plateState.naturalWidth).toBeGreaterThan(0)
  expect(plateState.naturalHeight).toBeGreaterThan(0)

  const artifactCount = await page.locator('button.artifact').count()
  expect(artifactCount).toBeGreaterThanOrEqual(6)

  const stageState = await page.evaluate(() => {
    const visibleDebugChrome = Array.from(document.querySelectorAll('.artifact span, .window-dock:not(.window-dock--stage), .side-rail, .runtime-topbar')).filter((node) => {
      const element = node as HTMLElement
      const rect = element.getBoundingClientRect()
      const style = window.getComputedStyle(element)
      return style.display !== 'none' && style.visibility !== 'hidden' && Number(style.opacity || '1') > 0.01 && rect.width > 0 && rect.height > 0
    }).length
    return { documentWidth: document.documentElement.scrollWidth, viewportWidth: window.innerWidth, visibleDebugChrome }
  })

  expect(stageState.documentWidth).toBeLessThanOrEqual(stageState.viewportWidth + 1)
  expect(stageState.visibleDebugChrome).toBe(0)

  await page.locator('button.artifact').first().hover({ force: true })
  await expect(page.locator('.stage-overlay-windows--live .source-window')).toHaveCount(1)
  await page.waitForTimeout(450)

  const windowState = await page.locator('.stage-overlay-windows--live .source-window').first().evaluate((node) => {
    const rect = node.getBoundingClientRect()
    const body = node.querySelector('.source-window__body')
    const bodyRect = body?.getBoundingClientRect()
    const readableRect = bodyRect && bodyRect.width > rect.width ? bodyRect : rect
    const media = Array.from(node.querySelectorAll('img, iframe, video')).some((element) => {
      const mediaRect = element.getBoundingClientRect()
      return mediaRect.width >= 80 && mediaRect.height >= 80
    })
    const close = node.querySelector('.source-window__close')
    const closeRect = close?.getBoundingClientRect()
    return {
      clipped: readableRect.left < -1 || readableRect.top < -1 || readableRect.right > window.innerWidth + 1 || readableRect.bottom > window.innerHeight + 1,
      width: readableRect.width,
      hasMedia: media,
      hasReadableText: (node.textContent || '').replace(/\s+/g, ' ').trim().length >= 12,
      hasReachableClose: Boolean(closeRect
        && closeRect.width >= 28
        && closeRect.height >= 28
        && closeRect.left >= -1
        && closeRect.top >= -1
        && closeRect.right <= window.innerWidth + 1
        && closeRect.bottom <= window.innerHeight + 1),
    }
  })

  expect(windowState.clipped).toBe(false)
  expect(windowState.width).toBeGreaterThanOrEqual(240)
  expect(windowState.hasReachableClose).toBe(true)
  expect(windowState.hasMedia || windowState.hasReadableText).toBe(true)
})
