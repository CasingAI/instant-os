import type { GeneratedAppId } from './types.ts'
import {
  GENERATED_APP_DATA_KEY_PREFIX,
  getLocalStorageKeyBytes,
  writeLocalStorageItem,
} from './device-storage.ts'

export const GENERATED_APP_STORAGE_MESSAGE_TYPE = 'instant-os-app-storage' as const

export type GeneratedAppDataStore = Record<string, string>

export type GeneratedAppStorageMessage = {
  type: typeof GENERATED_APP_STORAGE_MESSAGE_TYPE
  appId: GeneratedAppId
  data: GeneratedAppDataStore
}

function storageKey(appId: GeneratedAppId): string {
  return `${GENERATED_APP_DATA_KEY_PREFIX}${appId}`
}

function isStringRecord(value: unknown): value is GeneratedAppDataStore {
  if (typeof value !== 'object' || value === undefined) {
    return false
  }

  return Object.values(value as Record<string, unknown>).every((entry) => typeof entry === 'string')
}

export function loadGeneratedAppData(appId: GeneratedAppId): GeneratedAppDataStore {
  try {
    const raw = localStorage.getItem(storageKey(appId))
    if (!raw) {
      return {}
    }

    const parsed: unknown = JSON.parse(raw)
    if (!isStringRecord(parsed)) {
      return {}
    }

    return parsed
  } catch {
    return {}
  }
}

export function saveGeneratedAppData(appId: GeneratedAppId, data: GeneratedAppDataStore): boolean {
  if (!isStringRecord(data)) {
    return false
  }

  return writeLocalStorageItem(storageKey(appId), JSON.stringify(data))
}

export function clearGeneratedAppData(appId: GeneratedAppId): void {
  try {
    localStorage.removeItem(storageKey(appId))
  } catch {
    // ignore
  }
}

export function getGeneratedAppDataBytes(appId: GeneratedAppId): number {
  return getLocalStorageKeyBytes(storageKey(appId))
}

export function listGeneratedAppDataKeys(): string[] {
  const keys: string[] = []

  try {
    for (let index = 0; index < localStorage.length; index += 1) {
      const key = localStorage.key(index)
      if (key?.startsWith(GENERATED_APP_DATA_KEY_PREFIX)) {
        keys.push(key)
      }
    }
  } catch {
    return []
  }

  return keys
}

export function getAllGeneratedAppDataBytes(): number {
  return listGeneratedAppDataKeys().reduce(
    (total, key) => total + getLocalStorageKeyBytes(key),
    0,
  )
}

export function isGeneratedAppStorageMessage(value: unknown): value is GeneratedAppStorageMessage {
  if (typeof value !== 'object' || value === undefined) {
    return false
  }

  const message = value as Record<string, unknown>
  return (
    message.type === GENERATED_APP_STORAGE_MESSAGE_TYPE &&
    typeof message.appId === 'string' &&
    message.appId.startsWith('gen:') &&
    isStringRecord(message.data)
  )
}
