import { rm } from 'node:fs/promises'
import path from 'node:path'
// Local review studies are intentionally retained in public for dev previews,
// but are not edition assets and must never enter a static production deploy.
export const excludeReviewAssets = {
  name: 'exclude-disposable-review-assets',
  apply: 'build',
  async writeBundle(options) {
    if (options.dir) await rm(path.join(options.dir, 'review'), { recursive: true, force: true })
  },
}
