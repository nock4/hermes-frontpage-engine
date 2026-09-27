import fs from 'node:fs'
import path from 'node:path'
import { expect, test } from '@playwright/test'

// A larger mesh's convex outline must not swallow a nested source mark.
// Reproduce the Sept 27 crossing pillar/sequence-notch overlap on any edition.
for (const width of [375, 852]) {
  test(`nested source mark survives overlapping hover mesh at ${width}px`, async ({ page }) => {
    const manifest = JSON.parse(fs.readFileSync('public/editions/index.json', 'utf8'))
    const edition = manifest.editions.find((item: { edition_id: string }) => item.edition_id === manifest.current_edition_id)
    const map = JSON.parse(fs.readFileSync(path.join('public', edition.path, 'artifact-map.json'), 'utf8'))
    const bindings = JSON.parse(fs.readFileSync(path.join('public', edition.path, 'source-bindings.json'), 'utf8')).bindings
    const binding = bindings[0]
    const target = map.artifacts.find((item: { id: string }) => item.id === binding.artifact_id)
    const blocker = map.artifacts.find((item: { id: string }) => item.id !== binding.artifact_id)
    for (const artifact of map.artifacts) {
      artifact.bounds = { x: 0.8, y: 0.8, w: 0.1, h: 0.1 }
      artifact.polygon = [[0.8, 0.8], [0.9, 0.8], [0.9, 0.9], [0.8, 0.9]]
      delete artifact.interaction_mesh
    }
    target.bounds = { x: 0.32, y: 0.52, w: 0.1, h: 0.29 }
    target.polygon = [[0.32, 0.52], [0.42, 0.52], [0.42, 0.81], [0.32, 0.81]]
    target.z_index = 10
    blocker.bounds = { x: 0.3, y: 0.5, w: 0.3, h: 0.32 }
    blocker.polygon = [[0.3, 0.5], [0.6, 0.5], [0.6, 0.82], [0.3, 0.82]]
    blocker.z_index = 20
    await page.route('**/artifact-map.json', route => route.fulfill({ json: map }))
    await page.setViewportSize({ width, height: width === 375 ? 667 : 393 })
    await page.goto('/')
    const button = page.getByRole('button', { name: target.label, exact: true })
    await expect(button).toBeVisible()
    const point = await button.evaluate(node => {
      const rect = node.getBoundingClientRect()
      const x = rect.x + rect.width / 2
      const y = rect.y + rect.height / 2
      return { x, y, reachable: document.elementFromPoint(x, y) === node }
    })
    expect(point.reachable).toBe(true)
    await page.mouse.click(point.x, point.y)
    await expect(page.locator(`.stage-overlay-windows--live .source-window[data-binding-id="${binding.id}"]`)).toHaveAttribute('data-source-window-mode', 'primary')
  })
}
