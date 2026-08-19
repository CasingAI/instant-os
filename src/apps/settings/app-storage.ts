import type { ComponentType } from 'preact'
import { APP_REGISTRY } from '../../os/app-registry.tsx'
import type { BuiltinAppId, GeneratedAppId } from '../../os/types.ts'
import type { GeneratedAppRecord } from '../appstore/types.ts'
import { loadInternalProjectsSync } from '../icode/icode-storage.ts'
import { normalizeVersionSnapshots } from '../appstore/generated-app-versions.ts'
import { getAppDataBytesByApp } from '../files/files-app-data-quota.ts'
import { getInstalledAppsStorageBytes } from '../../os/generated-apps-storage.ts'
import {
  getLegacyGeneratedAppBytes,
  isGeneratedAppBundleStored,
} from '../../os/generated-apps-store.ts'
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
  getDevDataStorageFillBytes,
  getFolderIconSnapshotsBytes,
  getModelVisionResultsBytes,
  getSafariPageCacheBytes,
  getTotalDataStorageBytes,
} from '../../os/device-data-storage.ts'
import { createGlobalRegistry } from '../../os/app-registry.ts'
import { listMigratedLegacyStorageKeys } from '../../os/app-registry-migration.ts'
import { getFilesTotalBytes } from '../files/files-storage.ts'
import { getAiTokenUsageBytes } from '../../ai/ai-token-usage-storage.ts'
import { getAiEventLogBytes } from '../../ai/ai-event-log-storage.ts'
import { getVscodeAiChatBytes } from '../vscode/vscode-ai-chat-storage.ts'
import { getBrowserSystemStorageBytes } from '../browser/browser-system-storage.ts'
import { buildSystemSpaceBreakdown } from './app-storage-system.ts'

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
export { buildSystemSpaceBreakdown }

export function getManagedAppTotalBytes(entry: ManagedAppEntry): number {
  return entry.appSizeBytes + entry.documentsBytes + entry.dataBytes + entry.versionHistoryBytes
}

function getSerializedByteSize(value: unknown): number {
  return new TextEncoder().encode(JSON.stringify(value)).length
}

/** 已迁移到注册表的内置应用：文档数据按注册表字节记账 */
const REGISTRY_MIGRATED_BUILTINS = new Set<BuiltinAppId>([
  'weather',
  'calendar',
  'stocks',
  'gomoku',
  'mail',
  'news',
  'catgpt',
  'produde',
  'books',
  'icode',
])

/** 已注册表化应用的 localStorage 残留旧键（AI 用量等按应用记账的键） */
const REGISTRY_MIGRATED_EXTRA_KEYS: Partial<Record<BuiltinAppId, string[]>> = {
  news: [DEVICE_STORAGE_KEYS.newsTokenUsage],
}

function splitGeneratedAppSize(
  app: GeneratedAppRecord,
  registryBytesByApp: Record<string, number>,
): {
  appSizeBytes: number
  documentsBytes: number
  versionHistoryBytes: number
} {
  const versionHistoryBytes = isGeneratedAppBundleStored(app.id)
    ? 0
    : normalizeVersionSnapshots(app).reduce(
        (total, snapshot) => total + new TextEncoder().encode(snapshot.html).length,
        0,
      )
  const htmlBytes = new TextEncoder().encode(app.html).length
  const { html: _html, versions: _versions, ...metadata } = app
  // 本体已迁到 /Applications/*/Contents 文件时，appSize/版本历史统一走 dataBytes（Contents 文件字节），避免与文件分类双计
  const appSizeBytes = isGeneratedAppBundleStored(app.id) ? 0 : getSerializedByteSize(metadata) + htmlBytes
  // 生成应用文档数据现全部存放在注册表命名空间（gen:{id}）
  const documentsBytes = registryBytesByApp[app.id] ?? 0
  return { appSizeBytes, documentsBytes, versionHistoryBytes }
}

function getBuiltinDocumentsBytes(
  appId: BuiltinAppId,
  registryBytesByApp: Record<string, number>,
): number {  // 已注册表化的内置应用：文档数据按注册表字节记账（+ 少量残留 localStorage 旧键）
  if (REGISTRY_MIGRATED_BUILTINS.has(appId)) {
    const registryBytes = registryBytesByApp[appId] ?? 0
    const extraBytes = sumLocalStorageKeys(REGISTRY_MIGRATED_EXTRA_KEYS[appId] ?? [])
    return registryBytes + extraBytes
  }
  if (appId === 'browser') {
    return getBrowserSystemStorageBytes()
  }
  if (appId === 'vscode') {
    return sumLocalStorageKeys([
      DEVICE_STORAGE_KEYS.vscodePrefs,
      DEVICE_STORAGE_KEYS.vscodeSession,
    ])
  }
  /** @deprecated 模拟终端已弃用，此分支保留仅为过渡，后续移除 */
  if (appId === 'simulated-terminal') {
    return getLocalStorageKeyBytes(DEVICE_STORAGE_KEYS.terminalCommandHistory)
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
      DEVICE_STORAGE_KEYS.notificationCenterSettings,
      DEVICE_STORAGE_KEYS.windowSizes,
      DEVICE_STORAGE_KEYS.launcherLayout,
      DEVICE_STORAGE_KEYS.notificationCenterWidgets,
    ])
  }
  return 0
}

export function buildManagedAppList(
  installedApps: GeneratedAppRecord[],
  registryBytesByApp: Record<string, number>,
): ManagedAppEntry[] {
  const icodeProjectIds = new Set(
    loadInternalProjectsSync()
      .map((project) => project.linkedAppId)
      .filter((appId): appId is GeneratedAppId => appId !== undefined),
  )

  const builtins: ManagedAppEntry[] = APP_REGISTRY.map((app) => ({
    id: app.id,
    kind: 'builtin',
    name: app.name,
    Icon: app.icon,
    appSizeBytes: 0,
    documentsBytes: getBuiltinDocumentsBytes(app.id, registryBytesByApp),
    dataBytes: 0,
    versionHistoryBytes: 0,
    removable: false,
  }))

  const generated: ManagedAppEntry[] = installedApps.map((app) => {
    const { appSizeBytes, documentsBytes, versionHistoryBytes } = splitGeneratedAppSize(
      app,
      registryBytesByApp,
    )
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


/** 已迁移应用残留在 localStorage 的旧键字节合计（设置页「应用数据旧键」分类） */
function getLegacyMigratedStorageBytes(): number {
  return listMigratedLegacyStorageKeys().reduce(
    (total, item) => total + getLocalStorageKeyBytes(item.storageKey),
    0,
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
    vscodeAiChatBytes: number
    folderIconSnapshotsBytes: number
    modelVisionBytes: number
    filesBytes: number
    /** 按应用记账的 /Applications/{id}.app/Data+Contents 文件字节 */
    appDataBytesByApp: Record<string, number>
    /** 按应用记账的注册表字节（App Registry 命名空间） */
    registryBytesByApp: Record<string, number>
  },
) {
  const { registryBytesByApp } = dataStorage
  const entries = buildManagedAppList(installedApps, registryBytesByApp)
  /** localStorage 里的应用清单索引（及未迁移旧键），并入系统配置，不是应用占用合计 */
  const appsBytes = getInstalledAppsStorageBytes() + getLegacyGeneratedAppBytes()
  const browserSystemBytes = getBrowserSystemStorageBytes()
  const {
    totalBytes: dataUsedBytes,
    safariCacheBytes,
    booksDataBytes,
    aiUsageBytes,
    aiEventLogBytes,
    vscodeAiChatBytes,
    folderIconSnapshotsBytes,
    modelVisionBytes,
    filesBytes,
  } = dataStorage
  const legacyAppDataBytes = getLegacyMigratedStorageBytes()
  const appDataBytes = Object.values(dataStorage.appDataBytesByApp).reduce(
    (total, bytes) => total + bytes,
    0,
  )
  // 「文件」分类展示值扣除应用目录合计：应用目录单列，避免同一块字节出现两次。
  // 总量条 dataUsedBytes 仍是真实占用，不做假减法。
  const filesBytesExcludingAppData = Math.max(0, filesBytes - appDataBytes)
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
    if (entry.id === 'model-vision') {
      return { ...entry, dataBytes: modelVisionBytes }
    }
    if (entry.id === 'files') {
      return { ...entry, dataBytes: filesBytesExcludingAppData }
    }
    return { ...entry, dataBytes: dataStorage.appDataBytesByApp[entry.id] ?? 0 }
  })

  const appsTotalBytes = entriesWithData.reduce(
    (total, entry) => total + getManagedAppTotalBytes(entry),
    0,
  )

  return {
    entries: entriesWithData,
    appsBytes,
    appsTotalBytes,
    appDataBytes,
    safariCacheBytes,
    booksDataBytes,
    browserSystemBytes,
    otherBytes,
    usedBytes,
    availableBytes,
    dataUsedBytes,
    dataAvailableBytes,
    aiUsageBytes,
    aiEventLogBytes,
    vscodeAiChatBytes,
    folderIconSnapshotsBytes,
    modelVisionBytes,
    filesBytes: filesBytesExcludingAppData,
    legacyAppDataBytes,
    systemBytes: usedBytes,
  }
}

export async function loadDataStorageBreakdown(): Promise<{
  totalBytes: number
  safariCacheBytes: number
  booksDataBytes: number
  aiUsageBytes: number
  aiEventLogBytes: number
  vscodeAiChatBytes: number
  folderIconSnapshotsBytes: number
  modelVisionBytes: number
  filesBytes: number
  appDataBytesByApp: Record<string, number>
  registryBytesByApp: Record<string, number>
}> {
  const [
    coreDataBytes,
    rawSafariCacheBytes,
    booksDataBytes,
    aiUsageBytes,
    aiEventLogBytes,
    vscodeAiChatBytes,
    folderIconSnapshotsBytes,
    modelVisionBytes,
    devFillBytes,
    filesBytes,
    appDataBytesByApp,
    registryBytesByApp,
  ] = await Promise.all([
    getTotalDataStorageBytes(),
    getSafariPageCacheBytes(),
    getBooksContentBytes(),
    getAiTokenUsageBytes(),
    getAiEventLogBytes(),
    getVscodeAiChatBytes(),
    getFolderIconSnapshotsBytes(),
    getModelVisionResultsBytes(),
    getDevDataStorageFillBytes(),
    getFilesTotalBytes(),
    getAppDataBytesByApp(),
    createGlobalRegistry().bytesByApp(),
  ])
  return {
    totalBytes: coreDataBytes + filesBytes + Object.values(registryBytesByApp).reduce((sum, bytes) => sum + bytes, 0),
    // 开发者填充不计入网页缓存，归入用量条 / 分类列表的「其他」
    safariCacheBytes: Math.max(0, rawSafariCacheBytes - devFillBytes),
    booksDataBytes,
    aiUsageBytes,
    aiEventLogBytes,
    vscodeAiChatBytes,
    folderIconSnapshotsBytes,
    modelVisionBytes,
    filesBytes,
    appDataBytesByApp,
    registryBytesByApp,
  }
}

export function findManagedApp(
  entries: ManagedAppEntry[],
  appId: BuiltinAppId | GeneratedAppId,
): ManagedAppEntry | undefined {
  return entries.find((entry) => entry.id === appId)
}
