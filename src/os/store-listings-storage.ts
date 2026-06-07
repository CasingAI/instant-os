import type { StoreListing } from '../apps/appstore/types.ts'
import {
  DEVICE_STORAGE_KEYS,
  getLocalStorageKeyBytes,
  writeLocalStorageItem,
} from './device-storage.ts'

const STORAGE_KEY = DEVICE_STORAGE_KEYS.storeListings

export function loadStoreListings(): StoreListing[] {
  try {
    const raw = localStorage.getItem(STORAGE_KEY)
    if (!raw) {
      return []
    }

    const parsed: unknown = JSON.parse(raw)
    if (!Array.isArray(parsed)) {
      return []
    }

    return parsed.filter(isValidStoreListing)
  } catch {
    return []
  }
}

export function saveStoreListings(listings: StoreListing[]): boolean {
  return writeLocalStorageItem(STORAGE_KEY, JSON.stringify(listings))
}

export function getStoreListingsStorageBytes(): number {
  return getLocalStorageKeyBytes(STORAGE_KEY)
}

function isValidStoreListing(value: unknown): value is StoreListing {
  if (typeof value !== 'object' || value === undefined) {
    return false
  }

  const record = value as Record<string, unknown>
  return (
    typeof record.slug === 'string' &&
    typeof record.name === 'string' &&
    typeof record.description === 'string' &&
    typeof record.category === 'string' &&
    typeof record.iconEmoji === 'string' &&
    typeof record.themeColor === 'string'
  )
}
