import type { StoreListing } from '../apps/appstore/types.ts'
import { ensureListingTags } from '../apps/appstore/listing-tags.ts'
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

    return parsed.map(normalizeStoredListing).filter((listing): listing is StoreListing => listing !== undefined)
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

function normalizeStoredListing(value: unknown): StoreListing | undefined {
  if (typeof value !== 'object' || value === undefined) {
    return undefined
  }

  const record = value as Record<string, unknown>
  if (
    typeof record.slug !== 'string' ||
    typeof record.name !== 'string' ||
    typeof record.description !== 'string' ||
    typeof record.category !== 'string' ||
    typeof record.iconEmoji !== 'string' ||
    typeof record.themeColor !== 'string'
  ) {
    return undefined
  }

  const listing = {
    slug: record.slug,
    name: record.name,
    description: record.description,
    category: record.category,
    iconEmoji: record.iconEmoji,
    themeColor: record.themeColor,
    tags: record.tags,
  }

  return {
    ...listing,
    tags: ensureListingTags(listing),
  }
}
