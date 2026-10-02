import { expect, type Locator } from '@playwright/test'

export async function waitForNativeAudioReady(iframe: Locator, provider: string, timeout = 20_000) {
  await expect(iframe).toBeVisible({ timeout })
  // An iframe rectangle is visible before the cross-origin player paints.
  // Fail closed on an empty provider document instead of saving blank proof.
  const transport = provider === 'bandcamp-embed'
    ? '#play:visible, #big_play_button:visible'
    : '.playButton:visible, .playControl:visible'
  await expect(iframe.contentFrame().locator(transport).first()).toBeVisible({ timeout })
}
