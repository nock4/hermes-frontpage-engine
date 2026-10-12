import type { SourceBindingRecord } from '../types/runtime'
export interface OriginalImageDelivery {
  version: 1
  kind: 'attested-full-original'
  edition_id: string
  source_url: string
  media_url: string
  capture_sha256: string
  mime_type: 'image/png' | 'image/jpeg' | 'image/gif' | 'image/webp'
  byte_length: number
  asset_path: string
}
export const ORIGINAL_IMAGE_MAX_BYTES: number
export function originalImageMime(bytes: Uint8Array): OriginalImageDelivery['mime_type']
export function assertOriginalImageContract(binding: Pick<SourceBindingRecord, 'source_url' | 'source_image_url' | 'source_media_type' | 'source_media_url' | 'source_image_delivery'>, editionId: string): OriginalImageDelivery
