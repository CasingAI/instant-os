import type { GeneratedAppRecord, GeneratedAppVersionSnapshot } from '../apps/appstore/types.ts'
import { migrateAppRecord } from '../apps/appstore/generated-app-versions.ts'
import {
  DEVICE_STORAGE_KEYS,
  getLocalStorageKeyBytes,
  writeLocalStorageItem,
} from './device-storage.ts'

const STORAGE_KEY = DEVICE_STORAGE_KEYS.generatedApps

export function loadInstalledApps(): GeneratedAppRecord[] {
  try {
    const raw = localStorage.getItem(STORAGE_KEY)
    if (!raw) {
      return []
    }

    const parsed: unknown = JSON.parse(raw)
    if (!Array.isArray(parsed)) {
      return []
    }

    return parsed.filter(isValidGeneratedAppRecord).map(migrateAppRecord)
  } catch {
    return []
  }
}

export function saveInstalledApps(apps: GeneratedAppRecord[]): boolean {
  return writeLocalStorageItem(STORAGE_KEY, JSON.stringify(apps))
}

export function getInstalledAppsStorageBytes(): number {
  return getLocalStorageKeyBytes(STORAGE_KEY)
}

function isValidGeneratedAppRecord(value: unknown): value is GeneratedAppRecord {
  if (typeof value !== 'object' || value === undefined) {
    return false
  }

  const record = value as Record<string, unknown>
  if (
    typeof record.id !== 'string' ||
    !record.id.startsWith('gen:') ||
    typeof record.name !== 'string' ||
    typeof record.description !== 'string' ||
    typeof record.category !== 'string' ||
    typeof record.iconEmoji !== 'string' ||
    typeof record.themeColor !== 'string' ||
    typeof record.html !== 'string'
  ) {
    return false
  }

  if (record.versions !== undefined) {
    if (!Array.isArray(record.versions)) {
      return false
    }
    if (!record.versions.every(isValidVersionSnapshot)) {
      return false
    }
  }

  return true
}

function isValidVersionSnapshot(value: unknown): value is GeneratedAppVersionSnapshot {
  if (typeof value !== 'object' || value === undefined) {
    return false
  }

  const snapshot = value as Record<string, unknown>
  return (
    typeof snapshot.version === 'string' &&
    typeof snapshot.html === 'string' &&
    typeof snapshot.savedAt === 'number'
  )
}
