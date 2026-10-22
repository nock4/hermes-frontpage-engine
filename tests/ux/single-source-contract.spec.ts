import { expect, test } from '@playwright/test'
import fs from 'node:fs'

// Browser-only reduced archive fixture: no generation or archive mutation.
const edition = '2026-10-21-the-grip-leaves-a-gap-v1'
const base = `public/editions/${edition}`
const bindings = JSON.parse(fs.readFileSync(`${base}/source-bindings.json`, 'utf8'))
const map = JSON.parse(fs.readFileSync(`${base}/artifact-map.json`, 'utf8'))
const binding = bindings.bindings[0]
const artifact = map.artifacts.find((a: { id: string }) => a.id === binding.artifact_id)

for (const viewport of [{ width: 1440, height: 980 }, { width: 393, height: 852 }]) {
  test(`one independently owned source opens without chrome or clipping at ${viewport.width}`, async ({ page }, info) => {
    await page.setViewportSize(viewport)
    await page.route(`**/${edition}/edition.json`, async route => {
      const response = await route.fetch()
      await route.fulfill({ response, json: { ...await response.json(), date: '2026-10-22' } })
    })
    await page.route(`**/${edition}/artifact-map.json`, route => route.fulfill({ json: {
      ...map, artifacts: [artifact], default_artifact_id: artifact.id,
    } }))
    await page.route(`**/${edition}/source-bindings.json`, route => route.fulfill({ json: { ...bindings, bindings: [binding] } }))
    await page.goto(`/?edition=${edition}`)
    await expect(page.locator('button.artifact')).toHaveCount(1)
    await page.locator('img.plate').evaluate((img: HTMLImageElement) => img.decode())
    await expect(page.locator('.runtime-topbar, .side-rail, .artifact-lists')).toHaveCount(0)
    // Actual invisible mark hit, not a synthetic source-window event.
    const point = await page.locator('button.artifact').evaluate(node => {
      const r = node.getBoundingClientRect()
      for (const x of [.5, .35, .65, .2, .8]) for (const y of [.5, .35, .65, .2, .8]) {
        const p = { x: r.x + r.width * x, y: r.y + r.height * y }
        const hit = document.elementFromPoint(p.x, p.y)
        if (hit === node || node.contains(hit)) return p
      }
      return null
    })
    expect(point).not.toBeNull()
    await page.mouse.click(point!.x, point!.y)
    const window = page.locator('.stage-overlay-windows--live .source-window')
    await expect(window).toHaveCount(1)
    await page.waitForTimeout(450)
    const rect = await window.boundingBox()
    expect(rect!.width).toBeGreaterThanOrEqual(240)
    expect(rect!.x).toBeGreaterThanOrEqual(-1)
    expect(rect!.y).toBeGreaterThanOrEqual(-1)
    expect(rect!.x + rect!.width).toBeLessThanOrEqual(viewport.width + 1)
    expect(rect!.y + rect!.height).toBeLessThanOrEqual(viewport.height + 1)
    await expect(window.locator('img, video, iframe').first()).toBeVisible()
    await expect(window.locator('.source-window__close')).toBeVisible()
    await info.attach('single-source-window', { body: await page.screenshot(), contentType: 'image/png' })
  })
}
