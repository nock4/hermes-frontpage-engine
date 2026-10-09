import { expect, test, type Locator } from '@playwright/test'

const proofRoot = 'tmp/interaction-lab-proof'

// Mesh polygons can overlap or exclude their bounding-box center. Prove an
// actual hit on this mark before each gesture; never bypass actionability.
async function activateMark(target: Locator, mobile: boolean, gesture: string) {
  const geometry = await target.evaluate((node) => {
    const rect = node.getBoundingClientRect()
    const steps = [0.5, 0.35, 0.65, 0.2, 0.8, 0.1, 0.9]
    const owner = (x: number, y: number) => document.elementFromPoint(x, y)?.closest('[data-interaction-lab-artifact]')?.getAttribute('data-interaction-lab-artifact')
    const id = node.getAttribute('data-interaction-lab-artifact')
    const points = steps.flatMap((x) => steps.map((y) => ({ x: rect.width * x, y: rect.height * y })))
    return {
      id,
      rect: rect.toJSON(),
      centerOwner: owner(rect.left + rect.width / 2, rect.top + rect.height / 2),
      point: points.find(({ x, y }) => owner(rect.left + x, rect.top + y) === id),
    }
  })
  await test.info().attach(`${gesture}-${geometry.id}-hit`, { body: JSON.stringify(geometry, null, 2), contentType: 'application/json' })
  expect(geometry.point, `${geometry.id} must have a real reachable hit point`).toBeDefined()
  if (mobile) await target.tap({ position: geometry.point! })
  else await target.click({ position: geometry.point! })
}

for (const device of [
  { name: 'desktop', width: 1440, height: 980, mobile: false },
  { name: 'mobile', width: 390, height: 844, mobile: true },
]) {
  test(`all local verbs, source handoff, and reduced motion work on ${device.name}`, async ({ browser }) => {
    const baseURL = test.info().project.use.baseURL as string
    const context = await browser.newContext({
      baseURL,
      viewport: { width: device.width, height: device.height },
      hasTouch: device.mobile,
      isMobile: device.mobile,
      reducedMotion: 'reduce',
    })
    const page = await context.newPage()
    await page.goto('/', { waitUntil: 'domcontentloaded' })
    await page.waitForSelector('img.plate')
    await expect(page.locator('[data-interaction-lab]')).toHaveCount(0)
    await page.screenshot({ path: `${proofRoot}/baseline-${device.name}.png`, fullPage: true })

    await page.goto('/?interaction-lab=1', { waitUntil: 'domcontentloaded' })
    await page.waitForSelector('[data-interaction-lab-artifact]')
    await expect(page.locator('[data-interaction-lab-artifact]')).toHaveCount(6)
    await expect(page.locator('.interaction-lab__trail')).toBeVisible()

    const materialStyles = await page.locator('.interaction-lab__visual').evaluateAll((nodes) => nodes.map((node) => (node as HTMLElement).style.getPropertyValue('--lab-material')))
    expect(materialStyles.every((value) => !/https?:|^url\(["']?\/\//i.test(value))).toBe(true)

    const first = page.locator('[data-interaction-lab-artifact]').first()
    await page.keyboard.press('Tab')
    await first.focus()
    expect(await first.evaluate((node) => getComputedStyle(node.querySelector('.interaction-lab__visual')!, '::after').borderTopWidth)).not.toBe('0px')
    await first.evaluate((node) => (node as HTMLElement).blur())
    expect(await first.evaluate((node) => getComputedStyle(node.querySelector('.interaction-lab__visual')!, '::after').borderTopWidth)).toBe('0px')

    const marks = page.locator('[data-interaction-lab-artifact]')
    for (let index = 0; index < 6; index += 1) {
      const target = marks.nth(index)
      const verb = await target.getAttribute('data-verb')
      await expect(target).toHaveAttribute('data-lab-revealed', 'false')
      await activateMark(target, device.mobile, 'reveal')
      await expect(target).toHaveAttribute('data-lab-revealed', 'true')
      await expect(page.locator('.source-window')).toHaveCount(0)
      const motion = await target.evaluate((node) => {
        const visual = node.querySelector('.interaction-lab__visual')!
        const wash = node.querySelector('.interaction-lab__wash')
        return {
          materialTransition: getComputedStyle(visual.querySelector('.interaction-lab__material')!).transitionDuration,
          washAnimation: wash ? getComputedStyle(wash).animationName : 'none',
        }
      })
      expect(motion.materialTransition).toBe('0s')
      expect(motion.washAnimation).toBe('none')
      await expect(page.locator('.interaction-lab__trail-item')).toHaveCount(index + 1)
      await page.screenshot({ path: `${proofRoot}/${index}-${verb}-${device.name}.png`, fullPage: true })
    }

    await expect(page.locator('.interaction-lab__wash')).toHaveCount(2)
    for (const wash of await page.locator('[data-interaction-lab-artifact][data-verb="wash"]').all()) {
      expect(await wash.locator('.interaction-lab__wash').boundingBox()).toEqual(await wash.locator('.interaction-lab__visual').boundingBox())
    }
    await expect(page.locator('.interaction-lab__trail-item')).toHaveCount(6)

    const editionId = await page.locator('main[data-edition-id]').getAttribute('data-edition-id')
    const response = await context.request.get(`/editions/${editionId}/source-bindings.json`)
    expect(response.ok()).toBe(true)
    const { bindings } = await response.json() as { bindings: { id: string; artifact_id: string }[] }
    for (let index = 0; index < 6; index += 1) {
      const target = marks.nth(index)
      const artifactId = await target.getAttribute('data-interaction-lab-artifact')
      const binding = bindings.find((item) => item.artifact_id === artifactId)
      expect(binding).toBeDefined()
      await activateMark(target, device.mobile, 'source')
      const surface = page.locator('.source-window[data-source-window-mode="primary"]')
      await expect(surface).toHaveCount(1)
      await expect(surface).toHaveAttribute('data-binding-id', binding!.id)
      await expect(page.locator('.interaction-lab__trail-item')).toHaveCount(6)
      await page.screenshot({ path: `${proofRoot}/source-window-${index}-${device.name}.png`, fullPage: true })
      const close = surface.locator('.source-window__close')
      if (device.mobile) await close.tap()
      else await close.click()
      await expect(page.locator('.source-window')).toHaveCount(0)
    }

    const geometry = await page.evaluate(() => ({ width: innerWidth, scrollWidth: document.documentElement.scrollWidth, debug: document.querySelectorAll('.interaction-lab__debug, .interaction-lab__hotspot-outline').length }))
    expect(geometry.scrollWidth).toBeLessThanOrEqual(geometry.width + 1)
    expect(geometry.debug).toBe(0)
    await context.close()
  })
}

test('mobile encounter trail does not intercept an overlapping source mark', async ({ browser }) => {
  const baseURL = test.info().project.use.baseURL as string
  const context = await browser.newContext({
    baseURL,
    viewport: { width: 390, height: 844 },
    hasTouch: true,
    isMobile: true,
    reducedMotion: 'reduce',
  })
  const page = await context.newPage()
  await page.goto('/?interaction-lab=1', { waitUntil: 'domcontentloaded' })
  const marks = page.locator('[data-interaction-lab-artifact]')
  await expect(marks).toHaveCount(6)
  for (let index = 0; index < 6; index += 1) {
    await activateMark(marks.nth(index), true, `overlap-reveal-${index}`)
  }

  const overlap = await page.locator('[data-interaction-lab-artifact="module-compressed-incision-seam"]').evaluate((node) => {
    const rect = node.getBoundingClientRect()
    const trail = document.querySelector('.interaction-lab__trail')!.getBoundingClientRect()
    const id = node.getAttribute('data-interaction-lab-artifact')
    const steps = [0.5, 0.35, 0.65, 0.2, 0.8, 0.1, 0.9]
    const candidates = steps.flatMap((x) => steps.map((y) => ({
      x: rect.left + rect.width * x,
      y: rect.top + rect.height * y,
    }))).filter(({ x, y }) => x >= trail.left && x <= trail.right && y >= trail.top && y <= trail.bottom)
    const point = candidates.find(({ x, y }) => document.elementsFromPoint(x, y).includes(node))
    return point ? {
      point,
      owner: document.elementFromPoint(point.x, point.y)?.closest('[data-interaction-lab-artifact]')?.getAttribute('data-interaction-lab-artifact') ?? null,
      topClass: document.elementFromPoint(point.x, point.y)?.className ?? null,
    } : null
  })

  expect(overlap, 'fixture must overlap the expanded encounter trail').not.toBeNull()
  expect(overlap?.owner, `trail intercepted the source mark via ${overlap?.topClass}`).toBe('module-compressed-incision-seam')
  await context.close()
})

test('hydrates a persisted encounter before saving trail state', async ({ page, request }) => {
  const response = await request.get('/editions/index.json')
  expect(response.ok()).toBe(true)
  const manifest = await response.json()
  expect(manifest.current_edition_id).toEqual(expect.any(String))
  const storageKey = `daily-frontpage:interaction-lab:v1:${manifest.current_edition_id}`
  const persisted = [{
    artifactId: 'artifact-hero-01',
    sourceUrl: 'https://example.com/persisted',
    sourceTitle: 'Persisted encounter',
    order: 1,
    discoveredAt: 42,
  }]
  await page.addInitScript(({ trail, key }) => {
    window.localStorage.setItem(key, JSON.stringify({ version: 1, trail }))
    const writes: string[] = []
    const originalSetItem = Storage.prototype.setItem
    Storage.prototype.setItem = function setItem(key, value) {
      if (key.startsWith('daily-frontpage:interaction-lab:')) writes.push(value)
      return originalSetItem.call(this, key, value)
    }
    Object.assign(window, { __interactionLabStorageWrites: writes })
  }, { trail: persisted, key: storageKey })
  await page.goto('/?interaction-lab=1', { waitUntil: 'domcontentloaded' })
  await expect(page.locator('.interaction-lab__trail-item')).toContainText('Persisted encounter')
  expect(await page.evaluate((key) => JSON.parse(window.localStorage.getItem(key) || '{}').trail, storageKey)).toEqual(persisted)
  expect(await page.evaluate(() => (window as typeof window & { __interactionLabStorageWrites: string[] }).__interactionLabStorageWrites)).not.toContain(JSON.stringify({ version: 1, trail: [] }))
})
