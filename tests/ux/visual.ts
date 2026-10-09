import { expect, type Locator, type Page } from '@playwright/test'

export async function expectStableVisual(page: Page, name: string, options?: { mask?: Locator[] }) {
  await expect(page).toHaveScreenshot(`${name}.png`, options)
}
