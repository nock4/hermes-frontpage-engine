import fs from 'node:fs'
import path from 'node:path'
import { expect, test } from '@playwright/test'

// Exercise the real production loader and packaged capture, never an eligibility bypass.
const edition = '2026-10-12-paint-gives-way-to-air-v1'
const base = `/editions/${edition}`
const data = JSON.parse(fs.readFileSync(path.join(process.cwd(), 'public', base, 'source-bindings.json'), 'utf8'))
const binding = data.bindings.find((b: { source_image_delivery?: unknown }) => b.source_image_delivery)
if (!binding) throw new Error('Packaged-original regression requires its attested fixture')
const delivery = binding.source_image_delivery
const artifacts = JSON.parse(fs.readFileSync(path.join(process.cwd(), 'public', base, 'artifact-map.json'), 'utf8'))
const artifactIndex = artifacts.artifacts.findIndex((a: { id: string }) => a.id === binding.artifact_id)

test.use({ bypassCSP: false })

for (const viewport of [{ width: 1440, height: 980 }, { width: 852, height: 393 }]) {
  test(`attested full original preloads and renders with remote blocked at ${viewport.width}`, async ({ page }, testInfo) => {
    await page.setViewportSize(viewport)
    const remoteRequests: string[] = []
    for (const b of data.bindings) {
      if (b.source_image_delivery) await page.route(b.source_image_delivery.media_url, route => {
        remoteRequests.push(route.request().url())
        return route.abort('blockedbyclient')
      })
    }
    await page.goto(`/?edition=${edition}`)
    const preload = page.locator(`img.embed-preload-image[src="${delivery.asset_path}"]`)
    await expect(preload).toHaveCount(1)
    await preload.evaluate((img: HTMLImageElement) => img.decode())
    expect(await preload.evaluate((img: HTMLImageElement) => img.naturalWidth)).toBeGreaterThan(100)
    const artifact = page.locator('button.artifact').nth(artifactIndex)
    await artifact.focus()
    const surface = page.locator(`.stage-overlay-windows--live .source-window[data-binding-id="${binding.id}"]`)
    for (const mode of ['preview', 'primary']) {
      if (mode === 'primary') await artifact.press('Enter')
      await expect(surface).toHaveAttribute('data-source-window-mode', mode)
      const image = surface.locator('.visual-source-card__image')
      await expect(image).toHaveAttribute('src', delivery.asset_path)
      await expect(image).toHaveCSS('object-fit', 'contain')
      await image.evaluate((img: HTMLImageElement) => img.decode())
      expect(await image.evaluate((img: HTMLImageElement) => img.naturalWidth)).toBeGreaterThan(100)
      if (mode === 'primary') await expect(surface.locator(`a[href="${binding.source_url}"]`).first()).toBeVisible()
    }
    // Other warmup paths may attempt canonical URLs; every such request is
    // aborted above. Rendering and the DOM preload must still use local bytes.
    await testInfo.attach('blocked-original-requests', { body: JSON.stringify(remoteRequests), contentType: 'application/json' })
    await testInfo.attach('packaged-original', { body: await page.screenshot(), contentType: 'image/png' })
  })
}

for (const fault of ['tampered-bytes', 'local-placeholder', 'stale-source'] as const) {
  test(`production loader fails closed for ${fault}`, async ({ page }) => {
    if (fault === 'tampered-bytes') {
      const bytes = fs.readFileSync(path.join(process.cwd(), 'public', delivery.asset_path))
      bytes[bytes.length - 1] ^= 1
      await page.route(`**${delivery.asset_path}`, route => route.fulfill({ contentType: delivery.mime_type, body: bytes }))
    } else {
      await page.route(`**${base}/source-bindings.json`, route => {
        const changed = structuredClone(data)
        const target = changed.bindings.find((b: { id: string }) => b.id === binding.id)
        if (fault === 'local-placeholder') target.source_image_delivery.asset_path = `${base}/assets/plate.png`
        else target.source_url = 'https://example.test/different-source'
        return route.fulfill({ json: changed })
      })
    }
    await page.goto(`/?edition=${edition}`)
    await expect(page.locator('main')).toContainText(fault === 'tampered-bytes' ? 'Original image delivery: integrity mismatch' : 'Original image delivery: invalid identity')
    await expect(page.locator('button.artifact, .embed-preload-image, .source-window')).toHaveCount(0)
  })
}
