import { expect, test } from '@playwright/test'

for (const viewport of [{ width: 375, height: 667 }, { width: 852, height: 393 }]) {
  for (const mode of ['preview', 'primary']) {
    test(`SoundCloud ${mode} source footer has readable contrast at ${viewport.width}`, async ({ page }, testInfo) => {
      await page.setViewportSize(viewport)
      await page.route('**/source-bindings.json', async route => {
        const response = await route.fetch()
        const data = await response.json()
        data.bindings[0] = {
          ...data.bindings[0], source_type: 'audio', window_type: 'audio',
          source_url: 'https://soundcloud.com/ashra-official/ocean-of-tenderness',
          title: 'Ocean of Tenderness', source_title: 'Ocean of Tenderness',
          embed_status: undefined, source_embed_html: undefined,
        }
        await route.fulfill({ response, json: data })
      })
      await page.route('https://w.soundcloud.com/**', route => route.fulfill({
        contentType: 'text/html',
        body: '<html style="background:#333;color:white"><body><h1>Ocean of Tenderness</h1><button>Play</button></body></html>',
      }))
      await page.goto('/', { waitUntil: 'domcontentloaded' })
      const artifact = page.locator('button.artifact').first()
      await artifact.focus()
      if (mode === 'primary') await artifact.press('Enter')
      const surface = page.locator('.stage-overlay-windows--live .source-window[data-source-window-kind="soundcloud-embed"]')
      await expect(surface).toHaveAttribute('data-source-window-mode', mode)
      await surface.evaluate(async el => {
        await Promise.all(el.getAnimations({ subtree: true }).filter(a => a.effect?.getTiming().iterations !== Infinity).map(a => a.finished))
      })
      await expect(surface.frameLocator('iframe').getByRole('button', { name: 'Play' })).toBeVisible()
      const footer = surface.getByRole('link', { name: 'Open track source' })
      await expect(footer).toBeVisible()
      const footerPixels = (await footer.screenshot()).toString('base64')
      const contrast = await footer.evaluate(async (el, pixels) => {
        const rgba = (value: string) => {
          const values = value.match(/[\d.]+/g)!.map(Number)
          return [...values.slice(0, 3), values[3] ?? 1]
        }
        const luminance = (rgb: number[]) => rgb.map(c => c / 255).map(c => c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4).reduce((sum, c, i) => sum + c * [0.2126, 0.7152, 0.0722][i], 0)
        // Sample the empty right-hand footer padding, not an assumed ancestor
        // color: the preview backing is translucent over a gradient and plate.
        const image = new Image()
        image.src = `data:image/png;base64,${pixels}`
        await image.decode()
        const canvas = document.createElement('canvas')
        canvas.width = image.width
        canvas.height = image.height
        const ctx = canvas.getContext('2d')!
        ctx.drawImage(image, 0, 0)
        const bg = Array.from(ctx.getImageData(image.width - 8, Math.floor(image.height / 2), 1, 1).data).slice(0, 3)
        const style = getComputedStyle(el)
        const text = rgba(style.color)
        const fg = text.slice(0, 3).map((c, i) => c * text[3] + bg[i] * (1 - text[3]))
        const a = luminance(fg), b = luminance(bg)
        return {
          color: style.color, background: style.backgroundColor, paintedBackground: bg,
          ratio: (Math.max(a, b) + 0.05) / (Math.min(a, b) + 0.05),
        }
      }, footerPixels)
      console.log(JSON.stringify({ viewport, mode, contrast }))
      await testInfo.attach('footer-contrast', { body: JSON.stringify(contrast, null, 2), contentType: 'application/json' })
      await page.screenshot({ path: testInfo.outputPath(`${viewport.width}-${mode}.png`) })
      expect(contrast.ratio).toBeGreaterThanOrEqual(4.5)
      const media = await surface.locator('iframe').boundingBox()
      const shell = await surface.boundingBox()
      expect(media!.width * media!.height / (shell!.width * shell!.height)).toBeGreaterThan(0.6)
      await expect(footer).toHaveAttribute('href', 'https://soundcloud.com/ashra-official/ocean-of-tenderness')
    })
  }
}

for (const viewport of [{ width: 375, height: 667 }, { width: 852, height: 393 }, { width: 1440, height: 900 }]) {
  test(`SoundCloud primary close separates from provider artwork at ${viewport.width}`, async ({ page }) => {
    await page.setViewportSize(viewport)
    // Inject a stable native-audio binding into the current edition; keep the real runtime/CSS.
    await page.route('**/source-bindings.json', async route => {
      const response = await route.fetch()
      const data = await response.json()
      data.bindings[0] = {
        ...data.bindings[0], source_type: 'audio', window_type: 'audio',
        source_url: 'https://soundcloud.com/ashra-official/ocean-of-tenderness',
        embed_status: undefined, source_embed_html: undefined,
      }
      await route.fulfill({ response, json: data })
    })
    await page.route('https://w.soundcloud.com/**', route => route.fulfill({ contentType: 'text/html', body: '<button>Play</button>' }))
    await page.goto('/', { waitUntil: 'domcontentloaded' })
    const artifact = page.locator('button.artifact').first()
    await artifact.focus()
    await artifact.press('Enter')
    const surface = page.locator('.stage-overlay-windows--live .source-window[data-source-window-kind="soundcloud-embed"][data-source-window-mode="primary"]')
    await expect(surface).toBeVisible()
    const close = surface.locator('.source-window__close')
    const style = await close.evaluate(el => {
      const s = getComputedStyle(el)
      const components = s.backgroundColor.match(/[\d.]+/g)!.map(Number)
      return { alpha: components.length === 4 ? components[3] : 1, color: s.color }
    })
    // A translucent 4%-white chip allows provider letters to cross the cream ×.
    expect(style.alpha).toBeGreaterThanOrEqual(0.9)
    await close.click()
    await expect(surface).toHaveCount(0)
  })
}
