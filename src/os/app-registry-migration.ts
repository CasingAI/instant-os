/**
 * 应用注册表迁移：把散落在 localStorage 的应用数据导入新的 App Registry（IndexedDB）。
 *
 * - 来源是原始 localStorage 键（内置应用每应用一个 JSON 键；生成应用
 *   `instant-os-generated-app-data:{appId}` 前缀下每应用一个 JSON 快照；iCode 内部项目一个键）
 * - 幂等：注册表里已有该应用数据的应用跳过导入（注册表为权威数据源）；
 *   localStorage 旧键视为陈旧副本，删除
 * - 迁移成功后删除上一版导出的 /Applications/{bundle}.app/Data 旧 JSON 副本
 *   （weather.json / app-data.json 等），并清理旧版 /dev/apps 旁路
 * - 失败项保留待下次启动重试；空键不标记
 */
import { DEVICE_STORAGE_KEYS, GENERATED_APP_DATA_KEY_PREFIX } from './device-storage.ts'
import { createAppRegistry, hydrateAppRegistry } from './app-registry.ts'
import { registryDbListKeys } from './app-registry-db.ts'
import { hydrateAllBuiltinRegistryStores } from './builtin-registry-stores.ts'
import { appBundleDirName } from '../apps/files/files-app-id.ts'
import { emitSystemVfsChange } from '../apps/files/files-system-vfs.ts'
import { collectSubtreeIds, deleteSubtree, listChildNodes } from '../apps/files/files-storage.ts'
import { APP_DATA_APPS_DIR_NAME, APP_DATA_DIR_NAME } from '../apps/files/files-app-data-root.ts'

type RegistryMigrationItem = {
  appId: string
  storageKey: string
  /** 导入后注册表里使用的 key（生成应用为逐 key 导入，此项仅用于存在性检查） */
  registryKey: string
  /** 上一版导出到 Data 目录的旧文件名（迁移后删除） */
  legacyDataFileNames: string[]
}

const BUILTIN_MIGRATION_ITEMS: RegistryMigrationItem[] = [
  { appId: 'weather', storageKey: DEVICE_STORAGE_KEYS.weather, registryKey: 'store', legacyDataFileNames: ['weather.json'] },
  { appId: 'calendar', storageKey: DEVICE_STORAGE_KEYS.calendar, registryKey: 'store', legacyDataFileNames: ['calendar.json'] },
  { appId: 'stocks', storageKey: DEVICE_STORAGE_KEYS.stocks, registryKey: 'store', legacyDataFileNames: ['stocks.json'] },
  { appId: 'gomoku', storageKey: DEVICE_STORAGE_KEYS.gomoku, registryKey: 'store', legacyDataFileNames: ['gomoku.json'] },
  { appId: 'mail', storageKey: DEVICE_STORAGE_KEYS.mail, registryKey: 'store', legacyDataFileNames: ['mail.json'] },
  { appId: 'news', storageKey: DEVICE_STORAGE_KEYS.news, registryKey: 'store', legacyDataFileNames: ['news.json'] },
  { appId: 'catgpt', storageKey: DEVICE_STORAGE_KEYS.catgpt, registryKey: 'store', legacyDataFileNames: ['catgpt.json'] },
  { appId: 'produde', storageKey: DEVICE_STORAGE_KEYS.produde, registryKey: 'store', legacyDataFileNames: ['produde.json'] },
  { appId: 'books', storageKey: DEVICE_STORAGE_KEYS.books, registryKey: 'store', legacyDataFileNames: ['books-index.json'] },
  { appId: 'icode', storageKey: DEVICE_STORAGE_KEYS.icodeInternalProjects, registryKey: 'internal-projects', legacyDataFileNames: [] },
]

function isStringRecord(value: unknown): value is Record<string, string> {
  if (typeof value !== 'object' || value === undefined) {
    return false
  }
  return Object.values(value as Record<string, unknown>).every((entry) => typeof entry === 'string')
}

function readLocalStorageItem(key: string): string | null {
  try {
    return localStorage.getItem(key)
  } catch {
    return null
  }
}

function removeLocalStorageItem(key: string): void {
  try {
    localStorage.removeItem(key)
  } catch {
    // 删除失败不阻塞迁移
  }
}

/** 上一版 /dev/apps/{appId}/Data 旁路目录：删除（localStorage 才是旧数据源）。 */
async function deleteLegacyDevAppsDir(): Promise<void> {
  try {
    const appsNode = (await listChildNodes('dev', undefined)).find(
      (node) => node.kind === 'folder' && node.name === APP_DATA_APPS_DIR_NAME,
    )
    if (appsNode) {
      const subtree = await collectSubtreeIds(appsNode.id)
      await deleteSubtree(subtree)
    }
  } catch {
    // 旁路不存在或删除失败均可忽略
  }
}

/** 删除上一版导出的 Data 旧 JSON 副本（applications 卷真身节点）；返回是否删除了文件。 */
async function deleteLegacyAppDataFiles(appId: string, fileNames: string[]): Promise<boolean> {
  try {
    const bundles = await listChildNodes('applications', undefined)
    const bundle = bundles.find(
      (node) => node.kind === 'folder' && node.name === appBundleDirName(appId),
    )
    if (!bundle) {
      return false
    }
    const dataRoot = (await listChildNodes('applications', bundle.id)).find(
      (node) => node.kind === 'folder' && node.name === APP_DATA_DIR_NAME,
    )
    if (!dataRoot) {
      return false
    }
    let deleted = false
    for (const child of await listChildNodes('applications', dataRoot.id)) {
      if (child.kind !== 'file' || !fileNames.includes(child.name)) {
        continue
      }
      const subtree = await collectSubtreeIds(child.id)
      await deleteSubtree(subtree)
      emitSystemVfsChange(`/Applications/${appBundleDirName(appId)}/${APP_DATA_DIR_NAME}/${child.name}`, 'deleted')
      deleted = true
    }
    return deleted
  } catch {
    // 单项失败不阻塞整体，保留待下次启动重试
    return false
  }
}

export type RegistryMigrationResult = {
  migrated: string[]
  /** 陈旧 localStorage 旧键已删除的应用 */
  cleanedLegacyKeys: string[]
  /** 上一版 Data 旧 JSON 副本已删除的应用 */
  cleanedDataFiles: string[]
  skipped: string[]
  failed: string[]
}

/** 该应用命名空间在注册表中是否已有数据（任意 key 存在即视为已注册表化） */
async function registryNamespaceHasData(appId: string): Promise<boolean> {
  try {
    await hydrateAppRegistry(appId)
    const keys = await registryDbListKeys(appId)
    return keys.length > 0
  } catch {
    return false
  }
}

async function migrateSingleItem(
  item: RegistryMigrationItem,
  result: RegistryMigrationResult,
): Promise<void> {
  try {
    const raw = readLocalStorageItem(item.storageKey)
    const alreadyInRegistry = await registryNamespaceHasData(item.appId)

    if (alreadyInRegistry) {
      // 注册表为权威数据源：localStorage 旧键是陈旧副本，删除
      if (raw !== null) {
        removeLocalStorageItem(item.storageKey)
        result.cleanedLegacyKeys.push(item.appId)
      }
      result.skipped.push(item.appId)
      return
    }

    if (raw === null || raw === '') {
      // 空键不标记：该应用之后写入旧键时，下次启动仍会导入
      result.skipped.push(item.appId)
      return
    }

    const registry = createAppRegistry(item.appId)
    if (item.appId.startsWith('gen:')) {
      // 生成应用旧快照是整份键值 JSON → 逐 key 导入
      let parsed: unknown
      try {
        parsed = JSON.parse(raw)
      } catch {
        result.failed.push(item.appId)
        return
      }
      if (!isStringRecord(parsed)) {
        result.failed.push(item.appId)
        return
      }
      for (const [key, value] of Object.entries(parsed)) {
        await registry.setItem(key, value)
      }
    } else {
      await registry.setItem(item.registryKey, raw)
    }
    removeLocalStorageItem(item.storageKey)
    result.migrated.push(item.appId)
  } catch {
    result.failed.push(item.appId)
  }
}

/** 启动时调用一次（幂等）。 */
export async function runAppRegistryMigration(): Promise<RegistryMigrationResult> {
  const result: RegistryMigrationResult = {
    migrated: [],
    cleanedLegacyKeys: [],
    cleanedDataFiles: [],
    skipped: [],
    failed: [],
  }

  // 1) 上一版 /dev/apps 旁路清理
  await deleteLegacyDevAppsDir()

  // 2) 内置应用 + iCode 内部项目
  for (const item of BUILTIN_MIGRATION_ITEMS) {
    await migrateSingleItem(item, result)
  }

  // 3) 生成应用整份键值快照 → 逐 key 导入
  let generatedKeys: string[] = []
  try {
    for (let index = 0; index < localStorage.length; index += 1) {
      const key = localStorage.key(index)
      if (key?.startsWith(GENERATED_APP_DATA_KEY_PREFIX)) {
        generatedKeys.push(key)
      }
    }
  } catch {
    generatedKeys = []
  }
  for (const key of generatedKeys) {
    const appId = key.slice(GENERATED_APP_DATA_KEY_PREFIX.length)
    if (!appId) continue
    await migrateSingleItem(
      {
        appId,
        storageKey: key,
        registryKey: 'store',
        legacyDataFileNames: ['app-data.json'],
      },
      result,
    )
  }

  // 4) 删除上一版 Data 旧 JSON 副本（对本次处理过的应用幂等清理）
  const appsTouched = new Set([...result.migrated, ...result.skipped])
  for (const appId of appsTouched) {
    const item = BUILTIN_MIGRATION_ITEMS.find((entry) => entry.appId === appId)
    const fileNames = item?.legacyDataFileNames ?? ['app-data.json']
    const deleted = await deleteLegacyAppDataFiles(appId, fileNames)
    if (deleted) {
      result.cleanedDataFiles.push(appId)
    }
  }

  // 5) 触发所有内置应用 storage 的 hydrate/read，让新版字段级 createRegistryStore
  //    自动把残留的 `store` / `internal-projects` 旧单键拆分为字段级 keys。
  //    已拆分的应用会直接命中字段 key，不会复写。
  await hydrateAllBuiltinRegistryStores().catch((error) => {
    console.warn('[app-registry-migration] 内置应用字段拆分失败', error)
  })

  return result
}

export type MigratedLegacyStorageKey = {
  appId: string
  storageKey: string
}

/**
 * 设置页「应用数据旧键」：列出已迁应用可能残留的 localStorage 旧键
 * （内置应用每应用一个键；生成应用按 `instant-os-generated-app-data:{appId}` 前缀收集）。
 * 不做存在性过滤，由调用方读取实际值判断是否需要展示。
 */
export function listMigratedLegacyStorageKeys(): MigratedLegacyStorageKey[] {
  const items: MigratedLegacyStorageKey[] = BUILTIN_MIGRATION_ITEMS.map((item) => ({
    appId: item.appId,
    storageKey: item.storageKey,
  }))
  try {
    for (let index = 0; index < localStorage.length; index += 1) {
      const key = localStorage.key(index)
      if (key?.startsWith(GENERATED_APP_DATA_KEY_PREFIX)) {
        items.push({ appId: key.slice(GENERATED_APP_DATA_KEY_PREFIX.length), storageKey: key })
      }
    }
  } catch {
    // 读取失败时仅返回内置应用已知键
  }
  return items
}
