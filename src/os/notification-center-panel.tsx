import { useEffect, useRef, useState } from 'preact/hooks'
import { AiStreamPreview } from '../ai/ai-stream-preview.tsx'
import { IosNavBackButton } from '../ui/ios-nav-back-button.tsx'
import { formatTextLengthK } from '../apps/appstore/format-text-length.ts'
import { GeneratedAppIcon } from '../apps/generated/generated-app-icon.tsx'
import { BooksCover } from '../apps/books/books-cover.tsx'
import { DateTimeWidget, StockWidget, WeatherWidget } from './notification-center-widgets.tsx'
import { useGeneratedApps } from './generated-apps-context.tsx'
import { useNotificationCenter } from './notification-center-context.tsx'
import { useNotificationCenterWidgets } from './use-notification-center-widgets.ts'
import {
  loadNotificationCenterSettings,
  NOTIFICATION_CENTER_SETTINGS_CHANGED_EVENT,
  type NotificationCenterSettings,
} from './notification-center-settings-storage.ts'
import { usePendingInstallStream } from './use-pending-install-stream.ts'
import { useOs } from './os-context.tsx'
import { useAppNotifications } from './use-app-notifications.ts'
import { useProcessIsolationFallbackNotification } from './use-process-isolation-fallback-notification.ts'
import {
  ProcessIsolationFallbackDetail,
  ProcessIsolationFallbackListItem,
} from './process-isolation-fallback-notification-center.tsx'
import { PROCESS_ISOLATION_FALLBACK_SLUG } from './process-isolation-fallback.ts'
import {
  StorageWarningDetail,
  StorageWarningListItem,
} from './storage-warning-notification-center.tsx'
import { STORAGE_WARNING_SLUG } from './storage-warning.ts'
import { useStorageWarningNotification } from './use-storage-warning-notification.ts'
import { useBookStream } from './use-book-stream.ts'
import type { CompletedInstall, FailedInstall, PendingInstall } from '../apps/appstore/types.ts'
import type { AppNotification } from './app-notifications-store.ts'
import { clearAppNotifications, dismissAppNotification } from './app-notifications-store.ts'
import { dismissProcessIsolationFallbackNotification } from './process-isolation-fallback-notification-store.ts'
import { dismissStorageWarningNotification } from './storage-warning-notification-store.ts'
import { NOTIFICATION_CENTER_SCREEN_FADE_MS } from './notification-center-store.ts'

function phaseLabel(phase: PendingInstall['phase'], isUpdate?: boolean): string {
  if (phase === 'waiting') {
    return '正在连接 AI…'
  }
  if (phase === 'thinking') {
    return isUpdate ? '正在思考更新方案…' : '正在思考应用方案…'
  }
  return isUpdate ? '正在更新应用…' : '正在生成应用…'
}

type NotificationListItemProps = {
  item: PendingInstall
  onSelect: () => void
}

type FailedNotificationListItemProps = {
  item: FailedInstall
  onSelect: () => void
  onDismiss: () => void
  armedClearId: string | undefined
  setArmedClearId: (id: string | undefined) => void
}

type CompletedNotificationListItemProps = {
  item: CompletedInstall
  onSelect: () => void
  onDismiss: () => void
  armedClearId: string | undefined
  setArmedClearId: (id: string | undefined) => void
}

type IosStyleClearButtonProps = {
  clearId: string
  armedClearId: string | undefined
  setArmedClearId: (id: string | undefined) => void
  onConfirm: () => void
  confirmLabel: string
  className?: string
}

function IosStyleClearButton({
  clearId,
  armedClearId,
  setArmedClearId,
  onConfirm,
  confirmLabel,
  className,
}: IosStyleClearButtonProps) {
  const armed = armedClearId === clearId

  return (
    <button
      type="button"
      data-ios-clear={clearId}
      class={`notification-center__ios-clear${armed ? ' notification-center__ios-clear--armed' : ''}${className ? ` ${className}` : ''}`}
      aria-label={armed ? confirmLabel : '准备清除'}
      aria-expanded={armed}
      onClick={(event) => {
        event.stopPropagation()
        if (armed) {
          setArmedClearId(undefined)
          onConfirm()
          return
        }
        setArmedClearId(clearId)
      }}
    >
      <span class="notification-center__ios-clear-glyph" aria-hidden="true" />
      <span class="notification-center__ios-clear-label" aria-hidden="true">
        {confirmLabel}
      </span>
    </button>
  )
}

function CompletedNotificationListItem({
  item,
  onSelect,
  onDismiss,
  armedClearId,
  setArmedClearId,
}: CompletedNotificationListItemProps) {
  return (
    <div class="notification-center__item-wrap">
      <button
        type="button"
        class="notification-center__item notification-center__item--complete"
        onClick={onSelect}
      >
        <span class="notification-center__item-icon">
          <GeneratedAppIcon
            emoji={item.listing.iconEmoji}
            themeColor={item.listing.themeColor}
            size={40}
          />
        </span>
        <span class="notification-center__item-copy">
          <span class="notification-center__item-title">{item.listing.name}</span>
          <span class="notification-center__item-subtitle">
            {item.isUpdate ? '更新完成' : '安装完成'} · 已就绪
          </span>
        </span>
      </button>
      <IosStyleClearButton
        clearId={`completed:${item.id}`}
        armedClearId={armedClearId}
        setArmedClearId={setArmedClearId}
        onConfirm={onDismiss}
        confirmLabel="清除"
      />
    </div>
  )
}

function FailedNotificationListItem({
  item,
  onSelect,
  onDismiss,
  armedClearId,
  setArmedClearId,
}: FailedNotificationListItemProps) {
  return (
    <div class="notification-center__item-wrap">
      <button
        type="button"
        class="notification-center__item notification-center__item--failed"
        onClick={onSelect}
      >
        <span class="notification-center__item-icon">
          <GeneratedAppIcon
            emoji={item.listing.iconEmoji}
            themeColor={item.listing.themeColor}
            size={40}
          />
        </span>
        <span class="notification-center__item-copy">
          <span class="notification-center__item-title">{item.listing.name}</span>
          <span class="notification-center__item-subtitle">
            {item.isUpdate ? '更新失败' : '生成失败'} · {item.error}
          </span>
        </span>
      </button>
      <IosStyleClearButton
        clearId={`failed:${item.id}`}
        armedClearId={armedClearId}
        setArmedClearId={setArmedClearId}
        onConfirm={onDismiss}
        confirmLabel="清除"
      />
    </div>
  )
}

function NotificationListItem({ item, onSelect }: NotificationListItemProps) {
  const progress = Math.round(item.progress)

  return (
    <button type="button" class="notification-center__item" onClick={onSelect}>
      <span class="notification-center__item-icon">
        <GeneratedAppIcon
          emoji={item.listing.iconEmoji}
          themeColor={item.listing.themeColor}
          size={40}
        />
      </span>
      <span class="notification-center__item-copy">
        <span class="notification-center__item-title">{item.listing.name}</span>
        <span class="notification-center__item-subtitle">{phaseLabel(item.phase, item.isUpdate)}</span>
        <span class="notification-center__item-progress" aria-hidden="true">
          <span class="notification-center__item-progress-track">
            <span
              class="notification-center__item-progress-fill"
              style={{ width: `${progress}%` }}
            />
          </span>
        </span>
      </span>
      <span class="notification-center__item-meta">{progress}%</span>
    </button>
  )
}

type NotificationDetailProps = {
  item: PendingInstall
  onBack: () => void
}

type FailedNotificationDetailProps = {
  item: FailedInstall
  onBack: () => void
  onRetry: () => void
  onDismiss: () => void
}

type CompletedNotificationDetailProps = {
  item: CompletedInstall
  onBack: () => void
  onOpen: () => void
  onDismiss: () => void
}

function handleDetailBack(event: MouseEvent, onBack: () => void) {
  event.stopPropagation()
  onBack()
}

function CompletedNotificationDetail({
  item,
  onBack,
  onOpen,
  onDismiss,
}: CompletedNotificationDetailProps) {
  const stream = usePendingInstallStream(item.listing.slug)

  return (
    <div class="notification-center__detail">
      <div class="notification-center__detail-header">
        <IosNavBackButton
          label="返回通知"
          onClick={(event) => handleDetailBack(event, onBack)}
        />
      </div>
      <div class="notification-center__detail-card notification-center__detail-card--complete">
        <div class="notification-center__detail-hero">
          <GeneratedAppIcon
            emoji={item.listing.iconEmoji}
            themeColor={item.listing.themeColor}
            size={52}
          />
          <div class="notification-center__detail-copy">
            <p class="notification-center__detail-title">{item.listing.name}</p>
            <p class="notification-center__detail-phase notification-center__detail-phase--complete">
              {item.isUpdate ? '更新完成' : '安装完成'}
            </p>
          </div>
        </div>
        <div class="notification-center__detail-actions">
          <button
            type="button"
            class="notification-center__action notification-center__action--primary"
            onClick={onOpen}
          >
            打开
          </button>
          <button type="button" class="notification-center__action" onClick={onDismiss}>
            忽略
          </button>
        </div>
      </div>
      {(stream.reasoningText || stream.rawText) && (
        <>
          <p class="notification-center__stream-heading">AI 输出</p>
          <AiStreamPreview
            reasoningText={stream.reasoningText}
            contentText={stream.rawText}
            variant="notification"
          />
        </>
      )}
    </div>
  )
}

function FailedNotificationDetail({ item, onBack, onRetry, onDismiss }: FailedNotificationDetailProps) {
  const stream = usePendingInstallStream(item.listing.slug)

  return (
    <div class="notification-center__detail">
      <div class="notification-center__detail-header">
        <IosNavBackButton
          label="返回通知"
          onClick={(event) => handleDetailBack(event, onBack)}
        />
      </div>
      <div class="notification-center__detail-card notification-center__detail-card--failed">
        <div class="notification-center__detail-hero">
          <GeneratedAppIcon
            emoji={item.listing.iconEmoji}
            themeColor={item.listing.themeColor}
            size={52}
          />
          <div class="notification-center__detail-copy">
            <p class="notification-center__detail-title">{item.listing.name}</p>
            <p class="notification-center__detail-phase notification-center__detail-phase--failed">
              {item.isUpdate ? '更新失败' : '生成失败'}
            </p>
          </div>
        </div>
        <p class="notification-center__detail-error">{item.error}</p>
        <div class="notification-center__detail-actions">
          <button type="button" class="notification-center__action notification-center__action--primary" onClick={onRetry}>
            重试
          </button>
          <button type="button" class="notification-center__action" onClick={onDismiss}>
            忽略
          </button>
        </div>
      </div>
      {(stream.reasoningText || stream.rawText) && (
        <>
          <p class="notification-center__stream-heading">上次 AI 输出</p>
          <AiStreamPreview
            reasoningText={stream.reasoningText}
            contentText={stream.rawText}
            variant="notification"
          />
        </>
      )}
    </div>
  )
}

function NotificationDetail({ item, onBack }: NotificationDetailProps) {
  const progress = Math.round(item.progress)
  const phase = phaseLabel(item.phase, item.isUpdate)
  const stream = usePendingInstallStream(item.listing.slug)

  return (
    <div class="notification-center__detail">
      <div class="notification-center__detail-header">
        <IosNavBackButton
          label="返回通知"
          onClick={(event) => handleDetailBack(event, onBack)}
        />
      </div>
      <div class="notification-center__detail-card">
        <div class="notification-center__detail-hero">
          <GeneratedAppIcon
            emoji={item.listing.iconEmoji}
            themeColor={item.listing.themeColor}
            size={52}
            progress={item.progress}
            textLength={item.textLength}
          />
          <div class="notification-center__detail-copy">
            <p class="notification-center__detail-title">{item.listing.name}</p>
            <p class="notification-center__detail-phase">{phase}</p>
          </div>
        </div>
        <div class="notification-center__detail-stats">
          <div class="notification-center__stat">
            <span class="notification-center__stat-label">进度</span>
            <span class="notification-center__stat-value">{progress}%</span>
          </div>
          <div class="notification-center__stat">
            <span class="notification-center__stat-label">已输出</span>
            <span class="notification-center__stat-value">{formatTextLengthK(item.textLength)}</span>
          </div>
        </div>
        <div class="notification-center__detail-progress" aria-hidden="true">
          <span class="notification-center__detail-progress-track">
            <span
              class="notification-center__detail-progress-fill"
              style={{ width: `${progress}%` }}
            />
          </span>
        </div>
      </div>
      <p class="notification-center__stream-heading">AI 输出</p>
      <AiStreamPreview
        reasoningText={stream.reasoningText}
        contentText={stream.rawText}
        variant="notification"
      />
    </div>
  )
}

type AppNotificationListItemProps = {
  notification: AppNotification
  onSelect: () => void
  onDismiss: () => void
  armedClearId: string | undefined
  setArmedClearId: (id: string | undefined) => void
}

function AppNotificationListItem({
  notification,
  onSelect,
  onDismiss,
  armedClearId,
  setArmedClearId,
}: AppNotificationListItemProps) {
  return (
    <div class="notification-center__item-wrap">
      <button
        type="button"
        class="notification-center__item notification-center__item--failed"
        onClick={onSelect}
      >
        <span class="notification-center__item-icon">
          <BooksCover
            title={notification.appName}
            coverColor={notification.themeColor}
            coverEmoji={notification.iconEmoji}
            size="small"
          />
        </span>
        <span class="notification-center__item-copy">
          <span class="notification-center__item-title">{notification.appName}</span>
          <span class="notification-center__item-subtitle">
            生成失败 · {notification.error}
          </span>
        </span>
      </button>
      <IosStyleClearButton
        clearId={`app:${notification.id}`}
        armedClearId={armedClearId}
        setArmedClearId={setArmedClearId}
        onConfirm={onDismiss}
        confirmLabel="清除"
      />
    </div>
  )
}

type AppNotificationDetailProps = {
  notification: AppNotification
  onBack: () => void
  onDismiss: () => void
}

function AppNotificationDetail({ notification, onBack, onDismiss }: AppNotificationDetailProps) {
  const stream = useBookStream(notification.appSlug)

  return (
    <div class="notification-center__detail">
      <div class="notification-center__detail-header">
        <IosNavBackButton
          label="返回通知"
          onClick={(event) => {
            event.stopPropagation()
            onBack()
          }}
        />
      </div>
      <div class="notification-center__detail-card notification-center__detail-card--failed">
        <div class="notification-center__detail-hero">
          <div class="notification-center__item-icon">
            <BooksCover
              title={notification.appName}
              coverColor={notification.themeColor}
              coverEmoji={notification.iconEmoji}
              size="small"
            />
          </div>
          <div class="notification-center__detail-copy">
            <p class="notification-center__detail-title">{notification.appName}</p>
            <p class="notification-center__detail-phase notification-center__detail-phase--failed">
              生成失败
            </p>
          </div>
        </div>
        <p class="notification-center__detail-error">{notification.error}</p>
        <div class="notification-center__detail-actions">
          <button type="button" class="notification-center__action" onClick={onDismiss}>
            忽略
          </button>
        </div>
      </div>
      <p class="notification-center__stream-heading">AI 最后输出</p>
      <AiStreamPreview
        reasoningText=""
        contentText={stream.rawText}
        variant="notification"
        emptyLabel="无 AI 输出记录"
      />
    </div>
  )
}

type NotificationCenterPanelProps = {
  open: boolean
  onClose: () => void
}

export function NotificationCenterPanel({ open, onClose }: NotificationCenterPanelProps) {
  const {
    pendingInstalls,
    failedInstalls,
    completedInstalls,
    installListing,
    dismissFailedInstall,
    dismissCompletedInstall,
    clearDismissibleInstallNotifications,
    openInstalledApp,
  } = useGeneratedApps()
  const appNotifications = useAppNotifications()
  const processIsolationFallbackActive = useProcessIsolationFallbackNotification()
  const storageWarning = useStorageWarningNotification()
  const { panelScreen, selectedSlug, openDetail, closeDetail } = useNotificationCenter()
  const { openApp } = useOs()
  const panelRef = useRef<HTMLDivElement>(null)
  const panelWasOpenRef = useRef(false)
  const lastDetailSlugRef = useRef<string | undefined>(undefined)
  const [visible, setVisible] = useState(false)
  const [contentScreen, setContentScreen] = useState<'list' | 'detail'>('list')
  const [contentVisible, setContentVisible] = useState(true)
  const [widgetSettings, setWidgetSettings] = useState<NotificationCenterSettings>(() =>
    loadNotificationCenterSettings(),
  )

  useEffect(() => {
    const syncSettings = () => setWidgetSettings(loadNotificationCenterSettings())
    window.addEventListener(NOTIFICATION_CENTER_SETTINGS_CHANGED_EVENT, syncSettings)
    return () => window.removeEventListener(NOTIFICATION_CENTER_SETTINGS_CHANGED_EVENT, syncSettings)
  }, [])

  const showWidgets = widgetSettings.showWeather || widgetSettings.showStocks
  const widgets = useNotificationCenterWidgets(open && visible && showWidgets)

  const clearableCount =
    failedInstalls.length +
    completedInstalls.length +
    appNotifications.length +
    (processIsolationFallbackActive ? 1 : 0) +
    (storageWarning ? 1 : 0)

  const clearDismissibleNotifications = () => {
    clearDismissibleInstallNotifications()
    clearAppNotifications()
    dismissProcessIsolationFallbackNotification()
    dismissStorageWarningNotification()
  }

  const [armedClearId, setArmedClearId] = useState<string | undefined>(undefined)

  useEffect(() => {
    if (!open) {
      setArmedClearId(undefined)
    }
  }, [open])

  useEffect(() => {
    if (clearableCount === 0) {
      setArmedClearId(undefined)
    }
  }, [clearableCount])

  useEffect(() => {
    if (!armedClearId) {
      return
    }

    const handlePointerDown = (event: PointerEvent) => {
      const target = event.target
      if (!(target instanceof Element)) {
        return
      }
      if (target.closest('[data-ios-clear]')) {
        return
      }
      setArmedClearId(undefined)
    }

    window.addEventListener('pointerdown', handlePointerDown, true)
    return () => window.removeEventListener('pointerdown', handlePointerDown, true)
  }, [armedClearId])

  const activeDetailSlug =
    contentScreen === 'detail' ? (selectedSlug ?? lastDetailSlugRef.current) : undefined

  const selectedPending = activeDetailSlug
    ? pendingInstalls.find((item) => item.listing.slug === activeDetailSlug)
    : undefined
  const selectedFailed = activeDetailSlug
    ? failedInstalls.find((item) => item.listing.slug === activeDetailSlug)
    : undefined
  const selectedCompleted = activeDetailSlug
    ? completedInstalls.find((item) => item.listing.slug === activeDetailSlug)
    : undefined
  const selectedAppNotification = activeDetailSlug
    ? appNotifications.find((item) => item.appSlug === activeDetailSlug)
    : undefined
  const selectedProcessIsolationFallback =
    activeDetailSlug === PROCESS_ISOLATION_FALLBACK_SLUG && processIsolationFallbackActive
  const selectedStorageWarning =
    activeDetailSlug === STORAGE_WARNING_SLUG ? storageWarning : undefined

  useEffect(() => {
    if (selectedSlug) {
      lastDetailSlugRef.current = selectedSlug
    }
  }, [selectedSlug])

  // 同步外部 open 状态到本地的可见状态：打开时用 rAF 确保元素已在 DOM 后再加可见类以触发动画；
  // 关闭时立即置为不可见以开始滑出过渡。组件本身常驻 DOM，由 CSS 类控制视觉与交互。
  useEffect(() => {
    if (open) {
      const id = window.requestAnimationFrame(() => setVisible(true))
      return () => window.cancelAnimationFrame(id)
    }
    setVisible(false)
    return undefined
  }, [open])

  // 管理内部内容区（列表/详情）的切换与淡入淡出过渡。
  // 首次打开面板时直接显示目标屏幕，不走淡出再淡入；后续在列表与详情间切换时会有短暂淡出过渡。
  useEffect(() => {
    if (!open) {
      setContentScreen('list')
      setContentVisible(true)
      lastDetailSlugRef.current = undefined
      panelWasOpenRef.current = false
      return
    }

    const wasOpen = panelWasOpenRef.current
    panelWasOpenRef.current = true

    if (!wasOpen) {
      setContentScreen(panelScreen)
      setContentVisible(true)
      return
    }

    if (panelScreen === contentScreen) {
      setContentVisible(true)
      return
    }

    setContentVisible(false)
    const timer = window.setTimeout(() => {
      setContentScreen(panelScreen)
      setContentVisible(true)
    }, NOTIFICATION_CENTER_SCREEN_FADE_MS)

    return () => window.clearTimeout(timer)
  }, [open, panelScreen, contentScreen])

  const showDetail =
    contentScreen === 'detail' &&
    (selectedPending !== undefined ||
      selectedFailed !== undefined ||
      selectedCompleted !== undefined ||
      selectedAppNotification !== undefined ||
      selectedProcessIsolationFallback ||
      selectedStorageWarning !== undefined)

  const selectedHasNotification =
    selectedSlug !== undefined &&
    (pendingInstalls.some((item) => item.listing.slug === selectedSlug) ||
      failedInstalls.some((item) => item.listing.slug === selectedSlug) ||
      completedInstalls.some((item) => item.listing.slug === selectedSlug) ||
      appNotifications.some((item) => item.appSlug === selectedSlug) ||
      (selectedSlug === PROCESS_ISOLATION_FALLBACK_SLUG && processIsolationFallbackActive) ||
      (selectedSlug === STORAGE_WARNING_SLUG && storageWarning !== undefined))

  useEffect(() => {
    if (!open) {
      return
    }
    if (panelScreen === 'detail' && selectedSlug && !selectedHasNotification) {
      closeDetail()
    }
  }, [open, panelScreen, selectedSlug, selectedHasNotification, closeDetail])

  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key !== 'Escape' || !open) {
        return
      }
      if (panelScreen === 'detail') {
        closeDetail()
        return
      }
      onClose()
    }

    window.addEventListener('keydown', handleKeyDown)
    return () => window.removeEventListener('keydown', handleKeyDown)
  }, [open, panelScreen, closeDetail, onClose])

  const handleBackdropClick = (event: MouseEvent) => {
    if (panelRef.current?.contains(event.target as Node)) {
      return
    }
    onClose()
  }

  const handleOpenCalendarApp = () => {
    openApp('calendar')
    onClose()
  }

  const handleOpenWeatherApp = () => {
    openApp('weather')
    onClose()
  }

  const handleOpenStocksApp = () => {
    openApp('stocks')
    onClose()
  }

  return (
    <div
      class={`notification-center-overlay${visible ? ' notification-center-overlay--open' : ''}`}
      onClick={handleBackdropClick}
    >
      <div
        ref={panelRef}
        class={`notification-center${visible ? ' notification-center--open' : ''}`}
        role="dialog"
        aria-label="通知中心"
        aria-hidden={!visible}
      >
        <div
          class="notification-center__body"
          onClick={(event) => event.stopPropagation()}
        >
          <div
            class={`notification-center__screen${contentVisible ? '' : ' notification-center__screen--hidden'}`}
          >
            {showDetail && selectedPending ? (
              <NotificationDetail item={selectedPending} onBack={closeDetail} />
            ) : showDetail && selectedFailed ? (
              <FailedNotificationDetail
                item={selectedFailed}
                onBack={closeDetail}
                onRetry={() => {
                  dismissFailedInstall(selectedFailed.id)
                  void installListing(selectedFailed.listing)
                  closeDetail()
                }}
                onDismiss={() => {
                  dismissFailedInstall(selectedFailed.id)
                  closeDetail()
                }}
              />
            ) : showDetail && selectedCompleted ? (
              <CompletedNotificationDetail
                item={selectedCompleted}
                onBack={closeDetail}
                onOpen={() => {
                  openInstalledApp(selectedCompleted.id)
                  dismissCompletedInstall(selectedCompleted.id)
                  onClose()
                }}
                onDismiss={() => {
                  dismissCompletedInstall(selectedCompleted.id)
                  closeDetail()
                }}
              />
            ) : showDetail && selectedAppNotification ? (
              <AppNotificationDetail
                notification={selectedAppNotification}
                onBack={closeDetail}
                onDismiss={() => {
                  dismissAppNotification(selectedAppNotification.id)
                  closeDetail()
                }}
              />
            ) : showDetail && selectedProcessIsolationFallback ? (
              <ProcessIsolationFallbackDetail
                onBack={closeDetail}
                onDismiss={closeDetail}
              />
            ) : showDetail && selectedStorageWarning ? (
              <StorageWarningDetail
                level={selectedStorageWarning.level}
                onBack={closeDetail}
                onDismiss={closeDetail}
              />
            ) : (
              <>
                <DateTimeWidget onOpen={handleOpenCalendarApp} />
                {showWidgets && (
                  <div class="notification-center__widgets">
                    {widgetSettings.showWeather && (
                      <WeatherWidget
                        weather={widgets.weather}
                        loading={widgets.weatherState === 'loading'}
                        error={widgets.weatherError}
                        onOpen={handleOpenWeatherApp}
                      />
                    )}
                    {widgetSettings.showStocks && (
                      <StockWidget
                        snapshot={widgets.stocks}
                        loading={widgets.stocksState === 'loading'}
                        error={widgets.stocksError}
                        onOpen={handleOpenStocksApp}
                      />
                    )}
                  </div>
                )}
                <div class="notification-center__section">
                  <div class="notification-center__section-header">
                    <p class="notification-center__section-title">通知</p>
                    {clearableCount > 0 ? (
                      <IosStyleClearButton
                        clearId="section:all"
                        armedClearId={armedClearId}
                        setArmedClearId={setArmedClearId}
                        onConfirm={clearDismissibleNotifications}
                        confirmLabel="清除全部"
                        className="notification-center__ios-clear--section"
                      />
                    ) : undefined}
                  </div>
                  {pendingInstalls.length === 0 &&
                  failedInstalls.length === 0 &&
                  completedInstalls.length === 0 &&
                  appNotifications.length === 0 &&
                  !processIsolationFallbackActive &&
                  !storageWarning ? (
                    <p class="notification-center__empty">暂无通知</p>
                  ) : (
                    <div class="notification-center__list">
                      {pendingInstalls.map((item) => (
                        <NotificationListItem
                          key={item.id}
                          item={item}
                          onSelect={() => openDetail(item.listing.slug)}
                        />
                      ))}
                      {completedInstalls.map((item) => (
                        <CompletedNotificationListItem
                          key={item.id}
                          item={item}
                          onSelect={() => openDetail(item.listing.slug)}
                          onDismiss={() => dismissCompletedInstall(item.id)}
                          armedClearId={armedClearId}
                          setArmedClearId={setArmedClearId}
                        />
                      ))}
                      {failedInstalls.map((item) => (
                        <FailedNotificationListItem
                          key={item.id}
                          item={item}
                          onSelect={() => openDetail(item.listing.slug)}
                          onDismiss={() => dismissFailedInstall(item.id)}
                          armedClearId={armedClearId}
                          setArmedClearId={setArmedClearId}
                        />
                      ))}
                      {appNotifications.map((notification) => (
                        <AppNotificationListItem
                          key={notification.id}
                          notification={notification}
                          onSelect={() => openDetail(notification.appSlug)}
                          onDismiss={() => dismissAppNotification(notification.id)}
                          armedClearId={armedClearId}
                          setArmedClearId={setArmedClearId}
                        />
                      ))}
                      {storageWarning ? (
                        <div class="notification-center__item-wrap">
                          <StorageWarningListItem
                            level={storageWarning.level}
                            onSelect={() => openDetail(STORAGE_WARNING_SLUG)}
                          />
                          <IosStyleClearButton
                            clearId="storage-warning"
                            armedClearId={armedClearId}
                            setArmedClearId={setArmedClearId}
                            onConfirm={dismissStorageWarningNotification}
                            confirmLabel="清除"
                          />
                        </div>
                      ) : undefined}
                      {processIsolationFallbackActive ? (
                        <div class="notification-center__item-wrap">
                          <ProcessIsolationFallbackListItem
                            onSelect={() => openDetail(PROCESS_ISOLATION_FALLBACK_SLUG)}
                          />
                          <IosStyleClearButton
                            clearId="process-isolation-fallback"
                            armedClearId={armedClearId}
                            setArmedClearId={setArmedClearId}
                            onConfirm={dismissProcessIsolationFallbackNotification}
                            confirmLabel="清除"
                          />
                        </div>
                      ) : undefined}
                    </div>
                  )}
                </div>
              </>
            )}
          </div>
        </div>
      </div>
    </div>
  )
}
