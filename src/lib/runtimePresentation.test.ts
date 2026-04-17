import { describe, expect, it } from 'vitest'
import { getRuntimePresentation, type ReviewMode } from './runtimePresentation'

const getMode = (reviewMode: ReviewMode) => getRuntimePresentation(reviewMode)

describe('getRuntimePresentation', () => {
  it('treats live mode as the real-deal presentation', () => {
    expect(getMode('live')).toEqual({
      showTopbar: false,
      showSidebar: false,
      showArtifactLists: false,
      showReviewPanel: false,
      showPersistentRegionLabels: false,
      showStageOverlayWindows: false,
      stageFillViewport: true,
      briefEyebrow: 'Edition',
      selectionEyebrow: 'Active pocket',
      sourceWindowsEmptyState: 'Open a pocket to pin a source window.',
    })
  })

  it('keeps clickable review mode explicitly review-oriented', () => {
    expect(getMode('clickable')).toEqual({
      showTopbar: true,
      showSidebar: true,
      showArtifactLists: true,
      showReviewPanel: true,
      showPersistentRegionLabels: true,
      showStageOverlayWindows: false,
      stageFillViewport: false,
      briefEyebrow: 'Review mode',
      selectionEyebrow: 'Selection',
      sourceWindowsEmptyState: 'Hover for preview, click to pin.',
    })
  })

  it('keeps solo and debug modes in the review lane', () => {
    for (const mode of ['solo', 'debug'] satisfies ReviewMode[]) {
      expect(getMode(mode).showTopbar).toBe(true)
      expect(getMode(mode).showSidebar).toBe(true)
      expect(getMode(mode).showReviewPanel).toBe(true)
      expect(getMode(mode).showArtifactLists).toBe(true)
      expect(getMode(mode).showPersistentRegionLabels).toBe(true)
      expect(getMode(mode).showStageOverlayWindows).toBe(false)
      expect(getMode(mode).stageFillViewport).toBe(false)
      expect(getMode(mode).briefEyebrow).toBe('Review mode')
    }
  })
})
