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

  const artifactHitPoints = await page.locator('button.artifact').evaluateAll((nodes) => nodes.flatMap((node) => {
    const element = node as HTMLElement
    const rect = element.getBoundingClientRect()
    const xSteps = [0.5, 0.35, 0.65, 0.2, 0.8]
    const ySteps = [0.5, 0.35, 0.65, 0.2, 0.8]
    const points: { x: number, y: number }[] = []

    for (const xStep of xSteps) {
      for (const yStep of ySteps) {
        const x = rect.left + rect.width * xStep
        const y = rect.top + rect.height * yStep
        const hit = document.elementFromPoint(x, y)
        if (hit === element || element.contains(hit)) {
          points.push({ x, y })
        }
      }
    }

    return points
  }))

  expect(artifactHitPoints.length).toBeGreaterThan(0)

  for (const point of artifactHitPoints) {
    await page.mouse.move(point.x, point.y)
    const openWindows = await page.locator('.stage-overlay-windows--live .source-window').count()
    if (openWindows > 0) break
  }

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

for (const { audioOnly, clickDelay } of [
  { audioOnly: false, clickDelay: 0 },
  { audioOnly: true, clickDelay: 0 },
  { audioOnly: false, clickDelay: 150 },
]) {
  test(`generated edition clicks keep ${audioOnly ? 'audio ' : ''}source surfaces in the plate instead of opening linkout chrome${clickDelay ? ' with delayed pointer delivery' : ''}`, async ({ page }) => {
    const route = process.env.DFE_SMOKE_ROUTE || '/'

    if (audioOnly) {
      // Exercise consecutive audio pins even when today's first sources are visual.
      // Keep real artifact geometry/media; only vary the window-manager category.
      await page.route('**/source-bindings.json', async (request) => {
        const response = await request.fetch()
        const payload = await response.json()
        for (const binding of payload.bindings) {
          binding.window_type = 'audio'
          binding.playback_persistence = true
        }
        await request.fulfill({ json: payload })
      })
    }

    await page.goto(route, { waitUntil: 'domcontentloaded' })
    await page.waitForSelector('img.plate', { timeout: 20_000 })
    await page.waitForSelector('button.artifact', { timeout: 20_000 })

    const findClickableArtifactPoint = async (openedArtifactIndexes: number[]) => page.locator('button.artifact').evaluateAll((nodes, openedIndexes) => {
      const opened = new Set(openedIndexes)
      const xSteps = [0.5, 0.35, 0.65, 0.2, 0.8]
      const ySteps = [0.5, 0.35, 0.65, 0.2, 0.8]

      for (const [index, node] of nodes.entries()) {
        if (opened.has(index)) continue

        const element = node as HTMLElement
        const rect = element.getBoundingClientRect()
        if (rect.width <= 0 || rect.height <= 0) continue

        for (const xStep of xSteps) {
          for (const yStep of ySteps) {
            const x = rect.left + rect.width * xStep
            const y = rect.top + rect.height * yStep
            const hit = document.elementFromPoint(x, y)
            if (hit === element || element.contains(hit)) return { index, x, y }
          }
        }
      }

      return null
    }, openedArtifactIndexes)

    let popupOpened = false
    page.once('popup', async (popup) => {
      popupOpened = true
      await popup.close().catch(() => undefined)
    })

    const openWindows = page.locator('.stage-overlay-windows--live .source-window')
    const openedArtifactIndexes = new Set<number>()

    for (let attempt = 0; attempt < 2; attempt += 1) {
      // The opening bloom initially exposes points that its iframe later covers.
      // Settle finite entrance animations before sampling real hit territories.
      await openWindows.evaluateAll(async (nodes) => {
        await Promise.all(nodes.flatMap((node) => node.getAnimations({ subtree: true }))
          .filter((animation) => animation.effect?.getTiming().iterations !== Infinity)
          .map((animation) => animation.finished.catch(() => undefined)))
      })
      const point = await findClickableArtifactPoint([...openedArtifactIndexes])
      expect(point).not.toBeNull()
      if (!point) break

      // Regress the discovery-to-delivery race without forced clicks or retries.
      if (attempt > 0 && clickDelay) await page.waitForTimeout(clickDelay)
      await page.mouse.click(point.x, point.y)
      openedArtifactIndexes.add(point.index)
      await expect(openWindows).toHaveCount(openedArtifactIndexes.size)
    }

    expect(openedArtifactIndexes.size).toBe(2)
    await expect(openWindows).toHaveCount(2)
    await expect(page.locator('.stage-overlay-windows--live .source-window[data-source-window-mode="primary"]')).toHaveCount(1)
    await expect(page.locator('.stage-overlay-windows--live .source-window[data-source-window-mode="secondary"]')).toHaveCount(1)
    expect(popupOpened).toBe(false)
  })
}
