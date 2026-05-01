export function getEditionIds(options, manifest) {
  if (options.allEditions) return manifest.editions.map((edition) => edition.edition_id)
  if (options.editions.length) return [...new Set(options.editions)]
  return [manifest.current_edition_id]
}

export function maskPipelineArgs(options, generationName, editionIds = []) {
  const args = ['scripts/automated-mask-pipeline.py', '--generation-name', generationName, '--apply-artifact-map']
  if (options.promptedMaskDir) args.push('--prompted-mask-dir', options.promptedMaskDir)
  args.push(...editionIds)
  return args
}

export function existingPackageSteps(options, editionIds, generationName) {
  const steps = [
    {
      name: 'Verify packaged edition inputs are present',
      tool: 'Node fs',
      command: ['node', ['-e', `console.log(${JSON.stringify(JSON.stringify({ editions: editionIds }))})`]],
    },
    {
      name: 'Enrich source images',
      tool: 'Node fetch + provider image rules',
      command: ['npm', ['run', 'enrich:source-images']],
    },
  ]

  if (!options.skipMask) {
    steps.push({
      name: 'Generate post-plate mask candidates and geometry audit files',
      tool: 'Python + Pillow + NumPy + SciPy + OpenCV GrabCut + scikit-image contours',
      command: ['python3', maskPipelineArgs(options, generationName, editionIds)],
    })
  }

  return steps
}

export function buildSmokeRoute(edition) {
  if (!edition) return '/'
  return edition.is_live ? '/?edition=' + encodeURIComponent(edition.edition_id) : '/?archive=' + encodeURIComponent(edition.slug)
}

export function postPackageSteps({ options, editionIds, generationName, smokeRoute }) {
  const steps = [
    {
      name: 'Generate interpretation files',
      tool: 'Node interpretation generator',
      command: ['npm', ['run', 'generate:interpretations']],
    },
    {
      name: 'Generate enhancement plans',
      tool: 'Node enhancement-plan generator',
      command: ['npm', ['run', 'generate:enhancement-plans']],
    },
    {
      name: 'Validate packaged editions',
      tool: 'Node edition validator',
      command: ['node', ['scripts/validate-editions.mjs']],
    },
    {
      name: 'Run unit tests',
      tool: 'Vitest',
      command: ['npm', ['test']],
    },
    {
      name: 'Build production runtime',
      tool: 'TypeScript + Vite',
      command: ['npm', ['run', 'build']],
    },
  ]

  if (options.ux === 'smoke') {
    steps.push({
      name: 'Run generated-edition smoke UX test',
      tool: 'Playwright + Chromium',
      command: ['npx', ['playwright', 'test', '-c', 'playwright.ux.config.ts', 'tests/ux/generated-edition-smoke.spec.ts']],
      env: { DFE_SMOKE_ROUTE: smokeRoute },
    })
    steps.push({
      name: 'Run source-window media audit for generated edition',
      tool: 'Playwright + Chromium media audit',
      command: ['npm', ['run', 'test:ux:media']],
      env: {
        DFE_MEDIA_AUDIT_EDITIONS: editionIds.join(','),
        DFE_MEDIA_AUDIT_REQUIRE_YOUTUBE_EMBEDS: '1',
      },
    })
  } else if (options.ux === 'focused') {
    steps.push({
      name: 'Run focused source-window UX tests',
      tool: 'Playwright + Chromium',
      command: ['npx', ['playwright', 'test', '-c', 'playwright.ux.config.ts', 'tests/ux/stage-windows.spec.ts', '-g', 'forest breath|signal greenhouse youtube']],
    })
  } else if (options.ux === 'full') {
    steps.push({
      name: 'Run full UX test suite',
      tool: 'Playwright + Chromium + Axe',
      command: ['npm', ['run', 'test:ux']],
    })
  }

  return steps.map((step) => ({
    ...step,
    editionIds,
    generationName,
  }))
}
