import { DEFAULT_APP_VERSION, normalizeAppVersion } from './app-version.ts'
import { osNowMs } from '../../os/os-clock.ts'
import type { GeneratedAppRecord, GeneratedAppVersionSnapshot } from './types.ts'

export function normalizeVersionSnapshots(
  record: GeneratedAppRecord,
): GeneratedAppVersionSnapshot[] {
  if (record.versions && record.versions.length > 0) {
    return record.versions.map((snapshot) => ({
      version: normalizeAppVersion(snapshot.version),
      html: snapshot.html,
      savedAt: typeof snapshot.savedAt === 'number' ? snapshot.savedAt : osNowMs(),
    }))
  }

  return [
    {
      version: normalizeAppVersion(record.version),
      html: record.html,
      savedAt: osNowMs(),
    },
  ]
}

export function migrateAppRecord(record: GeneratedAppRecord): GeneratedAppRecord {
  // 版本文件夹布局（iCode 管理）：html/versions 快照栈不是真相，不做快照规整
  if (record.versionsLayout) {
    return record
  }
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
    savedAt: osNowMs(),
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
    savedAt: osNowMs(),
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
