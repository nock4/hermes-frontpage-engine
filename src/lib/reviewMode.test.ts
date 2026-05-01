import { describe, expect, it } from 'vitest'

import { getReviewMode } from './reviewMode'

describe('getReviewMode', () => {
  it('defaults to live mode with no review params', () => {
    expect(getReviewMode('')).toBe('live')
    expect(getReviewMode('?edition=signal-field-v3')).toBe('live')
  })

  it('detects mask debug mode before qa params', () => {
    expect(getReviewMode('?debug=masks')).toBe('debug')
    expect(getReviewMode('?debug=masks&qa=solo')).toBe('debug')
  })

  it('detects clickable and solo qa states', () => {
    expect(getReviewMode('?qa=clickable')).toBe('clickable')
    expect(getReviewMode('?qa=solo')).toBe('solo')
  })
})
