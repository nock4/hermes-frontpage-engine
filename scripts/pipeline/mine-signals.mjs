import path from 'node:path'

export function createMineSignalsStep({ options, context, recentDiversityAvoidTerms, root, runDir, mineSignals }) {
  return {
    name: 'Mine source signals',
    tool: options.inputMode === 'manifest'
      ? 'JSON manifest adapter'
      : options.inputMode === 'markdown-folder'
        ? 'Markdown folder adapter'
        : 'Obsidian allowlist adapter',
    command: [
      'internal:mine-signals',
      `--input-mode ${options.inputMode}`,
      options.inputRoot ? `--input-root ${JSON.stringify(options.inputRoot)}` : null,
      options.signalManifest ? `--signal-manifest ${JSON.stringify(options.signalManifest)}` : null,
      options.inspirationOverride ? `--inspiration-override ${JSON.stringify(options.inspirationOverride)}` : null,
      `--window-days ${options.windowDays}`,
      `--max-notes ${options.maxNotes}`,
      `--avoid-recent-terms ${JSON.stringify(recentDiversityAvoidTerms.join(','))}`,
    ].filter(Boolean).join(' '),
    run: async () => {
      context.signalHarvest = await mineSignals({
        ...options,
        diversityAvoidTerms: recentDiversityAvoidTerms,
        inspirationOverride: context.inspirationOverride,
      }, runDir)
      return {
        notes_scanned: context.signalHarvest.notes_scanned,
        notes_selected: context.signalHarvest.notes_selected.length,
        source_candidates: context.signalHarvest.source_candidates.length,
        diversity_avoid_terms: recentDiversityAvoidTerms,
        output: path.relative(root, path.join(runDir, 'signal-harvest.json')),
      }
    },
  }
}
