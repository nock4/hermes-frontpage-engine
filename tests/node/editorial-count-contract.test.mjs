import { describe, it, expect } from 'vitest'
import { assertEditorialBindings } from '../../scripts/lib/source-selection-policy.mjs'
import { prepareCronReserve } from '../../scripts/run-daily-publish-cron.mjs'
import { MIN_SOURCE_WINDOWS, DESIRED_SOURCE_WINDOWS, MAX_SOURCE_WINDOWS } from '../../src/lib/sourceWindowCountContract.mjs'

describe('authorized editorial count contract', () => {
  it('shares minimum one, desired six, maximum ten', () => {
    expect([MIN_SOURCE_WINDOWS, DESIRED_SOURCE_WINDOWS, MAX_SOURCE_WINDOWS]).toEqual([1, 6, 10])
  })
  it('rejects zero even when a caller tries to disable the floor', () => {
    expect(() => assertEditorialBindings([], {}, null, { minimum: 0 })).toThrow(/minimum|count/)
  })
  it('does not acquire a required reserve on the normal path', async () => {
    let calls = 0
    expect(await prepareCronReserve({}, { env: {}, run: async () => { calls++; return { code: 2 } } })).toEqual({ skipped: true })
    expect(calls).toBe(0)
  })
})
