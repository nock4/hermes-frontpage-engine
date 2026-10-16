import path from 'node:path'
import sharp from 'sharp'

// Source measurements describe content, never the output canvas policy.
export function landscapeImageSize(size) {
  const match = /^(\d+)x(\d+)$/.exec(String(size || ''))
  return match && Number(match[1]) > Number(match[2]) && Number(match[2]) > 0 ? size : '1536x1024'
}

export async function assertLandscapePlate(filePath) {
  let dimensions = { width: 0, height: 0 }
  try {
    // Fully decode: a plausible PNG/JPEG header is not proof of readable pixels.
    // No resize, crop, rotation or write is allowed at this gate.
    const { info } = await sharp(filePath, { failOn: 'warning' }).raw().toBuffer({ resolveWithObject: true })
    dimensions = { width: info.width, height: info.height }
  } catch {
    // Missing, truncated, corrupt and unsupported bytes all fail closed.
  }
  if (!(dimensions.width > dimensions.height && dimensions.height > 0)) {
    const error = new Error(`Landscape plate required: actual ${dimensions.width}x${dimensions.height} at ${filePath}; regenerate by source-native landscape recomposition, never stretch, crop, or pad.`)
    error.code = 'DFE_LANDSCAPE_REQUIRED'
    throw error
  }
  return dimensions
}

export async function assertLandscapePublication(editionDir) {
  for (const asset of ['plate.png', 'preview.png']) {
    await assertLandscapePlate(path.join(editionDir, 'assets', asset))
  }
}
