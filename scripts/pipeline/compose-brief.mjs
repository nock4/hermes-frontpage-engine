import path from 'node:path'

export function createComposeBriefStep({
  apiKey,
  composeDailyPayload,
  context,
  diversityDirective,
  options,
  recentEditions,
  root,
  runDir,
}) {
  return {
    name: 'Compose research field and daily scene brief',
    tool: 'Hermes structured JSON',
    command: `internal:hermes-compose-brief --requested-model ${options.model}`,
    run: async () => {
      context.payload = await composeDailyPayload({
        signalHarvest: context.signalHarvest,
        researchField: context.researchField,
        apiKey,
        model: options.model,
        date: options.date,
        recentEditions,
        diversityDirective,
      }, runDir)
      return {
        title: context.payload.edition_title,
        scene_family: context.payload.scene_family,
        artifacts: context.payload.artifacts.length,
        request: path.relative(root, path.join(runDir, 'brief-composition-request.json')),
        output: path.relative(root, path.join(runDir, 'daily-generation-payload.json')),
      }
    },
  }
}
