import { it, expect } from 'vitest'
import { reviewEffectsFromRequest } from '../../scripts/lib/effects-review-plugin.mjs'
const context = {
  editionId: 'qa',
  artifacts: [
    {
      id: 'a',
      bounds: { x: 0.2, y: 0.2, w: 0.5, h: 0.5 },
      polygon: [
        [0.2, 0.2],
        [0.7, 0.2],
        [0.7, 0.7],
      ],
      source_binding_ids: ['b'],
    },
  ],
  bindings: [{ id: 'b', artifact_id: 'a', source_url: 'https://artist.example/work' }],
}
const admission = {
  edition_id: 'qa',
  evidence: [
    {
      artifact_id: 'a',
      binding_id: 'b',
      material: 'metal',
      observation: 'Approved QA-only inspected reflective ridge',
      modalities: ['reflective'],
    },
  ],
}
it('requires explicit QA optin and a local admission, never changes real contracts or admits still video', () => {
  expect(reviewEffectsFromRequest({ query: '', context, admission })).toBeNull()
  expect(
    reviewEffectsFromRequest({ query: '?qaEffects=1&effectReview=camera', context, admission: null }),
  ).toBeNull()
  expect(
    reviewEffectsFromRequest({
      query: '?qaEffects=1&effectReview=camera',
      context,
      admission,
      hasContract: true,
    }),
  ).toBeNull()
  expect(
    reviewEffectsFromRequest({ query: '?qaEffects=1&effectReview=projection', context, admission }),
  ).toBeNull()
  expect(
    reviewEffectsFromRequest({ query: '?qaEffects=1&effectReview=camera', context, admission })?.effects[0]
      .kind,
  ).toBe('camera')
})
