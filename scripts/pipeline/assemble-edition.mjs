import path from 'node:path'

export function createAssembleEditionStep({ assembleEditionPackage, context, envLoadedFromFiles, options, root, runDir }) {
  return {
    name: 'Assemble first edition package and archive manifest entry',
    tool: 'Node edition package assembler',
    command: `internal:assemble-edition-package --publish ${options.publish}`,
    run: async () => {
      context.package = await assembleEditionPackage({
        options,
        payload: context.payload,
        researchField: context.researchField,
        signalHarvest: context.signalHarvest,
        plate: context.plate,
        analysis: context.analysis,
        runDir,
      }, {
        env_loaded_from_files: envLoadedFromFiles,
      })
      return {
        edition_id: context.package.editionId,
        route: context.package.route,
        published: context.package.published,
        edition_dir: path.relative(root, context.package.editionDir),
      }
    },
  }
}
