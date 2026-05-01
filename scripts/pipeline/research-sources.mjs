import path from 'node:path'

export function createResearchSourcesStep({
  apiKey,
  context,
  inspectSourceCandidates,
  options,
  recentSourceKeys,
  root,
  runDir,
}) {
  return {
    name: 'Deep source autoresearch and browser capture',
    tool: `Node fetch evidence + OpenAI Responses API (${options.model}) + ${options.sourceTool === 'browser-harness' ? 'browser-harness Chrome capture' : 'Node fetch capture'}`,
    command: `internal:autoresearch-sources --model ${options.model} --capture-tool ${options.sourceTool} --max-sources ${options.maxSources}`,
    run: async () => {
      context.researchField = await inspectSourceCandidates(context.signalHarvest, {
        maxSources: options.maxSources,
        runDir,
        sourceTool: options.sourceTool,
        browserHarness: options.browserHarness,
        recentSourceKeys,
        apiKey,
        model: options.model,
        date: options.date,
      })
      return {
        sources: context.researchField.source_count,
        tool: context.researchField.source_research_tool,
        capture_tool: context.researchField.source_capture_tool,
        fetch_evidence: context.researchField.fetch_evidence_count,
        autoresearch_thesis: context.researchField.autoresearch?.edition_thesis || null,
        visual_reference: context.researchField.visual_reference ? {
          title: context.researchField.visual_reference.title,
          image_url: context.researchField.visual_reference.image_url,
          selection_reason: context.researchField.visual_reference.selection_reason,
        } : null,
        content_sources: context.researchField.content_source_count,
        output: path.relative(root, path.join(runDir, 'source-research.json')),
      }
    },
  }
}
