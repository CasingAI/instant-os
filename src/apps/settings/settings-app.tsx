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
import { AccountPaneIcon, AccountView } from './account-view.tsx'
import './settings.css'

type SettingsRoute =
  | { view: 'root' }
  | { view: 'usage' }
  | { view: 'account' }
  | { view: 'app-detail'; appId: BuiltinAppId | GeneratedAppId }
  | { view: 'safari-usage' }

const ROOT_TITLE = '系统偏好设置'

function titleForRoute(route: SettingsRoute, selectedApp: ManagedAppEntry | undefined): string {
  if (route.view === 'app-detail' && selectedApp) {
    return selectedApp.name
  }
  if (route.view === 'usage') {
    return '用量'
  }
  if (route.view === 'account') {
    return '账户'
  }
  if (route.view === 'safari-usage') {
    return 'Safari'
  }
  return ROOT_TITLE
}

export function SettingsApp() {
  const { setAppWindowTitle, closeWindowsForApp, minimizeWindow, windows } = useOs()
  const { showBuiltinAbout } = useAboutApp()
  const [route, setRoute] = useState<SettingsRoute>({ view: 'root' })
  const [cacheRevision, setCacheRevision] = useState(0)
  const { installedApps, storageRevision } = useGeneratedApps()
  const summary = useMemo(
    () => getStorageSummary(installedApps),
    [installedApps, cacheRevision, storageRevision],
  )

  const selectedApp =
    route.view === 'app-detail' ? findManagedApp(summary.entries, route.appId) : undefined

  const settingsWindowTitle = useMemo(
    () => titleForRoute(route, selectedApp),
    [route.view, route.view === 'app-detail' ? route.appId : '', selectedApp?.name],
  )

  useEffect(() => {
    setAppWindowTitle('settings', settingsWindowTitle)
  }, [settingsWindowTitle, setAppWindowTitle])

  const menuBar = useMemo((): MenuDefinition[] => {
    const settingsWindow = windows.find((window) => window.appId === 'settings' && !window.minimized)

    return [
      {
        label: '系统偏好设置',
        items: [
          ...aboutAppMenuPrefix('关于系统偏好设置', () => showBuiltinAbout('settings')),
          {
            type: 'action',
            label: '隐藏系统偏好设置',
            shortcut: '⌘H',
            onClick: () => settingsWindow && minimizeWindow(settingsWindow.id),
          },
          { type: 'separator' },
          {
            type: 'action',
            label: '退出系统偏好设置',
            shortcut: '⌘Q',
            onClick: () => closeWindowsForApp('settings'),
          },
        ],
      },
      {
        label: '显示',
        items: [
          {
            type: 'action',
            label: '显示全部',
            onClick: () => setRoute({ view: 'root' }),
            disabled: route.view === 'root',
          },
        ],
      },
    ]
  }, [closeWindowsForApp, minimizeWindow, route.view, showBuiltinAbout, windows])

  useAppMenuBar('settings', menuBar)

  if (route.view === 'app-detail' && selectedApp) {
    return (
      <AppDetailView
        app={selectedApp}
        onBack={() => setRoute({ view: 'usage' })}
        onOpenSafariSettings={
          selectedApp.id === 'browser'
            ? () => setRoute({ view: 'safari-usage' })
            : undefined
        }
      />
    )
  }

  if (route.view === 'safari-usage') {
    return (
      <SafariUsageView
        onBack={() => setRoute({ view: 'root' })}
        onCacheChange={() => setCacheRevision((value) => value + 1)}
      />
    )
  }

  if (route.view === 'account') {
    return <AccountView onBack={() => setRoute({ view: 'root' })} />
  }

  if (route.view === 'usage') {
    return (
      <UsageView
        summary={summary}
        onBack={() => setRoute({ view: 'root' })}
        onSelectApp={(appId) => setRoute({ view: 'app-detail', appId })}
      />
    )
  }

  return (
    <div class="settings">
      <div class="settings__content">
        <div class="settings__panes">
          <button
            type="button"
            class="settings__pane"
            onClick={() => {
              setCacheRevision((value) => value + 1)
              setRoute({ view: 'usage' })
            }}
          >
            <span class="settings__pane-icon" aria-hidden="true">
              <UsagePaneIcon />
            </span>
            <span class="settings__pane-label">用量</span>
          </button>
          <button
            type="button"
            class="settings__pane"
            onClick={() => setRoute({ view: 'account' })}
          >
            <span class="settings__pane-icon" aria-hidden="true">
              <AccountPaneIcon />
            </span>
            <span class="settings__pane-label">账户</span>
          </button>
          <button
            type="button"
            class="settings__pane"
            onClick={() => setRoute({ view: 'safari-usage' })}
          >
            <span class="settings__pane-icon" aria-hidden="true">
              <SafariUsagePaneIcon />
            </span>
            <span class="settings__pane-label">Safari</span>
          </button>
        </div>
        <p class="settings__hint">
          查看 localStorage 用量与各应用占用，并卸载不再需要的 AI 应用。
          <br />
          当前已用 {formatStorageSize(summary.usedBytes)}。
        </p>
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

  return (
    <div class="settings">
      <ContentNav label="显示全部" onBack={onBack} />
      <div class="settings__content settings__content--compact">
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
              <span>Safari 缓存 {formatStorageSize(summary.safariCacheBytes)}</span>
              <span>邮件 {formatStorageSize(summary.mailDataBytes)}</span>
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
              <StorageCategoryRow label="Safari 缓存" bytes={summary.safariCacheBytes} />
              <StorageCategoryRow label="邮件" bytes={summary.mailDataBytes} />
              <StorageCategoryRow label="其他" bytes={summary.otherBytes} hint="未归类的 localStorage 键" />
            </div>
          </div>
        </section>

        <section class="settings__section">
          <h2 class="settings__section-title">已安装的应用</h2>
          {summary.entries.length === 0 ? (
            <div class="settings__box settings__empty">暂无已安装应用</div>
          ) : (
            <div class="settings__list">
              <div class="settings__list-head">
                <span>名称</span>
                <span>大小</span>
              </div>
              <div class="settings__list-body">
                {summary.entries.map((entry) => (
                  <AppListRow
                    key={entry.id}
                    entry={entry}
                    onClick={() => onSelectApp(entry.id)}
                  />
                ))}
              </div>
            </div>
          )}
          <p class="settings__section-footnote">
            AI 应用的用户数据通过 localStorage 桥接按应用独立存储；「文稿与数据」即此类内容。
            「其他」统计未归类的 localStorage 键（如浏览记录、窗口尺寸）。
            上限 5 MB 为硬限制，空间不足时无法继续写入。
          </p>
        </section>
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
      <span class="settings__row-name">{entry.name}</span>
      <span class="settings__row-size">{formatStorageSize(totalBytes)}</span>
      <span class="settings__row-disclosure" aria-hidden="true">
        ›
      </span>
    </button>
  )
}

type AppDetailViewProps = {
  app: ManagedAppEntry
  onBack: () => void
  onOpenSafariSettings?: () => void
}

function AppDetailView({ app, onBack, onOpenSafariSettings }: AppDetailViewProps) {
  const { uninstallApp, pruneAppVersionHistory, getAppVersionCount, clearAppData } =
    useGeneratedApps()
  const [confirmOpen, setConfirmOpen] = useState(false)
  const [pruneConfirmOpen, setPruneConfirmOpen] = useState(false)
  const [clearDataConfirmOpen, setClearDataConfirmOpen] = useState(false)
  const totalBytes = app.appSizeBytes + app.documentsBytes + app.versionHistoryBytes
  const versionCount = isGeneratedAppId(app.id) ? getAppVersionCount(generatedAppIdToSlug(app.id)) : 0
  const archivedVersionCount = Math.max(0, versionCount - 1)

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
      <ContentNav label="用量" onBack={onBack} />
      <div class="settings__content settings__content--compact">
        <header class="settings__detail-header">
          <AppIcon entry={app} size={48} />
          <div class="settings__detail-meta">
            <h2 class="settings__detail-name">{app.name}</h2>
            <p class="settings__detail-kind">
              {app.removable ? 'AI 应用 · 可卸载' : '系统应用 · 不可卸载'}
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
                  {app.id === 'browser' ? '网页缓存' : app.id === 'mail' ? '邮件数据' : '文稿与数据'}
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
              管理 Safari 缓存与用量
            </button>
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

function UsagePaneIcon() {
  return (
    <svg width="34" height="34" viewBox="0 0 34 34" aria-hidden="true">
      <rect x="5" y="20" width="5" height="9" rx="1" fill="#6aa3e8" />
      <rect x="14" y="14" width="5" height="15" rx="1" fill="#8ec96a" />
      <rect x="23" y="8" width="5" height="21" rx="1" fill="#f0b84d" />
    </svg>
  )
}

function SafariUsagePaneIcon() {
  return (
    <svg width="34" height="34" viewBox="0 0 34 34" aria-hidden="true">
      <circle cx="17" cy="17" r="13" fill="#4d90fe" stroke="#2f6fd0" stroke-width="1" />
      <path
        d="M17 9 L17 17 L23 17"
        fill="none"
        stroke="#fff"
        stroke-width="2"
        stroke-linecap="round"
      />
      <circle cx="17" cy="17" r="2" fill="#fff" />
    </svg>
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
