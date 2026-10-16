import path from 'node:path'
import { landscapeImageSize } from '../lib/landscape-policy.mjs'

export function createGeneratePlateStep({
  apiKey,
  context,
  generateScenePlate,
  imageAspectRatioFromSize,
  options,
  root,
  runDir,
}) {
  const effectiveImageSize = landscapeImageSize(options.imageSize)
  return {
    name: 'Generate AI scene plate',
    tool: options.imageBackend === 'hermes'
      ? 'Hermes image generation provider'
      : `OpenAI Images API (${options.imageModel})`,
    command: options.imageBackend === 'hermes'
      ? `internal:hermes-generate-image --aspect-ratio ${imageAspectRatioFromSize(effectiveImageSize)} --size ${effectiveImageSize}`
      : `internal:openai-generate-image --size ${effectiveImageSize} --quality ${options.imageQuality}`,
    run: async () => {
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
