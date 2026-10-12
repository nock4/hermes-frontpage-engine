import type { SourceBindingRecord } from '../types/runtime'
import { assertOriginalImageContract, originalImageMime, ORIGINAL_IMAGE_MAX_BYTES } from './originalImageContract.mjs'

// JSON alone is not a runtime delivery permit. Only loader-verified bytes can
// select the local asset; remote identities are never overwritten or aliased.
const verified = new WeakMap<SourceBindingRecord, string>()
const identity = (binding: SourceBindingRecord) => JSON.stringify([binding.source_url, binding.source_image_url,
  binding.source_media_url, binding.source_media_type, binding.source_image_delivery])
export function getOriginalImageDeliveryUrl(binding: SourceBindingRecord): string | null {
  return verified.get(binding) === identity(binding) ? binding.source_image_delivery?.asset_path || null : null
}
export async function verifyOriginalImageDelivery(binding: SourceBindingRecord, editionId: string) {
  verified.delete(binding)
  if (binding.source_image_delivery === undefined) return
  const d = assertOriginalImageContract(binding, editionId)
  const before = identity(binding)
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), 8000)
  try {
    const response = await fetch(d.asset_path, { redirect: 'error', credentials: 'same-origin', signal: controller.signal })
    if (!response.ok || response.redirected || response.headers.get('content-type')?.split(';')[0] !== d.mime_type
      || !response.body || Number(response.headers.get('content-length') || 0) > ORIGINAL_IMAGE_MAX_BYTES) {
      throw new Error('Original image delivery: invalid response')
    }
    const reader = response.body.getReader()
    const chunks: Uint8Array[] = []; let length = 0
    try {
      while (true) {
        const { value, done } = await reader.read()
        if (done) break
        length += value.length
        if (length > d.byte_length || length > ORIGINAL_IMAGE_MAX_BYTES) throw new Error('Original image delivery: oversized response')
        chunks.push(value)
      }
    } catch (error) { controller.abort(); await reader.cancel().catch(() => {}); throw error }
    finally { reader.releaseLock() }
    const bytes = new Uint8Array(length); let offset = 0
    for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.length }
    const hash = Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256', bytes)), byte => byte.toString(16).padStart(2, '0')).join('')
    if (length !== d.byte_length || hash !== d.capture_sha256 || originalImageMime(bytes) !== d.mime_type || identity(binding) !== before) {
      throw new Error('Original image delivery: integrity mismatch')
    }
    verified.set(binding, before)
  } finally { clearTimeout(timer) }
}
