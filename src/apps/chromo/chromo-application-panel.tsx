import { useCallback, useEffect, useRef, useState } from 'preact/hooks'
import type {
  ChromoCookie,
  ChromoIdbDatabase,
  ChromoIdbEntry,
  ChromoIdbStore,
  ChromoNetworkCacheStats,
  ChromoStorageEntry,
  ChromoSwInfo,
} from './chromo-bridge.ts'
import { CHROMO_WORKER_ORIGIN } from './chromo-config.ts'

export type ChromoApplicationApi = {
  listCookies: () => Promise<{ cookies: ChromoCookie[] }>
  deleteCookie: (cookieId: string) => Promise<{ deleted: boolean }>
  clearCookies: (domain?: string) => Promise<{ cleared: number }>
  listStorage: (type: 'local' | 'session') => Promise<{
    type: 'local' | 'session'
    origin: string
    entries: ChromoStorageEntry[]
  }>
  setStorageItem: (type: 'local' | 'session', key: string, value: string) => Promise<unknown>
  removeStorageItem: (type: 'local' | 'session', key: string) => Promise<unknown>
  clearStorage: (type: 'local' | 'session') => Promise<unknown>
  getSwInfo: () => Promise<ChromoSwInfo>
  getNetworkCacheStats: () => Promise<ChromoNetworkCacheStats>
  listNetworkCache: (
    layer: 'hot' | 'archive',
  ) => Promise<{ layer: string; entries: unknown[] }>
  clearNetworkCache: (layer: 'hot' | 'archive' | 'all') => Promise<{ layer: string }>
  listIdb: () => Promise<{ databases: ChromoIdbDatabase[] }>
  deleteIdb: (name: string) => Promise<unknown>
  listIdbStores: (
    name: string,
  ) => Promise<{ name: string; version: number; stores: ChromoIdbStore[] }>
  getIdbAll: (
    name: string,
    store: string,
  ) => Promise<{
    name: string
    store: string
    keyPath: unknown
    entries: ChromoIdbEntry[]
    truncated?: boolean
  }>
  listSiteCaches: () => Promise<{ caches: string[] }>
  listSiteCacheKeys: (
    cache: string,
  ) => Promise<{ cache: string; urls: string[]; truncated?: boolean }>
  deleteSiteCache: (cache: string, url?: string) => Promise<unknown>
}

type NavId =
  | 'local-storage'
  | 'session-storage'
  | 'cookies'
  | 'indexeddb'
  | 'site-cache'
  | 'network-cache'
  | 'service-workers'
  | 'clear-storage'

const NAV: { id: NavId; label: string; group: string }[] = [
  { id: 'local-storage', label: '本地存储', group: '存储' },
  { id: 'session-storage', label: '会话存储', group: '存储' },
  { id: 'cookies', label: 'Cookie', group: '存储' },
  { id: 'indexeddb', label: 'IndexedDB', group: '存储' },
  { id: 'site-cache', label: 'Cache Storage', group: '缓存' },
  { id: 'network-cache', label: 'Network Cache', group: '缓存' },
  { id: 'service-workers', label: 'Service Workers', group: '后台' },
  { id: 'clear-storage', label: '清除存储', group: '后台' },
]

type ChromoApplicationPanelProps = {
  pageReady: boolean
  pageLoading?: boolean
  pageUrl?: string
  api: ChromoApplicationApi
  onClearBrowsingData?: () => Promise<void>
}

function formatBytes(n: number): string {
  if (!Number.isFinite(n) || n < 0) {
    return '—'
  }
  if (n < 1024) {
    return `${n} B`
  }
  if (n < 1024 * 1024) {
    return `${(n / 1024).toFixed(1)} KB`
  }
  return `${(n / (1024 * 1024)).toFixed(1)} MB`
}

function originFromUrl(url?: string): string {
  if (!url) {
    return ''
  }
  try {
    return new URL(url).origin
  } catch {
    return ''
  }
}

function normalizeOrigin(value: string): string {
  const trimmed = value.trim()
  if (!trimmed) {
    return ''
  }
  try {
    return new URL(trimmed).origin
  } catch {
    try {
      return new URL(`https://${trimmed}`).origin
    } catch {
      return trimmed.replace(/\/$/, '')
    }
  }
}

/** 虚拟空白页文档 origin（导航中间态）。 */
function isTransientStorageOrigin(origin: string): boolean {
  const normalized = normalizeOrigin(origin).toLowerCase()
  if (!normalized || normalized === 'null' || normalized === 'undefined') {
    return true
  }
  try {
    const parsed = new URL(normalized)
    const host = parsed.hostname.toLowerCase()
    return (
      host === 'blank' ||
      parsed.protocol === 'about:' ||
      parsed.protocol === 'chrome:' ||
      parsed.protocol === 'chrome-error:'
    )
  } catch {
    return (
      normalized === 'about:blank' ||
      normalized === 'https://blank' ||
      normalized === 'http://blank'
    )
  }
}

/**
 * listStorage 在真实站点上常返回 viewer 壳 origin（如 localhost:8787），
 * 不是地址栏页面 origin；不能拿它去和 pageUrl 做相等判断。
 */
function isViewerShellOrigin(origin: string): boolean {
  const actual = normalizeOrigin(origin)
  const worker = normalizeOrigin(CHROMO_WORKER_ORIGIN)
  return Boolean(actual && worker && actual === worker)
}

/** UI 展示用：优先地址栏目标 origin，避免露出 viewer 壳地址。 */
function displayStorageOrigin(apiOrigin: string, pageOrigin: string): string {
  if (pageOrigin) {
    return pageOrigin
  }
  if (apiOrigin && !isViewerShellOrigin(apiOrigin) && !isTransientStorageOrigin(apiOrigin)) {
    return apiOrigin
  }
  return apiOrigin || '—'
}

/** 这些面板在导航切换期间需要等离开 blank 再展示。 */
function navNeedsOriginMatch(nav: NavId): boolean {
  return (
    nav === 'local-storage' ||
    nav === 'session-storage' ||
    nav === 'indexeddb' ||
    nav === 'site-cache' ||
    nav === 'service-workers'
  )
}

const ORIGIN_SYNC_MAX_MS = 8_000
const ORIGIN_SYNC_RETRY_MS = 350

export function ChromoApplicationPanel({
  pageReady,
  pageLoading = false,
  pageUrl,
  api,
  onClearBrowsingData,
}: ChromoApplicationPanelProps) {
  const [nav, setNav] = useState<NavId>('cookies')
  const [error, setError] = useState<string>('')
  const [busy, setBusy] = useState(false)

  const [cookies, setCookies] = useState<ChromoCookie[]>([])
  const [storageEntries, setStorageEntries] = useState<ChromoStorageEntry[]>([])
  const [storageOrigin, setStorageOrigin] = useState('')
  const [swInfo, setSwInfo] = useState<ChromoSwInfo | null>(null)
  const [cacheStats, setCacheStats] = useState<ChromoNetworkCacheStats | null>(null)
  const [cacheLayer, setCacheLayer] = useState<'hot' | 'archive'>('hot')
  const [cacheEntries, setCacheEntries] = useState<unknown[]>([])
  const [idbList, setIdbList] = useState<ChromoIdbDatabase[]>([])
  const [idbName, setIdbName] = useState('')
  const [idbStores, setIdbStores] = useState<ChromoIdbStore[]>([])
  const [idbStore, setIdbStore] = useState('')
  const [idbEntries, setIdbEntries] = useState<ChromoIdbEntry[]>([])
  const [siteCaches, setSiteCaches] = useState<string[]>([])
  const [siteCacheName, setSiteCacheName] = useState('')
  const [siteCacheUrls, setSiteCacheUrls] = useState<string[]>([])
  const [clearBusy, setClearBusy] = useState(false)
  /** origin 作用域数据是否已与地址栏目标对齐（未对齐时不展示中间态脏数据） */
  const [originScopedReady, setOriginScopedReady] = useState(false)
  const refreshSeqRef = useRef(0)
  const apiRef = useRef(api)
  apiRef.current = api
  const pageLoadingRef = useRef(pageLoading)
  pageLoadingRef.current = pageLoading

  const expectedOrigin = originFromUrl(pageUrl)

  const run = useCallback(
    async (fn: () => Promise<void>) => {
      if (!pageReady) {
        setError('页面未就绪')
        return
      }
      setBusy(true)
      setError('')
      try {
        await fn()
      } catch (err) {
        setError(err instanceof Error ? err.message : String(err))
      } finally {
        setBusy(false)
      }
    },
    [pageReady],
  )

  const refresh = useCallback(async (options?: {
    force?: boolean
  }): Promise<{ matchedOrigin: boolean }> => {
    if (!pageReady) {
      setError('页面未就绪')
      return { matchedOrigin: false }
    }
    const currentApi = apiRef.current
    const loading = options?.force ? false : pageLoadingRef.current
    const seq = ++refreshSeqRef.current
    setBusy(true)
    setError('')
    try {
      if (nav === 'cookies') {
        const result = await currentApi.listCookies()
        if (seq !== refreshSeqRef.current) {
          return { matchedOrigin: true }
        }
        setCookies(result.cookies ?? [])
        return { matchedOrigin: true }
      }
      if (nav === 'local-storage' || nav === 'session-storage') {
        const type = nav === 'session-storage' ? 'session' : 'local'
        const result = await currentApi.listStorage(type)
        if (seq !== refreshSeqRef.current) {
          return { matchedOrigin: false }
        }
        const origin = result.origin ?? ''
        const stillOnBlank = isTransientStorageOrigin(origin)

        // 仅丢弃虚拟空白页中间态；viewer 壳 origin（localhost:8787）是正常结果
        if (stillOnBlank) {
          if (loading) {
            setStorageEntries([])
            setStorageOrigin('')
            setOriginScopedReady(false)
            return { matchedOrigin: false }
          }
          // 导航结束仍停在 blank：空表 + 地址栏 origin 文案
          setStorageEntries([])
          setStorageOrigin(displayStorageOrigin(origin, expectedOrigin))
          setOriginScopedReady(true)
          return { matchedOrigin: true }
        }

        setStorageEntries(result.entries ?? [])
        setStorageOrigin(displayStorageOrigin(origin, expectedOrigin))
        setOriginScopedReady(true)
        return { matchedOrigin: true }
      }
      if (nav === 'service-workers') {
        if (loading && expectedOrigin) {
          setOriginScopedReady(false)
          return { matchedOrigin: false }
        }
        const info = await currentApi.getSwInfo()
        if (seq !== refreshSeqRef.current) {
          return { matchedOrigin: false }
        }
        setSwInfo(info)
        setOriginScopedReady(true)
        return { matchedOrigin: true }
      }
      if (nav === 'network-cache') {
        setCacheStats(await currentApi.getNetworkCacheStats())
        const listed = await currentApi.listNetworkCache(cacheLayer)
        if (seq !== refreshSeqRef.current) {
          return { matchedOrigin: true }
        }
        setCacheEntries(listed.entries ?? [])
        return { matchedOrigin: true }
      }
      if (nav === 'indexeddb') {
        if (loading && expectedOrigin) {
          setOriginScopedReady(false)
          return { matchedOrigin: false }
        }
        const listed = await currentApi.listIdb()
        if (seq !== refreshSeqRef.current) {
          return { matchedOrigin: false }
        }
        setIdbList(listed.databases ?? [])
        if (idbName) {
          const stores = await currentApi.listIdbStores(idbName)
          if (seq !== refreshSeqRef.current) {
            return { matchedOrigin: false }
          }
          setIdbStores(stores.stores ?? [])
          if (idbStore) {
            const rows = await currentApi.getIdbAll(idbName, idbStore)
            if (seq !== refreshSeqRef.current) {
              return { matchedOrigin: false }
            }
            setIdbEntries(rows.entries ?? [])
          } else {
            setIdbEntries([])
          }
        } else {
          setIdbStores([])
          setIdbEntries([])
        }
        setOriginScopedReady(true)
        return { matchedOrigin: true }
      }
      if (nav === 'site-cache') {
        if (loading && expectedOrigin) {
          setOriginScopedReady(false)
          return { matchedOrigin: false }
        }
        const listed = await currentApi.listSiteCaches()
        if (seq !== refreshSeqRef.current) {
          return { matchedOrigin: false }
        }
        setSiteCaches(listed.caches ?? [])
        if (siteCacheName) {
          const keys = await currentApi.listSiteCacheKeys(siteCacheName)
          if (seq !== refreshSeqRef.current) {
            return { matchedOrigin: false }
          }
          setSiteCacheUrls(keys.urls ?? [])
        } else {
          setSiteCacheUrls([])
        }
        setOriginScopedReady(true)
        return { matchedOrigin: true }
      }
      return { matchedOrigin: true }
    } catch (err) {
      if (seq === refreshSeqRef.current) {
        setError(err instanceof Error ? err.message : String(err))
      }
      return { matchedOrigin: false }
    } finally {
      if (seq === refreshSeqRef.current) {
        setBusy(false)
      }
    }
  }, [cacheLayer, expectedOrigin, idbName, idbStore, nav, pageReady, siteCacheName])

  // 地址栏目标变更时先清掉旧域数据，避免短暂显示上一站内容
  useEffect(() => {
    setStorageEntries([])
    setStorageOrigin('')
    setIdbList([])
    setIdbName('')
    setIdbStores([])
    setIdbStore('')
    setIdbEntries([])
    setSiteCaches([])
    setSiteCacheName('')
    setSiteCacheUrls([])
    setSwInfo(null)
    setOriginScopedReady(false)
  }, [pageUrl])

  useEffect(() => {
    if (!pageReady) {
      return
    }

    let cancelled = false
    let timer = 0
    const startedAt = Date.now()

    const tick = async () => {
      const result = await refresh()
      if (cancelled) {
        return
      }
      const elapsed = Date.now() - startedAt
      const loading = pageLoadingRef.current
      // 仅在仍加载且未对齐时继续轮询；loading 结束或超时则停，避免永久「正在切换」
      const needsRetry =
        navNeedsOriginMatch(nav) &&
        !result.matchedOrigin &&
        loading &&
        elapsed < ORIGIN_SYNC_MAX_MS
      if (needsRetry) {
        timer = window.setTimeout(() => {
          void tick()
        }, ORIGIN_SYNC_RETRY_MS)
        return
      }
      if (navNeedsOriginMatch(nav) && !result.matchedOrigin && !cancelled) {
        void refresh({ force: true })
      }
    }

    void tick()

    return () => {
      cancelled = true
      if (timer) {
        window.clearTimeout(timer)
      }
      refreshSeqRef.current += 1
    }
  }, [refresh, pageUrl, pageReady, nav])

  // loading 结束后补一次（不因 VC_LOADING 抖动重置轮询计时）
  useEffect(() => {
    if (!pageReady || pageLoading || !navNeedsOriginMatch(nav)) {
      return
    }
    if (originScopedReady) {
      return
    }
    void refresh({ force: true })
  }, [pageLoading, pageReady, nav, originScopedReady, refresh])

  const groups = [...new Set(NAV.map((item) => item.group))]

  return (
    <div class="chromo-application">
      <aside class="chromo-application__nav" aria-label="应用程序分区">
        {groups.map((group) => (
          <div key={group} class="chromo-application__nav-group">
            <div class="chromo-application__nav-group-label">{group}</div>
            {NAV.filter((item) => item.group === group).map((item) => (
              <button
                key={item.id}
                type="button"
                class={[
                  'chromo-application__nav-item',
                  nav === item.id ? 'chromo-application__nav-item--active' : '',
                ]
                  .filter(Boolean)
                  .join(' ')}
                onClick={() => setNav(item.id)}
              >
                {item.label}
              </button>
            ))}
          </div>
        ))}
      </aside>

      <section class="chromo-application__main">
        <header class="chromo-application__toolbar">
          <div class="chromo-application__toolbar-title">
            {NAV.find((item) => item.id === nav)?.label}
            {pageUrl ? <span class="chromo-application__muted"> · {pageUrl}</span> : null}
          </div>
          <div class="chromo-application__toolbar-actions">
            {pageLoading ? <span class="chromo-application__muted">页面仍在加载中</span> : null}
            {busy ? <span class="chromo-application__muted">加载中…</span> : null}
            <button type="button" class="chromo-application__btn" onClick={refresh} disabled={!pageReady}>
              刷新
            </button>
          </div>
        </header>
        {error ? <div class="chromo-application__error">{error}</div> : null}

        {!pageUrl ? (
          <div class="chromo-application__empty">打开网页后可查看与管理存储。</div>
        ) : null}

        {!pageReady && pageUrl ? (
          <div class="chromo-application__empty">Viewer 未就绪，稍候即可查看存储。</div>
        ) : null}

        {pageReady && nav === 'cookies' ? (
          <div class="chromo-application__table-wrap">
            <div class="chromo-application__row-actions">
              <button
                type="button"
                class="chromo-application__btn"
                onClick={() =>
                  void run(async () => {
                    await api.clearCookies()
                    await refresh()
                  })
                }
              >
                清空全部 Cookie
              </button>
            </div>
            <table class="chromo-application__table">
              <thead>
                <tr>
                  <th>Name</th>
                  <th>Value</th>
                  <th>Domain</th>
                  <th>Path</th>
                  <th>HttpOnly</th>
                  <th>Secure</th>
                  <th />
                </tr>
              </thead>
              <tbody>
                {cookies.map((cookie) => (
                  <tr key={cookie.id}>
                    <td>{cookie.name}</td>
                    <td class="chromo-application__mono">{cookie.value}</td>
                    <td>{cookie.domain}</td>
                    <td>{cookie.path}</td>
                    <td>{cookie.httpOnly ? '✓' : ''}</td>
                    <td>{cookie.secure ? '✓' : ''}</td>
                    <td>
                      <button
                        type="button"
                        class="chromo-application__btn chromo-application__btn--small"
                        onClick={() =>
                          void run(async () => {
                            await api.deleteCookie(cookie.id)
                            await refresh()
                          })
                        }
                      >
                        删除
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
            {cookies.length === 0 ? (
              <div class="chromo-application__empty">无 Cookie</div>
            ) : null}
          </div>
        ) : null}

        {pageReady && (nav === 'local-storage' || nav === 'session-storage') ? (
          <div class="chromo-application__table-wrap">
            {!originScopedReady ? (
              <div class="chromo-application__empty">
                {expectedOrigin
                  ? `正在切换到 ${expectedOrigin}…`
                  : '正在获取存储…'}
              </div>
            ) : (
              <>
            <div class="chromo-application__row-actions">
              <span class="chromo-application__muted">origin: {storageOrigin || '—'}</span>
              <button
                type="button"
                class="chromo-application__btn"
                onClick={() =>
                  void run(async () => {
                    await api.clearStorage(nav === 'session-storage' ? 'session' : 'local')
                    await refresh()
                  })
                }
              >
                清空
              </button>
            </div>
            <table class="chromo-application__table">
              <thead>
                <tr>
                  <th>Key</th>
                  <th>Value</th>
                  <th />
                </tr>
              </thead>
              <tbody>
                {storageEntries.map((entry) => (
                  <tr key={entry.key}>
                    <td class="chromo-application__mono">{entry.key}</td>
                    <td class="chromo-application__mono">{entry.value}</td>
                    <td>
                      <button
                        type="button"
                        class="chromo-application__btn chromo-application__btn--small"
                        onClick={() =>
                          void run(async () => {
                            await api.removeStorageItem(
                              nav === 'session-storage' ? 'session' : 'local',
                              entry.key,
                            )
                            await refresh()
                          })
                        }
                      >
                        删除
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
            {storageEntries.length === 0 ? (
              <div class="chromo-application__empty">无条目</div>
            ) : null}
              </>
            )}
          </div>
        ) : null}

        {pageReady && nav === 'service-workers' ? (
          !originScopedReady ? (
            <div class="chromo-application__empty">
              {expectedOrigin ? `正在切换到 ${expectedOrigin}…` : '正在获取…'}
            </div>
          ) : (
          <div class="chromo-application__card">
            <h3 class="chromo-application__card-title">Viewer 代理 Service Worker</h3>
            <p class="chromo-application__hint">
              站点页面的 <code>navigator.serviceWorker.register</code> 已被代理层禁用；此处仅显示
              Chromo Viewer 自身的 SW。
            </p>
            {swInfo ? (
              <dl class="chromo-application__dl">
                <div>
                  <dt>scriptURL</dt>
                  <dd class="chromo-application__mono">{swInfo.scriptURL || '—'}</dd>
                </div>
                <div>
                  <dt>state</dt>
                  <dd>{swInfo.state}</dd>
                </div>
                <div>
                  <dt>build</dt>
                  <dd>
                    {swInfo.build} / {swInfo.version}
                  </dd>
                </div>
                <div>
                  <dt>controlled</dt>
                  <dd>{swInfo.controlled ? '是' : '否'}</dd>
                </div>
                <div>
                  <dt>站点 SW</dt>
                  <dd>{swInfo.siteServiceWorkerBlocked ? '已禁用注册' : '可用'}</dd>
                </div>
              </dl>
            ) : (
              <div class="chromo-application__empty">暂无信息</div>
            )}
          </div>
          )
        ) : null}

        {pageReady && nav === 'network-cache' ? (
          <div class="chromo-application__table-wrap">
            <div class="chromo-application__row-actions">
              {cacheStats ? (
                <span class="chromo-application__muted">
                  Hot {cacheStats.hot.entries} / {formatBytes(cacheStats.hot.bytes)} · Archive{' '}
                  {cacheStats.archive.entries} / {formatBytes(cacheStats.archive.bytes)}
                </span>
              ) : null}
              <select
                value={cacheLayer}
                onChange={(event) =>
                  setCacheLayer((event.currentTarget as HTMLSelectElement).value as 'hot' | 'archive')
                }
              >
                <option value="hot">Hot</option>
                <option value="archive">Archive</option>
              </select>
              <button
                type="button"
                class="chromo-application__btn"
                onClick={() =>
                  void run(async () => {
                    await api.clearNetworkCache(cacheLayer)
                    await refresh()
                  })
                }
              >
                清空本层
              </button>
              <button
                type="button"
                class="chromo-application__btn"
                onClick={() =>
                  void run(async () => {
                    await api.clearNetworkCache('all')
                    await refresh()
                  })
                }
              >
                清空全部
              </button>
            </div>
            <table class="chromo-application__table">
              <thead>
                <tr>
                  <th>Key</th>
                  <th>Size</th>
                  <th>Meta</th>
                </tr>
              </thead>
              <tbody>
                {cacheEntries.map((row, index) => {
                  const item = row as Record<string, unknown>
                  return (
                    <tr key={String(item.key ?? index)}>
                      <td class="chromo-application__mono">{String(item.key ?? item.entryId ?? '')}</td>
                      <td>{formatBytes(Number(item.size) || 0)}</td>
                      <td class="chromo-application__mono">
                        {item.fresh !== undefined
                          ? `fresh=${String(item.fresh)}`
                          : item.entryId
                            ? `entryId=${String(item.entryId)}`
                            : ''}
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
            {cacheEntries.length === 0 ? (
              <div class="chromo-application__empty">无缓存条目</div>
            ) : null}
          </div>
        ) : null}

        {pageReady && nav === 'indexeddb' ? (
          !originScopedReady ? (
            <div class="chromo-application__empty">
              {expectedOrigin ? `正在切换到 ${expectedOrigin}…` : '正在获取…'}
            </div>
          ) : (
          <div class="chromo-application__split">
            <div class="chromo-application__list">
              <div class="chromo-application__list-title">Databases</div>
              {idbList.map((db) => (
                <button
                  key={db.name}
                  type="button"
                  class={[
                    'chromo-application__list-item',
                    idbName === db.name ? 'chromo-application__list-item--active' : '',
                  ]
                    .filter(Boolean)
                    .join(' ')}
                  onClick={() => {
                    setIdbName(db.name)
                    setIdbStore('')
                    setIdbEntries([])
                  }}
                >
                  {db.name}
                  <span class="chromo-application__muted"> v{db.version}</span>
                </button>
              ))}
              {idbList.length === 0 ? (
                <div class="chromo-application__empty">无数据库</div>
              ) : null}
              {idbName ? (
                <button
                  type="button"
                  class="chromo-application__btn"
                  onClick={() =>
                    void run(async () => {
                      await api.deleteIdb(idbName)
                      setIdbName('')
                      setIdbStore('')
                      setIdbStores([])
                      setIdbEntries([])
                      await refresh()
                    })
                  }
                >
                  删除数据库
                </button>
              ) : null}
            </div>
            <div class="chromo-application__list">
              <div class="chromo-application__list-title">Object stores</div>
              {idbStores.map((store) => (
                <button
                  key={store.name}
                  type="button"
                  class={[
                    'chromo-application__list-item',
                    idbStore === store.name ? 'chromo-application__list-item--active' : '',
                  ]
                    .filter(Boolean)
                    .join(' ')}
                  onClick={() => setIdbStore(store.name)}
                >
                  {store.name}
                  <span class="chromo-application__muted"> ({store.count})</span>
                </button>
              ))}
            </div>
            <div class="chromo-application__table-wrap">
              <table class="chromo-application__table">
                <thead>
                  <tr>
                    <th>Key</th>
                    <th>Value</th>
                  </tr>
                </thead>
                <tbody>
                  {idbEntries.map((entry, index) => (
                    <tr key={index}>
                      <td class="chromo-application__mono">
                        {typeof entry.key === 'string' || typeof entry.key === 'number'
                          ? String(entry.key)
                          : JSON.stringify(entry.key)}
                      </td>
                      <td class="chromo-application__mono">{entry.value?.preview ?? ''}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
              {!idbStore ? (
                <div class="chromo-application__empty">选择 object store</div>
              ) : null}
            </div>
          </div>
          )
        ) : null}

        {pageReady && nav === 'site-cache' ? (
          !originScopedReady ? (
            <div class="chromo-application__empty">
              {expectedOrigin ? `正在切换到 ${expectedOrigin}…` : '正在获取…'}
            </div>
          ) : (
          <div class="chromo-application__split">
            <div class="chromo-application__list">
              <div class="chromo-application__list-title">Caches</div>
              {siteCaches.map((name) => (
                <button
                  key={name}
                  type="button"
                  class={[
                    'chromo-application__list-item',
                    siteCacheName === name ? 'chromo-application__list-item--active' : '',
                  ]
                    .filter(Boolean)
                    .join(' ')}
                  onClick={() => setSiteCacheName(name)}
                >
                  {name}
                </button>
              ))}
              {siteCaches.length === 0 ? (
                <div class="chromo-application__empty">无 Cache Storage</div>
              ) : null}
              {siteCacheName ? (
                <button
                  type="button"
                  class="chromo-application__btn"
                  onClick={() =>
                    void run(async () => {
                      await api.deleteSiteCache(siteCacheName)
                      setSiteCacheName('')
                      setSiteCacheUrls([])
                      await refresh()
                    })
                  }
                >
                  删除此 Cache
                </button>
              ) : null}
            </div>
            <div class="chromo-application__table-wrap">
              <table class="chromo-application__table">
                <thead>
                  <tr>
                    <th>URL</th>
                    <th />
                  </tr>
                </thead>
                <tbody>
                  {siteCacheUrls.map((url) => (
                    <tr key={url}>
                      <td class="chromo-application__mono">{url}</td>
                      <td>
                        <button
                          type="button"
                          class="chromo-application__btn chromo-application__btn--small"
                          onClick={() =>
                            void run(async () => {
                              await api.deleteSiteCache(siteCacheName, url)
                              await refresh()
                            })
                          }
                        >
                          删除
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
          )
        ) : null}

        {pageReady && nav === 'clear-storage' ? (
          <div class="chromo-application__card">
            <h3 class="chromo-application__card-title">清除浏览数据</h3>
            <p class="chromo-application__hint">
              将清空所有 Chromo 标签页共享的 Cookie、网页 Storage、热缓存与归档缓存（等同于{' '}
              <code>VC_CLEAR_STATE</code>）。
            </p>
            <button
              type="button"
              class="chromo-application__btn chromo-application__btn--danger"
              disabled={clearBusy || !onClearBrowsingData}
              onClick={() => {
                if (!onClearBrowsingData || clearBusy) {
                  return
                }
                const ok = window.confirm(
                  '将清空所有 Chromo 标签页的 Cookie、网页 Storage 与热缓存。确定继续？',
                )
                if (!ok) {
                  return
                }
                setClearBusy(true)
                void onClearBrowsingData()
                  .catch((err) => {
                    setError(err instanceof Error ? err.message : String(err))
                  })
                  .finally(() => {
                    setClearBusy(false)
                    refresh()
                  })
              }}
            >
              {clearBusy ? '清空中…' : '清空 Cookie / Storage / 缓存'}
            </button>
          </div>
        ) : null}
      </section>
    </div>
  )
}
