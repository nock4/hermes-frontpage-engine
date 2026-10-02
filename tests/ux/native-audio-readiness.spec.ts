import { expect, test } from '@playwright/test'
import { waitForNativeAudioReady } from './native-audio-readiness'

test('native audio readiness rejects a visible but blank provider iframe', async ({ page }) => {
  await page.setContent('<iframe style="width:320px;height:180px" srcdoc="<body></body>"></iframe>')
  await expect(waitForNativeAudioReady(page.locator('iframe'), 'bandcamp-embed', 300)).rejects.toThrow()
})

test('native audio readiness accepts rendered transport rather than geometry alone', async ({ page }) => {
  await page.setContent('<iframe style="width:320px;height:180px" srcdoc="<button id=big_play_button>Play</button>"></iframe>')
  await waitForNativeAudioReady(page.locator('iframe'), 'bandcamp-embed', 1000)
})
