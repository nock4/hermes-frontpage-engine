import fs from 'node:fs'
import path from 'node:path'
import { expect, test } from '@playwright/test'

for (const viewport of [{width:375,height:667},{width:393,height:852},{width:360,height:740},{width:852,height:393}]) {
  test(`Bandcamp fallback close stays on settled raw card ${viewport.width}`, async ({page}, testInfo) => {
    await page.setViewportSize(viewport)
    await page.goto('/?edition=2026-10-02-the-canopy-comes-apart-v1')
    const artifact = page.locator('button.artifact').nth(4)
    await artifact.focus()
    const surface = page.locator('.stage-overlay-windows--live .source-window[data-binding-id="binding-module-moss-channel-cleft"]')
    for (const mode of ['preview','primary']) {
      if (mode === 'primary') await artifact.press('Enter')
      await expect(surface).toHaveAttribute('data-source-window-mode', mode)
      await surface.locator('img').evaluate((img: HTMLImageElement) => img.decode())
      await surface.evaluate(async el => { await Promise.all(el.getAnimations({subtree:true}).filter(a => a.effect?.getTiming().iterations !== Infinity).map(a => a.finished)) })
      const geometry = await surface.evaluate(el => {
        const card = el.querySelector('.visual-source-card')!.getBoundingClientRect()
        const close = el.querySelector('.source-window__close')!
        const rect = close.getBoundingClientRect()
        const hit = document.elementFromPoint(rect.x + rect.width/2, rect.y + rect.height/2)
        return {card:card.toJSON(), close:rect.toJSON(), hit:close === hit || close.contains(hit), text:el.textContent}
      })
      const root = process.env.DFE_CLOSE_QA_DIR || testInfo.outputPath('proof')
      fs.mkdirSync(root,{recursive:true})
      fs.writeFileSync(path.join(root,`${viewport.width}-${mode}.json`),JSON.stringify(geometry,null,2))
      await page.screenshot({path:path.join(root,`${viewport.width}-${mode}.png`)})
      expect(geometry.hit).toBe(true)
      expect(geometry.close.width).toBeGreaterThanOrEqual(44)
      expect(geometry.close.left).toBeGreaterThanOrEqual(geometry.card.left-1)
      expect(geometry.close.right).toBeLessThanOrEqual(geometry.card.right+1)
      expect(geometry.close.left+geometry.close.width/2).toBeGreaterThan(geometry.card.left+geometry.card.width*.68)
      expect(geometry.close.top+geometry.close.height/2).toBeLessThan(geometry.card.top+geometry.card.height*.25)
      expect(geometry.text).toContain('Stream unavailable')
      await expect(surface.locator('iframe')).toHaveCount(0)
      await expect(surface.locator('a[href="https://masahirosugaya.bandcamp.com/track/straight-line-floating-in-the-sky"]').first()).toBeAttached()
    }
    await surface.locator('.source-window__close').click()
    await expect(surface).toHaveCount(0)
  })
}
