import { expect, test } from '@playwright/test'

const proofRoot = 'tmp/interaction-lab-proof'
const verbs = ['material', 'contour', 'wash'] as const

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

    for (const verb of verbs) {
      const target = page.locator(`[data-interaction-lab-artifact][data-verb="${verb}"]`).first()
      if (device.mobile) await target.tap()
      else await target.click()
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
      await page.screenshot({ path: `${proofRoot}/${verb}-${device.name}.png`, fullPage: true })
    }

    expect(await page.locator('.interaction-lab__wash').count()).toBe(1)
    const washBox = await page.locator('.interaction-lab__wash').boundingBox()
    const washVisualBox = await page.locator('[data-verb="wash"].is-revealed .interaction-lab__visual').boundingBox()
    expect(washBox).toEqual(washVisualBox)
    await expect(page.locator('.interaction-lab__trail-item')).toHaveCount(3)

    const material = page.locator('[data-interaction-lab-artifact][data-verb="material"]').first()
    if (device.mobile) await material.tap()
    else await material.click()
    await expect(page.locator('.source-window[data-source-window-mode="primary"]')).toHaveCount(1)
    await page.screenshot({ path: `${proofRoot}/source-window-${device.name}.png`, fullPage: true })

    const geometry = await page.evaluate(() => ({ width: innerWidth, scrollWidth: document.documentElement.scrollWidth, debug: document.querySelectorAll('.interaction-lab__debug, .interaction-lab__hotspot-outline').length }))
    expect(geometry.scrollWidth).toBeLessThanOrEqual(geometry.width + 1)
    expect(geometry.debug).toBe(0)
    await context.close()
  })
}

test('hydrates a persisted encounter before saving trail state', async ({ page }) => {
  const persisted = [{
    artifactId: 'artifact-hero-01',
    sourceUrl: 'https://example.com/persisted',
    sourceTitle: 'Persisted encounter',
    order: 1,
    discoveredAt: 42,
  }]
  await page.addInitScript((trail) => {
    window.localStorage.setItem('daily-frontpage:interaction-lab:v1:2026-10-02-a-pulse-inside-the-opening-v1', JSON.stringify({ version: 1, trail }))
    const writes: string[] = []
    const originalSetItem = Storage.prototype.setItem
    Storage.prototype.setItem = function setItem(key, value) {
      if (key.startsWith('daily-frontpage:interaction-lab:')) writes.push(value)
      return originalSetItem.call(this, key, value)
    }
    Object.assign(window, { __interactionLabStorageWrites: writes })
  }, persisted)
  await page.goto('/?interaction-lab=1', { waitUntil: 'domcontentloaded' })
  await expect(page.locator('.interaction-lab__trail-item')).toContainText('Persisted encounter')
  expect(await page.evaluate(() => JSON.parse(window.localStorage.getItem('daily-frontpage:interaction-lab:v1:2026-10-02-a-pulse-inside-the-opening-v1') || '{}').trail)).toEqual(persisted)
  expect(await page.evaluate(() => (window as typeof window & { __interactionLabStorageWrites: string[] }).__interactionLabStorageWrites)).not.toContain(JSON.stringify({ version: 1, trail: [] }))
})
