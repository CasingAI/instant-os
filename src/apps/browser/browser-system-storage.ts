import { DEVICE_STORAGE_KEYS, getLocalStorageKeyBytes } from '../../os/device-storage.ts'

export function getBrowserSystemStorageBytes(): number {
  return (
    getLocalStorageKeyBytes(DEVICE_STORAGE_KEYS.safariHistory) +
    getLocalStorageKeyBytes(DEVICE_STORAGE_KEYS.safariBookmarks) +
    getLocalStorageKeyBytes(DEVICE_STORAGE_KEYS.safariTokenUsage) +
    getLocalStorageKeyBytes(DEVICE_STORAGE_KEYS.safariSettings)
  )
}
