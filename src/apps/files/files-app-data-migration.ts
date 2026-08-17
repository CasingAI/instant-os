/**
 * 一次性迁移：把各应用历史 localStorage 文档数据导出为
 * `/Applications/{appBundleDirName(appId)}/Data` 下的文件（applications 卷真身）。
 * 保守策略：导出成功后标记完成，不删除旧键（应用侧接入新读写 API 后再清理旧键）。
 * 空键不标记：仅「确实有内容且导出成功」的应用进入完成集合，避免后续应用写入旧键时
 * 设置页用量被提前清零。
 * 幂等：已标记的应用跳过；失败项保留待下次启动重试。
 * 兼容：上一版若已把数据导出到 `/dev/apps/{appId}/Data`，启动时迁到 Applications Data
 * 并删除旁路目录，之后不再使用 `/dev/apps`。
 */
import { DEVICE_STORAGE_KEYS } from '../../os/device-storage.ts'
import {
  listGeneratedAppDataKeys,
  loadGeneratedAppData,
} from '../../os/generated-app-data-storage.ts'
import { APP_DATA_APPS_DIR_NAME } from './files-app-data-root.ts'
import { appDataDirNameToAppId } from './files-app-id.ts'
import { writeAppDataText } from './files-app-data-api.ts'
import { deleteDevSystemSubtree } from './files-system-vfs.ts'
import { listChildNodes, readBlobText } from './files-storage.ts'
import { listSubtreeFiles, resolveNodeByAbsolutePath } from './files-vfs.ts'

const MIGRATION_MARK_KEY = 'instant-os:app-data-migration:v1'

type AppDataMigrationItem = {
  appId: string
  storageKey: string
  fileName: string
}

const MIGRATION_ITEMS: AppDataMigrationItem[] = [
  { appId: 'weather', storageKey: DEVICE_STORAGE_KEYS.weather, fileName: 'weather.json' },
  { appId: 'calendar', storageKey: DEVICE_STORAGE_KEYS.calendar, fileName: 'calendar.json' },
  { appId: 'stocks', storageKey: DEVICE_STORAGE_KEYS.stocks, fileName: 'stocks.json' },
  { appId: 'gomoku', storageKey: DEVICE_STORAGE_KEYS.gomoku, fileName: 'gomoku.json' },
  { appId: 'mail', storageKey: DEVICE_STORAGE_KEYS.mail, fileName: 'mail.json' },
  { appId: 'news', storageKey: DEVICE_STORAGE_KEYS.news, fileName: 'news.json' },
  { appId: 'catgpt', storageKey: DEVICE_STORAGE_KEYS.catgpt, fileName: 'catgpt.json' },
  { appId: 'produde', storageKey: DEVICE_STORAGE_KEYS.produde, fileName: 'produde.json' },
  { appId: 'books', storageKey: DEVICE_STORAGE_KEYS.books, fileName: 'books-index.json' },
]

function loadMigratedAppIds(): Set<string> {
  try {
    const raw = localStorage.getItem(MIGRATION_MARK_KEY)
    if (!raw) return new Set()
    const parsed: unknown = JSON.parse(raw)
    if (!Array.isArray(parsed)) return new Set()
    return new Set(parsed.filter((value): value is string => typeof value === 'string'))
  } catch {
    return new Set()
  }
}

function markMigrated(appId: string, done: Set<string>): void {
  done.add(appId)
  try {
    localStorage.setItem(MIGRATION_MARK_KEY, JSON.stringify([...done]))
  } catch {
    // 标记失败不阻塞：下次启动幂等重试
  }
}

/** 该应用的旧 localStorage 数据是否已完成导出到 Data 目录 */
export function isAppDataMigrated(appId: string): boolean {
  return loadMigratedAppIds().has(appId)
}

export type AppDataMigrationResult = {
  migrated: string[]
  skipped: string[]
  failed: string[]
}

/** 迁走上一版 `/dev/apps/{appId}/Data` 旁路：文件搬到 Applications Data 后删除旁路。 */
async function migrateLegacyDevAppsData(): Promise<string[]> {
  const appsNode = (await listChildNodes('dev', undefined)).find(
    (node) => node.kind === 'folder' && node.name === APP_DATA_APPS_DIR_NAME,
  )
  if (!appsNode) return []

  const moved: string[] = []
  const entries = await listSubtreeFiles(`/dev/${APP_DATA_APPS_DIR_NAME}`).catch(() => [])
  for (const entry of entries) {
    // 旧版目录名即 appId 原样（内置 `weather`；gen `gen:xxx` 冒号保留）
    const match = /^\/dev\/apps\/([^/]+)\/Data\/(.+)$/.exec(entry.absolutePath)
    if (!match) continue
    const appId = appDataDirNameToAppId(match[1]!)
    const relativePath = match[2]!
    try {
      const node = await resolveNodeByAbsolutePath(entry.absolutePath)
      if (!node || node.kind !== 'file') continue
      const text = await readBlobText(node.id)
      if (text === undefined) continue
      await writeAppDataText(appId, relativePath, text)
      moved.push(appId)
    } catch {
      // 单项失败不阻塞整体；旁路保留待下次重试
    }
  }

  await deleteDevSystemSubtree(appsNode).catch(() => undefined)
  return moved
}

/** 启动时调用一次；已标记的应用跳过，失败项保留待下次重试 */
export async function runAppDataMigrationOnce(): Promise<AppDataMigrationResult> {
  const done = loadMigratedAppIds()
  const result: AppDataMigrationResult = { migrated: [], skipped: [], failed: [] }

  // 1) 上一版 `/dev/apps` 旁路 → Applications Data
  const legacyMoved = await migrateLegacyDevAppsData()
  result.migrated.push(...legacyMoved)

  // 2) 内置应用 localStorage → 每应用一个 JSON（空键不标记，等下次有数据再导出）
  for (const item of MIGRATION_ITEMS) {
    if (done.has(item.appId)) {
      result.skipped.push(item.appId)
      continue
    }

    let raw: string | null = null
    try {
      raw = localStorage.getItem(item.storageKey)
    } catch {
      raw = null
    }

    if (raw === null || raw === '') {
      // 空键不标记：该应用之后写入旧键时，下次启动仍会导出
      result.skipped.push(item.appId)
      continue
    }

    try {
      await writeAppDataText(item.appId, item.fileName, raw)
      markMigrated(item.appId, done)
      result.migrated.push(item.appId)
    } catch {
      result.failed.push(item.appId)
    }
  }

  // 3) 生成应用整份键值 → app-data.json（空对象不标记）
  for (const key of listGeneratedAppDataKeys()) {
    const appId = key.slice('instant-os-generated-app-data:'.length)
    if (!appId || done.has(appId)) {
      if (appId) result.skipped.push(appId)
      continue
    }
    const store = loadGeneratedAppData(appId as `gen:${string}`)
    if (Object.keys(store).length === 0) {
      result.skipped.push(appId)
      continue
    }
    try {
      await writeAppDataText(appId, 'app-data.json', `${JSON.stringify(store, null, 2)}\n`)
      markMigrated(appId, done)
      result.migrated.push(appId)
    } catch {
      result.failed.push(appId)
    }
  }

  return result
}
