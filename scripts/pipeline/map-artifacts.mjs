import path from 'node:path'

export function createMapArtifactsStep({ apiKey, context, inspectGeneratedPlate, options, root, runDir }) {
  return {
    name: 'Inspect generated plate and map visible artifacts',
    tool: 'Hermes structured vision JSON',
    command: `internal:hermes-vision-map --requested-model ${options.model}`,
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
