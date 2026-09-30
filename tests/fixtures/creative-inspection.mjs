// Synthetic unit-test attestations. Never import into production or run artifacts.
export function inspectedDecision(source, artifact_kind = 'artwork') {
  return { url: source.url, role: 'content', confidence: 'high', inspection: {
    version: 1, source_url: source.url, media_url: source.image_url,
    inspector: 'creative-artifact-vision', status: 'verified', artifact_kind,
    confidence: 'high', observation: 'Synthetic fixture: painted figures and trees',
    capture_sha256: 'a'.repeat(64), capture_path: '/synthetic-test-only/capture.jpg',
  } }
}
