import process from 'node:process'

import { describe, expect, it } from 'vitest'

import { parseArgs } from '../../scripts/lib/cli-options.mjs'

const availableBrowserHarnessArgs = ['--browser-harness', process.execPath]

describe('daily process CLI options', () => {
  it('widens the default window for bundled sample signals so demo data does not expire', () => {
    const options = parseArgs(['--use-sample-signals', ...availableBrowserHarnessArgs])

    expect(options.inputMode).toBe('manifest')
    expect(options.windowDays).toBeGreaterThanOrEqual(3650)
  })

  it('preserves an explicit sample signal window', () => {
    const options = parseArgs(['--use-sample-signals', '--window-days', '90', ...availableBrowserHarnessArgs])

    expect(options.windowDays).toBe(90)
  })
})
