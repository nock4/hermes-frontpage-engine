import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { allocateUxPort, postPackageSteps } from '../../scripts/pipeline/package-steps.mjs'

describe('post-package UX port isolation', () => {
  beforeEach(() => vi.stubEnv('DFE_UX_PORT', ''))
  afterEach(() => vi.unstubAllEnvs())

  it('retains an explicitly configured port instead of applying the default range', () => {
    vi.stubEnv('DFE_UX_PORT', '43903')
    expect(allocateUxPort('fixture')).toBe('43903')
  })
  it('allocates a stable high port from a run id', () => {
    expect(allocateUxPort('daily-process-2026-05-15T08-10-53-271Z')).toMatch(/^4[4-8]\d{3}$/)
    expect(allocateUxPort('daily-process-2026-05-15T08-10-53-271Z')).toBe(
      allocateUxPort('daily-process-2026-05-15T08-10-53-271Z'),
    )
  })

  it('passes the allocated UX port to all Playwright smoke steps', () => {
    const steps = postPackageSteps({
      options: { ux: 'smoke' },
      editionIds: ['example-edition'],
      generationName: 'daily-process-2026-05-15T08-10-53-271Z',
      smokeRoute: '/',
    })

    const uxSteps = steps.filter((step) => step.tool.includes('Playwright'))
    expect(uxSteps.length).toBe(2)
    expect(new Set(uxSteps.map((step) => step.env.DFE_UX_PORT)).size).toBe(1)
    expect(uxSteps.every((step) => step.env.DFE_UX_PORT)).toBe(true)
  })
})
