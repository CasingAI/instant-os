import type { StoreListingDetail } from '../apps/appstore/types.ts'
import {
  DEVICE_STORAGE_KEYS,
  getLocalStorageKeyBytes,
  writeLocalStorageItem,
} from './device-storage.ts'

const STORAGE_KEY = DEVICE_STORAGE_KEYS.listingDetails

export function loadListingDetails(): Record<string, StoreListingDetail> {
  try {
    const raw = localStorage.getItem(STORAGE_KEY)
    if (!raw) {
      return {}
    }

    const parsed: unknown = JSON.parse(raw)
    if (typeof parsed !== 'object' || parsed === undefined || parsed === null || Array.isArray(parsed)) {
      return {}
    }

    const result: Record<string, StoreListingDetail> = {}
    for (const [slug, value] of Object.entries(parsed)) {
      if (typeof slug === 'string' && isValidListingDetail(value)) {
        result[slug] = value
      }
    }
    return result
  } catch {
    return {}
  }
}

export function saveListingDetails(details: Record<string, StoreListingDetail>): boolean {
  return writeLocalStorageItem(STORAGE_KEY, JSON.stringify(details))
}

export function getListingDetailsStorageBytes(): number {
  return getLocalStorageKeyBytes(STORAGE_KEY)
}

function isValidListingDetail(value: unknown): value is StoreListingDetail {
  if (typeof value !== 'object' || value === undefined) {
    return false
  }

  const record = value as Record<string, unknown>
  return (
    typeof record.tagline === 'string' &&
    typeof record.longDescription === 'string' &&
    typeof record.developer === 'string' &&
    typeof record.compatibility === 'string' &&
    typeof record.language === 'string'
  )
}
