/**
 * 启动时统一触发所有内置应用的注册表字段拆分。
 *
 * 历史原因：旧版迁移/旧代码把每个内置应用的整份状态写入单个 `store`（或 icode 的
 * `internal-projects`）键。新版 `createRegistryStore` 的字段模式会在首次 `read()`
 * / `hydrate()` 时自动把旧单键拆分为字段级 key。但如果用户一直没打开某个应用，
 * 这个拆分就永远不会发生，导致注册表管理器里只看到 `store`。
 *
 * 本模块在启动迁移完成后被调用一次：动态 import 各内置应用 storage 模块并触发读取，
 * 从而在所有内置应用上完成字段拆分。幂等：已拆分的应用会直接命中字段 key，不会复写。
 */

import { readWeatherStore } from '../apps/weather/weather-storage.ts'
import { readCalendarStore } from '../apps/calendar/calendar-storage.ts'
import { readStocksStore } from '../apps/stocks/stocks-storage.ts'
import { loadGomokuGameMode } from '../apps/gomoku/gomoku-storage.ts'
import { readMailStore } from '../apps/mail/mail-storage.ts'
import { readNewsStore } from '../apps/news/news-storage.ts'
import { readCatGptStore } from '../apps/catgpt/catgpt-storage.ts'
import { readProdudeStore } from '../apps/produde/produde-storage.ts'
import { readBooksStore } from '../apps/books/books-storage.ts'
import { loadInternalProjects } from '../apps/icode/icode-storage.ts'

const BUILTIN_STORE_READERS: Array<{ appId: string; read: () => Promise<unknown> }> = [
  { appId: 'weather', read: readWeatherStore },
  { appId: 'calendar', read: readCalendarStore },
  { appId: 'stocks', read: readStocksStore },
  { appId: 'gomoku', read: loadGomokuGameMode },
  { appId: 'mail', read: readMailStore },
  { appId: 'news', read: readNewsStore },
  { appId: 'catgpt', read: readCatGptStore },
  { appId: 'produde', read: readProdudeStore },
  { appId: 'books', read: readBooksStore },
  { appId: 'icode', read: loadInternalProjects },
]

export async function hydrateAllBuiltinRegistryStores(): Promise<void> {
  await Promise.all(
    BUILTIN_STORE_READERS.map(async ({ appId, read }) => {
      try {
        await read()
      } catch (error) {
        // 单个应用拆分失败不应阻塞启动；保留旧 store 键，下次启动再试
        console.warn(`[builtin-registry-stores] ${appId} 字段拆分失败`, error)
      }
    }),
  )
}
