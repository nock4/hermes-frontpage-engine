import fs from 'node:fs'
import path from 'node:path'
import { expect, test } from '@playwright/test'

// These exact published surfaces exposed a false green: the window rectangle
// fit, but its overflow-hidden body cut off both the image and the edge title.
for (const viewport of [{ width: 375, height: 667 }, { width: 393, height: 852 }, { width: 360, height: 740 }, { width: 852, height: 393 }]) {
  for (const source of [{ id: 'module-color-node', label: 'Color Node' }, { id: 'module-field-marker', label: 'Field Marker' }]) {
    test(`Sept28 focused preview keeps ${source.label} whole at ${viewport.width}px`, async ({ page }, testInfo) => {
      await page.setViewportSize(viewport)
      await page.goto('/?edition=2026-09-28-the-edge-outlasts-the-day-v1')
      await page.getByRole('button', { name: source.label, exact: true }).focus()
      const surface = page.locator(`.stage-overlay-windows--live .source-window[data-artifact-id="${source.id}"]`)
      await expect(surface).toHaveAttribute('data-source-window-mode', 'preview')
      await expect(surface.locator('.visual-source-card__image')).toBeVisible()
      await surface.locator('.visual-source-card__image').evaluate(async (media) => {
        if (media instanceof HTMLImageElement) await media.decode()
      })
      await page.waitForTimeout(2500)
      const geometry = await surface.evaluate(node => {
        const card = node.querySelector('.visual-source-card')!
        const figure = card.querySelector('.visual-source-card__figure')!
        const title = card.querySelector('.visual-source-card__edge-title')!
        const rect = (element: Element) => element.getBoundingClientRect().toJSON()
        const clippingAncestors = []
        for (let ancestor = title.parentElement; ancestor; ancestor = ancestor.parentElement) {
          const style = getComputedStyle(ancestor)
          if (/(hidden|clip|auto|scroll)/.test(style.overflowY) || style.clipPath !== 'none') clippingAncestors.push({ className: ancestor.className, rect: rect(ancestor), clipPath: style.clipPath })
        }
        return { surface: rect(node), body: rect(node.querySelector('.source-window__body')!), card: rect(card), figure: rect(figure), title: rect(title), clippingAncestors, inlineStyle: node.getAttribute('style') }
      })
      const proofRoot = process.env.DFE_FOCUS_QA_DIR || testInfo.outputPath('focus-proof')
      fs.mkdirSync(proofRoot, { recursive: true })
      const stem = path.join(proofRoot, `${viewport.width}-${source.id}`)
      fs.writeFileSync(`${stem}.json`, JSON.stringify(geometry, null, 2))
      await page.screenshot({ path: `${stem}.png` })
      await testInfo.attach('focused-preview', { path: `${stem}.png`, contentType: 'image/png' })
      expect(geometry.surface.top).toBeGreaterThanOrEqual(0)
      expect(geometry.surface.bottom).toBeLessThanOrEqual(viewport.height)
      expect(geometry.title.width).toBeGreaterThan(64)
      expect(geometry.title.height).toBeGreaterThan(12)
      expect(geometry.title.top).toBeGreaterThanOrEqual(geometry.figure.bottom - 1)
      for (const part of [geometry.figure, geometry.title]) {
        expect.soft(part.bottom, 'content must fit inside the actual body, not only the viewport').toBeLessThanOrEqual(geometry.body.bottom + 1)
        expect.soft(part.bottom).toBeLessThanOrEqual(viewport.height)
        expect.soft(part.right).toBeLessThanOrEqual(viewport.width)
        for (const ancestor of geometry.clippingAncestors) {
          expect.soft(part.bottom, `content clipped by ${ancestor.className}`).toBeLessThanOrEqual(ancestor.rect.bottom + 1)
        }
      }
    })
  }
}

// Provider classes must not opt out of the common mobile visual-card aperture.
for (const viewport of [{ width: 375, height: 667 }, { width: 852, height: 393 }]) {
  test(`primary video and image surfaces share readable mobile geometry ${viewport.width}`, async ({ page }) => {
    await page.setViewportSize(viewport)
    await page.goto('/')
    await page.waitForSelector('.stage')
    for (const variant of ['tweet-embed-native source-window--bleed-embed', 'rich-preview-stage source-window--poster-window', 'rich-preview-stage']) {
      await page.locator('.stage').evaluate((stage, provider) => {
        const surface = document.createElement('div')
        surface.className = `source-window source-window--stage source-window--primary source-window--${provider}`
        surface.innerHTML = `<div class="source-window__body source-window__body--visual-card"><div class="visual-source-card" data-has-source-visual="true" data-source-visual-mode="raw"><div class="visual-source-card__figure"><video class="visual-source-card__image visual-source-card__video"></video></div><div class="visual-source-card__caption"><strong class="visual-source-card__title">${'A long source title with concrete image provenance '.repeat(6)}</strong></div></div></div>`
        stage.querySelectorAll('.source-window').forEach(node => node.remove())
        stage.append(surface)
        surface.getAnimations({ subtree: true }).forEach(animation => animation.finish())
      }, variant)
      const geometry = await page.locator('.source-window').evaluate(node => {
        const title = node.querySelector('.visual-source-card__title')!
        const figure = node.querySelector('.visual-source-card__figure')!
        return { surface: node.getBoundingClientRect().toJSON(), title: title.getBoundingClientRect().toJSON(), figure: figure.getBoundingClientRect().toJSON(), writingMode: getComputedStyle(title).writingMode }
      })
      expect(geometry.surface.bottom).toBeLessThanOrEqual(viewport.height)
      expect(geometry.title.top).toBeGreaterThanOrEqual(geometry.figure.bottom - 1)
      expect(geometry.title.bottom).toBeLessThanOrEqual(viewport.height)
      expect(geometry.title.width).toBeGreaterThan(64)
      expect(geometry.title.right).toBeLessThanOrEqual(geometry.surface.right)
      expect(geometry.figure.right).toBeLessThanOrEqual(geometry.surface.right)
      expect(geometry.writingMode).toBe('horizontal-tb')
    }
    // Native YouTube playback must fit with its own caption; thumbnail metadata
    // must never force replacement of the primary iframe with a still image.
    await page.locator('.stage').evaluate(stage => {
      stage.querySelectorAll('.source-window').forEach(node => node.remove())
      const surface = document.createElement('div')
      surface.className = 'source-window source-window--stage source-window--primary source-window--embedded-media-bare source-window--bleed-embed'
      surface.innerHTML = '<div class="source-window__body source-window__body--video"><iframe title="Native player" src="about:blank"></iframe><strong class="source-window__media-title">Ambient music from forgotten CDs</strong></div>'
      stage.append(surface)
      surface.getAnimations({ subtree: true }).forEach(animation => animation.finish())
    })
    const native = await page.locator('.source-window').evaluate(node => ({
      title: node.querySelector('.source-window__media-title')!.getBoundingClientRect().toJSON(),
      player: node.querySelector('iframe')!.getBoundingClientRect().toJSON(),
    }))
    expect(native.title.top).toBeGreaterThanOrEqual(native.player.bottom - 1)
    expect(native.title.bottom).toBeLessThanOrEqual(viewport.height)
    expect(native.title.width).toBeGreaterThan(64)
    expect(native.player.height).toBeGreaterThan(100)
  })
}
