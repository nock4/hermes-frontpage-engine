import { it, expect } from 'vitest'
import fs from 'node:fs'

it('root clean installs include the worker emulator used by the root test suite', () => {
  const root = JSON.parse(fs.readFileSync(new URL('../../package.json', import.meta.url), 'utf8'))
  const lock = JSON.parse(fs.readFileSync(new URL('../../package-lock.json', import.meta.url), 'utf8'))
  const worker = JSON.parse(fs.readFileSync(new URL('../../workers/shared-surface/package.json', import.meta.url), 'utf8'))
  expect(root.workspaces).toContain('workers/shared-surface')
  expect(lock.packages[''].workspaces).toContain('workers/shared-surface')
  expect(lock.packages['workers/shared-surface'].devDependencies.miniflare).toBe(worker.devDependencies.miniflare)
  expect(lock.packages['node_modules/daily-shared-surface-worker']).toMatchObject({ link: true, resolved: 'workers/shared-surface' })
})
