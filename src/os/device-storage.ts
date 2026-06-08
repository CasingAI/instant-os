/** localStorage 硬上限 5 MB */
export const DEVICE_CAPACITY_BYTES = 5 * 1024 * 1024

export const GENERATED_APP_DATA_KEY_PREFIX = 'instant-os-generated-app-data:'

export const DEVICE_STORAGE_KEYS = {
  generatedApps: 'instant-os-generated-apps',
  listingDetails: 'instant-os-listing-details',
  listingReviews: 'instant-os-listing-reviews',
  storeListings: 'instant-os-store-listings',
  safariPageCache: 'instant-os-safari-page-cache',
  safariHistory: 'instant-os-safari-history',
  safariBookmarks: 'instant-os-safari-bookmarks',
  safariTokenUsage: 'instant-os-safari-token-usage',
  mail: 'instant-os-mail',
  news: 'instant-os-news',
  newsTokenUsage: 'instant-os-news-token-usage',
  windowSizes: 'instant-os:window-sizes',
  accountSettings: 'instant-os-account-settings',
  displaySettings: 'instant-os-display-settings',
  scene3dLabArchives: 'instant-os-scene3d-lab-archives',
  scene3dLabPrefs: 'instant-os-scene3d-lab-prefs',
  notificationCenterWidgets: 'instant-os-notification-center-widgets',
  weather: 'instant-os-weather',
  stocks: 'instant-os-stocks',
  catgpt: 'instant-os-catgpt',
} as const

const ACCOUNTED_KEYS: ReadonlySet<string> = new Set([
  DEVICE_STORAGE_KEYS.generatedApps,
  DEVICE_STORAGE_KEYS.listingDetails,
  DEVICE_STORAGE_KEYS.listingReviews,
  DEVICE_STORAGE_KEYS.storeListings,
  DEVICE_STORAGE_KEYS.safariPageCache,
  DEVICE_STORAGE_KEYS.mail,
  DEVICE_STORAGE_KEYS.news,
  DEVICE_STORAGE_KEYS.newsTokenUsage,
  DEVICE_STORAGE_KEYS.accountSettings,
])

export class DeviceStorageFullError extends Error {
  constructor() {
    super('设备存储空间已满（5 MB 上限）')
    this.name = 'DeviceStorageFullError'
  }
}

function byteSize(value: string): number {
  return new TextEncoder().encode(value).length
}

export function getLocalStorageKeyBytes(key: string): number {
  try {
    const raw = localStorage.getItem(key)
    if (!raw) {
      return 0
    }
    return byteSize(raw)
  } catch {
    return 0
  }
}

export function getTotalLocalStorageBytes(): number {
  try {
    let total = 0
    for (let index = 0; index < localStorage.length; index += 1) {
      const key = localStorage.key(index)
      if (!key) {
        continue
      }
      total += getLocalStorageKeyBytes(key)
    }
    return total
  } catch {
    return 0
  }
}

export function getAccountedStorageBytes(): number {
  let total = 0
  for (const key of ACCOUNTED_KEYS) {
    total += getLocalStorageKeyBytes(key)
  }
  return total
}

export type UnaccountedStorageEntry = {
  key: string
  bytes: number
}

function isAccountedStorageKey(key: string): boolean {
  if (ACCOUNTED_KEYS.has(key)) {
    return true
  }

  return key.startsWith(GENERATED_APP_DATA_KEY_PREFIX)
}

export function listUnaccountedStorageKeys(): UnaccountedStorageEntry[] {
  const entries: UnaccountedStorageEntry[] = []

  try {
    for (let index = 0; index < localStorage.length; index += 1) {
      const key = localStorage.key(index)
      if (!key || isAccountedStorageKey(key)) {
        continue
      }
      entries.push({ key, bytes: getLocalStorageKeyBytes(key) })
    }
  } catch {
    return []
  }

  return entries.sort((left, right) => right.bytes - left.bytes)
}

export function getOtherStorageBytes(): number {
  return listUnaccountedStorageKeys().reduce((total, entry) => total + entry.bytes, 0)
}

export function projectedStorageBytes(key: string, value: string): number {
  const currentTotal = getTotalLocalStorageBytes()
  const previousKeyBytes = getLocalStorageKeyBytes(key)
  return currentTotal - previousKeyBytes + byteSize(value)
}

export function wouldExceedDeviceStorage(key: string, value: string): boolean {
  return projectedStorageBytes(key, value) > DEVICE_CAPACITY_BYTES
}

export function writeLocalStorageItem(key: string, value: string): boolean {
  if (wouldExceedDeviceStorage(key, value)) {
    return false
  }

  try {
    localStorage.setItem(key, value)
    return true
  } catch {
    return false
  }
}

export function assertDeviceStorageCapacity(key: string, value: string): void {
  if (!writeLocalStorageItem(key, value)) {
    throw new DeviceStorageFullError()
  }
}
