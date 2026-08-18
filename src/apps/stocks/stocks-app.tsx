import { useCallback, useEffect, useMemo, useState } from 'preact/hooks'
import { useAboutApp } from '../../os/about-app-context.tsx'
import { aboutAppMenuPrefix } from '../../os/about-app-menu.ts'
import { useAppMenuBar } from '../../os/menu-bar-context.tsx'
import type { MenuDefinition } from '../../os/menu-bar-types.ts'
import { loadNotificationCenterWidgetsCache } from '../../os/notification-center-widgets-storage.ts'
import { useOs } from '../../os/os-context.tsx'
import { generateStockBoard, generateStockDetail } from './stocks-agent.ts'
import { StocksSearchSheet } from './stocks-search-sheet.tsx'
import {
  bootstrapStocksStoreFromWidgetCache,
  clearActiveWatch,
  getActiveWatch,
  isWidgetDefaultWatch,
  readStocksStore,
  removeWatchEntry,
  setActiveWatch,
  setDefaultDisplay,
  subscribeStocksStore,
  updateMarketBoard,
  updateWatchDetail,
  upsertWatchEntry,
  writeStocksStore,
} from './stocks-storage.ts'
import type { StockBoard, StockDetail, StockSearchSuggestion, StocksStore } from './stocks-types.ts'
import './stocks.css'

function formatSigned(value: number, digits = 2): string {
  const prefix = value > 0 ? '+' : ''
  return `${prefix}${value.toFixed(digits)}`
}

type StockQuoteRowProps = {
  symbol: string
  name: string
  price: number
  change: number
  changePercent: number
}

function StockQuoteRow({ symbol, name, price, change, changePercent }: StockQuoteRowProps) {
  const rising = change >= 0
  return (
    <div class="stocks-app__stock-row">
      <div class="stocks-app__stock-name">
        <span class="stocks-app__stock-symbol">{symbol}</span>
        <span class="stocks-app__stock-title">{name}</span>
      </div>
      <div class="stocks-app__stock-quote">
        <span class="stocks-app__stock-price">{price.toFixed(2)}</span>
        <span
          class={
            rising
              ? 'stocks-app__stock-change stocks-app__stock-change--up'
              : 'stocks-app__stock-change stocks-app__stock-change--down'
          }
        >
          {formatSigned(change)} ({formatSigned(changePercent)}%)
        </span>
      </div>
    </div>
  )
}

type StockDetailPanelProps = {
  detail: StockDetail
  isDefaultWatch: boolean
  isWidgetDefault: boolean
  onSetWidgetDefault: () => void
}

function StockDetailPanel({
  detail,
  isDefaultWatch,
  isWidgetDefault,
  onSetWidgetDefault,
}: StockDetailPanelProps) {
  return (
    <div class="stocks-app__detail-card">
      <div class="stocks-app__detail-badges">
        {isDefaultWatch && <span class="stocks-app__badge">默认股票</span>}
        {!isDefaultWatch && <span class="stocks-app__badge">自选</span>}
        {isWidgetDefault && <span class="stocks-app__badge stocks-app__badge--widget">通知中心</span>}
      </div>
      <div class="stocks-app__detail-header">
        <div>
          <h2 class="stocks-app__detail-symbol">{detail.symbol}</h2>
          <p class="stocks-app__detail-name">
            {detail.name} · {detail.exchange}
          </p>
        </div>
        <div class="stocks-app__detail-quote">
          <div>
            <div class="stocks-app__detail-price">{detail.price.toFixed(2)}</div>
            <span
              class={
                detail.change >= 0
                  ? 'stocks-app__stock-change stocks-app__stock-change--up'
                  : 'stocks-app__stock-change stocks-app__stock-change--down'
              }
            >
              {formatSigned(detail.change)} ({formatSigned(detail.changePercent)}%)
            </span>
          </div>
          {!isWidgetDefault && (
            <button
              type="button"
              class="stocks-app__widget-pin"
              aria-label="设为通知中心显示"
              title="设为通知中心显示"
              onClick={onSetWidgetDefault}
            >
              <svg
                class="stocks-app__widget-pin-icon"
                width="18"
                height="18"
                viewBox="0 0 24 24"
                aria-hidden="true"
              >
                <rect
                  x="4"
                  y="4"
                  width="16"
                  height="16"
                  rx="3.5"
                  fill="none"
                  stroke="currentColor"
                  stroke-width="1.75"
                />
                <path
                  d="M8 9.5h8M8 12.5h5.5M12 16.5V21M9.5 19h5"
                  fill="none"
                  stroke="currentColor"
                  stroke-width="1.75"
                  stroke-linecap="round"
                  stroke-linejoin="round"
                />
              </svg>
            </button>
          )}
        </div>
      </div>
      <div class="stocks-app__detail-grid">
        <div class="stocks-app__stat">
          <span class="stocks-app__stat-label">今开</span>
          <span class="stocks-app__stat-value">{detail.open.toFixed(2)}</span>
        </div>
        <div class="stocks-app__stat">
          <span class="stocks-app__stat-label">昨收</span>
          <span class="stocks-app__stat-value">{detail.prevClose.toFixed(2)}</span>
        </div>
        <div class="stocks-app__stat">
          <span class="stocks-app__stat-label">最高</span>
          <span class="stocks-app__stat-value">{detail.high.toFixed(2)}</span>
        </div>
        <div class="stocks-app__stat">
          <span class="stocks-app__stat-label">最低</span>
          <span class="stocks-app__stat-value">{detail.low.toFixed(2)}</span>
        </div>
        <div class="stocks-app__stat">
          <span class="stocks-app__stat-label">成交量</span>
          <span class="stocks-app__stat-value">{detail.volume}</span>
        </div>
        <div class="stocks-app__stat">
          <span class="stocks-app__stat-label">市值</span>
          <span class="stocks-app__stat-value">{detail.marketCap}</span>
        </div>
      </div>
      <p class="stocks-app__detail-summary">{detail.summary}</p>
    </div>
  )
}

export function StocksApp() {
  const { setAppWindowTitle, closeWindowsForApp, minimizeWindow, windows } = useOs()
  const { showBuiltinAbout } = useAboutApp()

  const widgetCache = useMemo(() => loadNotificationCenterWidgetsCache(), [])
  const [store, setStore] = useState<StocksStore | undefined>(undefined)
  const [board, setBoard] = useState<StockBoard | undefined>(undefined)
  const [searchQuery, setSearchQuery] = useState('')
  const [searchSheetOpen, setSearchSheetOpen] = useState(false)
  const [searchSheetQuery, setSearchSheetQuery] = useState('')
  const [loadingBoard, setLoadingBoard] = useState(false)
  const [loadingWatchId, setLoadingWatchId] = useState<string | undefined>(undefined)
  const [addingSymbol, setAddingSymbol] = useState<string | undefined>(undefined)
  const [error, setError] = useState<string | undefined>(undefined)
  const [bootstrapped, setBootstrapped] = useState(false)

  const activeWatch = useMemo(() => (store ? getActiveWatch(store) : undefined), [store])

  useEffect(() => {
    setAppWindowTitle('stocks', '股票')
  }, [setAppWindowTitle])

  useEffect(() => {
    let alive = true
    const load = () => {
      bootstrapStocksStoreFromWidgetCache(widgetCache.stocks).then((next) => {
        if (!alive) {
          return
        }
        setStore(next)
        if (next.marketBoard) {
          setBoard(next.marketBoard)
        }
      })
    }
    load()
    const unsubscribe = subscribeStocksStore(load)
    return () => {
      alive = false
      unsubscribe()
    }
  }, [widgetCache.stocks])

  const loadBoard = useCallback(async (force = false) => {
    const current = await readStocksStore()
    if (!force && current.marketBoard) {
      setBoard(current.marketBoard)
      return
    }

    setLoadingBoard(true)
    setError(undefined)
    try {
      const data = await generateStockBoard()
      const next = await updateMarketBoard(data)
      setStore(next)
      setBoard(data)
    } catch (err) {
      setError(err instanceof Error ? err.message : '行情生成失败')
    } finally {
      setLoadingBoard(false)
    }
  }, [])

  useEffect(() => {
    if (bootstrapped || store === undefined) {
      return
    }
    setBootstrapped(true)
    void loadBoard()
  }, [bootstrapped, store, loadBoard])

  const refreshWatchDetail = useCallback(async (watchId: string, query: string) => {
    setLoadingWatchId(watchId)
    setError(undefined)
    try {
      const detail = await generateStockDetail(query)
      const next = await updateWatchDetail(watchId, detail)
      setStore(next)
    } catch (err) {
      setError(err instanceof Error ? err.message : '刷新失败')
    } finally {
      setLoadingWatchId(undefined)
    }
  }, [])

  const openSearchSheet = useCallback(() => {
    const query = searchQuery.trim()
    if (!query) {
      return
    }
    setSearchSheetQuery(query)
    setSearchSheetOpen(true)
  }, [searchQuery])

  const handleSelectSuggestion = useCallback(async (suggestion: StockSearchSuggestion) => {
    setAddingSymbol(suggestion.symbol)
    setError(undefined)
    try {
      const detail = await generateStockDetail(`${suggestion.symbol} ${suggestion.name}`)
      const next = upsertWatchEntry(await readStocksStore(), {
        symbol: suggestion.symbol,
        name: suggestion.name,
        exchange: suggestion.exchange,
        detail,
      })
      await writeStocksStore(next)
      setStore(next)
      setSearchSheetOpen(false)
      setSearchQuery('')
    } catch (err) {
      setError(err instanceof Error ? err.message : '添加失败')
    } finally {
      setAddingSymbol(undefined)
    }
  }, [])

  const handleSelectWatch = useCallback(async (watchId: string) => {
    const next = await setActiveWatch(watchId)
    setStore(next)
  }, [])

  const handleSelectBoard = useCallback(async () => {
    const next = await clearActiveWatch()
    setStore(next)
  }, [])

  const handleRemoveWatch = useCallback(async (watchId: string) => {
    const next = await removeWatchEntry(watchId)
    setStore(next)
  }, [])

  const handleSetWidgetDefault = useCallback(async () => {
    if (!activeWatch || !store) {
      return
    }
    const next =
      activeWatch.id === store.defaultWatchId
        ? await setDefaultDisplay('default-watch')
        : await setDefaultDisplay(activeWatch.id)
    setStore(next)
  }, [activeWatch, store?.defaultWatchId])

  const handleSetMarketBoardDefault = useCallback(async () => {
    const next = await setDefaultDisplay('market-board')
    setStore(next)
  }, [])

  const handleRefresh = useCallback(async () => {
    if (activeWatch) {
      await refreshWatchDetail(activeWatch.id, `${activeWatch.symbol} ${activeWatch.name}`)
      return
    }
    await loadBoard(true)
  }, [activeWatch, refreshWatchDetail, loadBoard])

  const menuBar = useMemo((): MenuDefinition[] => {
    const appWindow = windows.find((window) => window.appId === 'stocks' && !window.minimized)

    return [
      {
        label: '股票',
        items: [
          ...aboutAppMenuPrefix('关于 股票', () => showBuiltinAbout('stocks')),
          {
            type: 'action',
            label: '隐藏股票',
            shortcut: '⌘H',
            onClick: () => appWindow && minimizeWindow(appWindow.id),
          },
          { type: 'separator' },
          {
            type: 'action',
            label: '退出股票',
            shortcut: '⌘Q',
            onClick: () => closeWindowsForApp('stocks'),
          },
        ],
      },
    ]
  }, [closeWindowsForApp, minimizeWindow, showBuiltinAbout, windows])

  useAppMenuBar('stocks', menuBar)

  const loading = loadingBoard || loadingWatchId !== undefined

  return (
    <div class="stocks-app">
      <div class="stocks-app__toolbar">
        <span class="stocks-app__brand">股票</span>
        <label class="stocks-app__search">
          <input
            type="search"
            value={searchQuery}
            placeholder="搜索股票代码或公司名…"
            aria-label="搜索股票"
            onInput={(event) => setSearchQuery((event.currentTarget as HTMLInputElement).value)}
            onKeyDown={(event) => {
              if (event.key === 'Enter') {
                event.preventDefault()
                openSearchSheet()
              }
            }}
          />
          <button
            type="button"
            class="stocks-app__search-btn"
            disabled={!searchQuery.trim()}
            onClick={openSearchSheet}
          >
            搜索
          </button>
        </label>
        <button
          type="button"
          class="stocks-app__refresh"
          aria-label="刷新"
          disabled={loading}
          onClick={() => void handleRefresh()}
        >
          ↻
        </button>
      </div>

      {store && (board || store.watchlist.length > 0) && (
        <div class="stocks-app__watch-bar" role="tablist" aria-label="行情视图">
          {board && (
            <div
              class={`stocks-app__watch-chip-wrap${!store.activeWatchId ? ' stocks-app__watch-chip-wrap--active' : ''}`}
            >
              <button
                type="button"
                role="tab"
                aria-selected={!store.activeWatchId}
                class={`stocks-app__watch-chip stocks-app__watch-chip--board${!store.activeWatchId ? ' stocks-app__watch-chip--active' : ''}`}
                onClick={() => void handleSelectBoard()}
              >
                <span class="stocks-app__watch-chip-symbol">看板</span>
                <span class="stocks-app__watch-chip-copy">
                  <span class="stocks-app__watch-chip-name">{board.marketName}</span>
                  <span class="stocks-app__watch-chip-change">市场概览</span>
                </span>
              </button>
            </div>
          )}
          {store.watchlist.map((item) => {
            const selected = item.id === store.activeWatchId
            const isDefaultWatch = item.id === store.defaultWatchId
            const price = item.detail?.price
            const change = item.detail?.change
            return (
              <div
                key={item.id}
                class={`stocks-app__watch-chip-wrap${selected ? ' stocks-app__watch-chip-wrap--active' : ''}`}
              >
                <button
                  type="button"
                  role="tab"
                  aria-selected={selected}
                  class={`stocks-app__watch-chip${selected ? ' stocks-app__watch-chip--active' : ''}`}
                  onClick={() => void handleSelectWatch(item.id)}
                >
                  <span class="stocks-app__watch-chip-symbol">{item.symbol}</span>
                  <span class="stocks-app__watch-chip-copy">
                    <span class="stocks-app__watch-chip-name">{item.name}</span>
                    <span
                      class={
                        change !== undefined && change >= 0
                          ? 'stocks-app__watch-chip-change stocks-app__watch-chip-change--up'
                          : 'stocks-app__watch-chip-change stocks-app__watch-chip-change--down'
                      }
                    >
                      {isDefaultWatch ? '默认股票' : '自选'}
                      {price !== undefined ? ` · ${price.toFixed(2)}` : ''}
                      {change !== undefined ? ` · ${formatSigned(change)}` : ''}
                    </span>
                  </span>
                </button>
                {!isDefaultWatch && (
                  <button
                    type="button"
                    class="stocks-app__watch-remove"
                    aria-label={`移除 ${item.symbol}`}
                    onClick={() => void handleRemoveWatch(item.id)}
                  >
                    ×
                  </button>
                )}
              </div>
            )
          })}
        </div>
      )}

      <div class="stocks-app__body">
        {store === undefined && !loading && (
          <div class="stocks-app__loading" role="status" aria-live="polite">
            <div class="stocks-app__loading-spinner" aria-hidden="true" />
            <p>正在加载</p>
          </div>
        )}
        {loadingBoard && !board && !activeWatch && (
          <div class="stocks-app__loading" role="status" aria-live="polite">
            <div class="stocks-app__loading-spinner" aria-hidden="true" />
            <p>正在加载</p>
          </div>
        )}
        {error && <p class="stocks-app__error">{error}</p>}

        {activeWatch?.detail && store && (
          <StockDetailPanel
            detail={activeWatch.detail}
            isDefaultWatch={activeWatch.id === store.defaultWatchId}
            isWidgetDefault={isWidgetDefaultWatch(store, activeWatch.id)}
            onSetWidgetDefault={handleSetWidgetDefault}
          />
        )}

        {!activeWatch && board && (
          <>
            <div class="stocks-app__market-head">
              <div class="stocks-app__market-head-row">
                <div>
                  <p class="stocks-app__market-name">{board.marketName}</p>
                  <p class="stocks-app__market-headline">{board.headline}</p>
                </div>
                {store?.defaultDisplay === 'market-board' ? (
                  <span class="stocks-app__badge stocks-app__badge--widget">通知中心</span>
                ) : (
                  <button
                    type="button"
                    class="stocks-app__widget-pin"
                    aria-label="设为通知中心显示"
                    title="设为通知中心显示"
                    onClick={() => void handleSetMarketBoardDefault()}
                  >
                    <svg
                      class="stocks-app__widget-pin-icon"
                      width="18"
                      height="18"
                      viewBox="0 0 24 24"
                      aria-hidden="true"
                    >
                      <rect
                        x="4"
                        y="4"
                        width="16"
                        height="16"
                        rx="3.5"
                        fill="none"
                        stroke="currentColor"
                        stroke-width="1.75"
                      />
                      <path
                        d="M8 9.5h8M8 12.5h5.5M12 16.5V21M9.5 19h5"
                        fill="none"
                        stroke="currentColor"
                        stroke-width="1.75"
                        stroke-linecap="round"
                        stroke-linejoin="round"
                      />
                    </svg>
                  </button>
                )}
              </div>
            </div>
            {board.indices.length > 0 && (
              <div class="stocks-app__indices">
                {board.indices.map((index) => {
                  const rising = index.change >= 0
                  return (
                    <div key={index.name} class="stocks-app__index">
                      <span class="stocks-app__index-name">{index.name}</span>
                      <span class="stocks-app__index-value">{index.value.toFixed(2)}</span>
                      <span
                        class={
                          rising
                            ? 'stocks-app__stock-change stocks-app__stock-change--up'
                            : 'stocks-app__stock-change stocks-app__stock-change--down'
                        }
                      >
                        {formatSigned(index.change)} ({formatSigned(index.changePercent)}%)
                      </span>
                    </div>
                  )
                })}
              </div>
            )}
            <p class="stocks-app__section-title">热门个股</p>
            <div class="stocks-app__stock-list">
              {board.items.map((item) => (
                <StockQuoteRow key={item.symbol} {...item} />
              ))}
            </div>
          </>
        )}

        {!activeWatch && !board && !loadingBoard && store !== undefined && (
          <p class="stocks-app__hint">搜索股票并加入自选，或在通知中心生成默认行情看板。</p>
        )}
      </div>

      <StocksSearchSheet
        open={searchSheetOpen}
        query={searchSheetQuery}
        addingSymbol={addingSymbol}
        onClose={() => setSearchSheetOpen(false)}
        onSelect={(suggestion) => void handleSelectSuggestion(suggestion)}
      />
    </div>
  )
}
