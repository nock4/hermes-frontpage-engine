import { MIN_SOURCE_WINDOWS } from '../../src/lib/sourceWindowCountContract.mjs'
// One correction of the SAME inspected source field. Never reselect sources,
// weaken the floor, or spend an image call on a failed inspection provider.
export async function recoverMappedPlate({ context, snapshot, replan, generate, audit, map, wait = ms => new Promise(resolve => setTimeout(resolve, ms)) }) {
  if (context.analysis?.inspection_error) {
    await snapshot('inspection-failed')
    await wait(2000)
    await map()
    if (context.analysis?.inspection_error) throw new Error(`Mapping inspection remains unavailable: ${context.analysis.inspection_error}`)
    // An available retry now has real observations; handle a genuine floor below.
  }
  const count = context.analysis?.detected_objects?.length || 0
  if (count >= MIN_SOURCE_WINDOWS) return
  await snapshot('mapping-blocked')
  const sourceIdentity = JSON.stringify([context.researchField, context.signalHarvest, context.payload.source_image_fingerprints])
  context.payload = {
    ...context.payload,
    mapping_recovery_diagnostics: structuredClone(context.analysis),
    real_mark_plan: { status: 'needs-replan', reason: `Only ${count} real mapped objects survived` },
    scene_prompt: `${context.payload.scene_prompt} Mapping correction: the prior plate yielded only ${count} real visible source-bearing objects after normalization. Keep the same source identities, handmade silhouettes and image-only composition. Make the ${context.payload.artifacts?.length || MIN_SOURCE_WINDOWS} supplied source-derived contours visibly separable, not labels, rings, debug marks, cards, invented unrelated objects, or duplicated regions. Retain expressive roughness; do not over-articulate figures to meet a count.`,
  }
  await replan()
  if (JSON.stringify([context.researchField, context.signalHarvest, context.payload.source_image_fingerprints]) !== sourceIdentity) throw new Error('Mapping recovery changed source identity; refusing generation')
  await generate()
  await audit() // The unchanged fidelity gate must pass for these exact bytes.
  await map()
  if (context.analysis?.inspection_error) throw new Error(`Mapping inspection unavailable after correction: ${context.analysis.inspection_error}`)
  const finalCount = context.analysis?.detected_objects?.length || 0
  if (finalCount < MIN_SOURCE_WINDOWS) throw new Error(`Same-source correction still has ${finalCount} real mapped objects; retained evidence requires operator review, not blind reselection`)
}
