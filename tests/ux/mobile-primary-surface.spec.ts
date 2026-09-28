import { expect, test } from '@playwright/test'

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
