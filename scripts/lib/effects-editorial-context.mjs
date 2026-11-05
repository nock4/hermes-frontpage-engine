import { hasCreativeArtifactEvidence } from './source-selection-policy.mjs'

// Research metadata is context, never an admission. Only an existing actual-media
// inspection supplies citable source observation/capture provenance. Do not crawl,
// mint inspection stamps, or merge unrelated image_candidates here.
export function buildEffectsEditorialContext(payload, researchField = {}) {
  const brief = typeof payload.scene_prompt === 'string' ? payload.scene_prompt : ''
  const sources = (payload.artifacts || []).flatMap((artifact, planned_artifact_index) => {
    const source = (researchField.sources || []).find(s =>
      [s.url, s.source_url, s.final_url].includes(artifact.source_url))
    if (!source) return []
    const decision = (researchField.autoresearch?.source_decisions || []).find(d =>
      d.url === artifact.source_url && d.inspection?.source_url === artifact.source_url
      && hasCreativeArtifactEvidence(source, { source_decisions: [d] }))
    // Whole-field exclusions remain authoritative, not just the matching record.
    if (!decision || !hasCreativeArtifactEvidence(source, researchField.autoresearch)) return []
    const proof = decision.inspection
    return [{ planned_artifact_index, source_url: artifact.source_url,
      title: typeof source.title === 'string' ? source.title : '',
      summary: typeof source.description === 'string' ? source.description : '',
      observation: proof.observation, capture_sha256: proof.capture_sha256,
      capture_path: proof.capture_path, media_url: proof.media_url,
    }]
  })
  return { schema_version: 1, brief,
    aesthetic_thesis: typeof researchField.autoresearch?.aesthetic_thesis === 'string' ? researchField.autoresearch.aesthetic_thesis : '',
    sources }
}
