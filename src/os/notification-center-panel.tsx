import { useEffect, useRef, useState } from 'preact/hooks'
import { DateTimeWidget, StockWidget, WeatherWidget } from './notification-center-widgets.tsx'
import { useNotificationCenter } from './notification-center-context.tsx'
import { useNotificationCenterWidgets } from './use-notification-center-widgets.ts'
import {
  loadNotificationCenterSettings,
  NOTIFICATION_CENTER_SETTINGS_CHANGED_EVENT,
  type NotificationCenterSettings,
} from './notification-center-settings-storage.ts'
import { useOs } from './os-context.tsx'
import {
  IosStyleClearButton,
  OsNotificationDetail,
  OsNotificationListRow,
} from './os-notification-views.tsx'
import {
  clearDismissibleOsNotifications,
  dismissOsNotification,
  isOsNotificationDismissible,
} from './os-notifications.ts'
import { useOsNotifications } from './use-os-notifications.ts'
import { NOTIFICATION_CENTER_SCREEN_FADE_MS } from './notification-center-store.ts'

type NotificationCenterPanelProps = {
  open: boolean
  onClose: () => void
}

export function NotificationCenterPanel({ open, onClose }: NotificationCenterPanelProps) {
  const notifications = useOsNotifications()
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

  const clearableCount = notifications.filter(isOsNotificationDismissible).length
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
  const selectedNotification = activeDetailSlug
    ? notifications.find((item) => item.id === activeDetailSlug)
    : undefined

  useEffect(() => {
    if (selectedSlug) {
      lastDetailSlugRef.current = selectedSlug
    }
  }, [selectedSlug])

  useEffect(() => {
    if (open) {
      const id = window.requestAnimationFrame(() => setVisible(true))
      return () => window.cancelAnimationFrame(id)
    }
    setVisible(false)
    return undefined
  }, [open])

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

  const showDetail = contentScreen === 'detail' && selectedNotification !== undefined
  const selectedHasNotification =
    selectedSlug !== undefined && notifications.some((item) => item.id === selectedSlug)

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
            {showDetail && selectedNotification ? (
              <OsNotificationDetail notification={selectedNotification} onBack={closeDetail} />
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
                        onConfirm={clearDismissibleOsNotifications}
                        confirmLabel="清除全部"
                        className="notification-center__ios-clear--section"
                      />
                    ) : undefined}
                  </div>
                  {notifications.length === 0 ? (
                    <p class="notification-center__empty">暂无通知</p>
                  ) : (
                    <div class="notification-center__list">
                      {notifications.map((notification) => (
                        <OsNotificationListRow
                          key={notification.id}
                          notification={notification}
                          onSelect={() => openDetail(notification.id)}
                          onDismiss={() => dismissOsNotification(notification.id)}
                          armedClearId={armedClearId}
                          setArmedClearId={setArmedClearId}
                        />
                      ))}
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
