import type { CSSProperties } from 'react'

import type { AboutRecord } from '../types/about'

type SourceWindowPlacementStyle = CSSProperties & {
  '--emission-x': string
  '--emission-y': string
  '--source-window-bloom-origin': string
  '--source-window-bloom-x': string
  '--source-window-bloom-y': string
}

type AboutTypographyStyle = CSSProperties & {
  '--about-heading-font'?: string
  '--about-body-font'?: string
  '--about-accent-font'?: string
  '--about-heading-weight'?: number
  '--about-body-weight'?: number
  '--about-accent-weight'?: number
  '--source-card-title-font'?: string
  '--source-card-body-font'?: string
  '--source-card-accent-font'?: string
  '--source-card-title-weight'?: number
  '--source-card-body-weight'?: number
  '--source-card-accent-weight'?: number
}

const clampPercent = (value: number) => Math.min(100, Math.max(0, value))

interface StageWindowPlacementLike {
  x: number
  y: number
  width: number
  maxHeight: number
  emissionX: number
  emissionY: number
}

export const getSourceWindowPlacementStyle = (placement: StageWindowPlacementLike, stackIndex: number): SourceWindowPlacementStyle => {
  const bloomX = clampPercent(((placement.emissionX - placement.x) / placement.width) * 100)
  const bloomY = clampPercent(((placement.emissionY - placement.y) / placement.maxHeight) * 100)

  return {
    left: `${placement.x * 100}%`,
    top: `${placement.y * 100}%`,
    width: `${placement.width * 100}%`,
    maxWidth: 'calc(100% - 1.5rem)',
    maxHeight: `min(${placement.maxHeight * 100}%, calc(100% - 1.5rem))`,
    zIndex: 40 + stackIndex,
    '--emission-x': `${placement.emissionX * 100}%`,
    '--emission-y': `${placement.emissionY * 100}%`,
    '--source-window-bloom-origin': `${bloomX}% ${bloomY}%`,
    '--source-window-bloom-x': `${bloomX}%`,
    '--source-window-bloom-y': `${bloomY}%`,
  }
}

export const getAboutTypographyStyle = (about: AboutRecord | null | undefined): AboutTypographyStyle | undefined => {
  const typography = about?.typography
  if (!typography) return undefined

  return {
    '--about-heading-font': typography.heading_family,
    '--about-body-font': typography.body_family,
    '--about-accent-font': typography.accent_family,
    '--about-heading-weight': typography.heading_weight,
    '--about-body-weight': typography.body_weight,
    '--about-accent-weight': typography.accent_weight,
    '--source-card-title-font': typography.heading_family,
    '--source-card-body-font': typography.body_family,
    '--source-card-accent-font': typography.accent_family,
    '--source-card-title-weight': typography.heading_weight,
    '--source-card-body-weight': typography.body_weight,
    '--source-card-accent-weight': typography.accent_weight,
  }
}
