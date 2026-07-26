import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'preact/hooks'
import { IosNavBackButton } from '../../ui/ios-nav-back-button.tsx'
import { GeneratedAppIcon } from '../generated/generated-app-icon.tsx'
import { useAboutApp } from '../../os/about-app-context.tsx'
import { aboutAppMenuPrefix } from '../../os/about-app-menu.ts'
import { useGeneratedApps } from '../../os/generated-apps-context.tsx'
import { generatedAppIdToSlug } from '../appstore/store-agent.ts'
import { useAppMenuBar } from '../../os/menu-bar-context.tsx'
import type { MenuDefinition } from '../../os/menu-bar-types.ts'
import { useOs } from '../../os/os-context.tsx'
import type { BuiltinAppId, GeneratedAppId } from '../../os/types.ts'
import { isGeneratedAppId } from '../../os/types.ts'
import {
  DEVICE_CAPACITY_BYTES,
  findManagedApp,
  getStorageSummary,
  loadDataStorageBreakdown,
  type ManagedAppEntry,
} from './app-storage.ts'
import { DATA_CAPACITY_BYTES, DATA_STORAGE_CHANGED_EVENT } from '../../os/device-data-storage.ts'
import { STORAGE_CHANGED_EVENT } from '../../os/device-storage.ts'
import { formatStorageSize } from './format-storage-size.ts'
import { initBrowserPageCache } from '../browser/browser-page-cache.ts'
import { AiUsageView } from './ai-usage-view.tsx'
import { SafariUsageView } from './safari-usage-view.tsx'
import { AppsStorageView } from './apps-storage-view.tsx'
import { OtherStorageView } from './other-storage-view.tsx'
import { EventLogStorageView } from './event-log-storage-view.tsx'
import { DisplayView } from './display-view.tsx'
import { DateTimeSettingsView } from './date-time-settings-view.tsx'
import { NotificationCenterSettingsView } from './notification-center-settings-view.tsx'
import { SpeechSettingsView } from './speech-settings-view.tsx'
import { EmojiCalibrationView } from './emoji-calibration-view.tsx'
import { EmojiSettingsView } from './emoji-settings-view.tsx'
import { DockSettingsView } from './dock-settings-view.tsx'
import { DeveloperSettingsView } from './developer-settings-view.tsx'
import { ExternalBridgeConsentsView } from './external-bridge-consents-view.tsx'
import { ProxyServerSettingsView } from './proxy-server-settings-view.tsx'
import { BackgroundRefreshSettingsView } from './background-refresh-settings-view.tsx'
import { BackgroundRefreshTaskDetailView } from './background-refresh-task-detail-view.tsx'
import { NpmSettingsView } from './npm-settings-view.tsx'
import { SystemEnvSettingsView } from './system-env-settings-view.tsx'
import { StartupItemsSettingsView } from './startup-items-settings-view.tsx'
import { WallpaperView } from './wallpaper-view.tsx'
import { ResourcesView } from './resources-view.tsx'
import { Resources3dView } from './resources-3d-view.tsx'
import { Resources3dDetailView } from './resources-3d-detail-view.tsx'
import { NewsManagementView } from './news-management-view.tsx'
import { formatTokenCount } from '../browser/format-token-count.ts'
import {
  getNewsCommentStats,
  getNewsStorageBytes,
  readNewsStore,
} from '../news/news-storage.ts'
import { loadNewsTokenUsage } from '../news/news-token-usage.ts'
import { SettingsDisclosureIcon } from './settings-disclosure-icon.tsx'
import { SettingsKeepLayer } from './settings-keep-layer.tsx'
import {
  getVisibleSettingsPaneGroups,
  isNestedSettingsRoute,
  isSettingsRouteVisible,
  paneIdForRoute,
  SETTINGS_DEFAULT_ROUTE,
  SETTINGS_WIDE_DEFAULT_ROUTE,
  SETTINGS_WIDE_LAYOUT_MIN_WIDTH,
  type SettingsRoute,
} from './settings-panes.ts'
import {
  EXPERIMENTAL_SETTINGS_CHANGED_EVENT,
  loadExperimentalSettings,
} from '../../os/experimental-settings-storage.ts'
import { OPEN_SETTINGS_PROXY_SERVER_EVENT } from '../../os/proxy-server-settings-storage.ts'
import { OPEN_SETTINGS_USAGE_EVENT } from '../../os/storage-warning.ts'
import '../../icons/app-icon-tile.css'
import './settings.css'

const SETTINGS_WINDOW_TITLE = '系统设置'

const INSTALLED_APPS_PREVIEW_COUNT = 10

export function SettingsApp() {
  const { setAppWindowTitle, closeWindowsForApp, minimizeWindow, windows, openApp } = useOs()
  const { showBuiltinAbout } = useAboutApp()
  const [route, setRoute] = useState<SettingsRoute>(SETTINGS_DEFAULT_ROUTE)
  const hostRef = useRef<HTMLDivElement>(null)
  const [cacheRevision, setCacheRevision] = useState(0)
  const [dataStorage, setDataStorage] = useState({
    totalBytes: 0,
    safariCacheBytes: 0,
    booksDataBytes: 0,
    aiUsageBytes: 0,
    aiEventLogBytes: 0,
    folderIconSnapshotsBytes: 0,
    modelVisionBytes: 0,
    filesBytes: 0,
  })
  const { installedApps, storageRevision } = useGeneratedApps()
  const [experimentalSettingsVersion, setExperimentalSettingsVersion] = useState(0)
  const experimentalSettings = useMemo(
    () => loadExperimentalSettings(),
    [experimentalSettingsVersion],
  )
  const visibleGroups = useMemo(
    () => getVisibleSettingsPaneGroups(experimentalSettings),
    [experimentalSettings],
  )
  const summary = useMemo(
    () => getStorageSummary(installedApps, dataStorage),
    [installedApps, cacheRevision, storageRevision, dataStorage],
  )

  useEffect(() => {
    const refreshDataBytes = () => {
      void initBrowserPageCache()
        .then(() => loadDataStorageBreakdown())
        .then(setDataStorage)
    }
    const refreshSystemBytes = () => {
      setCacheRevision((value) => value + 1)
    }
    refreshDataBytes()
    window.addEventListener(DATA_STORAGE_CHANGED_EVENT, refreshDataBytes)
    window.addEventListener(STORAGE_CHANGED_EVENT, refreshSystemBytes)
    return () => {
      window.removeEventListener(DATA_STORAGE_CHANGED_EVENT, refreshDataBytes)
      window.removeEventListener(STORAGE_CHANGED_EVENT, refreshSystemBytes)
    }
  }, [cacheRevision, storageRevision])

  useEffect(() => {
    const handleExperimentalChange = () => {
      setExperimentalSettingsVersion((value) => value + 1)
    }
    window.addEventListener(EXPERIMENTAL_SETTINGS_CHANGED_EVENT, handleExperimentalChange)
    return () => {
      window.removeEventListener(EXPERIMENTAL_SETTINGS_CHANGED_EVENT, handleExperimentalChange)
    }
  }, [])

  useEffect(() => {
    if (isSettingsRouteVisible(route, experimentalSettings)) {
      return
    }
    const host = hostRef.current
    const wide = host !== null && host.clientWidth >= SETTINGS_WIDE_LAYOUT_MIN_WIDTH
    setRoute(wide ? SETTINGS_WIDE_DEFAULT_ROUTE : SETTINGS_DEFAULT_ROUTE)
  }, [route, experimentalSettings])

  const selectedApp =
    route.view === 'app-detail' ? findManagedApp(summary.entries, route.appId) : undefined

  useEffect(() => {
    setAppWindowTitle('settings', SETTINGS_WINDOW_TITLE)
  }, [setAppWindowTitle])

  useLayoutEffect(() => {
    const host = hostRef.current
    if (!host) {
      return
    }

    const syncRouteForLayout = () => {
      const wide = host.clientWidth >= SETTINGS_WIDE_LAYOUT_MIN_WIDTH
      setRoute((current) => {
        if (wide && current.view === 'root') {
          return SETTINGS_WIDE_DEFAULT_ROUTE
        }
        return current
      })
    }

    syncRouteForLayout()
    const observer = new ResizeObserver(syncRouteForLayout)
    observer.observe(host)
    return () => observer.disconnect()
  }, [])

  useEffect(() => {
    const handleOpenUsage = () => {
      setCacheRevision((value) => value + 1)
      setRoute({ view: 'usage' })
    }
    const handleOpenProxyServer = () => {
      setRoute({ view: 'proxy-server' })
    }

    window.addEventListener(OPEN_SETTINGS_USAGE_EVENT, handleOpenUsage)
    window.addEventListener(OPEN_SETTINGS_PROXY_SERVER_EVENT, handleOpenProxyServer)
    return () => {
      window.removeEventListener(OPEN_SETTINGS_USAGE_EVENT, handleOpenUsage)
      window.removeEventListener(OPEN_SETTINGS_PROXY_SERVER_EVENT, handleOpenProxyServer)
    }
  }, [])

  const menuBar = useMemo((): MenuDefinition[] => {
    const settingsWindow = windows.find((window) => window.appId === 'settings' && !window.minimized)

    return [
      {
        label: '系统设置',
        items: [
          ...aboutAppMenuPrefix('关于系统设置', () => showBuiltinAbout('settings')),
          {
            type: 'action',
            label: '隐藏系统设置',
            shortcut: '⌘H',
            onClick: () => settingsWindow && minimizeWindow(settingsWindow.id),
          },
          { type: 'separator' },
          {
            type: 'action',
            label: '退出系统设置',
            shortcut: '⌘Q',
            onClick: () => closeWindowsForApp('settings'),
          },
        ],
      },
    ]
  }, [closeWindowsForApp, minimizeWindow, showBuiltinAbout, windows])

  useAppMenuBar('settings', menuBar)

  const view = route.view
  const showRoot = view === 'root'
  const showUsage = view === 'usage'
  const showAiUsage = view === 'ai-usage'
  const keepUsage =
    showUsage ||
    view === 'app-detail' ||
    view === 'apps-storage' ||
    view === 'other-storage' ||
    view === 'event-log-storage'
  const showAppsStorage = view === 'apps-storage'
  const showOtherStorage = view === 'other-storage'
  const showEventLogStorage = view === 'event-log-storage'
  const showAppDetail = view === 'app-detail' && selectedApp
  const showDisplay = view === 'display'
  const showDateTime = view === 'date-time'
  const showSpeech = view === 'speech'
  const showNotificationCenter = view === 'notification-center'
  const keepDisplay =
    showDisplay || view === 'display-emoji' || view === 'display-emoji-calibration'
  const showWallpaper = view === 'wallpaper'
  const showDock = view === 'dock'
  const showProxyServer = view === 'proxy-server'
  const showBackgroundRefresh = view === 'background-refresh'
  const keepBackgroundRefresh =
    showBackgroundRefresh || view === 'background-refresh-task'
  const showBackgroundRefreshTask = view === 'background-refresh-task'
  const showNpm = view === 'npm'
  const showSystemEnv = view === 'system-env'
  const showStartupItems = view === 'startup-items'
  const showEmoji = view === 'display-emoji' || view === 'display-emoji-calibration'
  const showEmojiCalibration = view === 'display-emoji-calibration'
  const showSafari = view === 'safari-usage'
  const showResources = view === 'resources'
  const keepResources =
    showResources || view === 'resources-3d' || view === 'resources-3d-detail'
  const showResources3d = view === 'resources-3d'
  const keepResources3d = showResources3d || view === 'resources-3d-detail'
  const showResources3dDetail = view === 'resources-3d-detail'
  const showNews = view === 'news'
  const showExperimental = view === 'experimental'
  const showExternalBridgeConsent = view === 'external-bridge-consent'
  const activePaneId = paneIdForRoute(route)
  const nestedRoute = isNestedSettingsRoute(route)

  const navigatePane = (nextRoute: SettingsRoute) => {
    if (nextRoute.view === 'account') {
      openApp('keychain')
      return
    }
    if (nextRoute.view === 'usage') {
      setCacheRevision((value) => value + 1)
    }
    setRoute(nextRoute)
  }

  return (
    <div
      ref={hostRef}
      class="settings-host"
      data-settings-nested={nestedRoute ? 'true' : undefined}
    >
      <div class="settings__shell">
        <nav class="settings__sidebar" aria-label="设置分类">
          {visibleGroups.map(({ group, panes }) => (
            <section class="settings__sidebar-group" key={group.id} aria-label={group.label}>
              <h3 class="settings__sidebar-group-title">{group.label}</h3>
              <ul class="settings__sidebar-list">
                {panes.map((pane) => {
                  const Icon = pane.Icon
                  const selected = activePaneId === pane.id
                  return (
                    <li key={pane.id}>
                      <button
                        type="button"
                        class={`settings__sidebar-item${selected ? ' settings__sidebar-item--active' : ''}`}
                        aria-current={selected ? 'page' : undefined}
                        onClick={() => navigatePane(pane.route)}
                      >
                        <span class="settings__sidebar-icon" aria-hidden="true">
                          <span class="settings__sidebar-icon-scale">
                            <Icon />
                          </span>
                        </span>
                        <span class="settings__sidebar-label">{pane.label}</span>
                      </button>
                    </li>
                  )
                })}
              </ul>
            </section>
          ))}
        </nav>

        <div class="settings__main">
          <SettingsKeepLayer show={showRoot} keep={showRoot}>
            <div class="settings">
              <div class="settings__content settings__content--compact">
                <div class="settings__welcome" aria-hidden={!showRoot}>
                  <h2 class="settings__welcome-title">系统设置</h2>
                  <p class="settings__welcome-text">从左侧列表中选择要更改的设置。</p>
                </div>
                <div class="settings__root-menu" aria-label="设置分类">
                  {visibleGroups.map(({ group, panes }) => (
                    <section class="settings__section" key={group.id}>
                      <h2 class="settings__section-title">{group.label}</h2>
                      <div class="settings__list">
                        {panes.map((pane) => {
                          const Icon = pane.Icon
                          return (
                            <button
                              key={pane.id}
                              type="button"
                              class="settings__row settings__row--button settings__row--nav settings__row--pane"
                              onClick={() => navigatePane(pane.route)}
                            >
                              <span class="settings__row-pane-icon" aria-hidden="true">
                                <span class="settings__row-pane-icon-scale">
                                  <Icon />
                                </span>
                              </span>
                              <span class="settings__row-name">{pane.label}</span>
                              <SettingsDisclosureIcon />
                            </button>
                          )
                        })}
                      </div>
                    </section>
                  ))}
                </div>
              </div>
            </div>
          </SettingsKeepLayer>

          <SettingsKeepLayer show={showAiUsage} keep={showAiUsage}>
        <AiUsageView
          onBack={() => setRoute({ view: 'root' })}
          installedApps={installedApps}
        />
      </SettingsKeepLayer>

      <SettingsKeepLayer show={showUsage} keep={keepUsage}>
        <UsageView
          summary={summary}
          onBack={() => setRoute({ view: 'root' })}
          onSelectApp={(appId) => setRoute({ view: 'app-detail', appId, from: 'usage' })}
          onOpenAppsStorage={() => setRoute({ view: 'apps-storage' })}
          onOpenOtherStorage={() => setRoute({ view: 'other-storage' })}
          onOpenEventLogStorage={() => setRoute({ view: 'event-log-storage' })}
        />
      </SettingsKeepLayer>

      <SettingsKeepLayer show={showAppsStorage} keep={showAppsStorage}>
        <AppsStorageView
          entries={summary.entries}
          totalBytes={summary.appsBytes}
          onBack={() => setRoute({ view: 'usage' })}
          onSelectApp={(entry) =>
            setRoute({ view: 'app-detail', appId: entry.id, from: 'apps-storage' })
          }
        />
      </SettingsKeepLayer>

      <SettingsKeepLayer show={showOtherStorage} keep={showOtherStorage}>
        <OtherStorageView
          totalBytes={summary.otherBytes}
          onBack={() => setRoute({ view: 'usage' })}
        />
      </SettingsKeepLayer>

      <SettingsKeepLayer show={showEventLogStorage} keep={showEventLogStorage}>
        <EventLogStorageView onBack={() => setRoute({ view: 'usage' })} />
      </SettingsKeepLayer>

      <SettingsKeepLayer show={Boolean(showAppDetail)} keep={Boolean(showAppDetail)}>
        {selectedApp && (
          <AppDetailView
            app={selectedApp}
            onBack={() =>
              setRoute(
                route.view === 'app-detail' && route.from === 'apps-storage'
                  ? { view: 'apps-storage' }
                  : { view: 'usage' },
              )
            }
            onOpenSafariSettings={
              selectedApp.id === 'browser'
                ? () => setRoute({ view: 'safari-usage' })
                : undefined
            }
            onOpenNewsSettings={
              selectedApp.id === 'news' ? () => setRoute({ view: 'news' }) : undefined
            }
          />
        )}
      </SettingsKeepLayer>

      <SettingsKeepLayer show={showDisplay} keep={keepDisplay}>
        <DisplayView
          onBack={() => setRoute({ view: 'root' })}
          onOpenEmoji={() => setRoute({ view: 'display-emoji' })}
        />
      </SettingsKeepLayer>

      <SettingsKeepLayer show={showDateTime} keep={showDateTime}>
        <DateTimeSettingsView onBack={() => setRoute({ view: 'root' })} />
      </SettingsKeepLayer>

      <SettingsKeepLayer show={showSpeech} keep={showSpeech}>
        <SpeechSettingsView
          onBack={() => setRoute({ view: 'root' })}
          onOpenKeychain={() => openApp('keychain')}
        />
      </SettingsKeepLayer>

      <SettingsKeepLayer show={showNotificationCenter} keep={showNotificationCenter}>
        <NotificationCenterSettingsView onBack={() => setRoute({ view: 'root' })} />
      </SettingsKeepLayer>

      <SettingsKeepLayer show={showWallpaper} keep={showWallpaper}>
        <WallpaperView onBack={() => setRoute({ view: 'root' })} />
      </SettingsKeepLayer>

      <SettingsKeepLayer show={showDock} keep={showDock}>
        <DockSettingsView onBack={() => setRoute({ view: 'root' })} />
      </SettingsKeepLayer>

      <SettingsKeepLayer show={showProxyServer} keep={showProxyServer}>
        <ProxyServerSettingsView onBack={() => setRoute({ view: 'root' })} />
      </SettingsKeepLayer>

      <SettingsKeepLayer show={showBackgroundRefresh} keep={keepBackgroundRefresh}>
        <BackgroundRefreshSettingsView
          onBack={() => setRoute({ view: 'root' })}
          onOpenTask={(taskId) => setRoute({ view: 'background-refresh-task', taskId })}
        />
      </SettingsKeepLayer>

      <SettingsKeepLayer show={showBackgroundRefreshTask} keep={showBackgroundRefreshTask}>
        {showBackgroundRefreshTask && (
          <BackgroundRefreshTaskDetailView
            taskId={route.taskId}
            onBack={() => setRoute({ view: 'background-refresh' })}
          />
        )}
      </SettingsKeepLayer>

      <SettingsKeepLayer show={showNpm} keep={showNpm}>
        <NpmSettingsView onBack={() => setRoute({ view: 'root' })} />
      </SettingsKeepLayer>

      <SettingsKeepLayer show={showSystemEnv} keep={showSystemEnv}>
        <SystemEnvSettingsView onBack={() => setRoute({ view: 'root' })} />
      </SettingsKeepLayer>

      <SettingsKeepLayer show={showStartupItems} keep={showStartupItems}>
        <StartupItemsSettingsView onBack={() => setRoute({ view: 'root' })} />
      </SettingsKeepLayer>

      <SettingsKeepLayer show={showEmoji && !showEmojiCalibration} keep={showEmoji}>
        <EmojiSettingsView
          onBack={() => setRoute({ view: 'display' })}
          onOpenCalibration={() => setRoute({ view: 'display-emoji-calibration' })}
        />
      </SettingsKeepLayer>

      <SettingsKeepLayer show={showEmojiCalibration} keep={showEmojiCalibration}>
        <EmojiCalibrationView onBack={() => setRoute({ view: 'display-emoji' })} />
      </SettingsKeepLayer>

      <SettingsKeepLayer show={showSafari} keep={showSafari}>
        <SafariUsageView
          onBack={() => setRoute({ view: 'root' })}
          onCacheChange={() => setCacheRevision((value) => value + 1)}
          onHistoryChange={() => setCacheRevision((value) => value + 1)}
        />
      </SettingsKeepLayer>

      <SettingsKeepLayer show={showResources} keep={keepResources}>
        <ResourcesView
          onBack={() => setRoute({ view: 'root' })}
          onOpen3d={() => setRoute({ view: 'resources-3d' })}
        />
      </SettingsKeepLayer>

      <SettingsKeepLayer show={showResources3d} keep={keepResources3d}>
        <Resources3dView
          onBack={() => setRoute({ view: 'resources' })}
          onOpenDetail={(target) => setRoute({ view: 'resources-3d-detail', target })}
        />
      </SettingsKeepLayer>

      <SettingsKeepLayer show={showResources3dDetail} keep={showResources3dDetail}>
        {showResources3dDetail && (
          <Resources3dDetailView
            target={route.target}
            onBack={() => setRoute({ view: 'resources-3d' })}
          />
        )}
      </SettingsKeepLayer>

      <SettingsKeepLayer show={showNews} keep={showNews}>
        <NewsManagementView
          onBack={() => setRoute({ view: 'root' })}
          onDataChange={() => setCacheRevision((value) => value + 1)}
        />
      </SettingsKeepLayer>

      <SettingsKeepLayer show={showExperimental} keep={showExperimental}>
        <DeveloperSettingsView onBack={() => setRoute({ view: 'root' })} />
      </SettingsKeepLayer>

      <SettingsKeepLayer show={showExternalBridgeConsent} keep={showExternalBridgeConsent}>
        <ExternalBridgeConsentsView onBack={() => setRoute({ view: 'root' })} />
      </SettingsKeepLayer>
        </div>
      </div>
    </div>
  )
}

type ContentNavProps = {
  label: string
  onBack: () => void
}

function ContentNav({ label, onBack }: ContentNavProps) {
  return (
    <div class="settings__nav">
      <IosNavBackButton label={label} onClick={onBack} />
    </div>
  )
}

type UsageViewProps = {
  summary: ReturnType<typeof getStorageSummary>
  onBack: () => void
  onSelectApp: (appId: BuiltinAppId | GeneratedAppId) => void
  onOpenAppsStorage: () => void
  onOpenOtherStorage: () => void
  onOpenEventLogStorage: () => void
}

type StorageMeterSegment = {
  id: string
  label: string
  bytes: number
  color: string
  free?: boolean
}

function residualBytes(usedBytes: number, attributedBytes: number): number {
  return Math.max(0, usedBytes - attributedBytes)
}

function StorageMeter({
  capacityBytes,
  segments,
}: {
  capacityBytes: number
  segments: StorageMeterSegment[]
}) {
  const usedSegments = segments.filter((segment) => !segment.free && segment.bytes > 0)
  const legendSegments = segments.filter((segment) => segment.bytes > 0 || segment.free)
  const usedBytes = usedSegments.reduce((total, segment) => total + segment.bytes, 0)
  const usedPercent = capacityBytes > 0 ? Math.min(100, (usedBytes / capacityBytes) * 100) : 0

  return (
    <>
      <div class="settings__meter-bar" role="img" aria-label="用量分布">
        {usedSegments.map((segment) => (
          <div
            key={segment.id}
            class="settings__meter-segment"
            style={{
              width: `${(segment.bytes / capacityBytes) * 100}%`,
              ['--meter-segment-color' as string]: segment.color,
            }}
            title={`${segment.label} ${formatStorageSize(segment.bytes)}`}
          />
        ))}
        {usedPercent > 0 ? (
          <div class="settings__meter-stripe" style={{ width: `${usedPercent}%` }} aria-hidden="true" />
        ) : undefined}
      </div>
      <div class="settings__meter-legend">
        {legendSegments.map((segment) => (
          <span key={segment.id} class="settings__meter-legend-item">
            <span
              class={
                segment.free
                  ? 'settings__meter-legend-swatch settings__meter-legend-swatch--free'
                  : 'settings__meter-legend-swatch'
              }
              style={segment.free ? undefined : { background: segment.color }}
              aria-hidden="true"
            />
            {segment.label} {formatStorageSize(segment.bytes)}
          </span>
        ))}
      </div>
    </>
  )
}

function UsageView({
  summary,
  onBack,
  onSelectApp,
  onOpenAppsStorage,
  onOpenOtherStorage,
  onOpenEventLogStorage,
}: UsageViewProps) {
  const newsCommentStats = useMemo(() => getNewsCommentStats(readNewsStore()), [])
  const newsTokenUsage = useMemo(() => loadNewsTokenUsage(), [])

  const systemAttributedBytes =
    summary.appsBytes +
    summary.mailDataBytes +
    summary.newsDataBytes +
    summary.booksIndexBytes +
    summary.browserSystemBytes +
    summary.otherBytes
  const systemConfigBytes = residualBytes(summary.usedBytes, systemAttributedBytes)
  const systemSegments: StorageMeterSegment[] = [
    { id: 'apps', label: '应用程序', bytes: summary.appsBytes, color: '#4a90e2' },
    { id: 'mail', label: '邮件', bytes: summary.mailDataBytes, color: '#5856d6' },
    { id: 'news', label: '新闻', bytes: summary.newsDataBytes, color: '#ff9500' },
    { id: 'books-index', label: '图书索引', bytes: summary.booksIndexBytes, color: '#34c759' },
    { id: 'browser', label: '网络浏览器', bytes: summary.browserSystemBytes, color: '#5ac8fa' },
    { id: 'system-config', label: '系统配置', bytes: systemConfigBytes, color: '#636366' },
    { id: 'other', label: '其他', bytes: summary.otherBytes, color: '#8e8e93' },
    { id: 'free', label: '剩余', bytes: summary.availableBytes, color: '#d4d4d4', free: true },
  ]

  const dataAttributedBytes =
    summary.safariCacheBytes +
    summary.booksDataBytes +
    summary.aiUsageBytes +
    summary.aiEventLogBytes +
    summary.folderIconSnapshotsBytes +
    summary.modelVisionBytes +
    summary.filesBytes
  const dataOtherBytes = residualBytes(summary.dataUsedBytes, dataAttributedBytes)
  const dataSegments: StorageMeterSegment[] = [
    { id: 'safari-cache', label: '网络浏览器缓存', bytes: summary.safariCacheBytes, color: '#ff9500' },
    { id: 'books-data', label: '图书章节', bytes: summary.booksDataBytes, color: '#34c759' },
    { id: 'files', label: '文件', bytes: summary.filesBytes, color: '#007aff' },
    { id: 'ai-usage', label: 'AI 用量', bytes: summary.aiUsageBytes, color: '#af52de' },
    { id: 'event-log', label: '事件日志', bytes: summary.aiEventLogBytes, color: '#ff2d55' },
    {
      id: 'folder-icons',
      label: '文件夹图标',
      bytes: summary.folderIconSnapshotsBytes,
      color: '#a2845e',
    },
    {
      id: 'model-vision',
      label: '模型识图',
      bytes: summary.modelVisionBytes,
      color: '#ff9f0a',
    },
    { id: 'data-other', label: '其他', bytes: dataOtherBytes, color: '#8e8e93' },
    {
      id: 'data-free',
      label: '剩余',
      bytes: summary.dataAvailableBytes,
      color: '#d4d4d4',
      free: true,
    },
  ]

  return (
    <div class="settings">
      <ContentNav label="显示全部" onBack={onBack} />
      <div class="settings__content settings__content--compact">
        <div class="settings__content-body">
          <div class="settings__content-columns">
            <section class="settings__section">
              <h2 class="settings__section-title">系统空间</h2>
              <p class="settings__section-subtitle">配置、索引与轻量元数据（localStorage）</p>
              <div class="settings__box" aria-label="系统空间用量">
                <div class="settings__meter-row">
                  <span>
                    已用 <strong>{formatStorageSize(summary.usedBytes)}</strong>
                  </span>
                  <span>上限 {formatStorageSize(DEVICE_CAPACITY_BYTES)}</span>
                </div>
                <StorageMeter capacityBytes={DEVICE_CAPACITY_BYTES} segments={systemSegments} />
              </div>
            </section>

            <section class="settings__section">
              <h2 class="settings__section-title">数据空间</h2>
              <p class="settings__section-subtitle">大体积正文、媒体与用户文件（IndexedDB）</p>
              <div class="settings__box" aria-label="数据空间用量">
                <div class="settings__meter-row">
                  <span>
                    已用 <strong>{formatStorageSize(summary.dataUsedBytes)}</strong>
                  </span>
                  <span>上限 {formatStorageSize(DATA_CAPACITY_BYTES)}</span>
                </div>
                <StorageMeter capacityBytes={DATA_CAPACITY_BYTES} segments={dataSegments} />
              </div>
            </section>

            <section class="settings__section">
              <h2 class="settings__section-title">系统空间分类</h2>
              <div class="settings__list">
                <div class="settings__list-head">
                  <span>分类</span>
                  <span>大小</span>
                </div>
                <div class="settings__list-body">
                  <StorageCategoryRow
                    label="应用程序"
                    bytes={summary.appsBytes}
                    onClick={onOpenAppsStorage}
                  />
                  <StorageCategoryRow label="邮件" bytes={summary.mailDataBytes} />
                  <StorageCategoryRow label="新闻" bytes={summary.newsDataBytes} hint={`${newsCommentStats.threadCount} 篇已开评 · ${newsCommentStats.totalComments} 条评论 · AI ${formatTokenCount(newsTokenUsage.totalTokens)} tokens`} />
                  <StorageCategoryRow label="图书索引" bytes={summary.booksIndexBytes} />
                  <StorageCategoryRow
                    label="网络浏览器（历史/书签等）"
                    bytes={summary.browserSystemBytes}
                    hint="历史、书签与 Token 统计；网页 HTML 缓存在数据空间"
                  />
                  <StorageCategoryRow
                    label="其他"
                    bytes={summary.otherBytes}
                    hint="未归类的 localStorage 键"
                    onClick={onOpenOtherStorage}
                  />
                </div>
              </div>
            </section>

            <section class="settings__section">
              <h2 class="settings__section-title">数据空间分类</h2>
              <div class="settings__list">
                <div class="settings__list-head">
                  <span>分类</span>
                  <span>大小</span>
                </div>
                <div class="settings__list-body">
                  <StorageCategoryRow label="网络浏览器网页缓存" bytes={summary.safariCacheBytes} />
                  <StorageCategoryRow label="图书章节正文" bytes={summary.booksDataBytes} />
                  <StorageCategoryRow
                    label="文件"
                    bytes={summary.filesBytes}
                    hint="「文件」应用中的用户文件"
                  />
                  <StorageCategoryRow label="AI 用量明细" bytes={summary.aiUsageBytes} />
                  <StorageCategoryRow
                    label="事件日志"
                    bytes={summary.aiEventLogBytes}
                    hint="AI 调用的完整输入与输出"
                    onClick={onOpenEventLogStorage}
                  />
                  <StorageCategoryRow
                    label="程序图标缓存"
                    bytes={summary.folderIconSnapshotsBytes}
                    hint="文件夹预览缩略图缓存"
                  />
                  <StorageCategoryRow
                    label="模型识图结果"
                    bytes={summary.modelVisionBytes}
                    hint="3D 模型视觉标注缓存"
                  />
                  <StorageCategoryRow
                    label="其他"
                    bytes={dataOtherBytes}
                    hint="未归入已知分类的数据空间占用"
                  />
                </div>
              </div>
            </section>
          </div>

          <section class="settings__section">
          <h2 class="settings__section-title">已安装的应用</h2>
          {summary.entries.length === 0 ? (
            <div class="settings__box settings__empty">暂无已安装应用</div>
          ) : (
            <InstalledAppsList entries={summary.entries} onSelectApp={onSelectApp} />
          )}
            <p class="settings__section-footnote">
              系统空间存放配置与索引；数据空间存放网络浏览器网页缓存、图书章节、文件应用用户文件、事件日志、桌面文件夹图标缩略图等大体积数据（IndexedDB）。
              应用程序的用户数据通过 localStorage 桥接按应用独立存储；「文件」应用的用户文件计入数据空间并归在该应用名下。
              系统空间上限 {formatStorageSize(DEVICE_CAPACITY_BYTES)}、数据空间上限{' '}
              {formatStorageSize(DATA_CAPACITY_BYTES)}，均为硬限制。
            </p>
          </section>
        </div>
      </div>
    </div>
  )
}

type InstalledAppsListProps = {
  entries: ManagedAppEntry[]
  onSelectApp: (appId: BuiltinAppId | GeneratedAppId) => void
}

function InstalledAppsList({ entries, onSelectApp }: InstalledAppsListProps) {
  const [expanded, setExpanded] = useState(false)
  const canExpand = entries.length > INSTALLED_APPS_PREVIEW_COUNT
  const showExpandTrigger = canExpand && !expanded
  const visibleEntries = showExpandTrigger
    ? entries.slice(0, INSTALLED_APPS_PREVIEW_COUNT)
    : entries

  return (
    <div class="settings__list">
      <div class="settings__list-head">
        <span>名称</span>
        <span>大小</span>
      </div>
      <div class="settings__list-body settings__list-body--apps">
        {visibleEntries.map((entry) => (
          <AppListRow key={entry.id} entry={entry} onClick={() => onSelectApp(entry.id)} />
        ))}
        {showExpandTrigger && (
          <button
            type="button"
            class="settings__row settings__row--show-all"
            onClick={() => setExpanded(true)}
          >
            显示全部应用
          </button>
        )}
      </div>
    </div>
  )
}

type StorageCategoryRowProps = {
  label: string
  bytes: number
  hint?: string
  onClick?: () => void
}

function StorageCategoryRow({ label, bytes, hint, onClick }: StorageCategoryRowProps) {
  if (onClick) {
    return (
      <button
        type="button"
        class="settings__row settings__row--button settings__row--nav"
        onClick={onClick}
        title={hint}
      >
        <span class="settings__row-name">{label}</span>
        <span class="settings__row-size">{formatStorageSize(bytes)}</span>
        <SettingsDisclosureIcon />
      </button>
    )
  }

  return (
    <div class="settings__row settings__row--static" title={hint}>
      <span class="settings__row-name">{label}</span>
      <span class="settings__row-size">{formatStorageSize(bytes)}</span>
    </div>
  )
}

type AppListRowProps = {
  entry: ManagedAppEntry
  onClick: () => void
}

function builtinDocumentsLabel(appId: BuiltinAppId): string {
  switch (appId) {
    case 'browser':
      return '历史与书签'
    case 'mail':
      return '邮件数据'
    case 'news':
      return '新闻存档'
    case 'books':
      return '图书索引'
    case 'weather':
      return '天气数据'
    case 'calendar':
      return '日历存档'
    case 'stocks':
      return '股票数据'
    case 'catgpt':
      return '对话记录'
    case 'help':
      return '帮助对话'
    case 'gomoku':
      return '对局偏好'
    case 'icode':
      return '项目与对话'
    case 'vscode':
      return '编辑器偏好'
    case 'scene3d-lab':
      return '场景存档'
    case 'model-vision':
      return '识别结果'
    case 'appstore':
      return '商店清单'
    case 'settings':
      return '系统配置'
    default:
      return '文稿与数据'
  }
}

function AppListRow({ entry, onClick }: AppListRowProps) {
  const systemBytes =
    entry.appSizeBytes + entry.documentsBytes + entry.versionHistoryBytes
  const dataBytes = entry.dataBytes
  const totalBytes = systemBytes + dataBytes
  const sizeLabel =
    dataBytes > 0 && systemBytes > 0
      ? `系统 ${formatStorageSize(systemBytes)} · 数据 ${formatStorageSize(dataBytes)}`
      : dataBytes > 0
        ? `数据 ${formatStorageSize(dataBytes)}`
        : formatStorageSize(totalBytes)

  return (
    <button type="button" class="settings__row settings__row--button" onClick={onClick}>
      <AppIcon entry={entry} size={24} />
      <span class="settings__row-name">
        {entry.name}
        {entry.icodeManaged && <span class="settings__row-badge">iCode</span>}
      </span>
      <span class="settings__row-size" title={dataBytes > 0 ? '网页缓存等指标在数据空间' : undefined}>
        {sizeLabel}
      </span>
      <SettingsDisclosureIcon />
    </button>
  )
}

type AppDetailViewProps = {
  app: ManagedAppEntry
  onBack: () => void
  onOpenSafariSettings?: () => void
  onOpenNewsSettings?: () => void
}

function AppDetailView({ app, onBack, onOpenSafariSettings, onOpenNewsSettings }: AppDetailViewProps) {
  const { uninstallApp, pruneAppVersionHistory, getAppVersionCount, clearAppData } =
    useGeneratedApps()
  const [confirmOpen, setConfirmOpen] = useState(false)
  const [pruneConfirmOpen, setPruneConfirmOpen] = useState(false)
  const [clearDataConfirmOpen, setClearDataConfirmOpen] = useState(false)
  const totalBytes =
    app.appSizeBytes + app.documentsBytes + app.dataBytes + app.versionHistoryBytes
  const versionCount = isGeneratedAppId(app.id) ? getAppVersionCount(generatedAppIdToSlug(app.id)) : 0
  const archivedVersionCount = Math.max(0, versionCount - 1)
  const newsStore = app.id === 'news' ? readNewsStore() : undefined
  const newsCommentStats = newsStore ? getNewsCommentStats(newsStore) : undefined
  const newsTokenUsage = app.id === 'news' ? loadNewsTokenUsage() : undefined

  const handleDelete = () => {
    if (!isGeneratedAppId(app.id)) {
      return
    }
    uninstallApp(app.id)
    onBack()
  }

  const handlePruneVersions = () => {
    if (!isGeneratedAppId(app.id)) {
      return
    }
    if (pruneAppVersionHistory(app.id)) {
      setPruneConfirmOpen(false)
    }
  }

  const handleClearData = () => {
    if (!isGeneratedAppId(app.id)) {
      return
    }
    clearAppData(app.id)
    setClearDataConfirmOpen(false)
  }

  return (
    <div class="settings">
      <ContentNav label="存储空间" onBack={onBack} />
      <div class="settings__content settings__content--compact">
        <header class="settings__detail-header">
          <AppIcon entry={app} size={48} />
          <div class="settings__detail-meta">
            <h2 class="settings__detail-name">{app.name}</h2>
            <p class="settings__detail-kind">
              {app.icodeManaged
                ? 'iCode 应用 · 可卸载'
                : app.removable
                  ? 'AI 应用 · 可卸载'
                  : '系统应用 · 不可卸载'}
            </p>
          </div>
        </header>

        <section class="settings__section">
          <h2 class="settings__section-title">存储信息</h2>
          <div class="settings__box">
            <dl class="settings__form-row">
              <dt>应用大小</dt>
              <dd>{formatStorageSize(app.appSizeBytes)}</dd>
            </dl>
            {app.documentsBytes > 0 && (
              <dl class="settings__form-row">
                <dt>
                  {app.kind === 'builtin'
                    ? builtinDocumentsLabel(app.id as BuiltinAppId)
                    : '文稿与数据'}
                </dt>
                <dd>{formatStorageSize(app.documentsBytes)}</dd>
              </dl>
            )}
            {app.dataBytes > 0 && (
              <dl class="settings__form-row">
                <dt>
                  {app.id === 'books'
                    ? '章节正文'
                    : app.id === 'browser'
                      ? '网页缓存'
                      : '数据空间'}
                </dt>
                <dd>{formatStorageSize(app.dataBytes)}</dd>
              </dl>
            )}
            {app.versionHistoryBytes > 0 && (
              <dl class="settings__form-row">
                <dt>历史版本代码</dt>
                <dd>{formatStorageSize(app.versionHistoryBytes)}</dd>
              </dl>
            )}
            <dl class="settings__form-row">
              <dt>合计</dt>
              <dd>{formatStorageSize(totalBytes)}</dd>
            </dl>
            {archivedVersionCount > 0 && (
              <dl class="settings__form-row">
                <dt>可回滚版本</dt>
                <dd>{archivedVersionCount} 个</dd>
              </dl>
            )}
            {app.id === 'news' && newsStore && newsCommentStats && (
              <>
                <dl class="settings__form-row">
                  <dt>报道篇数</dt>
                  <dd>{newsStore.articles.length.toLocaleString('zh-CN')} 篇</dd>
                </dl>
                <dl class="settings__form-row">
                  <dt>评论数据</dt>
                  <dd>
                    {newsCommentStats.threadCount} 篇已开评 · {newsCommentStats.totalComments} 条
                  </dd>
                </dl>
                <dl class="settings__form-row">
                  <dt>你的发言 / 已举报</dt>
                  <dd>
                    {newsCommentStats.userComments} / {newsCommentStats.reportedCount}
                  </dd>
                </dl>
                {newsTokenUsage && (
                  <dl class="settings__form-row">
                    <dt>AI 累计 Tokens</dt>
                    <dd>{formatTokenCount(newsTokenUsage.totalTokens)}</dd>
                  </dl>
                )}
              </>
            )}
          </div>
        </section>

        {app.removable && app.documentsBytes > 0 && (
          <div class="settings__actions">
            <button type="button" class="settings__btn" onClick={() => setClearDataConfirmOpen(true)}>
              清除应用数据
            </button>
            <p class="settings__hint">删除该应用通过 localStorage 保存的全部用户数据，不影响应用本身。</p>
          </div>
        )}

        {app.removable && archivedVersionCount > 0 && (
          <div class="settings__actions">
            <button type="button" class="settings__btn" onClick={() => setPruneConfirmOpen(true)}>
              清理旧版本
            </button>
            <p class="settings__hint">将删除除当前版本外的全部历史代码，不可恢复。</p>
          </div>
        )}

        {app.id === 'browser' && onOpenSafariSettings && (
          <div class="settings__actions">
            <button type="button" class="settings__btn" onClick={onOpenSafariSettings}>
              管理网络浏览器缓存与用量
            </button>
          </div>
        )}

        {app.id === 'news' && onOpenNewsSettings && (
          <div class="settings__actions">
            <button type="button" class="settings__btn" onClick={onOpenNewsSettings}>
              管理新闻存档与评论区
            </button>
            <p class="settings__hint">
              含报道、评论、点赞/举报记录及 AI 用量统计（当前占用{' '}
              {formatStorageSize(getNewsStorageBytes())}）。
            </p>
          </div>
        )}

        {app.removable && (
          <div class="settings__actions">
            <button
              type="button"
              class="settings__btn settings__btn--danger"
              onClick={() => setConfirmOpen(true)}
            >
              卸载
            </button>
          </div>
        )}
      </div>

      {confirmOpen && (
        <ConfirmSheet
          appName={app.name}
          title={`确定要卸载「${app.name}」吗？`}
          message="应用及其所有数据将被永久删除，此操作不可恢复。"
          confirmLabel="卸载"
          onCancel={() => setConfirmOpen(false)}
          onConfirm={handleDelete}
        />
      )}

      {pruneConfirmOpen && (
        <ConfirmSheet
          appName={app.name}
          title="清理旧版本"
          message={`将删除 ${app.name} 的 ${archivedVersionCount} 个历史版本，仅保留当前可用版本。此操作不可恢复。`}
          confirmLabel="清理"
          onCancel={() => setPruneConfirmOpen(false)}
          onConfirm={handlePruneVersions}
        />
      )}

      {clearDataConfirmOpen && (
        <ConfirmSheet
          appName={app.name}
          title="清除应用数据"
          message={`将删除 ${app.name} 保存的全部用户数据（${formatStorageSize(app.documentsBytes)}）。应用代码不会受影响。`}
          confirmLabel="清除"
          onCancel={() => setClearDataConfirmOpen(false)}
          onConfirm={handleClearData}
        />
      )}
    </div>
  )
}

type AppIconProps = {
  entry: ManagedAppEntry
  size: number
}

function AppIcon({ entry, size }: AppIconProps) {
  if (entry.kind === 'generated' && entry.iconEmoji && entry.themeColor) {
    return (
      <span class="settings__app-icon">
        <GeneratedAppIcon
          emoji={entry.iconEmoji}
          themeColor={entry.themeColor}
          size={size}
        />
      </span>
    )
  }

  const Icon = entry.Icon
  if (!Icon) {
    return <span class="settings__app-icon" />
  }

  return (
    <span class="settings__app-icon">
      <Icon size={size} />
    </span>
  )
}

type ConfirmSheetProps = {
  appName: string
  title?: string
  message?: string
  confirmLabel?: string
  onCancel: () => void
  onConfirm: () => void
}

function ConfirmSheet({
  appName,
  title,
  message,
  confirmLabel = '卸载',
  onCancel,
  onConfirm,
}: ConfirmSheetProps) {
  return (
    <div class="settings__sheet-backdrop" role="presentation" onClick={onCancel}>
      <div
        class="settings__sheet"
        role="alertdialog"
        aria-modal="true"
        aria-labelledby="settings-sheet-title"
        onClick={(event) => event.stopPropagation()}
      >
        <div class="settings__sheet-body">
          <div class="settings__sheet-icon" aria-hidden="true">
            !
          </div>
          <div class="settings__sheet-copy">
            <h3 class="settings__sheet-title" id="settings-sheet-title">
              {title ?? `确定要卸载「${appName}」吗？`}
            </h3>
            <p class="settings__sheet-message">
              {message ?? '应用及其所有数据将被永久删除，此操作不可恢复。'}
            </p>
          </div>
        </div>
        <div class="settings__sheet-actions">
          <button type="button" class="settings__btn settings__btn--plain" onClick={onCancel}>
            取消
          </button>
          <button
            type="button"
            class="settings__btn settings__btn--danger"
            onClick={onConfirm}
          >
            {confirmLabel}
          </button>
        </div>
      </div>
    </div>
  )
}
