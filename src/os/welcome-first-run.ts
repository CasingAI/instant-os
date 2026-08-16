import { DEVICE_STORAGE_KEYS, writeLocalStorageItem } from './device-storage.ts'

const STORAGE_KEY = DEVICE_STORAGE_KEYS.welcomeSeen

/** 是否已看过欢迎 APP（首次运行后即为 true，不再自动打开）。 */
export function hasSeenWelcome(): boolean {
  try {
    return localStorage.getItem(STORAGE_KEY) === '1'
  } catch {
    return false
  }
}

/** 标记欢迎 APP 已展示过。 */
export function markWelcomeSeen(): boolean {
  try {
    return writeLocalStorageItem(STORAGE_KEY, '1')
  } catch {
    return false
  }
}
