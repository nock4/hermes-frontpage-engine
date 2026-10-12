import fs from 'node:fs'
import path from 'node:path'
import { createHash } from 'node:crypto'
import { expect, test, type Page } from '@playwright/test'

// Only committed edition geometry + deterministic raster bytes; no unpublished candidate.
// Routes change served bindings, never production verification or eligibility gates.
const edition = '2026-09-28-the-edge-outlasts-the-day-v1'
const base = `/editions/${edition}`
const bytes = fs.readFileSync(path.join(process.cwd(), 'tests/ux/fixtures/original-raster.png'))
const hash = createHash('sha256').update(bytes).digest('hex')
const delivery = {
  version: 1, kind: 'attested-full-original', edition_id: edition,
  source_url: 'https://www.artic.edu/artworks/fixture',
  media_url: 'https://media.example.test/original.png',
  capture_sha256: hash, byte_length: bytes.length, mime_type: 'image/png',
  asset_path: `${base}/assets/source-originals/${hash}.png`,
}
const title = 'Living Sculpture | The Art Institute of Chicago'
const data = JSON.parse(fs.readFileSync(path.join(process.cwd(), 'public', base, 'source-bindings.json'), 'utf8'))
data.bindings = data.bindings.map((b: { id: string; artifact_id: string }) => ({
  id: b.id, artifact_id: b.artifact_id, source_type: 'web', window_type: 'web',
  source_url: delivery.source_url, source_image_url: delivery.media_url,
  source_media_type: 'image', source_media_url: delivery.media_url,
  source_image_delivery: delivery, title: 'Editorial label', source_title: title,
  kicker: 'artic.edu', excerpt: 'Deterministic original fixture', playback_persistence: false,
  hover_behavior: 'preview', click_behavior: 'pin-open', fallback_type: 'rich-preview',
}))
const binding = data.bindings[0]
const artifacts = JSON.parse(fs.readFileSync(path.join(process.cwd(), 'public', base, 'artifact-map.json'), 'utf8'))
const artifactIndex = artifacts.artifacts.findIndex((a: { id: string }) => a.id === binding.artifact_id)
if (artifactIndex < 0) throw new Error('Committed fixture binding must have an artifact')

async function fixture(page: Page, fault?: 'tampered-bytes' | 'local-placeholder' | 'stale-source') {
  const changed = structuredClone(data)
  if (fault === 'local-placeholder') changed.bindings[0].source_image_delivery.asset_path = `${base}/assets/plate.png`
  if (fault === 'stale-source') changed.bindings[0].source_url = 'https://example.test/different-source'
  await page.route(`**${base}/source-bindings.json`, route => route.fulfill({ json: changed }))
  const servedBytes = Buffer.from(bytes)
  if (fault === 'tampered-bytes') servedBytes[servedBytes.length - 1] ^= 1
  await page.route(`**${delivery.asset_path}`, route => route.fulfill({ contentType: delivery.mime_type, body: servedBytes }))
  await page.route(delivery.media_url, route => route.abort('blockedbyclient'))
}

test.use({ bypassCSP: false })

for (const viewport of [{ width: 1440, height: 980 }, { width: 390, height: 844 }, { width: 852, height: 393 }]) {
  test(`attested full original preloads and renders with remote blocked at ${viewport.width}`, async ({ page }, testInfo) => {
    await page.setViewportSize(viewport)
    await fixture(page)
    await page.goto(`/?edition=${edition}`)
    await expect(page.locator('.stage-overlay-windows--live .source-window')).toHaveCount(0)
    const preload = page.locator(`img.embed-preload-image[src="${delivery.asset_path}"]`).first()
    await expect(preload).toBeAttached()
    await preload.evaluate((img: HTMLImageElement) => img.decode())
    expect(await preload.evaluate((img: HTMLImageElement) => [img.naturalWidth, img.naturalHeight])).toEqual([256, 128])
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
      expect(await image.evaluate((img: HTMLImageElement) => [img.naturalWidth, img.naturalHeight])).toEqual([256, 128])
      if (mode === 'preview') {
        const edge = surface.locator('.visual-source-card__edge-title')
        await expect.soft(edge).toBeVisible()
        await expect.soft(edge).toHaveText(title)
        await surface.evaluate(async node => { await Promise.all(node.getAnimations({ subtree: true }).filter(a => a.effect?.getTiming().iterations !== Infinity).map(a => a.finished)) })
        const r = await edge.boundingBox(), media = await image.boundingBox()
        expect.soft(r?.height).toBeGreaterThan(12)
        if (r && media) {
          expect(r.height).toBeLessThan(media.height / 4)
          expect(r.y + r.height).toBeLessThanOrEqual(viewport.height)
          expect(r.x).toBeGreaterThanOrEqual(0)
          expect(r.x + r.width).toBeLessThanOrEqual(viewport.width)
        }
        await testInfo.attach('preview-title', { body: await surface.screenshot({ path: testInfo.outputPath(`preview-${viewport.width}.png`) }), contentType: 'image/png' })
      } else await expect(surface.locator(`a[href="${binding.source_url}"]`).first()).toBeVisible()
    }
    await testInfo.attach('packaged-original', { body: await page.screenshot(), contentType: 'image/png' })
    await surface.locator('.source-window__close').click()
    await expect(surface).toHaveCount(0)
  })
}

for (const fault of ['tampered-bytes', 'local-placeholder', 'stale-source'] as const) {
  test(`production loader fails closed for ${fault}`, async ({ page }) => {
    await fixture(page, fault)
    await page.goto(`/?edition=${edition}`)
    await expect(page.locator('main')).toContainText(fault === 'tampered-bytes' ? 'Original image delivery: integrity mismatch' : 'Original image delivery: invalid identity')
    await expect(page.locator('button.artifact, .embed-preload-image, .source-window')).toHaveCount(0)
  })
}
