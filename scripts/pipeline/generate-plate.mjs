import path from 'node:path'

function sourceLockedImageSize(payload, fallbackSize) {
  if (process.env.DFE_SOURCE_ASPECT_LOCK_IMAGE_SIZE === '0') return fallbackSize
  const fingerprints = Array.isArray(payload?.source_image_fingerprints) ? payload.source_image_fingerprints : []
  const sourceText = fingerprints.slice(0, 1).map((fingerprint) => [
    fingerprint?.visual_summary,
    ...(Array.isArray(fingerprint?.preserve_cues) ? fingerprint.preserve_cues : []),
    ...(Array.isArray(fingerprint?.composition_moves) ? fingerprint.composition_moves : []),
  ].filter(Boolean).join(' ')).join(' ').toLowerCase()
  if (/\bsquare\b/.test(sourceText)) return '1024x1024'
  return fallbackSize
}

export function createGeneratePlateStep({
  apiKey,
  context,
  generateScenePlate,
  imageAspectRatioFromSize,
  options,
  root,
  runDir,
}) {
  return {
    name: 'Generate AI scene plate',
    tool: options.imageBackend === 'hermes'
      ? 'Hermes image generation provider'
      : `OpenAI Images API (${options.imageModel})`,
    command: options.imageBackend === 'hermes'
      ? `internal:hermes-generate-image --aspect-ratio ${imageAspectRatioFromSize(options.imageSize)} --size ${options.imageSize}`
      : `internal:openai-generate-image --size ${options.imageSize} --quality ${options.imageQuality}`,
    run: async () => {
      const effectiveImageSize = sourceLockedImageSize(context.payload, options.imageSize)
      if (effectiveImageSize !== options.imageSize) {
        console.warn(`[scene-generation] source aspect lock changed image size ${options.imageSize} -> ${effectiveImageSize}`)
        options.imageSize = effectiveImageSize
      }
      context.plate = await generateScenePlate({
        payload: context.payload,
        apiKey,
        imageModel: options.imageModel,
        imageBackend: options.imageBackend,
        imageSize: effectiveImageSize,
        imageQuality: options.imageQuality,
      }, runDir)
      return {
        backend: context.plate.backend,
        provider: context.plate.provider || null,
        model: context.plate.model,
        size: context.plate.size,
        output: path.relative(root, context.plate.outputPath),
      }
    },
  }
}
