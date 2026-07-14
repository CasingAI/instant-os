import type { ComponentType } from 'preact'
import { APP_REGISTRY } from '../../os/app-registry.tsx'
import type { BuiltinAppId, GeneratedAppId } from '../../os/types.ts'
import type { GeneratedAppRecord } from '../appstore/types.ts'
import { loadInternalProjects } from '../icode/icode-storage.ts'
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
  sumLocalStorageKeys,
} from '../../os/device-storage.ts'
import {
  DATA_CAPACITY_BYTES,
  getBooksContentBytes,
  getFolderIconSnapshotsBytes,
  getSafariPageCacheBytes,
  getTotalDataStorageBytes,
} from '../../os/device-data-storage.ts'
import { getAiTokenUsageBytes } from '../../ai/ai-token-usage-storage.ts'
import { getAiEventLogBytes } from '../../ai/ai-event-log-storage.ts'
import { getNewsStorageBytes } from '../news/news-storage.ts'
import { getCatGptStorageBytes } from '../catgpt/catgpt-storage.ts'
import { getBooksStorageBytes } from '../books/books-storage.ts'
import { getBrowserSystemStorageBytes } from '../browser/browser-system-storage.ts'

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
  dataBytes: number
  versionHistoryBytes: number
  removable: boolean
  icodeManaged?: boolean
}

export { DEVICE_CAPACITY_BYTES }

export function getManagedAppTotalBytes(entry: ManagedAppEntry): number {
  return entry.appSizeBytes + entry.documentsBytes + entry.dataBytes + entry.versionHistoryBytes
}

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
    return getBrowserSystemStorageBytes()
  }
  if (appId === 'mail') {
    return getLocalStorageKeyBytes(DEVICE_STORAGE_KEYS.mail)
  }
  if (appId === 'news') {
    return getNewsStorageBytes()
  }
  if (appId === 'catgpt') {
    return getCatGptStorageBytes()
  }
  if (appId === 'books') {
    return getBooksStorageBytes()
  }
  if (appId === 'weather') {
    return getLocalStorageKeyBytes(DEVICE_STORAGE_KEYS.weather)
  }
  if (appId === 'calendar') {
    return getLocalStorageKeyBytes(DEVICE_STORAGE_KEYS.calendar)
  }
  if (appId === 'stocks') {
    return getLocalStorageKeyBytes(DEVICE_STORAGE_KEYS.stocks)
  }
  if (appId === 'gomoku') {
    return getLocalStorageKeyBytes(DEVICE_STORAGE_KEYS.gomoku)
  }
  if (appId === 'icode') {
    return sumLocalStorageKeys([
      DEVICE_STORAGE_KEYS.icodeInternalProjects,
      DEVICE_STORAGE_KEYS.icodeProjects,
    ])
  }
  if (appId === 'scene3d-lab') {
    return sumLocalStorageKeys([
      DEVICE_STORAGE_KEYS.scene3dLabArchives,
      DEVICE_STORAGE_KEYS.scene3dLabPrefs,
    ])
  }
  if (appId === 'appstore') {
    return sumLocalStorageKeys([
      DEVICE_STORAGE_KEYS.listingDetails,
      DEVICE_STORAGE_KEYS.listingReviews,
      DEVICE_STORAGE_KEYS.storeListings,
    ])
  }
  if (appId === 'settings') {
    return sumLocalStorageKeys([
      DEVICE_STORAGE_KEYS.accountSettings,
      DEVICE_STORAGE_KEYS.displaySettings,
      DEVICE_STORAGE_KEYS.wallpaperSettings,
      DEVICE_STORAGE_KEYS.experimentalSettings,
      DEVICE_STORAGE_KEYS.windowSizes,
      DEVICE_STORAGE_KEYS.launcherLayout,
      DEVICE_STORAGE_KEYS.notificationCenterWidgets,
    ])
  }
  return 0
}

export function buildManagedAppList(installedApps: GeneratedAppRecord[]): ManagedAppEntry[] {
  const icodeProjectIds = new Set(
    loadInternalProjects()
      .map((project) => project.linkedAppId)
      .filter((appId): appId is GeneratedAppId => appId !== undefined),
  )

  const builtins: ManagedAppEntry[] = APP_REGISTRY.map((app) => ({
    id: app.id,
    kind: 'builtin',
    name: app.name,
    Icon: app.icon,
    appSizeBytes: 0,
    documentsBytes: getBuiltinDocumentsBytes(app.id),
    dataBytes: 0,
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
      dataBytes: 0,
      versionHistoryBytes,
      removable: true,
      icodeManaged: app.icodeProjectId !== undefined || icodeProjectIds.has(app.id),
    }
  })

  return [...builtins, ...generated].sort(
    (left, right) =>
      right.appSizeBytes +
      right.documentsBytes +
      right.dataBytes +
      right.versionHistoryBytes -
      (left.appSizeBytes + left.documentsBytes + left.dataBytes + left.versionHistoryBytes),
  )
}


export function getStorageSummary(
  installedApps: GeneratedAppRecord[],
  dataStorage: {
    totalBytes: number
    safariCacheBytes: number
    booksDataBytes: number
    aiUsageBytes: number
    aiEventLogBytes: number
    folderIconSnapshotsBytes: number
  },
) {
  const entries = buildManagedAppList(installedApps)
  const appsBytes =
    getLocalStorageKeyBytes(DEVICE_STORAGE_KEYS.generatedApps) + getAllGeneratedAppDataBytes()
  const mailDataBytes = getLocalStorageKeyBytes(DEVICE_STORAGE_KEYS.mail)
  const newsDataBytes = getNewsStorageBytes()
  const booksIndexBytes = getBooksStorageBytes()
  const browserSystemBytes = getBrowserSystemStorageBytes()
  const {
    totalBytes: dataUsedBytes,
    safariCacheBytes,
    booksDataBytes,
    aiUsageBytes,
    aiEventLogBytes,
    folderIconSnapshotsBytes,
  } = dataStorage
  const otherBytes = getOtherStorageBytes()
  const usedBytes = getTotalLocalStorageBytes()
  const availableBytes = Math.max(0, DEVICE_CAPACITY_BYTES - usedBytes)
  const dataAvailableBytes = Math.max(0, DATA_CAPACITY_BYTES - dataUsedBytes)

  const entriesWithData = entries.map((entry) => {
    if (entry.id === 'books') {
      return { ...entry, dataBytes: booksDataBytes }
    }
    if (entry.id === 'browser') {
      return { ...entry, dataBytes: safariCacheBytes }
    }
    return entry
  })

  return {
    entries: entriesWithData,
    appsBytes,
    safariCacheBytes,
    mailDataBytes,
    newsDataBytes,
    booksIndexBytes,
    booksDataBytes,
    browserSystemBytes,
    otherBytes,
    usedBytes,
    availableBytes,
    dataUsedBytes,
    dataAvailableBytes,
    aiUsageBytes,
    aiEventLogBytes,
    folderIconSnapshotsBytes,
    systemBytes: usedBytes,
  }
}

export async function loadDataStorageBreakdown(): Promise<{
  totalBytes: number
  safariCacheBytes: number
  booksDataBytes: number
  aiUsageBytes: number
  aiEventLogBytes: number
  folderIconSnapshotsBytes: number
}> {
  const [
    totalBytes,
    safariCacheBytes,
    booksDataBytes,
    aiUsageBytes,
    aiEventLogBytes,
    folderIconSnapshotsBytes,
  ] = await Promise.all([
    getTotalDataStorageBytes(),
    getSafariPageCacheBytes(),
    getBooksContentBytes(),
    getAiTokenUsageBytes(),
    getAiEventLogBytes(),
    getFolderIconSnapshotsBytes(),
  ])
  return {
    totalBytes,
    safariCacheBytes,
    booksDataBytes,
    aiUsageBytes,
    aiEventLogBytes,
    folderIconSnapshotsBytes,
  }
}

export function findManagedApp(
  entries: ManagedAppEntry[],
  appId: BuiltinAppId | GeneratedAppId,
): ManagedAppEntry | undefined {
  return entries.find((entry) => entry.id === appId)
}
