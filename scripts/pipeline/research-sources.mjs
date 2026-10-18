import fs from 'node:fs/promises'
import path from 'node:path'

async function writeJson(file, value) {
  await fs.mkdir(path.dirname(file), { recursive: true })
  await fs.writeFile(file, `${JSON.stringify(value, null, 2)}\n`, 'utf8')
}

// Keep the failed reserve attempt's top-level research files before the
// fresh fallback overwrites them.
async function retainAttempt(runDir) {
  const destination = path.join(runDir, 'prepared-reserve-attempt')
  await fs.mkdir(destination, { recursive: true })
  for (const item of await fs.readdir(runDir, { withFileTypes: true })) {
    if (item.isFile()) await fs.copyFile(path.join(runDir, item.name), path.join(destination, item.name))
  }
}

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
    tool: `Node fetch evidence + Hermes structured JSON + ${options.sourceTool === 'browser-harness' ? 'browser-harness Chrome capture' : 'Node fetch capture'}`,
    command: `internal:autoresearch-sources --requested-model ${options.model} --capture-tool ${options.sourceTool} --max-sources ${options.maxSources}`,
    run: async () => {
      // One 24-acquisition / 24-inspection allowance for the whole step,
      // shared by a prepared-reserve attempt and any fresh fallback.
      const bookmarkBudget = { acquisitions: 0, inspections: 0 }
      const research = harvest => inspectSourceCandidates(harvest, {
        maxSources: options.maxSources,
        runDir,
        sourceTool: options.sourceTool,
        browserHarness: options.browserHarness,
        recentSourceKeys,
        apiKey,
        model: options.model,
        date: options.date,
        inspirationOverride: context.inspirationOverride,
        bookmarkBudget,
      })
      const claim = context.reserveClaim
      context.reserveClaim = null
      if (claim) {
        // The reserve's own notes went through ordinary bounded admission. Consume
        // it only on success with byte-identical captures; otherwise retire it
        // as evidence and fall back to fresh intake within the remaining budget.
        let field = null, researchError = null
        try { field = await research(context.signalHarvest) } catch (error) { researchError = error }
        let outcome
        // Finalize is called exactly once. Its own failure is recorded, not retried.
        try {
          outcome = await context.finalizeReserve(claim, researchError ? { error: researchError } : { contentSources: field.content_sources, autoresearch: field.autoresearch })
        } catch (error) {
          outcome = { state: 'finalize-error', set_id: claim.set?.set_id || null, error: error.message }
        }
        context.preparedReserveOutcome = { ...outcome, research_error: researchError?.message || null, budget_after_attempt: { ...bookmarkBudget } }
        const evidenceErrors = []
        try { await writeJson(path.join(runDir, 'prepared-reserve-outcome.json'), { ...context.preparedReserveOutcome, claim: context.preparedReserveClaimResult || null }) } catch (error) { evidenceErrors.push(error.message) }
        if (outcome.state === 'consumed') context.researchField = field
        else {
          if (bookmarkBudget.acquisitions >= 24 || bookmarkBudget.inspections >= 24) {
            // Fail closed rather than buy a second bounded budget.
            throw researchError || new Error(`Prepared reserve not consumed (${outcome.state}) and the shared 24 acquisition/inspection budget is exhausted; no second budget is spent`)
          }
          try { await retainAttempt(runDir) } catch (error) { evidenceErrors.push(error.message) }
          if (evidenceErrors.length) context.preparedReserveOutcome.evidence_errors = evidenceErrors
          context.signalHarvest = await context.remineWithoutReserve()
          context.researchField = await research(context.signalHarvest)
        }
      } else context.researchField = await research(context.signalHarvest)
      return {
        sources: context.researchField.source_count,
        tool: context.researchField.source_research_tool,
        capture_tool: context.researchField.source_capture_tool,
        fetch_evidence: context.researchField.fetch_evidence_count,
        autoresearch_thesis: context.researchField.autoresearch?.edition_thesis || null,
        visual_reference: context.researchField.visual_reference ? {
          title: context.researchField.visual_reference.title,
          source_url: context.researchField.visual_reference.source_url || context.researchField.visual_reference.url || null,
          has_image: Boolean(context.researchField.visual_reference.image_url),
          selection_reason: context.researchField.visual_reference.selection_reason,
        } : null,
        content_sources: context.researchField.content_source_count,
        prepared_reserve: context.preparedReserveOutcome ? { state: context.preparedReserveOutcome.state, set_id: context.preparedReserveOutcome.set_id, reason: context.preparedReserveOutcome.reason || null } : null,
        output: path.relative(root, path.join(runDir, 'source-research.json')),
      }
    },
  }
}
