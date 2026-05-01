import path from 'node:path'

export function createMapArtifactsStep({ apiKey, context, inspectGeneratedPlate, options, root, runDir }) {
  return {
    name: 'Inspect generated plate and map visible artifacts',
    tool: `OpenAI Responses API vision (${options.model})`,
    command: `internal:openai-vision-map --model ${options.model}`,
    run: async () => {
      context.analysis = await inspectGeneratedPlate({
        payload: context.payload,
        platePath: context.plate.outputPath,
        apiKey,
        model: options.model,
      }, runDir)
      return {
        detected_objects: context.analysis.detected_objects.length,
        usable_surfaces: context.analysis.usable_surfaces.length,
        complexity: context.analysis.complexity_assessment,
        output: path.relative(root, path.join(runDir, 'plate-analysis.json')),
      }
    },
  }
}
