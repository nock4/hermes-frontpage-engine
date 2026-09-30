import { describe, it, expect } from 'vitest'
import { hasCreativeArtifactEvidence, isAutoresearchExcluded } from '../../scripts/lib/source-selection-policy.mjs'
const source = { url: 'https://artist.example/work', image_url: 'https://artist.example/work.jpg' }
const proof = { version: 1, source_url: source.url, media_url: source.image_url, status: 'verified', artifact_kind: 'artwork', confidence: 'high', observation: 'Four painted figures arranged in panels', capture_sha256: 'a'.repeat(64), capture_path: '/run/capture.jpg', inspector: 'creative-artifact-vision' }
const research = (inspection) => ({ source_decisions: [{ url: source.url, role: 'content', confidence: 'high', why: 'Inspected artwork', inspection }] })
describe('typed creative inspection', () => {
  it('rejects affirmative prose without actual bound inspection', () => expect(hasCreativeArtifactEvidence(source, research())).toBe(false))
  it('accepts typed art and game scene observations', () => {
    expect(hasCreativeArtifactEvidence(source, research(proof))).toBe(true)
    expect(hasCreativeArtifactEvidence(source, research({ ...proof, artifact_kind: 'game' }))).toBe(true)
  })
  it.each([{status:'unknown'}, {status:'ambiguous'}, {media_url:'https://artist.example/changed.jpg'}, {source_url:'https://other.example/'}, {capture_sha256:''}, {artifact_kind:'product'}, {confidence:'medium'}])('rejects insufficient or changed evidence %j', (change) => expect(hasCreativeArtifactEvidence(source, research({...proof,...change}))).toBe(false))
  it.each(['supporting-only','supporting_only','supporting only'])('retains %s constraints', role => expect(isAutoresearchExcluded(source, {source_decisions:[{url:source.url,role}]})).toBe(true))
})
