import { createArgosReporterOptions } from '@argos-ci/playwright/reporter'
import { defineConfig } from '@playwright/test'

const isCI = Boolean(process.env.CI)
const hasArgosToken = Boolean(process.env.ARGOS_TOKEN)
const uxPreviewPort = process.env.DFE_UX_PORT || '43180'
const uxPreviewUrl = `http://127.0.0.1:${uxPreviewPort}`

export default defineConfig({
  testDir: './tests/ux',
  fullyParallel: false,
  workers: 1,
  timeout: 60_000,
  reporter: [
    [isCI ? 'dot' : 'list'],
    ['html', { open: 'never', outputFolder: 'playwright-report/ux' }],
    [
      '@argos-ci/playwright/reporter',
      createArgosReporterOptions({
        uploadToArgos: isCI && hasArgosToken,
      }),
    ],
  ],
  use: {
    baseURL: uxPreviewUrl,
    viewport: { width: 1440, height: 980 },
    trace: isCI ? 'on-first-retry' : 'on',
    screenshot: 'only-on-failure',
    video: 'retain-on-failure',
    bypassCSP: true,
  },
  expect: {
    toHaveScreenshot: {
      animations: 'disabled',
      scale: 'css',
      maxDiffPixelRatio: 0.01,
    },
  },
  webServer: {
    command: `npm run preview -- --host 127.0.0.1 --port ${uxPreviewPort} --strictPort`,
    url: uxPreviewUrl,
    reuseExistingServer: false,
    timeout: 120_000,
  },
})
