import { useEffect, useRef, useState } from 'preact/hooks'
import { useNotificationCenter } from './notification-center-context.tsx'
import { OsNotificationIconView } from './os-notification-views.tsx'
import {
  getOsNotificationBannerGeneration,
  type OsNotification,
  type OsNotificationPhase,
} from './os-notifications.ts'
import { useOsNotifications } from './use-os-notifications.ts'
import './notification-banner.css'

const COMPLETE_DISMISS_MS = 2800
const FAILED_DISMISS_MS = 5200
const WARNING_DISMISS_MS = 5200
const EXIT_ANIMATION_MS = 340

type BannerToast = {
  notification: OsNotification
  generation: number
  visible: boolean
  exiting: boolean
}

function bannerModeClass(phase: OsNotificationPhase): string {
  if (phase === 'failure') return ' notification-banner--failed'
  if (phase === 'success') return ' notification-banner--complete'
  if (phase === 'warning') return ' notification-banner--warning'
  return ''
}

function autoHideMs(phase: OsNotificationPhase): number {
  if (phase === 'failure') return FAILED_DISMISS_MS
  if (phase === 'warning') return WARNING_DISMISS_MS
  return COMPLETE_DISMISS_MS
}

function NotificationBanner({
  toast,
  onOpen,
  onDismiss,
}: {
  toast: BannerToast
  onOpen: () => void
  onDismiss: () => void
}) {
  const { notification } = toast
  const showProgress =
    notification.banner === 'progress' && notification.phase === 'running' && notification.progress

  return (
    <div
      class={`notification-banner-slot${toast.exiting ? ' notification-banner-slot--exiting' : ''}`}
    >
      <div class="notification-banner-slot__clip">
        <article
          class={`notification-banner${toast.visible ? ' notification-banner--visible' : ''}${bannerModeClass(notification.phase)}`}
          role="status"
        >
          <button type="button" class="notification-banner__body" onClick={onOpen}>
            <span class="notification-banner__icon">
              <OsNotificationIconView notification={notification} size={36} />
            </span>
            <span class="notification-banner__copy">
              <span class="notification-banner__title">{notification.title}</span>
              <span class="notification-banner__subtitle">{notification.subtitle}</span>
            </span>
          </button>
          <button
            type="button"
            class="notification-banner__close"
            aria-label="关闭通知"
            onClick={onDismiss}
          >
            ×
          </button>
          {showProgress && (
            <span class="notification-banner__progress" aria-hidden="true">
              <span
                class="notification-banner__progress-fill"
                style={{ width: `${Math.round(notification.progress?.percent ?? 0)}%` }}
              />
            </span>
          )}
        </article>
      </div>
    </div>
  )
}

export function NotificationBannerHost() {
  const notifications = useOsNotifications()
  const { openPanel } = useNotificationCenter()
  const [toasts, setToasts] = useState<BannerToast[]>([])
  const hideTimersRef = useRef(new Map<string, number>())
  const removeTimersRef = useRef(new Map<string, number>())
  const manuallyHiddenRef = useRef(new Set<string>())
  const lastGenerationRef = useRef(new Map<string, number>())

  const clearHideTimer = (id: string) => {
    const hideTimer = hideTimersRef.current.get(id)
    if (hideTimer !== undefined) {
      window.clearTimeout(hideTimer)
      hideTimersRef.current.delete(id)
    }
  }

  const clearRemoveTimer = (id: string) => {
    const removeTimer = removeTimersRef.current.get(id)
    if (removeTimer !== undefined) {
      window.clearTimeout(removeTimer)
      removeTimersRef.current.delete(id)
    }
  }

  const clearTimers = (id: string) => {
    clearHideTimer(id)
    clearRemoveTimer(id)
  }

  const hideToast = (id: string) => {
    clearHideTimer(id)
    setToasts((existing) => {
      const current = existing.find((toast) => toast.notification.id === id)
      if (!current || current.exiting) {
        return existing
      }
      return existing.map((toast) =>
        toast.notification.id === id ? { ...toast, visible: false, exiting: true } : toast,
      )
    })
    if (removeTimersRef.current.has(id)) {
      return
    }
    const timer = window.setTimeout(() => {
      setToasts((existing) => existing.filter((toast) => toast.notification.id !== id))
      removeTimersRef.current.delete(id)
    }, EXIT_ANIMATION_MS)
    removeTimersRef.current.set(id, timer)
  }

  useEffect(() => {
    const activeIds = new Set(notifications.map((item) => item.id))

    setToasts((existing) => {
      let next = existing.filter(
        (toast) => activeIds.has(toast.notification.id) || toast.exiting,
      )

      for (const notification of notifications) {
        const banner = notification.banner ?? 'none'
        if (banner === 'none') {
          next = next.filter(
            (toast) => toast.notification.id !== notification.id || toast.exiting,
          )
          lastGenerationRef.current.delete(notification.id)
          continue
        }

        const generation = getOsNotificationBannerGeneration(notification.id)
        const previousGeneration = lastGenerationRef.current.get(notification.id)
        const existingToast = next.find((toast) => toast.notification.id === notification.id)

        if (banner === 'progress') {
          if (manuallyHiddenRef.current.has(notification.id) || existingToast?.exiting) {
            lastGenerationRef.current.set(notification.id, generation)
            continue
          }
          lastGenerationRef.current.set(notification.id, generation)
          if (existingToast) {
            next = next.map((toast) =>
              toast.notification.id === notification.id
                ? { ...toast, notification, generation }
                : toast,
            )
          } else {
            next = [...next, { notification, generation, visible: false, exiting: false }]
          }
          continue
        }

        if (
          (manuallyHiddenRef.current.has(notification.id) || existingToast?.exiting) &&
          previousGeneration === generation
        ) {
          continue
        }

        if (previousGeneration === generation && existingToast) {
          next = next.map((toast) =>
            toast.notification.id === notification.id ? { ...toast, notification } : toast,
          )
          continue
        }

        manuallyHiddenRef.current.delete(notification.id)
        lastGenerationRef.current.set(notification.id, generation)
        clearTimers(notification.id)
        next = [
          ...next.filter((toast) => toast.notification.id !== notification.id),
          {
            notification,
            generation,
            visible: false,
            exiting: false,
          },
        ]
      }

      for (const id of [...lastGenerationRef.current.keys()]) {
        if (!activeIds.has(id)) {
          lastGenerationRef.current.delete(id)
          manuallyHiddenRef.current.delete(id)
        }
      }

      return next
    })
  }, [notifications])

  useEffect(() => {
    const id = window.requestAnimationFrame(() => {
      setToasts((existing) =>
        existing.map((toast) =>
          toast.visible || toast.exiting ? toast : { ...toast, visible: true },
        ),
      )
    })
    return () => window.cancelAnimationFrame(id)
  }, [toasts.length])

  useEffect(() => {
    for (const toast of toasts) {
      const id = toast.notification.id
      if (toast.exiting) {
        continue
      }
      if (toast.notification.banner === 'progress') {
        clearHideTimer(id)
        continue
      }
      if (hideTimersRef.current.has(id)) {
        continue
      }

      const timer = window.setTimeout(() => {
        hideToast(id)
        hideTimersRef.current.delete(id)
      }, autoHideMs(toast.notification.phase))
      hideTimersRef.current.set(id, timer)
    }
  }, [toasts])

  useEffect(() => {
    return () => {
      for (const timer of hideTimersRef.current.values()) {
        window.clearTimeout(timer)
      }
      for (const timer of removeTimersRef.current.values()) {
        window.clearTimeout(timer)
      }
      hideTimersRef.current.clear()
      removeTimersRef.current.clear()
    }
  }, [])

  if (toasts.length === 0) {
    return undefined
  }

  return (
    <div class="notification-banner-host" aria-live="polite">
      {toasts.map((toast) => (
        <NotificationBanner
          key={toast.notification.id}
          toast={toast}
          onOpen={() => {
            openPanel(toast.notification.id)
          }}
          onDismiss={() => {
            manuallyHiddenRef.current.add(toast.notification.id)
            hideToast(toast.notification.id)
          }}
        />
      ))}
    </div>
  )
}
