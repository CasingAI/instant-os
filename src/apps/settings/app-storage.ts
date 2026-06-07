import type { ComponentType } from 'preact'
import { APP_REGISTRY } from '../../os/app-registry.tsx'
import type { BuiltinAppId, GeneratedAppId } from '../../os/types.ts'
import type { GeneratedAppRecord } from '../appstore/types.ts'
import { normalizeVersionSnapshots } from '../appstore/generated-app-versions.ts'
import {
  getAllGeneratedAppDataBytes,
  getGeneratedAppDataBytes,
} from '../../os/generated-app-data-storage.ts'
import {
  DEVICE_CAPACITY_BYTES,
  DEVICE_STORAGE_KEYS,
  getLocalStorageKeyBytes,
  getOtherStorageBytes,
  getTotalLocalStorageBytes,
} from '../../os/device-storage.ts'

export type ManagedAppKind = 'builtin' | 'generated'

export type ManagedAppEntry = {
  id: BuiltinAppId | GeneratedAppId
  kind: ManagedAppKind
  name: string
  iconEmoji?: string
  themeColor?: string
  Icon?: ComponentType<{ size?: number }>
  appSizeBytes: number
  documentsBytes: number
  versionHistoryBytes: number
  removable: boolean
}

export { DEVICE_CAPACITY_BYTES }

function getSerializedByteSize(value: unknown): number {
  return new TextEncoder().encode(JSON.stringify(value)).length
}

function splitGeneratedAppSize(app: GeneratedAppRecord): {
  appSizeBytes: number
  documentsBytes: number
  versionHistoryBytes: number
} {
  const versionHistoryBytes = normalizeVersionSnapshots(app).reduce(
    (total, snapshot) => total + new TextEncoder().encode(snapshot.html).length,
    0,
  )
  const htmlBytes = new TextEncoder().encode(app.html).length
  const { html: _html, versions: _versions, ...metadata } = app
  const appSizeBytes = getSerializedByteSize(metadata) + htmlBytes
  const documentsBytes = getGeneratedAppDataBytes(app.id)
  return { appSizeBytes, documentsBytes, versionHistoryBytes }
}

function getBuiltinDocumentsBytes(appId: BuiltinAppId): number {
  if (appId === 'browser') {
    return getLocalStorageKeyBytes(DEVICE_STORAGE_KEYS.safariPageCache)
  }
  if (appId === 'mail') {
    return getLocalStorageKeyBytes(DEVICE_STORAGE_KEYS.mail)
  }
  return 0
}

export function buildManagedAppList(installedApps: GeneratedAppRecord[]): ManagedAppEntry[] {
  const builtins: ManagedAppEntry[] = APP_REGISTRY.map((app) => ({
    id: app.id,
    kind: 'builtin',
    name: app.name,
    Icon: app.icon,
    appSizeBytes: 0,
    documentsBytes: getBuiltinDocumentsBytes(app.id),
    versionHistoryBytes: 0,
    removable: false,
  }))

  const generated: ManagedAppEntry[] = installedApps.map((app) => {
    const { appSizeBytes, documentsBytes, versionHistoryBytes } = splitGeneratedAppSize(app)
    return {
      id: app.id,
      kind: 'generated',
      name: app.name,
      iconEmoji: app.iconEmoji,
      themeColor: app.themeColor,
      appSizeBytes,
      documentsBytes,
      versionHistoryBytes,
      removable: true,
    }
  })

  return [...builtins, ...generated].sort(
    (left, right) =>
      right.appSizeBytes +
      right.documentsBytes +
      right.versionHistoryBytes -
      (left.appSizeBytes + left.documentsBytes + left.versionHistoryBytes),
  )
}


export function getStorageSummary(installedApps: GeneratedAppRecord[]) {
  const entries = buildManagedAppList(installedApps)
  const appsBytes =
    getLocalStorageKeyBytes(DEVICE_STORAGE_KEYS.generatedApps) + getAllGeneratedAppDataBytes()
  const safariCacheBytes = getLocalStorageKeyBytes(DEVICE_STORAGE_KEYS.safariPageCache)
  const mailDataBytes = getLocalStorageKeyBytes(DEVICE_STORAGE_KEYS.mail)
  const otherBytes = getOtherStorageBytes()
  const usedBytes = getTotalLocalStorageBytes()
  const availableBytes = Math.max(0, DEVICE_CAPACITY_BYTES - usedBytes)

  return {
    entries,
    appsBytes,
    safariCacheBytes,
    mailDataBytes,
    otherBytes,
    usedBytes,
    availableBytes,
    systemBytes: 0,
  }
}

export function findManagedApp(
  entries: ManagedAppEntry[],
  appId: BuiltinAppId | GeneratedAppId,
): ManagedAppEntry | undefined {
  return entries.find((entry) => entry.id === appId)
}
