import { describe, it, expect } from 'vitest'
import { isAiToolingContentSource, selectContentSources, visualReferenceScore } from '../../scripts/lib/source-selection-policy.mjs'
import { selectAnchorSource } from '../../scripts/lib/anchor-source-research.mjs'
import { isAiToolingImageMaterial, buildPromotedVisualAnchorMaterial } from '../../scripts/lib/source-research.mjs'

const advice = {
  url: 'https://x.com/karpathy/status/2053872850101285137',
  title: '@karpathy: Ask LLMs for HTML output',
  description: 'This works really well btw, at the end of your query ask your LLM to "structure your response as HTML", then view the generated file in your browser.',
  note_path: '01 - Active/themes/AI & Agents/karpathy-html-as-llm-output.md',
  source_channel: 'twitter-bookmark', source_type: 'tweet', fetch_status: 'fetch-ok',
  image_url: 'https://pbs.twimg.com/tweet_video_thumb/HIDXohiaQAQJTC2?format=webp&name=large',
}
const raster = { page_url: 'https://x.com/status/2053872850101285137', image_url: advice.image_url, title: '', caption: '', visual_reason: 'Image surfaced directly on the selected anchor page.' }

describe('LLM advice source and parent-image quarantine', () => {
  it.each([advice, { ...advice, url: raster.page_url, title: 'Saved post' }])('rejects named and authorless LLM advice without author bans: $url', source => {
    expect(isAiToolingContentSource(source)).toBe(true)
    expect(selectAnchorSource([source])).toBeNull()
    expect(selectContentSources([source])).toEqual([])
    expect(visualReferenceScore(source)).toBe(Number.NEGATIVE_INFINITY)
  })
  it('keeps parent evidence when an opaque attached raster has no title', () => {
    expect(isAiToolingImageMaterial(raster, { evidenceSources: [advice] })).toBe(true)
    expect(isAiToolingImageMaterial({ ...raster, parent_source: advice })).toBe(true)
    expect(isAiToolingImageMaterial({ ...raster, page_url: 'https://x.com/artist/status/999' }, { evidenceSources: [advice] })).toBe(false)
  })
  it('does not promote a reference whose inspected parent text is tooling advice', () => {
    expect(buildPromotedVisualAnchorMaterial({ ...advice, title: 'Saved image', description: '', visible_text: advice.description })).toBeNull()
    expect(buildPromotedVisualAnchorMaterial(raster, { evidenceSources: [advice] })).toBeNull()
  })
  it.each([
    { ...advice, title: 'Voxel garden', description: 'Built with GPT-5.5: a Three.js voxel action-adventure scene' },
    { ...advice, title: 'Plotter art', description: 'Generative artwork and code in an exhibition about LLMs' },
    { ...advice, title: 'Painting by Karpathy', description: 'A watercolor study' },
  ])('preserves creative/code works regardless of author or folder: $title', source => {
    expect(isAiToolingContentSource(source)).toBe(false)
    expect(selectAnchorSource([source])).not.toBeNull()
  })
})
