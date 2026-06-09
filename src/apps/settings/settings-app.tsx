import { useEffect, useMemo, useState } from 'preact/hooks'
import { BackIcon } from '../../icons/app-icons.tsx'
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
  type ManagedAppEntry,
} from './app-storage.ts'
import { formatStorageSize } from './format-storage-size.ts'
import { SafariUsageView } from './safari-usage-view.tsx'
import { AccountView } from './account-view.tsx'
import { DisplayView } from './display-view.tsx'
import { DeveloperSettingsView } from './developer-settings-view.tsx'
import { EmojiCalibrationView } from './emoji-calibration-view.tsx'
import { EmojiSettingsView } from './emoji-settings-view.tsx'
import { ExperimentalSettingsView } from './experimental-settings-view.tsx'
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
  isNestedSettingsRoute,
  paneIdForRoute,
  SETTINGS_DEFAULT_ROUTE,
  SETTINGS_PANES,
  type SettingsRoute,
} from './settings-panes.ts'
import { OPEN_SETTINGS_USAGE_EVENT } from '../../os/storage-warning.ts'
import '../../icons/app-icon-tile.css'
import './settings.css'

const SETTINGS_WINDOW_TITLE = '系统设置'

const INSTALLED_APPS_PREVIEW_COUNT = 10

export function SettingsApp() {
  const { setAppWindowTitle, closeWindowsForApp, minimizeWindow, windows } = useOs()
  const { showBuiltinAbout } = useAboutApp()
  const [route, setRoute] = useState<SettingsRoute>(SETTINGS_DEFAULT_ROUTE)
  const [cacheRevision, setCacheRevision] = useState(0)
  const { installedApps, storageRevision } = useGeneratedApps()
  const summary = useMemo(
    () => getStorageSummary(installedApps),
    [installedApps, cacheRevision, storageRevision],
  )

  const selectedApp =
    route.view === 'app-detail' ? findManagedApp(summary.entries, route.appId) : undefined

  useEffect(() => {
    setAppWindowTitle('settings', SETTINGS_WINDOW_TITLE)
  }, [setAppWindowTitle])

  useEffect(() => {
    const handleOpenUsage = () => {
      setCacheRevision((value) => value + 1)
      setRoute({ view: 'usage' })
    }

    window.addEventListener(OPEN_SETTINGS_USAGE_EVENT, handleOpenUsage)
    return () => window.removeEventListener(OPEN_SETTINGS_USAGE_EVENT, handleOpenUsage)
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
  const keepUsage = showUsage || view === 'app-detail'
  const showAppDetail = view === 'app-detail' && selectedApp
  const showAccount = view === 'account'
  const showDisplay = view === 'display'
  const keepDisplay =
    showDisplay || view === 'display-emoji' || view === 'display-emoji-calibration'
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
  const keepExperimental = showExperimental || view === 'experimental-developer'
  const showExperimentalDeveloper = view === 'experimental-developer'
  const activePaneId = paneIdForRoute(route)
  const nestedRoute = isNestedSettingsRoute(route)

  const navigatePane = (nextRoute: SettingsRoute) => {
    if (nextRoute.view === 'usage') {
      setCacheRevision((value) => value + 1)
    }
    setRoute(nextRoute)
  }

  return (
    <div
      class="settings-host"
      data-settings-nested={nestedRoute ? 'true' : undefined}
    >
      <div class="settings__shell">
        <nav class="settings__sidebar" aria-label="设置分类">
          <ul class="settings__sidebar-list">
            {SETTINGS_PANES.map((pane) => {
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
                      <Icon />
                    </span>
                    <span class="settings__sidebar-label">{pane.label}</span>
                  </button>
                </li>
              )
            })}
          </ul>
        </nav>

        <div class="settings__main">
          <SettingsKeepLayer show={showRoot} keep={showRoot}>
            <div class="settings">
              <div class="settings__content">
                <div class="settings__welcome" aria-hidden={!showRoot}>
                  <h2 class="settings__welcome-title">系统设置</h2>
                  <p class="settings__welcome-text">从左侧列表中选择要更改的设置。</p>
                </div>
                <div class="settings__panes" aria-label="设置分类">
                  {SETTINGS_PANES.map((pane) => {
                    const Icon = pane.Icon
                    return (
                      <button
                        key={pane.id}
                        type="button"
                        class="settings__pane"
                        onClick={() => navigatePane(pane.route)}
                      >
                        <span class="settings__pane-icon" aria-hidden="true">
                          <Icon />
                        </span>
                        <span class="settings__pane-label">{pane.label}</span>
                      </button>
                    )
                  })}
                </div>
              </div>
            </div>
          </SettingsKeepLayer>

          <SettingsKeepLayer show={showUsage} keep={keepUsage}>
        <UsageView
          summary={summary}
          onBack={() => setRoute({ view: 'root' })}
          onSelectApp={(appId) => setRoute({ view: 'app-detail', appId })}
        />
      </SettingsKeepLayer>

      <SettingsKeepLayer show={Boolean(showAppDetail)} keep={Boolean(showAppDetail)}>
        {selectedApp && (
          <AppDetailView
            app={selectedApp}
            onBack={() => setRoute({ view: 'usage' })}
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

      <SettingsKeepLayer show={showAccount} keep={showAccount}>
        <AccountView onBack={() => setRoute({ view: 'root' })} />
      </SettingsKeepLayer>

      <SettingsKeepLayer show={showDisplay} keep={keepDisplay}>
        <DisplayView
          onBack={() => setRoute({ view: 'root' })}
          onOpenEmoji={() => setRoute({ view: 'display-emoji' })}
        />
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

      <SettingsKeepLayer show={showExperimental} keep={keepExperimental}>
        <ExperimentalSettingsView
          onBack={() => setRoute({ view: 'root' })}
          onOpenDeveloper={() => setRoute({ view: 'experimental-developer' })}
        />
      </SettingsKeepLayer>

          <SettingsKeepLayer show={showExperimentalDeveloper} keep={showExperimentalDeveloper}>
            <DeveloperSettingsView onBack={() => setRoute({ view: 'experimental' })} />
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
      <button type="button" class="settings__nav-back" onClick={onBack}>
        <span class="settings__nav-back-icon" aria-hidden="true">
          <BackIcon size={13} />
        </span>
        {label}
      </button>
    </div>
  )
}

type UsageViewProps = {
  summary: ReturnType<typeof getStorageSummary>
  onBack: () => void
  onSelectApp: (appId: BuiltinAppId | GeneratedAppId) => void
}

function UsageView({ summary, onBack, onSelectApp }: UsageViewProps) {
  const usedPercent = Math.min(100, (summary.usedBytes / DEVICE_CAPACITY_BYTES) * 100)
  const newsCommentStats = useMemo(() => getNewsCommentStats(readNewsStore()), [])
  const newsTokenUsage = useMemo(() => loadNewsTokenUsage(), [])

  return (
    <div class="settings">
      <ContentNav label="显示全部" onBack={onBack} />
      <div class="settings__content settings__content--compact">
        <div class="settings__content-body">
          <div class="settings__content-columns">
            <section class="settings__section">
              <h2 class="settings__section-title">localStorage 用量</h2>
              <div class="settings__box" aria-label="存储用量">
                <div class="settings__meter-row">
                  <span>
                    已用 <strong>{formatStorageSize(summary.usedBytes)}</strong>
                  </span>
                  <span>上限 {formatStorageSize(DEVICE_CAPACITY_BYTES)}</span>
                </div>
                <div class="settings__meter-bar">
                  <div class="settings__meter-fill" style={{ width: `${usedPercent}%` }} />
                </div>
                <div class="settings__meter-legend">
                  <span>AI 应用 {formatStorageSize(summary.appsBytes)}</span>
                  <span>网络浏览器缓存 {formatStorageSize(summary.safariCacheBytes)}</span>
                  <span>邮件 {formatStorageSize(summary.mailDataBytes)}</span>
                  <span>新闻 {formatStorageSize(summary.newsDataBytes)}</span>
                  <span>其他 {formatStorageSize(summary.otherBytes)}</span>
                  <span>剩余 {formatStorageSize(summary.availableBytes)}</span>
                </div>
              </div>
            </section>

            <section class="settings__section">
              <h2 class="settings__section-title">存储分类</h2>
              <div class="settings__list">
                <div class="settings__list-head">
                  <span>分类</span>
                  <span>大小</span>
                </div>
                <div class="settings__list-body">
                  <StorageCategoryRow label="AI 应用" bytes={summary.appsBytes} />
                  <StorageCategoryRow label="网络浏览器缓存" bytes={summary.safariCacheBytes} />
                  <StorageCategoryRow label="邮件" bytes={summary.mailDataBytes} />
                  <StorageCategoryRow
                    label="新闻"
                    bytes={summary.newsDataBytes}
                    hint={`${newsCommentStats.threadCount} 篇已开评 · ${newsCommentStats.totalComments} 条评论 · AI ${formatTokenCount(newsTokenUsage.totalTokens)} tokens`}
                  />
                  <StorageCategoryRow label="其他" bytes={summary.otherBytes} hint="未归类的 localStorage 键" />
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
              AI 应用的用户数据通过 localStorage 桥接按应用独立存储；「文稿与数据」即此类内容。
              「其他」统计未归类的 localStorage 键（如浏览记录、窗口尺寸）。
              上限 5 MB 为硬限制，空间不足时无法继续写入。
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
}

function StorageCategoryRow({ label, bytes, hint }: StorageCategoryRowProps) {
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

function AppListRow({ entry, onClick }: AppListRowProps) {
  const totalBytes = entry.appSizeBytes + entry.documentsBytes + entry.versionHistoryBytes

  return (
    <button type="button" class="settings__row settings__row--button" onClick={onClick}>
      <AppIcon entry={entry} size={24} />
      <span class="settings__row-name">
        {entry.name}
        {entry.icodeManaged && <span class="settings__row-badge">iCode</span>}
      </span>
      <span class="settings__row-size">{formatStorageSize(totalBytes)}</span>
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
  const totalBytes = app.appSizeBytes + app.documentsBytes + app.versionHistoryBytes
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
                  {app.id === 'browser' ? '网页缓存' : app.id === 'mail' ? '邮件数据' : app.id === 'news' ? '新闻存档' : '文稿与数据'}
                </dt>
                <dd>{formatStorageSize(app.documentsBytes)}</dd>
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
              移到废纸篓
            </button>
          </div>
        )}
      </div>

      {confirmOpen && (
        <ConfirmSheet
          appName={app.name}
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
  confirmLabel = '移到废纸篓',
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
              {title ?? `确定要将「${appName}」移到废纸篓吗？`}
            </h3>
            <p class="settings__sheet-message">
              {message ?? '此应用的文稿与数据将被删除，且无法恢复。'}
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
