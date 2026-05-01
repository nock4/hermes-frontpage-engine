import path from 'node:path'

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
      context.plate = await generateScenePlate({
        payload: context.payload,
        apiKey,
        imageModel: options.imageModel,
        imageBackend: options.imageBackend,
        imageSize: options.imageSize,
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
