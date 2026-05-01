import type { ArtifactRecord } from '../types/runtime'

export const getArtifactCenter = (artifact: ArtifactRecord) => ({
  x: artifact.bounds.x + artifact.bounds.w / 2,
  y: artifact.bounds.y + artifact.bounds.h / 2,
})

export const getArtifactSceneReactionMetrics = (artifact: ArtifactRecord, anchorArtifact: ArtifactRecord) => {
  const artifactCenter = getArtifactCenter(artifact)
  const anchorCenter = getArtifactCenter(anchorArtifact)
  const dx = artifactCenter.x - anchorCenter.x
  const dy = artifactCenter.y - anchorCenter.y
  const distance = Math.sqrt(dx * dx + dy * dy)

  let tier = 3
  if (distance < 0.18) tier = 1
  else if (distance < 0.36) tier = 2

  const safeDistance = distance || 0.0001
  const unitX = dx / safeDistance
  const unitY = dy / safeDistance
  const strength = Math.max(0.2, 1 - Math.min(distance / 0.56, 0.82))

  return {
    tier,
    unitX,
    unitY,
    strength,
  }
}

type ArtifactInheritanceProfile = 'paper' | 'glass' | 'light' | 'living' | 'container' | 'device' | 'neutral'

export const getArtifactInheritanceProfile = (artifact: ArtifactRecord | null | undefined): ArtifactInheritanceProfile => {
  if (!artifact) return 'neutral'
  const type = artifact.artifact_type.toLowerCase()

  if (/(paper|sheet|note|chart|scroll|map|document|label|tab|book|board)/.test(type)) return 'paper'
  if (/(glass|lens|jar|vial|mirror)/.test(type)) return 'glass'
  if (/(lamp|candle|light|bulb)/.test(type)) return 'light'
  if (/(plant|specimen|leaf|flower|moss)/.test(type)) return 'living'
  if (/(tray|cabinet|case|box|container|cup|bowl|teapot|dish|vessel|shelf)/.test(type)) return 'container'
  if (/(device|display|cassette|headphones|listening|media|monitor|screen|tool|equipment|handset|cable|disk)/.test(type)) return 'device'
  return 'neutral'
}
