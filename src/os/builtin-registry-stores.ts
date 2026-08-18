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

const BUILTIN_STORE_MODULES: Array<{ appId: string; modulePath: string; readName: string }> = [
  { appId: 'weather', modulePath: '../apps/weather/weather-storage.ts', readName: 'readWeatherStore' },
  { appId: 'calendar', modulePath: '../apps/calendar/calendar-storage.ts', readName: 'readCalendarStore' },
  { appId: 'stocks', modulePath: '../apps/stocks/stocks-storage.ts', readName: 'readStocksStore' },
  { appId: 'gomoku', modulePath: '../apps/gomoku/gomoku-storage.ts', readName: 'loadGomokuGameMode' },
  { appId: 'mail', modulePath: '../apps/mail/mail-storage.ts', readName: 'readMailStore' },
  { appId: 'news', modulePath: '../apps/news/news-storage.ts', readName: 'readNewsStore' },
  { appId: 'catgpt', modulePath: '../apps/catgpt/catgpt-storage.ts', readName: 'readCatGptStore' },
  { appId: 'produde', modulePath: '../apps/produde/produde-storage.ts', readName: 'readProdudeStore' },
  { appId: 'books', modulePath: '../apps/books/books-storage.ts', readName: 'readBooksStore' },
  { appId: 'icode', modulePath: '../apps/icode/icode-storage.ts', readName: 'loadInternalProjects' },
]

export async function hydrateAllBuiltinRegistryStores(): Promise<void> {
  await Promise.all(
    BUILTIN_STORE_MODULES.map(async ({ appId, modulePath, readName }) => {
      try {
        const mod = (await import(modulePath)) as Record<string, unknown>
        const reader = mod[readName]
        if (typeof reader !== 'function') {
          console.warn(`[builtin-registry-stores] ${appId} 未导出 ${readName}，跳过拆分`)
          return
        }
        await reader()
      } catch (error) {
        // 单个应用拆分失败不应阻塞启动；保留旧 store 键，下次启动再试
        console.warn(`[builtin-registry-stores] ${appId} 字段拆分失败`, error)
      }
    }),
  )
}
