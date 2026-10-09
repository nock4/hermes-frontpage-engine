import { afterEach, expect, test, vi } from 'vitest'

const screenshot = vi.hoisted(() => vi.fn().mockResolvedValue(undefined))
vi.mock('@playwright/test', () => ({ expect: () => ({ toHaveScreenshot: screenshot }) }))
import { expectStableVisual } from './ux/visual'

afterEach(() => { vi.unstubAllEnvs(); screenshot.mockClear() })
for (const ci of ['', 'true']) {
  test(`visual baselines are asserted with CI=${ci || 'unset'}`, async () => {
    vi.stubEnv('CI', ci)
    const mask: never[] = []
    await expectStableVisual({} as never, 'baseline-contract', { mask })
    expect(screenshot).toHaveBeenCalledWith('baseline-contract.png', { mask })
  })
}
