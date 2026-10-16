import { spawnSync } from 'node:child_process'
import { existsSync } from 'node:fs'
import { fetchVettedRemoteUrl } from './source-image-network-policy.mjs'

export function withoutSourceUiCues(cues = []) {
  return cues.filter((cue) => !/\b(hud|debug|sliders?|health bars?|control panels?|panel cluster)\b/i.test(cue))
}

export function sourceGeometryGuard(source = {}) {
  const width = Number(source.width)
  const height = Number(source.height)
  if (!(width > 0 && height > 0)) return ''
  const shape = Math.abs(width - height) / Math.max(width, height) < 0.08 ? 'square' : width > height ? 'landscape' : 'portrait/vertical'
  return `SOURCE-ASPECT NOTE: measured source is ${shape} (${width}x${height}); this describes the reference, not the output canvas. Recompose its subjects, silhouettes, object relationships, light, surface and framing grammar on a landscape canvas. Keep subject proportions and source identity; no stretching, cropping, or padding to force orientation, no pasted source panel or unrelated replacement scene.`
}

export async function measureSourceImage(imageUrl) {
  const response = await fetchVettedRemoteUrl(imageUrl, { timeoutMs: 15000, maxBytes: 20 * 1024 * 1024 })
  if (!response.ok) throw new Error(`Source image measurement HTTP ${response.status}`)
  const bytes = Buffer.from(await response.arrayBuffer())
  const preferred = process.env.HERMES_IMAGE_PYTHON || '/Users/nickgeorge-studio/Projects/hermes/hermes-agent/venv/bin/python'
  const python = existsSync(preferred) ? preferred : 'python3'
  const result = spawnSync(python, ['-c', 'import sys,io,json; from PIL import Image; im=Image.open(io.BytesIO(sys.stdin.buffer.read())); print(json.dumps(dict(width=im.width,height=im.height)))'], { input: bytes, timeout: 15000, maxBuffer: 1024 * 1024 })
  if (result.status !== 0) throw new Error('Could not decode source image dimensions')
  return JSON.parse(result.stdout.toString())
}
