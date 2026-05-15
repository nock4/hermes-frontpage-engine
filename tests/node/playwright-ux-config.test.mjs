import { describe, expect, it, vi } from 'vitest'

describe('Playwright UX config port selection', () => {
  it('uses DFE_UX_PORT for the preview server URL and command', async () => {
    const originalPort = process.env.DFE_UX_PORT
    process.env.DFE_UX_PORT = '45678'

    try {
      vi.resetModules()
      const config = (await import('../../playwright.ux.config.ts')).default

      expect(config.use.baseURL).toBe('http://127.0.0.1:45678')
      expect(config.webServer.url).toBe('http://127.0.0.1:45678')
      expect(config.webServer.command).toContain('--port 45678')
    } finally {
      if (originalPort === undefined) delete process.env.DFE_UX_PORT
      else process.env.DFE_UX_PORT = originalPort
    }
  })
})
