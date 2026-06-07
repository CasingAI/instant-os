import type { StoreReview } from '../apps/appstore/types.ts'
import {
  DEVICE_STORAGE_KEYS,
  getLocalStorageKeyBytes,
  writeLocalStorageItem,
} from './device-storage.ts'

const STORAGE_KEY = DEVICE_STORAGE_KEYS.listingReviews

export function loadListingReviews(): Record<string, StoreReview[]> {
  try {
    const raw = localStorage.getItem(STORAGE_KEY)
    if (!raw) {
      return {}
    }

    const parsed: unknown = JSON.parse(raw)
    if (typeof parsed !== 'object' || parsed === undefined || parsed === null || Array.isArray(parsed)) {
      return {}
    }

    const result: Record<string, StoreReview[]> = {}
    for (const [slug, value] of Object.entries(parsed)) {
      if (typeof slug !== 'string' || !Array.isArray(value)) {
        continue
      }
      const reviews = value.filter(isValidStoreReview)
      if (reviews.length > 0) {
        result[slug] = reviews
      }
    }
    return result
  } catch {
    return {}
  }
}

export function saveListingReviews(reviews: Record<string, StoreReview[]>): boolean {
  return writeLocalStorageItem(STORAGE_KEY, JSON.stringify(reviews))
}

export function getListingReviewsStorageBytes(): number {
  return getLocalStorageKeyBytes(STORAGE_KEY)
}

function isValidStoreReview(value: unknown): value is StoreReview {
  if (typeof value !== 'object' || value === undefined) {
    return false
  }

  const record = value as Record<string, unknown>
  return (
    typeof record.id === 'string' &&
    typeof record.author === 'string' &&
    typeof record.rating === 'number' &&
    typeof record.body === 'string' &&
    typeof record.version === 'string' &&
    typeof record.createdAt === 'number'
  )
}
