import { test as it, expect } from '@playwright/test'
import fs from 'node:fs'
it('production build excludes disposable review studies, not real editions', () => {
  expect(fs.existsSync('dist/review')).toBe(false)
  expect(fs.existsSync('dist/editions/index.json')).toBe(true)
})
