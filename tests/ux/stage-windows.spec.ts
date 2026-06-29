import { expect, test, type Locator, type Page } from '@playwright/test'

import { expectStableVisual } from './visual'

const stageWindows = (page: Page) => page.locator('.stage-overlay-windows--live .source-window')
const iframeMask = (page: Page): Locator[] => [page.locator('iframe')]

async function gotoEdition(page: Page, route: string) {
  await page.goto(route, { waitUntil: 'domcontentloaded' })
  await page.waitForSelector('button.artifact', { timeout: 15_000 })
}

async function clickArtifactByIndex(page: Page, index: number) {
  await page.locator('button.artifact').nth(index).click({ force: true })
  await page.waitForTimeout(500)
}

async function expectLiveMasksInvisible(page: Page) {
  const spanVisibility = await page.locator('.artifact span').evaluateAll((nodes) =>
    nodes.map((node) => {
      const style = window.getComputedStyle(node)
      return style.display === 'none' || style.visibility === 'hidden' || Number(style.opacity) === 0
    }),
  )
  expect(spanVisibility.every(Boolean)).toBe(true)

  const artifactStyle = await page.locator('button.artifact').first().evaluate((node) => {
    const style = window.getComputedStyle(node)
    return {
      borderTopColor: style.borderTopColor,
      boxShadow: style.boxShadow,
    }
  })
  expect(artifactStyle.borderTopColor).toBe('rgba(0, 0, 0, 0)')
  expect(artifactStyle.boxShadow).toBe('none')
}

test.describe('live-stage window UX baselines', () => {
  test('night observatory untouched live state', async ({ page }) => {
    await gotoEdition(page, '/archive/night-observatory-v1')

    await expect(stageWindows(page)).toHaveCount(0)
    await expectStableVisual(page, 'night-observatory-live-rest')
  })

  test('night observatory one hero window open', async ({ page }) => {
    await gotoEdition(page, '/archive/night-observatory-v1')
    await clickArtifactByIndex(page, 0)

    await expect(stageWindows(page)).toHaveCount(1)
    await expectStableVisual(page, 'night-observatory-one-window', { mask: iframeMask(page) })
  })

  test('night observatory two-window stack', async ({ page }) => {
    await gotoEdition(page, '/archive/night-observatory-v1')
    await clickArtifactByIndex(page, 0)
    await clickArtifactByIndex(page, 1)

    await expect(stageWindows(page)).toHaveCount(2)
    await expectStableVisual(page, 'night-observatory-two-windows', { mask: iframeMask(page) })
  })

  test('night observatory article click links out instead of pinning a second stage card', async ({ page }) => {
    await gotoEdition(page, '/archive/night-observatory-v1')
    await clickArtifactByIndex(page, 0)

    const popupPromise = page.waitForEvent('popup')
    await page.locator('button.artifact').nth(2).click({ force: true })
    const popup = await popupPromise
    await popup.waitForLoadState('domcontentloaded')

    await expect(stageWindows(page)).toHaveCount(1)
    await expect(popup).toHaveURL(/skymaponline\.net/)
    await popup.close()
  })

  test('night observatory frontmost focus swap', async ({ page }) => {
    await gotoEdition(page, '/archive/night-observatory-v1')
    await clickArtifactByIndex(page, 0)
    await clickArtifactByIndex(page, 1)
    await stageWindows(page).nth(0).click({ force: true })
    await page.waitForTimeout(300)

    await expect(stageWindows(page)).toHaveCount(2)
    await expectStableVisual(page, 'night-observatory-focus-swap', { mask: iframeMask(page) })
  })

  test('forest listening table two youtube windows stacked', async ({ page }) => {
    await gotoEdition(page, '/archive/forest-listening-table-v1')
    await clickArtifactByIndex(page, 0)
    await clickArtifactByIndex(page, 2)

    await expect(stageWindows(page)).toHaveCount(2)
    await expect(page.locator('iframe')).toHaveCount(2)
    await expectStableVisual(page, 'forest-listening-table-two-youtube-windows', { mask: iframeMask(page) })
  })

  test('forest listening table preloads youtube embeds before visible open', async ({ page }) => {
    await gotoEdition(page, '/archive/forest-listening-table-v1')

    await expect(stageWindows(page)).toHaveCount(0)
    const preloadCount = await page.locator('.embed-preload-layer iframe[data-embed-preload-kind="youtube"]').count()
    expect(preloadCount).toBeGreaterThan(0)
  })

  test('forest breath cabinet preloads only youtube URLs that are marked embeddable before visible open', async ({ page }) => {
    await gotoEdition(page, '/archive/forest-breath-cabinet-v2')

    await expect(stageWindows(page)).toHaveCount(0)
    const youtubePreloads = page.locator('.embed-preload-layer iframe[data-embed-preload-kind="youtube"]')
    await expect(youtubePreloads).toHaveCount(5)

    const preloadState = await youtubePreloads.evaluateAll((nodes) => nodes.map((node) => ({
      src: node.getAttribute('src'),
      loading: node.getAttribute('loading'),
      title: node.getAttribute('title'),
    })))

    expect(preloadState.every((entry) => entry.src?.includes('youtube.com/embed/'))).toBe(true)
    expect(preloadState.every((entry) => entry.src?.includes('playsinline=1'))).toBe(true)
    expect(preloadState.every((entry) => entry.loading === 'eager')).toBe(true)
    expect(preloadState.every((entry) => Boolean(entry.title))).toBe(true)
    expect(preloadState.some((entry) => entry.src?.includes('YEgmpe8nToU'))).toBe(false)
    expect(preloadState.some((entry) => entry.src?.includes('t2Qrb2aZYUQ'))).toBe(false)
    expect(preloadState.some((entry) => entry.src?.includes('IrHS2-ptrTE'))).toBe(false)
  })

  test('forest breath cabinet vitrine hover preview uses the screen-rendered enhancement instead of raw signal tuning', async ({ page }) => {
    await gotoEdition(page, '/archive/forest-breath-cabinet-v2')

    await page.getByRole('button', { name: 'Central Habitat Vitrine' }).hover({ force: true })
    await page.waitForTimeout(500)

    await expect(stageWindows(page)).toHaveCount(1)
    const screenWindow = page.locator('.stage-overlay-windows--live .source-window')
    await expect(screenWindow).toHaveClass(/source-window--enhancement-screen-rendered/)
    await expect(page.locator('.stage-overlay-windows--live .source-window__body--screen-preview')).toHaveCount(1)
    await expect(page.locator('.stage-overlay-windows--live .source-window__screen-preview-title')).toContainText("Late '90s / Early '00s Japanese Ambient Techno and Electronica Mix")
    await expect(page.locator('.stage-overlay-windows--live .source-window__body--video-signal')).toHaveCount(0)
    await expect(page.locator('.stage-overlay-windows--live .source-window__screen-preview-scanlines')).toHaveCount(0)
    await expect(page.locator('.stage-overlay-windows--live .source-window__screen-preview-vignette')).toHaveCount(0)
    await expect(page.locator('.stage-overlay-windows--live .source-window__screen-preview-glow')).toHaveCount(0)

    const pseudoState = await screenWindow.evaluate((node) => ({
      beforeContent: window.getComputedStyle(node, '::before').content,
      afterContent: window.getComputedStyle(node, '::after').content,
    }))
    expect(pseudoState.beforeContent).toBe('none')
    expect(pseudoState.afterContent).toBe('none')
  })

  test('signal greenhouse youtube hover preview uses signal-tuning treatment without a container shell', async ({ page }) => {
    await gotoEdition(page, '/archive/signal-greenhouse-bench-v1')

    await page.getByRole('button', { name: 'Upper-left seed envelope' }).hover({ force: true })
    await page.waitForTimeout(500)

    await expect(stageWindows(page)).toHaveCount(1)
    await expect(page.locator('.stage-overlay-windows--live .source-window')).toHaveClass(/source-window--signal-tuning-video/)
    await expect(page.locator('.stage-overlay-windows--live .source-window__body--video-signal')).toHaveCount(1)
    await expect(page.locator('.stage-overlay-windows--live .source-window__floating-actions')).toHaveCount(0)
    await expect(page.locator('.stage-overlay-windows--live .source-window__signal-video-play')).toHaveCount(1)

    const tuningShell = await page.locator('.stage-overlay-windows--live .source-window').evaluate((node) => {
      const style = window.getComputedStyle(node)
      const beforeStyle = window.getComputedStyle(node, '::before')
      const afterStyle = window.getComputedStyle(node, '::after')
      const rect = node.getBoundingClientRect()
      const mediaRect = node.querySelector('.source-window__signal-video-shell')?.getBoundingClientRect()
      return {
        beforeContent: beforeStyle.content,
        afterContent: afterStyle.content,
        background: style.backgroundImage,
        borderTopWidth: style.borderTopWidth,
        boxShadow: style.boxShadow,
        paddingTop: style.paddingTop,
        pointerEvents: style.pointerEvents,
        bottomFitsViewport: rect.bottom <= window.innerHeight,
        mediaBottomFitsViewport: mediaRect ? mediaRect.bottom <= window.innerHeight : false,
      }
    })

    expect(tuningShell.beforeContent).toBe('none')
    expect(tuningShell.afterContent).toBe('none')
    expect(tuningShell.background).toBe('none')
    expect(tuningShell.borderTopWidth).toBe('0px')
    expect(tuningShell.boxShadow).toBe('none')
    expect(tuningShell.paddingTop).toBe('0px')
    expect(tuningShell.pointerEvents).toBe('auto')
    expect(tuningShell.bottomFitsViewport).toBe(true)
    expect(tuningShell.mediaBottomFitsViewport).toBe(true)
  })

  test('signal greenhouse youtube preview itself is clickable and opens the in-site player', async ({ page }) => {
    await gotoEdition(page, '/archive/signal-greenhouse-bench-v1')

    await page.getByRole('button', { name: 'Upper-left seed envelope' }).hover({ force: true })
    await page.waitForTimeout(500)
    await page.locator('.stage-overlay-windows--live .source-window--signal-tuning-video').click({ force: true })
    await page.waitForTimeout(500)

    await expect(page.locator('.stage-overlay-windows--live .source-window iframe')).toHaveCount(1)
  })

  test('forest breath cabinet top-right about button unfurls the pipeline note', async ({ page }) => {
    await gotoEdition(page, '/archive/forest-breath-cabinet-v2')

    const aboutButton = page.getByRole('button', { name: 'About' })
    const aboutPanel = page.locator('#about-panel')

    await expect(aboutButton).toHaveAttribute('aria-expanded', 'false')
    await expect(aboutPanel).toBeHidden()

    await aboutButton.click()

    await expect(aboutButton).toHaveAttribute('aria-expanded', 'true')
    await expect(aboutPanel).toBeVisible()
    await expect(aboutPanel).toContainText('Content signals are collected in Obsidian first.')
    await expect(aboutPanel).toContainText('2026-04-23-forest-breath-cabinet-v2')
  })

  test('forest breath cabinet pinned youtube opens in a cabinet-native player shell', async ({ page }) => {
    await gotoEdition(page, '/archive/forest-breath-cabinet-v2')

    await page.getByRole('button', { name: 'Listening Point Placard' }).click({ force: true })
    await page.waitForTimeout(500)

    const pinnedWindow = page.locator('.stage-overlay-windows--live .source-window--primary')
    await expect(pinnedWindow).toHaveClass(/source-window--cabinet-player/)
    await expect(pinnedWindow.locator('.source-window__body--cabinet-player')).toHaveCount(1)
    await expect(pinnedWindow.locator('.source-window__cabinet-player-title')).toContainText('Get at the Wave')
    await expect(pinnedWindow.locator('.source-window__platform-pill')).toHaveCount(0)
    await expect(pinnedWindow.locator('iframe')).toHaveCount(1)

    const cabinetShell = await pinnedWindow.evaluate((node) => {
      const shell = node.querySelector('.source-window__cabinet-player')
      const frame = node.querySelector('.source-window__cabinet-player-frame')
      const plaque = node.querySelector('.source-window__cabinet-player-plaque')
      const style = window.getComputedStyle(node)
      const shellStyle = shell ? window.getComputedStyle(shell) : null
      const frameRect = frame?.getBoundingClientRect()
      const windowRect = node.getBoundingClientRect()
      const plaqueStyle = plaque ? window.getComputedStyle(plaque) : null
      return {
        borderTopWidth: style.borderTopWidth,
        shellBackgroundImage: shellStyle?.backgroundImage ?? null,
        shellBoxShadow: shellStyle?.boxShadow ?? null,
        frameFitsViewport: Boolean(frameRect) && frameRect!.right <= window.innerWidth && frameRect!.bottom <= window.innerHeight,
        frameWidthRatio: frameRect ? frameRect.width / windowRect.width : 0,
        plaqueBlend: plaqueStyle?.mixBlendMode ?? null,
      }
    })

    expect(cabinetShell.borderTopWidth).toBe('0px')
    expect(cabinetShell.shellBackgroundImage).toBe('none')
    expect(cabinetShell.shellBoxShadow).toBe('none')
    expect(cabinetShell.frameFitsViewport).toBe(true)
    expect(cabinetShell.frameWidthRatio).toBeGreaterThan(0.55)
    expect(cabinetShell.plaqueBlend).toBe('normal')
  })

  test('forest breath cabinet youtube URLs rejected by native embed use source-truth fallbacks', async ({ page }) => {
    const unavailableEmbeds = [
      ['Watershed Map Board', 'Takashi Kokubo - Oasis Of The Wind / Forest Of Ion', 'https://youtube.com/watch?v=YEgmpe8nToU'],
      ['Field Recordings Box', 'Takashi Kokubo - Tokyo: Noise Aesthetics', 'https://youtube.com/watch?v=t2Qrb2aZYUQ'],
      ['Open Leaf Study Book', 'Cultivation - A Northern Ashram Mix for Sounds Of The Dawn', 'https://youtube.com/watch?v=IrHS2-ptrTE'],
    ] as const

    for (const [artifactName, sourceTitle, sourceUrl] of unavailableEmbeds) {
      await gotoEdition(page, '/archive/forest-breath-cabinet-v2')
      await page.getByRole('button', { name: artifactName }).click({ force: true })
      await page.waitForTimeout(500)

      const pinnedWindow = page.locator('.stage-overlay-windows--live .source-window--primary')
      await expect(pinnedWindow).toHaveClass(/source-window--youtube-linkout/)
      await expect(pinnedWindow.locator('.source-window__body--youtube-linkout')).toHaveCount(1)
      await expect(pinnedWindow.locator('iframe')).toHaveCount(0)
      await expect(pinnedWindow.locator('.youtube-linkout__title')).toContainText(sourceTitle)
      await expect(pinnedWindow.locator('.youtube-linkout__cta')).toHaveAttribute('href', sourceUrl)

      const slabStyle = await pinnedWindow.evaluate((node) => {
        const style = window.getComputedStyle(node)
        return {
          backgroundImage: style.backgroundImage,
          backgroundColor: style.backgroundColor,
          boxShadow: style.boxShadow,
          borderTopWidth: style.borderTopWidth,
        }
      })

      expect(slabStyle.backgroundImage).toBe('none')
      expect(slabStyle.backgroundColor).toBe('rgba(0, 0, 0, 0)')
      expect(slabStyle.boxShadow).toBe('none')
      expect(slabStyle.borderTopWidth).toBe('0px')
    }
  })

  test('forest breath cabinet book youtube click opens an iframe instead of leaving a title-only preview', async ({ page }) => {
    await gotoEdition(page, '/archive/forest-breath-cabinet-v2')

    await page.getByRole('button', { name: 'Open Insect Study Book' }).click({ force: true })
    await page.waitForTimeout(500)

    const pinnedWindow = page.locator('.stage-overlay-windows--live .source-window--primary')
    await expect(pinnedWindow).toHaveCount(1)
    await expect(pinnedWindow.locator('.source-window__body--video')).toHaveCount(1)
    await expect(pinnedWindow.locator('iframe')).toHaveCount(1)
    await expect(pinnedWindow.locator('iframe')).toHaveAttribute('src', /oHkG-pMnbbI/)
    await expect(page.locator('.stage-overlay-windows--live .source-window--preview')).toHaveCount(0)
  })

  test('signal greenhouse hover preview uses cinematic text bloom for regen atlas source', async ({ page }) => {
    await gotoEdition(page, '/archive/signal-greenhouse-bench-v1')

    const artifact = page.getByRole('button', { name: 'Central hanging manuscript' })
    await artifact.hover({ force: true })
    await page.waitForTimeout(500)

    await expect(page.locator('.stage-overlay-windows--live .source-window')).toHaveClass(/source-window--text-bloom/)
    await expect(page.locator('.stage-overlay-windows--live .source-window')).toHaveClass(/source-window--click-out/)
    await expect(artifact).toHaveClass(/artifact--click-out/)
    await expect(page.locator('.stage-overlay-windows--live .text-bloom')).toHaveClass(/text-bloom--reveal-signal-feed/)
    await expect(page.locator('.stage-overlay-windows--live .text-bloom__threshold')).toHaveCount(2)
    await expect(page.locator('.stage-overlay-windows--live .text-bloom')).toHaveCount(1)
    await expect(page.locator('.stage-overlay-windows--live .text-bloom__title')).toContainText('Green Crypto Marketplace')
    await expect(page.locator('.stage-overlay-windows--live .text-bloom__outbound-cue')).toContainText('open ↗')
    await expect(page.locator('.stage-overlay-windows--live .text-bloom__image-cutout')).toHaveCount(1)
    await expect(page.locator('.stage-overlay-windows--live .text-bloom__domain')).toHaveCount(0)
    await expect(page.locator('.stage-overlay-windows--live .text-bloom__excerpt')).toHaveCount(0)
    await expect(page.locator('.stage-overlay-windows--live .source-window')).not.toContainText('Wed, 15 Apr 2026 09:22:09 GMT')
  })

  test('signal greenhouse hover preview wakes the surrounding scene instead of only the hovered module', async ({ page }) => {
    await gotoEdition(page, '/archive/signal-greenhouse-bench-v1')

    const anchorArtifact = page.getByRole('button', { name: 'Central hanging manuscript' })
    const nearbyArtifact = page.getByRole('button', { name: 'Upper-right clipped note' })
    await anchorArtifact.hover({ force: true })
    await page.waitForTimeout(500)

    await expect(page.locator('.stage')).toHaveClass(/stage--scene-reacting/)
    await expect(page.locator('.stage')).toHaveClass(/stage--scene-tone-reading/)
    await expect(anchorArtifact).toHaveClass(/artifact--scene-anchor/)
    await expect(nearbyArtifact).toHaveClass(/artifact--scene-reactive/)

    const nearbyStyle = await nearbyArtifact.evaluate((node) => {
      const style = window.getComputedStyle(node)
      return {
        opacity: Number(style.opacity),
        transform: style.transform,
        driftX: style.getPropertyValue('--scene-drift-x').trim(),
        driftY: style.getPropertyValue('--scene-drift-y').trim(),
      }
    })

    expect(nearbyStyle.opacity).toBeLessThan(1)
    expect(nearbyStyle.transform).not.toBe('none')
    expect(nearbyStyle.driftX).not.toBe('0rem')
    expect(nearbyStyle.driftY).not.toBe('0rem')
  })

  test('signal greenhouse article preview click opens the source instead of pinning a card on stage', async ({ page }) => {
    await gotoEdition(page, '/archive/signal-greenhouse-bench-v1')

    await page.getByRole('button', { name: 'Central hanging manuscript' }).hover({ force: true })
    await page.waitForTimeout(500)

    const popupPromise = page.waitForEvent('popup')
    await page.locator('.stage-overlay-windows--live .source-window--click-out').click({ force: true })
    const popup = await popupPromise
    await popup.waitForLoadState('domcontentloaded')

    await expect(page.locator('.stage-overlay-windows--live .source-window iframe')).toHaveCount(0)
    await expect(popup).toHaveURL(/regenatlas\.xyz/)
    await popup.close()
  })

  test('signal greenhouse hover preview avoids placeholder source card copy', async ({ page }) => {
    await gotoEdition(page, '/archive/signal-greenhouse-bench-v1')

    await page.getByRole('button', { name: 'Central hanging manuscript' }).hover({ force: true })
    await page.waitForTimeout(500)

    await expect(stageWindows(page)).toHaveCount(1)
    await expect(page.getByText('Central hanging manuscript is treated as a real visible scene artifact inside Signal Greenhouse Bench, not an invented dashboard hotspot.')).toHaveCount(0)
    await expect(page.locator('.stage-overlay-windows--live .text-bloom__title')).toContainText('Green Crypto Marketplace')
    await expect(page.locator('.stage-overlay-windows--live .source-window')).not.toContainText('Central hanging manuscript')
    await expect(page.locator('.stage-overlay-windows--live .source-window')).not.toContainText('Wed, 15 Apr 2026 09:22:09 GMT')
    await expect(page.locator('.stage-overlay-windows--live .rich-preview-card')).toHaveCount(0)
  })

  test('signal greenhouse hover preview uses extracted source framing for substack article', async ({ page }) => {
    await gotoEdition(page, '/archive/signal-greenhouse-bench-v1')

    await page.getByRole('button', { name: 'Lower-right plant tag' }).hover({ force: true })
    await page.waitForTimeout(500)

    await expect(stageWindows(page)).toHaveCount(1)
    await expect(page.locator('.stage-overlay-windows--live .text-bloom')).toHaveCount(1)
    await expect(page.locator('.stage-overlay-windows--live .text-bloom')).toHaveClass(/text-bloom--reveal-editorial-scan/)
    await expect(page.locator('.stage-overlay-windows--live .text-bloom__threshold')).toHaveCount(2)
    await expect(page.locator('.stage-overlay-windows--live .source-window__body')).toHaveClass(/source-window__body--text-bloom-editorial-note/)
    await expect(page.locator('.stage-overlay-windows--live .text-bloom__title')).toContainText('Tung Tung Tung Sahur’s sensonarrative power')
    await expect(page.locator('.stage-overlay-windows--live .text-bloom__image-cutout')).toHaveCount(1)
    await expect(page.locator('.stage-overlay-windows--live .text-bloom__domain')).toHaveCount(0)
    await expect(page.locator('.stage-overlay-windows--live .text-bloom__excerpt')).toHaveCount(0)
    await expect(page.locator('.stage-overlay-windows--live .source-window')).not.toContainText('ARTIFACT POCKET')
    await expect(page.locator('.stage-overlay-windows--live .source-window')).not.toContainText('Lower-right plant tag')
    await expect(page.locator('.stage-overlay-windows--live .source-window')).not.toContainText('2026-04-15T14:46:28+00:00')
  })

  test('signal greenhouse hover preview uses repo-slip framing for github source', async ({ page }) => {
    await gotoEdition(page, '/archive/signal-greenhouse-bench-v1')

    await page.getByRole('button', { name: 'Upper-right clipped note' }).hover({ force: true })
    await page.waitForTimeout(500)

    await expect(stageWindows(page)).toHaveCount(1)
    await expect(page.locator('.stage-overlay-windows--live .text-bloom')).toHaveCount(1)
    await expect(page.locator('.stage-overlay-windows--live .text-bloom')).toHaveClass(/text-bloom--reveal-repo-scan/)
    await expect(page.locator('.stage-overlay-windows--live .source-window__body')).toHaveClass(/source-window__body--text-bloom-repo-slip/)
    await expect(page.locator('.stage-overlay-windows--live .text-bloom__title')).toContainText('GitHub - Regen-Atlas/Regen-Atlas: Web3')
    await expect(page.locator('.stage-overlay-windows--live .source-window')).not.toContainText('Reload to refresh your session')
  })

  test('signal greenhouse live stage keeps masks invisible and social window source-native', async ({ page }) => {
    await gotoEdition(page, '/archive/signal-greenhouse-bench-v1')

    await expectLiveMasksInvisible(page)
    await page.getByRole('button', { name: 'Left potted plant' }).click({ force: true })
    await page.waitForTimeout(1000)

    await expect(stageWindows(page)).toHaveCount(1)
    await expectLiveMasksInvisible(page)
    await expect(page.getByText('Keep this window source-native. Show the post as a post-shaped object with provenance, not as a flattened content summary.')).toHaveCount(0)
    const socialMediaCount = await page.locator('.stage-overlay-windows--live .visual-source-card__image, .stage-overlay-windows--live .tweet-embed-frame').count()
    expect(socialMediaCount).toBeGreaterThanOrEqual(1)
    await expect(page.locator('.stage-overlay-windows--live .source-window')).not.toContainText('Open post ↗')
  })

  test('signal greenhouse preloads tweet embeds before visible open', async ({ page }) => {
    await gotoEdition(page, '/archive/signal-greenhouse-bench-v1')

    await expect(stageWindows(page)).toHaveCount(0)
    await expect(page.locator('.embed-preload-layer iframe[data-embed-preload-kind="tweet"]')).toHaveCount(1)
  })

  test('roller cipher tweet preview foregrounds tweet media when available', async ({ page }) => {
    await gotoEdition(page, '/archive/roller-cipher-chapel-v1')

    await page.getByRole('button', { name: 'Pinned diagonal line study' }).hover({ force: true })
    await page.waitForTimeout(500)

    await expect(page.locator('.stage-overlay-windows--live .visual-source-card__image')).toHaveCount(1)
    await expect(page.locator('.stage-overlay-windows--live .tweet-embed-frame')).toHaveCount(0)

    const imageSrc = await page.locator('.stage-overlay-windows--live .visual-source-card__image').getAttribute('src')
    expect(imageSrc).toContain('pbs.twimg.com/media/')
    expect(imageSrc).not.toContain('profile_images')
  })

  test('candle library preloads audio embeds before visible open', async ({ page }) => {
    await gotoEdition(page, '/archive/candle-library-altar-v1')

    await expect(stageWindows(page)).toHaveCount(0)
    await expect(page.locator('.embed-preload-layer iframe[data-embed-preload-kind="soundcloud"]')).toHaveCount(1)
  })

  test('current edition adds dynamic preconnects, dns-prefetch hints, and head preloads before visible open', async ({ page }) => {
    await gotoEdition(page, '/archive/signal-greenhouse-bench-v1')

    await expect(page.locator('head link[rel="preload"][href="/editions/index.json"][as="fetch"]')).toHaveCount(1)
    await expect(page.locator('head link[rel="preload"][href="/editions/2026-04-18-signal-greenhouse-bench-v1/source-bindings.json"][as="fetch"]')).toHaveCount(1)
    await expect(page.locator('head link[rel="preload"][href="/editions/2026-04-18-signal-greenhouse-bench-v1/edition.json"][as="fetch"]')).toHaveCount(1)
    await expect(page.locator('head link[rel="preload"][href="/editions/2026-04-18-signal-greenhouse-bench-v1/assets/plate.jpg"][as="image"]')).toHaveCount(1)
    await expect(page.locator('head link[rel="preload"][href="https://img.youtube.com/vi/7Ul_1yuxEVs/hqdefault.jpg"][as="image"]')).toHaveCount(1)

    await expect(page.locator('head link[rel="preconnect"][href="https://www.youtube.com"]')).toHaveCount(1)
    await expect(page.locator('head link[rel="preconnect"][href="https://platform.twitter.com"]')).toHaveCount(1)
    await expect(page.locator('head link[rel="preconnect"][href="https://regenatlas.xyz"]')).toHaveCount(1)
    await expect(page.locator('head link[rel="preconnect"][href="https://algofolk.substack.com"]')).toHaveCount(1)
    await expect(page.locator('head link[rel="dns-prefetch"][href="//www.youtube.com"]')).toHaveCount(1)
    await expect(page.locator('head link[rel="dns-prefetch"][href="//platform.twitter.com"]')).toHaveCount(1)
    await expect(page.locator('head link[rel="dns-prefetch"][href="//regenatlas.xyz"]')).toHaveCount(1)

    await expect(page.locator('head link[rel="preconnect"][href="https://w.soundcloud.com"]')).toHaveCount(0)
  })

  test('source-shaped title typography uses refined profile metrics', async ({ page }) => {
    await gotoEdition(page, '/archive/signal-greenhouse-bench-v1')

    await page.getByRole('button', { name: 'Lower-right plant tag' }).hover({ force: true })
    await page.waitForTimeout(500)

    const editorialMetrics = await page.locator('.stage-overlay-windows--live .text-bloom__title').evaluate((node) => {
      const style = window.getComputedStyle(node)
      return {
        fontFamily: style.fontFamily,
        fontWeight: style.fontWeight,
        opticalSizing: style.fontOpticalSizing,
        sizeVar: style.getPropertyValue('--rich-preview-title-size').trim(),
        lineHeightVar: style.getPropertyValue('--rich-preview-title-line-height').trim(),
        letterSpacingVar: style.getPropertyValue('--rich-preview-title-letter-spacing').trim(),
      }
    })

    expect(editorialMetrics.fontFamily).toContain('DFE Newsreader')
    expect(editorialMetrics.fontWeight).toBe('560')
    expect(editorialMetrics.opticalSizing).toBe('auto')
    expect(editorialMetrics.sizeVar).toBe('clamp(1.44rem, 1.08rem + .72vw, 1.9rem)')
    expect(editorialMetrics.lineHeightVar).toBe('1.08')
    expect(editorialMetrics.letterSpacingVar).toBe('-.028em')

    await page.getByRole('button', { name: 'Upper-right clipped note' }).hover({ force: true })
    await page.waitForTimeout(500)

    const technicalMetrics = await page.locator('.stage-overlay-windows--live .text-bloom__title').evaluate((node) => {
      const style = window.getComputedStyle(node)
      return {
        fontFamily: style.fontFamily,
        fontWeight: style.fontWeight,
        opticalSizing: style.fontOpticalSizing,
        sizeVar: style.getPropertyValue('--rich-preview-title-size').trim(),
        lineHeightVar: style.getPropertyValue('--rich-preview-title-line-height').trim(),
        letterSpacingVar: style.getPropertyValue('--rich-preview-title-letter-spacing').trim(),
      }
    })

    expect(technicalMetrics.fontFamily).toContain('DFE Mono')
    expect(technicalMetrics.fontWeight).toBe('600')
    expect(technicalMetrics.opticalSizing).toBe('auto')
    expect(technicalMetrics.sizeVar).toBe('clamp(.98rem, .9rem + .34vw, 1.2rem)')
    expect(technicalMetrics.lineHeightVar).toBe('1.12')
    expect(technicalMetrics.letterSpacingVar).toBe('-.014em')
  })

  test('signal-sans rich preview titles use refined profile metrics', async ({ page }) => {
    await gotoEdition(page, '/archive/candle-library-altar-v1')

    await page.getByRole('button', { name: 'Shelf candle' }).hover({ force: true })
    await page.waitForTimeout(500)

    const panelMetrics = await page.locator('.stage-overlay-windows--live .text-bloom__title').evaluate((node) => {
      const style = window.getComputedStyle(node)
      return {
        fontFamily: style.fontFamily,
        fontWeight: style.fontWeight,
        opticalSizing: style.fontOpticalSizing,
        sizeVar: style.getPropertyValue('--rich-preview-title-size').trim(),
        lineHeightVar: style.getPropertyValue('--rich-preview-title-line-height').trim(),
        letterSpacingVar: style.getPropertyValue('--rich-preview-title-letter-spacing').trim(),
      }
    })

    expect(panelMetrics.fontFamily).toContain('DFE Space Grotesk')
    expect(panelMetrics.fontWeight).toBe('650')
    expect(panelMetrics.opticalSizing).toBe('auto')
    expect(panelMetrics.sizeVar).toBe('clamp(1.38rem, 1.04rem + .66vw, 1.82rem)')
    expect(panelMetrics.lineHeightVar).toBe('1.09')
    expect(panelMetrics.letterSpacingVar).toBe('-.032em')
  })

  test('artifact-native title treatments change by source class', async ({ page }) => {
    await gotoEdition(page, '/archive/signal-greenhouse-bench-v1')

    await page.getByRole('button', { name: 'Lower-right plant tag' }).hover({ force: true })
    await page.waitForTimeout(500)
    await expect(page.locator('.stage-overlay-windows--live .text-bloom')).toHaveClass(/text-bloom--title-treatment-typeset/)

    const typesetMetrics = await page.locator('.stage-overlay-windows--live .text-bloom').evaluate((node) => {
      const style = window.getComputedStyle(node)
      return {
        titleFilterVar: style.getPropertyValue('--rich-preview-title-filter').trim(),
        titleTransformVar: style.getPropertyValue('--rich-preview-title-transform-effect').trim(),
      }
    })

    expect(typesetMetrics.titleFilterVar).toBe('')
    expect(typesetMetrics.titleTransformVar).toBe('')

    await page.getByRole('button', { name: 'Upper-right clipped note' }).hover({ force: true })
    await page.waitForTimeout(500)
    await expect(page.locator('.stage-overlay-windows--live .text-bloom')).toHaveClass(/text-bloom--title-treatment-etched/)

    const etchedMetrics = await page.locator('.stage-overlay-windows--live .text-bloom__title').evaluate((node) => {
      const style = window.getComputedStyle(node)
      return {
        filter: style.filter,
        color: style.color,
      }
    })

    expect(etchedMetrics.filter).not.toBe('none')
    expect(etchedMetrics.color).not.toBe('rgba(249, 240, 220, 0.98)')
  })

  test('crowded text-bloom variants add more cutout separation and local title wash', async ({ page }) => {
    await gotoEdition(page, '/archive/signal-greenhouse-bench-v1')

    await page.getByRole('button', { name: 'Lower-right plant tag' }).hover({ force: true })
    await page.waitForTimeout(500)

    const editorialSeparation = await page.locator('.stage-overlay-windows--live .text-bloom').evaluate((node) => {
      const style = window.getComputedStyle(node)
      return {
        paddingTopVar: style.getPropertyValue('--text-bloom-cutout-top-padding').trim(),
        cutoutTopVar: style.getPropertyValue('--text-bloom-cutout-top').trim(),
        cutoutRightVar: style.getPropertyValue('--text-bloom-cutout-right').trim(),
        washOpacityVar: style.getPropertyValue('--text-bloom-title-wash-opacity').trim(),
        washInsetVar: style.getPropertyValue('--text-bloom-title-wash-inset').trim(),
      }
    })

    expect(editorialSeparation.paddingTopVar).toBe('6.2rem')
    expect(editorialSeparation.cutoutTopVar).toBe('.1rem')
    expect(editorialSeparation.cutoutRightVar).toBe('-.5rem')
    expect(editorialSeparation.washOpacityVar).toBe('.72')
    expect(editorialSeparation.washInsetVar).toBe('-1.15rem -1.75rem -1.1rem -1rem')

    await gotoEdition(page, '/archive/candle-library-altar-v1')
    await page.getByRole('button', { name: 'Shelf candle' }).hover({ force: true })
    await page.waitForTimeout(500)

    const signalSeparation = await page.locator('.stage-overlay-windows--live .text-bloom').evaluate((node) => {
      const style = window.getComputedStyle(node)
      return {
        paddingTopVar: style.getPropertyValue('--text-bloom-cutout-top-padding').trim(),
        cutoutTopVar: style.getPropertyValue('--text-bloom-cutout-top').trim(),
        cutoutRightVar: style.getPropertyValue('--text-bloom-cutout-right').trim(),
        washOpacityVar: style.getPropertyValue('--text-bloom-title-wash-opacity').trim(),
        washInsetVar: style.getPropertyValue('--text-bloom-title-wash-inset').trim(),
      }
    })

    expect(signalSeparation.paddingTopVar).toBe('6rem')
    expect(signalSeparation.cutoutTopVar).toBe('.18rem')
    expect(signalSeparation.cutoutRightVar).toBe('-.6rem')
    expect(signalSeparation.washOpacityVar).toBe('.68')
    expect(signalSeparation.washInsetVar).toBe('-1rem -1.6rem -1.05rem -.9rem')
  })

  test('artifact inheritance applies object-native classes to live previews', async ({ page }) => {
    await gotoEdition(page, '/archive/signal-greenhouse-bench-v1')

    const paperArtifact = page.getByRole('button', { name: 'Upper-right clipped note' })
    await paperArtifact.hover({ force: true })
    await page.waitForTimeout(500)
    await expect(paperArtifact).toHaveClass(/artifact--inherit-paper/)
    await expect(page.locator('.stage-overlay-windows--live .source-window')).toHaveClass(/source-window--artifact-paper/)
    await expect(page.locator('.stage-overlay-windows--live .text-bloom')).toHaveClass(/text-bloom--artifact-paper/)

    const lampArtifact = page.getByRole('button', { name: 'Task lamp', exact: true })
    await lampArtifact.hover({ force: true })
    await page.waitForTimeout(500)
    await expect(lampArtifact).toHaveClass(/artifact--inherit-light/)
    await expect(page.locator('.stage-overlay-windows--live .source-window')).toHaveClass(/source-window--artifact-light/)

    const livingArtifact = page.getByRole('button', { name: 'Left potted plant', exact: true })
    await livingArtifact.hover({ force: true })
    await page.waitForTimeout(500)
    await expect(livingArtifact).toHaveClass(/artifact--inherit-living/)
    await expect(page.locator('.stage-overlay-windows--live .source-window')).toHaveClass(/source-window--artifact-living/)
  })

  test('whimsical preview treatments animate tether seams while artifact masks stay unhighlighted', async ({ page }) => {
    await gotoEdition(page, '/archive/signal-greenhouse-bench-v1')

    await page.getByRole('button', { name: 'Lower-right plant tag' }).hover({ force: true })
    await page.waitForTimeout(500)

    await expect(page.locator('.stage-overlay-windows--live .source-window')).toHaveClass(/source-window--projection-cast/)
    await expect(page.locator('.stage-overlay-windows--live .source-window')).toHaveClass(/source-window--seam-stitch/)
    await expect(page.getByRole('button', { name: 'Lower-right plant tag' })).toHaveClass(/artifact--preview-active/)

    const castWhimsy = await page.locator('.stage-overlay-windows--live .source-window').evaluate((node) => {
      const beam = window.getComputedStyle(node, '::before')
      const contact = window.getComputedStyle(node, '::after')
      const seam = window.getComputedStyle(node.querySelector('.source-window__body--text-bloom'), '::after')
      const title = window.getComputedStyle(node.querySelector('.text-bloom__title'))
      return {
        beamAnimation: beam.animationName,
        seamAnimation: seam.animationName,
        titleAnimation: title.animationName,
        contactShadow: contact.boxShadow,
      }
    })

    expect(castWhimsy.beamAnimation).toContain('whimsical-beam-spark')
    expect(castWhimsy.seamAnimation).toContain('whimsical-stitch-wiggle')
    expect(castWhimsy.titleAnimation).toContain('text-bloom-title-reveal')
    expect(castWhimsy.contactShadow).not.toBe('none')

    const castArtifact = await page.getByRole('button', { name: 'Lower-right plant tag' }).evaluate((node) => {
      const style = window.getComputedStyle(node)
      const glow = window.getComputedStyle(node, '::before')
      return {
        transform: style.transform,
        animation: glow.animationName,
      }
    })

    expect(castArtifact.transform).not.toBe('none')
    expect(castArtifact.animation).toBe('none')

    await page.getByRole('button', { name: 'Upper-right clipped note' }).hover({ force: true })
    await page.waitForTimeout(500)

    await expect(page.locator('.stage-overlay-windows--live .source-window')).toHaveClass(/source-window--projection-mechanical/)

    const mechanicalArtifact = await page.getByRole('button', { name: 'Upper-right clipped note' }).evaluate((node) => {
      const scan = window.getComputedStyle(node, '::before')
      const cuff = window.getComputedStyle(node, '::after')
      return {
        scanAnimation: scan.animationName,
        cuffAnimation: cuff.animationName,
      }
    })

    expect(mechanicalArtifact.scanAnimation).toBe('none')
    expect(mechanicalArtifact.cuffAnimation).toBe('none')
  })

  test('night observatory close returns to one-window state cleanly', async ({ page }) => {
    await gotoEdition(page, '/archive/night-observatory-v1')
    await clickArtifactByIndex(page, 0)
    await clickArtifactByIndex(page, 1)
    await page.locator('.stage-overlay-windows--live .source-window .source-window__close').last().click({ force: true })
    await page.waitForTimeout(400)

    await expect(stageWindows(page)).toHaveCount(1)
    await expectStableVisual(page, 'night-observatory-close-back-to-one-window', { mask: iframeMask(page) })
  })

  test('algorithmic folklore watchpost CCTV preview uses screen-rendered enhancement treatment', async ({ page }) => {
    await gotoEdition(page, '/archive/algorithmic-folklore-watchpost-v1')

    await page.getByRole('button', { name: 'CCTV Monitor' }).hover({ force: true })
    await page.waitForTimeout(500)

    await expect(stageWindows(page)).toHaveCount(1)
    await expect(page.locator('.stage-overlay-windows--live .source-window')).toHaveClass(/source-window--enhancement-screen-rendered/)
    await expect(page.locator('.stage-overlay-windows--live .source-window__body--screen-preview')).toHaveCount(1)
    await expect(page.locator('.stage-overlay-windows--live .source-window__screen-preview-title')).toContainText('Dennō Senshi Porygon')
    await expect(page.locator('.stage-overlay-windows--live .source-window__screen-preview-eyebrow')).toHaveCount(0)

    const screenShell = await page.locator('.stage-overlay-windows--live .source-window').evaluate((node) => {
      const style = window.getComputedStyle(node)
      const frame = node.querySelector('.source-window__screen-preview-frame')
      const frameStyle = frame ? window.getComputedStyle(frame) : null
      return {
        background: style.backgroundImage,
        boxShadow: style.boxShadow,
        frameBorderRadius: frameStyle?.borderRadius ?? null,
        frameOutline: frameStyle?.boxShadow ?? null,
      }
    })

    expect(screenShell.background).toBe('none')
    expect(screenShell.boxShadow).toBe('none')
    expect(screenShell.frameBorderRadius).not.toBe('0px')
    expect(screenShell.frameOutline).toBe('none')
  })

  test('algorithmic folklore watchpost map board preview uses warped paper fragment treatment', async ({ page }) => {
    await gotoEdition(page, '/archive/algorithmic-folklore-watchpost-v1')

    await page.getByRole('button', { name: 'Map Route Board' }).hover({ force: true })
    await page.waitForTimeout(500)

    await expect(stageWindows(page)).toHaveCount(1)
    await expect(page.locator('.stage-overlay-windows--live .source-window')).toHaveClass(/source-window--enhancement-warped-paper/)
    await expect(page.locator('.stage-overlay-windows--live .source-window__body--warped-paper-preview')).toHaveCount(1)
    await expect(page.locator('.stage-overlay-windows--live .source-window__paper-preview-title')).toContainText('Suhur')

    const paperShell = await page.locator('.stage-overlay-windows--live .source-window').evaluate((node) => {
      const style = window.getComputedStyle(node)
      const body = node.querySelector('.source-window__body--warped-paper-preview')
      const bodyStyle = body ? window.getComputedStyle(body) : null
      return {
        background: style.backgroundImage,
        boxShadow: style.boxShadow,
        bodyFilter: bodyStyle?.filter ?? null,
        bodyClipPath: bodyStyle?.clipPath ?? null,
      }
    })

    expect(paperShell.background).toBe('none')
    expect(paperShell.boxShadow).toBe('none')
    expect(paperShell.bodyFilter).not.toBe('none')
    expect(paperShell.bodyClipPath).not.toBe('none')
  })

  test('algorithmic folklore watchpost ranking board preview omits hidden self-aware note', async ({ page }) => {
    await gotoEdition(page, '/archive/algorithmic-folklore-watchpost-v1')

    await page.getByRole('button', { name: 'Ranking Board' }).hover({ force: true })
    await page.waitForTimeout(500)

    await expect(stageWindows(page)).toHaveCount(1)
    await expect(page.locator('.stage-overlay-windows--live .source-window')).toHaveClass(/source-window--enhancement-warped-paper/)
    await expect(page.locator('.stage-overlay-windows--live .paper-preview')).not.toHaveClass(/paper-preview--hidden-note/)
    await expect(page.locator('.stage-overlay-windows--live .paper-preview__hidden-note')).toHaveCount(0)
    await expect(page.locator('.stage-overlay-windows--live .paper-preview__eyebrow')).toHaveCount(0)
  })

  test('algorithmic folklore watchpost archive cabinet preview is image-first without the paper container', async ({ page }) => {
    await gotoEdition(page, '/archive/algorithmic-folklore-watchpost-v1')

    await page.getByRole('button', { name: 'Archive & Spread Cabinet' }).hover({ force: true })
    await page.waitForTimeout(500)

    await expect(stageWindows(page)).toHaveCount(1)
    await expect(page.locator('.stage-overlay-windows--live .source-window')).toHaveClass(/source-window--enhancement-warped-paper/)
    await expect(page.locator('.stage-overlay-windows--live .source-window__body--archive-image-preview')).toHaveCount(1)
    await expect(page.locator('.stage-overlay-windows--live .paper-preview')).toHaveCount(0)
    await expect(page.locator('.stage-overlay-windows--live .archive-image-preview__title')).toContainText('Hard Boiled (1992) | The Criterion Collection')

    const previewImage = await page.locator('.stage-overlay-windows--live .archive-image-preview__image').getAttribute('src')
    expect(previewImage).not.toContain('hard-boiled-page.png')

    const previewShell = await page.locator('.stage-overlay-windows--live .archive-image-preview').evaluate((node) => {
      const style = window.getComputedStyle(node)
      const rect = node.getBoundingClientRect()
      return {
        background: style.backgroundImage,
        boxShadow: style.boxShadow,
        fitsViewportRight: rect.right <= window.innerWidth,
        fitsViewportBottom: rect.bottom <= window.innerHeight,
      }
    })

    expect(previewShell.background).toBe('none')
    expect(previewShell.boxShadow).toBe('none')
    expect(previewShell.fitsViewportRight).toBe(true)
    expect(previewShell.fitsViewportBottom).toBe(true)
  })

  test('algorithmic folklore watchpost archive cabinet preview still fits at a narrower viewport', async ({ page }) => {
    await page.setViewportSize({ width: 1180, height: 760 })
    await gotoEdition(page, '/archive/algorithmic-folklore-watchpost-v1')

    await page.getByRole('button', { name: 'Archive & Spread Cabinet' }).hover({ force: true })
    await page.waitForTimeout(500)

    const previewShell = await page.locator('.stage-overlay-windows--live .archive-image-preview').evaluate((node) => {
      const rect = node.getBoundingClientRect()
      return {
        right: rect.right,
        bottom: rect.bottom,
        width: rect.width,
        height: rect.height,
        viewportWidth: window.innerWidth,
        viewportHeight: window.innerHeight,
        fitsViewportRight: rect.right <= window.innerWidth,
        fitsViewportBottom: rect.bottom <= window.innerHeight,
      }
    })

    expect(previewShell.fitsViewportRight).toBe(true)
    expect(previewShell.fitsViewportBottom).toBe(true)
  })
})
