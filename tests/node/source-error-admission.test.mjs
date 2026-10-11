import { expect, it } from 'vitest'
import { hasCreativeArtifactEvidence, isAllowedInspectedSource, isLowValueVisualImage, selectBestVisualReference, selectContentSources, sourceHasRenderableCardSurface } from '../../scripts/lib/source-selection-policy.mjs'

const page = { url: 'https://www.nps.gov/articles/pollinator-gardens.htm', source_url: 'https://www.nps.gov/articles/pollinator-gardens.htm', title: 'Requested Page Not Found (404)', description: "Page not found We're sorry, we can't find the page you're looking for. Visit homepage Error code: 404", fetch_status: 'browser-harness', image_url: 'https://example.com/photograph.jpg', editorial_evidence: [{ fetch_status: 'fetch-http-404' }] }
const proofFor = (source, confidence = 'high') => ({ source_decisions: [{ url: source.url, role: 'content', confidence, inspection: { version: 1, status: 'verified', inspector: 'creative-artifact-vision', confidence, artifact_kind: 'photography', source_url: source.url, media_url: source.image_url, capture_sha256: 'a'.repeat(64), capture_path: '/fixture.jpg', observation: 'A real photograph, unrelated to the requested missing article.' } }] })

it.each([
  page,
  { ...page, title: 'Page not found - Collection', description: 'Oops! Back to home.' },
  { ...page, title: 'Garden guide', description: '', fetch_status: 'fetch-http-404' },
  { ...page, title: 'Garden guide', description: '', fetch_status: 'fetch-http-410' },
  { ...page, title: 'Garden guide', description: '', http_status: 404 },
])('blocks current error pages despite affirmative unrelated pixels: $title / $fetch_status', source => {
  const research = proofFor(source)
  expect(isAllowedInspectedSource(source)).toBe(false)
  expect(sourceHasRenderableCardSurface(source)).toBe(false)
  expect(hasCreativeArtifactEvidence(source, research)).toBe(false)
  expect(selectContentSources([source], { autoresearch: research })).toEqual([])
  expect(selectBestVisualReference([source])).toBeNull()
})

it.each([
  { title: 'Page Not Found', description: 'An original painting about the disappearing web.' },
  { title: 'Collected essays', description: 'An essay discussing Page not found and Back to Home.' },
  { title: 'A quiet evening', description: 'Welcome back to home.', fetch_status: 'fetch-ok' },
  { title: 'Garden guide', description: 'A recovered browser article', http_status: 200 },
])('preserves artwork titles, quotations and recovery over stale failures: $title', fields => {
  const source = { ...page, ...fields }
  expect(hasCreativeArtifactEvidence(source, proofFor(source))).toBe(true)
  expect(selectContentSources([source], { autoresearch: proofFor(source) })).toEqual([source])
})

it('keeps medium-confidence verified pixels below the unchanged admission threshold', () => {
  for (const url of ['https://curenailhouse.com/', 'https://www.formandseek.com/']) {
    const source = { ...page, url, source_url: url, title: 'Creative studio', description: 'Original artwork' }
    expect(sourceHasRenderableCardSurface(source)).toBe(true)
    expect(hasCreativeArtifactEvidence(source, proofFor(source, 'medium'))).toBe(false)
    expect(selectContentSources([source], { autoresearch: proofFor(source, 'medium') })).toEqual([])
  }
})

it('rejects global-navigation imagery regardless of photographed subject', () => {
  const image_url = 'https://www.nps.gov/common/commonspot/templates/assets/images/globalnav/GlobalNavPromo_GLAC_JacobWFrank_158x94.jpg'
  expect(isLowValueVisualImage(image_url)).toBe(true)
  expect(sourceHasRenderableCardSurface({ ...page, title: 'Garden guide', description: 'Planting habitat', image_url })).toBe(false)
  expect(isLowValueVisualImage('https://museum.example/art/navigation-study.jpg')).toBe(false)
})
