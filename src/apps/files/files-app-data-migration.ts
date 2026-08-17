/**
 * 一次性迁移：把各应用历史 localStorage 文档数据导出为 /dev/apps/{appId}/Data 下的文件。
 * 保守策略：导出成功后标记完成，不删除旧键（应用侧接入新读写 API 后再清理旧键）。
 * 幂等：已标记完成的应用跳过；失败项保留待下次启动重试。
 */
import { DEVICE_STORAGE_KEYS } from '../../os/device-storage.ts'
import { writeAppDataText } from './files-app-data-api.ts'

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

/** 启动时调用一次；已标记的应用跳过，失败项保留待下次重试 */
export async function runAppDataMigrationOnce(): Promise<AppDataMigrationResult> {
  const done = loadMigratedAppIds()
  const result: AppDataMigrationResult = { migrated: [], skipped: [], failed: [] }

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
      markMigrated(item.appId, done)
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

  return result
}
