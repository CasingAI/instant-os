import { useEffect, useMemo, useRef, useState } from 'preact/hooks'
import { useOpenAiReady } from '../../ai/use-openai-ready.ts'
import { useAboutApp } from '../../os/about-app-context.tsx'
import { aboutAppMenuPrefix } from '../../os/about-app-menu.ts'
import { useAppMenuBar } from '../../os/menu-bar-context.tsx'
import type { MenuDefinition } from '../../os/menu-bar-types.ts'
import { useGeneratedApps } from '../../os/generated-apps-context.tsx'
import { useOs } from '../../os/os-context.tsx'
import { AppStoreSearch } from './appstore-search.tsx'
import { InstalledGrid, ListingGrid } from './listing-grid.tsx'
import { ListingDetail } from './listing-detail.tsx'
import { recordToStoreListing, toGeneratedAppId } from './store-agent.ts'
import type { GeneratedAppRecord, StoreListing } from './types.ts'
import './appstore.css'

type AppStoreTab = 'discover' | 'installed'
type AppStoreScreen = 'main' | 'search' | 'detail'

export function AppStoreApp() {
  const { windows, closeWindowsForApp, minimizeWindow } = useOs()
  const { showBuiltinAbout } = useAboutApp()
  const {
    listings,
    installedApps,
    pendingInstalls,
    listingsLoading,
    listingsError,
    refreshListings,
    installListing,
    openInstalledApp,
    hasPendingUpdate,
    pendingAppStoreDetailSlug,
    clearPendingAppStoreDetail,
  } = useGeneratedApps()
  const [screen, setScreen] = useState<AppStoreScreen>('main')
  const [tab, setTab] = useState<AppStoreTab>('discover')
  const [detailSlug, setDetailSlug] = useState<string | undefined>(undefined)
  const [detailListings, setDetailListings] = useState<StoreListing[]>([])
  const [returnScreen, setReturnScreen] = useState<AppStoreScreen>('main')
  const apiReady = useOpenAiReady()
  const wasVisibleRef = useRef(false)

  const installedListings = useMemo(
    () => installedApps.map(recordToStoreListing),
    [installedApps],
  )

  useEffect(() => {
    const visible = windows.some((window) => window.appId === 'appstore' && !window.minimized)
    if (
      visible &&
      !wasVisibleRef.current &&
      apiReady &&
      listings.length === 0 &&
      !listingsLoading
    ) {
      void refreshListings()
    }
    wasVisibleRef.current = visible
  }, [windows, apiReady, listings.length, listingsLoading, refreshListings])

  useEffect(() => {
    if (!pendingAppStoreDetailSlug) {
      return
    }

    const installedApp = installedApps.find(
      (app) => app.id === toGeneratedAppId(pendingAppStoreDetailSlug),
    )
    const pendingInstall = pendingInstalls.find(
      (item) => item.listing.slug === pendingAppStoreDetailSlug,
    )
    const listing = installedApp
      ? recordToStoreListing(installedApp)
      : pendingInstall?.listing

    if (!listing) {
      clearPendingAppStoreDetail()
      return
    }

    const sourceListings = installedApp
      ? installedListings
      : pendingInstall
        ? [pendingInstall.listing]
        : [listing]

    setTab(installedApp ? 'installed' : 'discover')
    setDetailListings(sourceListings)
    setDetailSlug(pendingAppStoreDetailSlug)
    setReturnScreen('main')
    setScreen('detail')
    clearPendingAppStoreDetail()
  }, [
    pendingAppStoreDetailSlug,
    installedApps,
    pendingInstalls,
    installedListings,
    clearPendingAppStoreDetail,
  ])

  const menuBar = useMemo((): MenuDefinition[] => {
    const appWindow = windows.find((window) => window.appId === 'appstore' && !window.minimized)

    return [
      {
        label: 'App Store',
        items: [
          ...aboutAppMenuPrefix('关于 App Store', () => showBuiltinAbout('appstore')),
          {
            type: 'action',
            label: '隐藏 App Store',
            shortcut: '⌘H',
            onClick: () => appWindow && minimizeWindow(appWindow.id),
          },
          { type: 'separator' },
          {
            type: 'action',
            label: '退出 App Store',
            shortcut: '⌘Q',
            onClick: () => closeWindowsForApp('appstore'),
          },
        ],
      },
    ]
  }, [closeWindowsForApp, minimizeWindow, showBuiltinAbout, windows])

  useAppMenuBar('appstore', menuBar)

  const getPendingBySlug = (slug: string) =>
    pendingInstalls.find((item) => item.listing.slug === slug)

  const getPendingByAppId = (appId: GeneratedAppRecord['id']) =>
    pendingInstalls.find((item) => item.id === appId)

  const handleInstalledAction = (app: GeneratedAppRecord) => {
    if (app.pendingUpdate) {
      void installListing(recordToStoreListing(app))
      return
    }
    openInstalledApp(app.id)
  }

  const openDetail = (slug: string, sourceListings: StoreListing[]) => {
    setDetailListings(sourceListings)
    setDetailSlug(slug)
    setReturnScreen(screen)
    setScreen('detail')
  }

  const closeDetail = () => {
    setDetailSlug(undefined)
    setScreen(returnScreen)
  }

  const openSearch = () => {
    setDetailSlug(undefined)
    setScreen('search')
  }

  const closeSearch = () => {
    setScreen('main')
  }

  const handleRefresh = () => {
    void refreshListings()
  }

  const detailListing = detailSlug
    ? detailListings.find((listing) => listing.slug === detailSlug)
    : undefined

  if (screen === 'detail' && detailListing) {
    return (
      <div class="appstore appstore--detail">
        {listingsError && (
          <div class="appstore__notice appstore__notice--error">{listingsError}</div>
        )}
        <ListingDetail
          listing={detailListing}
          installed={installedApps.some((app) => app.id === toGeneratedAppId(detailListing.slug))}
          busy={getPendingBySlug(detailListing.slug) !== undefined}
          progress={getPendingBySlug(detailListing.slug)?.progress}
          textLength={getPendingBySlug(detailListing.slug)?.textLength}
          onBack={closeDetail}
          onInstall={(detail) => void installListing(detailListing, detail)}
        />
      </div>
    )
  }

  if (screen === 'search') {
    return (
      <div class="appstore appstore--search">
        <AppStoreSearch
          installedApps={installedApps}
          getPendingBySlug={getPendingBySlug}
          hasPendingUpdate={hasPendingUpdate}
          onBack={closeSearch}
          onInstall={installListing}
          onSelect={(slug, sourceListings) => openDetail(slug, sourceListings)}
        />
      </div>
    )
  }

  return (
    <div class="appstore">
      <header class="appstore__hero">
        <div>
          <p class="appstore__eyebrow">Instant OS</p>
          <h1 class="appstore__title">App Store</h1>
          <p class="appstore__subtitle">所有应用均由 AI 现场生成</p>
        </div>
        <button
          type="button"
          class="appstore__hero-search"
          onClick={openSearch}
          disabled={!apiReady}
          aria-label="搜索"
        >
          <span class="appstore__hero-search-icon" aria-hidden="true">⌕</span>
        </button>
      </header>

      {!apiReady && (
        <div class="appstore__notice appstore__notice--warn">
          请在「系统偏好设置 → 账户」中配置 API Key。
        </div>
      )}

      {listingsError && (
        <div class="appstore__notice appstore__notice--error">{listingsError}</div>
      )}

      <div class="appstore__toolbar">
        <div class="appstore__tabs">
          <button
            type="button"
            class={`appstore__tab${tab === 'discover' ? ' appstore__tab--active' : ''}`}
            onClick={() => setTab('discover')}
          >
            发现
          </button>
          <button
            type="button"
            class={`appstore__tab${tab === 'installed' ? ' appstore__tab--active' : ''}`}
            onClick={() => setTab('installed')}
          >
            已安装 ({installedApps.length})
          </button>
        </div>
        {tab === 'discover' && (
          <button
            type="button"
            class="appstore__refresh-btn"
            onClick={handleRefresh}
            disabled={!apiReady || listingsLoading}
          >
            {listingsLoading ? '生成中…' : '换一批'}
          </button>
        )}
      </div>

      <main class="appstore__content">
        {tab === 'discover' && (
          <ListingGrid
            listings={listings}
            installedApps={installedApps}
            loading={listingsLoading}
            getPendingBySlug={getPendingBySlug}
            hasPendingUpdate={hasPendingUpdate}
            onInstall={installListing}
            onSelect={(slug) => openDetail(slug, listings)}
            apiReady={apiReady}
            emptyMessage={listingsLoading ? '正在等待 AI 生成推荐…' : '点击「换一批」获取 AI 推荐'}
            entering
          />
        )}
        {tab === 'installed' && (
          <InstalledGrid
            apps={installedApps}
            getPendingByAppId={getPendingByAppId}
            onSelect={(app) => openDetail(recordToStoreListing(app).slug, installedListings)}
            onAction={handleInstalledAction}
          />
        )}
      </main>
    </div>
  )
}
