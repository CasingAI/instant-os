import { DEFAULT_APP_VERSION, normalizeAppVersion } from './app-version.ts'
import type { GeneratedAppRecord, GeneratedAppVersionSnapshot } from './types.ts'

export function normalizeVersionSnapshots(
  record: GeneratedAppRecord,
): GeneratedAppVersionSnapshot[] {
  if (record.versions && record.versions.length > 0) {
    return record.versions.map((snapshot) => ({
      version: normalizeAppVersion(snapshot.version),
      html: snapshot.html,
      savedAt: typeof snapshot.savedAt === 'number' ? snapshot.savedAt : Date.now(),
    }))
  }

  return [
    {
      version: normalizeAppVersion(record.version),
      html: record.html,
      savedAt: Date.now(),
    },
  ]
}

export function migrateAppRecord(record: GeneratedAppRecord): GeneratedAppRecord {
  const versions = normalizeVersionSnapshots(record)
  const active = versions[versions.length - 1]

  return {
    ...record,
    html: active.html,
    version: active.version,
    versions,
  }
}

export function canRollbackApp(record: GeneratedAppRecord): boolean {
  return normalizeVersionSnapshots(record).length > 1
}

export function getAppVersionCount(record: GeneratedAppRecord): number {
  return normalizeVersionSnapshots(record).length
}

export function rollbackAppRecord(record: GeneratedAppRecord): GeneratedAppRecord | undefined {
  const versions = normalizeVersionSnapshots(record)
  if (versions.length <= 1) {
    return undefined
  }

  const remaining = versions.slice(0, -1)
  const previous = remaining[remaining.length - 1]

  return {
    ...record,
    html: previous.html,
    version: previous.version,
    versions: remaining,
    pendingUpdate: true,
  }
}

export function appendVersionSnapshot(
  record: GeneratedAppRecord | undefined,
  version: string,
  html: string,
): GeneratedAppVersionSnapshot[] {
  const snapshot: GeneratedAppVersionSnapshot = {
    version: normalizeAppVersion(version),
    html,
    savedAt: Date.now(),
  }

  if (!record) {
    return [snapshot]
  }

  return [...normalizeVersionSnapshots(record), snapshot]
}

export function pruneArchivedVersions(record: GeneratedAppRecord): GeneratedAppRecord {
  const active: GeneratedAppVersionSnapshot = {
    version: normalizeAppVersion(record.version),
    html: record.html,
    savedAt: Date.now(),
  }

  return {
    ...record,
    versions: [active],
  }
}

export function getActiveVersionLabel(record: GeneratedAppRecord | undefined): string {
  if (!record) {
    return DEFAULT_APP_VERSION
  }
  return normalizeAppVersion(record.version)
}
