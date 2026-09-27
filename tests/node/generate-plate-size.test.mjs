import { expect, test } from 'vitest'
import { createGeneratePlateStep } from '../../scripts/pipeline/generate-plate.mjs'

for (const [description, fingerprint, expected] of [
  ['landscape with square paving', { width: 1200, height: 675, visual_summary: 'square posts and square paving' }, '1536x1024'],
  ['unknown aspect with square objects', { visual_summary: 'square posts' }, '1536x1024'],
  ['measured square', { width: 900, height: 900 }, '1024x1024'],
]) {
  test(`plate generation uses measured geometry: ${description}`, async () => {
    let actual
    const step = createGeneratePlateStep({
      context: { payload: { source_image_fingerprints: [fingerprint] } },
      options: { imageSize: '1536x1024', imageBackend: 'hermes' },
      root: '/tmp', runDir: '/tmp/test',
      imageAspectRatioFromSize: () => 'landscape',
      generateScenePlate: async (options) => { actual = options.imageSize; return { outputPath: '/tmp/test/plate.png', size: actual } },
    })
    await step.run()
    expect(actual).toBe(expected)
  })
}
