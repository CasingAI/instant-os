import type { StoreListing, StoreListingDetail } from './types.ts'

export function resolveListingDetailContext(
  listing: StoreListing,
  detail?: Partial<StoreListingDetail>,
  cached?: StoreListingDetail,
): Partial<StoreListingDetail> {
  return {
    tagline: (detail?.tagline ?? cached?.tagline)?.trim() || listing.description,
    longDescription:
      (detail?.longDescription ?? cached?.longDescription)?.trim() || listing.description,
    developer: (detail?.developer ?? cached?.developer)?.trim() || 'Instant AI',
    compatibility: (detail?.compatibility ?? cached?.compatibility)?.trim() || 'Instant OS',
    language: (detail?.language ?? cached?.language)?.trim() || '简体中文',
  }
}
