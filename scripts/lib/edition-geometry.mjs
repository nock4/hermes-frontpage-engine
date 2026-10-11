import fs from 'node:fs/promises'
import path from 'node:path'

export function clamp01(value) {
  if (!Number.isFinite(value)) return 0
  return Math.min(1, Math.max(0, value))
}

export function rectPolygon(bounds) {
  return [
    [bounds.x, bounds.y],
    [bounds.x + bounds.w, bounds.y],
    [bounds.x + bounds.w, bounds.y + bounds.h],
    [bounds.x, bounds.y + bounds.h],
  ].map(([x, y]) => [Number(x.toFixed(4)), Number(y.toFixed(4))])
}

export function parseImageSize(size) {
  const match = String(size || '').match(/^(\d+)x(\d+)$/)
  if (!match) return { width: 1536, height: 1024 }
  return { width: Number(match[1]), height: Number(match[2]) }
}

export async function readImageDimensions(filePath, fallbackSize = '1536x1024') {
  const fallback = parseImageSize(fallbackSize)
  try {
    const buffer = await fs.readFile(filePath)
    if (buffer.length >= 24 && buffer.toString('ascii', 1, 4) === 'PNG') {
      return { width: buffer.readUInt32BE(16), height: buffer.readUInt32BE(20) }
    }
    if (buffer.length >= 4 && buffer[0] === 0xff && buffer[1] === 0xd8) {
      let offset = 2
      while (offset + 9 < buffer.length) {
        if (buffer[offset] !== 0xff) {
          offset += 1
          continue
        }
        const marker = buffer[offset + 1]
        const length = buffer.readUInt16BE(offset + 2)
        if (length < 2) break
        if ((marker >= 0xc0 && marker <= 0xc3) || (marker >= 0xc5 && marker <= 0xc7) || (marker >= 0xc9 && marker <= 0xcb) || (marker >= 0xcd && marker <= 0xcf)) {
          return { width: buffer.readUInt16BE(offset + 7), height: buffer.readUInt16BE(offset + 5) }
        }
        offset += 2 + length
      }
    }
  } catch {
    // Fall through to the declared image generation size.
  }
  return fallback
}

function normalizedPolygonToSvgPoints(polygon, width, height) {
  const points = Array.isArray(polygon) && polygon.length >= 3 ? polygon : rectPolygon({ x: 0, y: 0, w: 1, h: 1 })
  return points
    .map((point) => {
      const x = clamp01(Number(point?.[0]))
      const y = clamp01(Number(point?.[1]))
      return `${Number((x * width).toFixed(2))},${Number((y * height).toFixed(2))}`
    })
    .join(' ')
}

export async function writeArtifactSvgMasks(editionDir, editionId, artifacts, dimensions, { root = process.cwd() } = {}) {
  const width = dimensions.width || 1536
  const height = dimensions.height || 1024
  const masksDir = path.join(editionDir, 'assets', 'masks')
  await fs.mkdir(masksDir, { recursive: true })
  const expectedMaskPaths = new Set()

  for (const artifact of artifacts) {
    const maskPath = artifact.mask_path || `/editions/${editionId}/assets/masks/${artifact.id}.svg`
    const localPath = maskPath.startsWith('/editions/')
      ? path.join(root, 'public', maskPath.replace(/^\//, ''))
      : path.join(masksDir, `${artifact.id}.svg`)
    expectedMaskPaths.add(path.resolve(localPath))
    const polygon = artifact.polygon || rectPolygon(artifact.bounds)
    const points = normalizedPolygonToSvgPoints(polygon, width, height)
    await fs.mkdir(path.dirname(localPath), { recursive: true })
    await fs.writeFile(localPath, [
      `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${width} ${height}">`,
      `  <polygon points="${points}" fill="white"/>`,
      '</svg>',
      '',
    ].join('\n'), 'utf8')
  }

  const maskEntries = await fs.readdir(masksDir).catch(() => [])
  await Promise.all(maskEntries
    .filter((entry) => entry.endsWith('.svg'))
    .map(async (entry) => {
      const localPath = path.resolve(path.join(masksDir, entry))
      if (expectedMaskPaths.has(localPath)) return
      await fs.unlink(localPath).catch(() => {})
    }))
}

export function safeOrigin(bounds, mode, { width = 1536, height = 1024 } = {}) {
  const x = Math.round((bounds.x + bounds.w * (mode === 'stage' ? 0.58 : 0.5)) * width)
  const y = Math.round((bounds.y + bounds.h * (mode === 'stage' ? 0.5 : 0.42)) * height)
  return [
    Math.round(Math.min(width * 1320 / 1536, Math.max(width * 90 / 1536, x))),
    Math.round(Math.min(height * 850 / 1024, Math.max(height * 80 / 1024, y))),
  ]
}

export function expansionLabel(bounds) {
  const centerX = bounds.x + bounds.w / 2
  const centerY = bounds.y + bounds.h / 2
  if (centerY > 0.68) return 'up'
  return centerX > 0.5 ? 'left' : 'right'
}
