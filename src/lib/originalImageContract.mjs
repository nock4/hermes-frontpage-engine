// Delivery is not eligibility: literal remote identities remain authoritative.
export const ORIGINAL_IMAGE_MAX_BYTES = 8_000_000
const extensions = { 'image/png': 'png', 'image/jpeg': 'jpeg', 'image/gif': 'gif', 'image/webp': 'webp' }
export function originalImageMime(bytes) {
  const starts = (...values) => values.every((value, index) => bytes[index] === value)
  if (starts(137, 80, 78, 71, 13, 10, 26, 10)) return 'image/png'
  if (starts(255, 216, 255)) return 'image/jpeg'
  if (starts(71, 73, 70, 56) && [55, 57].includes(bytes[4]) && bytes[5] === 97) return 'image/gif'
  if (starts(82, 73, 70, 70) && bytes[8] === 87 && bytes[9] === 69 && bytes[10] === 66 && bytes[11] === 80) return 'image/webp'
  throw new Error('Original image delivery: unsupported raster bytes')
}
export function assertOriginalImageContract(binding, editionId) {
  const d = binding.source_image_delivery
  if (!d || typeof d !== 'object' || d.version !== 1 || d.kind !== 'attested-full-original'
    || !/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(editionId || '') || d.edition_id !== editionId
    || d.source_url !== binding.source_url
    || d.media_url !== (binding.source_image_url || (binding.source_media_type === 'image' ? binding.source_media_url : undefined))
    || !/^https?:\/\//.test(d.media_url || '') || !/^https?:\/\//.test(d.source_url || '')
    || (binding.source_media_type === 'image' && binding.source_media_url && binding.source_media_url !== d.media_url)
    || !/^[a-f0-9]{64}$/.test(d.capture_sha256 || '')
    || !Object.hasOwn(extensions, d.mime_type)
    || !Number.isSafeInteger(d.byte_length) || d.byte_length <= 0 || d.byte_length > ORIGINAL_IMAGE_MAX_BYTES
    || d.asset_path !== `/editions/${editionId}/assets/source-originals/${d.capture_sha256}.${extensions[d.mime_type]}`) {
    throw new Error('Original image delivery: invalid identity, digest or same-edition asset path')
  }
  return d
}
