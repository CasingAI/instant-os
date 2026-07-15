import { useEffect, useRef, useState } from 'preact/hooks'
import { StoragePaneIcon } from '../apps/settings/settings-pane-icons.tsx'
import { useGeneratedApps } from './generated-apps-context.tsx'
import { useNotificationCenter } from './notification-center-context.tsx'
import {
  activateStorageWarningNotification,
  dismissStorageWarningNotification,
} from './storage-warning-notification-store.ts'
import {
  evaluateStorageWarning,
  getAvailableStoragePercent,
  messageForStorageWarning,
  STORAGE_CHANGED_EVENT,
  STORAGE_WARNING_SLUG,
  type StorageWarningNotification,
} from './storage-warning.ts'
import './notification-banner.css'

const DISMISS_MS = 5200
const EXIT_ANIMATION_MS = 340

type StorageWarningBannerRecord = StorageWarningNotification & {
  id: number
  visible: boolean
}

function StorageWarningBanner({
  banner,
  onOpen,
  onDismiss,
}: {
  banner: StorageWarningBannerRecord
  onOpen: () => void
  onDismiss: () => void
}) {
  const { title, subtitle } = messageForStorageWarning(banner.level)

  return (
    <article
      class={`notification-banner${banner.visible ? ' notification-banner--visible' : ''} notification-banner--warning`}
      role="status"
    >
      <button type="button" class="notification-banner__body" onClick={onOpen}>
        <span class="notification-banner__icon">
          <StoragePaneIcon />
        </span>
        <span class="notification-banner__copy">
          <span class="notification-banner__title">{title}</span>
          <span class="notification-banner__subtitle">{subtitle}</span>
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
    </article>
  )
}

export function StorageWarningBannerHost() {
  const { storageRevision } = useGeneratedApps()
  const { openPanel } = useNotificationCenter()
  const [banner, setBanner] = useState<StorageWarningBannerRecord | undefined>(undefined)
  const bannerIdRef = useRef(0)
  const dismissTimerRef = useRef<number | undefined>(undefined)
  const removeTimerRef = useRef<number | undefined>(undefined)

  const clearTimers = () => {
    if (dismissTimerRef.current !== undefined) {
      window.clearTimeout(dismissTimerRef.current)
      dismissTimerRef.current = undefined
    }
    if (removeTimerRef.current !== undefined) {
      window.clearTimeout(removeTimerRef.current)
      removeTimerRef.current = undefined
    }
  }

  const dismissBanner = () => {
    clearTimers()
    setBanner((current) => (current ? { ...current, visible: false } : undefined))
    removeTimerRef.current = window.setTimeout(() => {
      setBanner(undefined)
      removeTimerRef.current = undefined
    }, EXIT_ANIMATION_MS)
  }

  const showWarning = (warning: StorageWarningNotification) => {
    clearTimers()
    bannerIdRef.current += 1
    activateStorageWarningNotification(warning)
    setBanner({
      ...warning,
      id: bannerIdRef.current,
      visible: false,
    })
  }

  const checkStorage = () => {
    const warning = evaluateStorageWarning()
    if (warning) {
      showWarning(warning)
      return
    }
    if (getAvailableStoragePercent() >= 20) {
      dismissStorageWarningNotification()
    }
  }

  useEffect(() => {
    checkStorage()
  }, [storageRevision])

  useEffect(() => {
    const handleStorageChanged = () => {
      checkStorage()
    }

    window.addEventListener(STORAGE_CHANGED_EVENT, handleStorageChanged)
    return () => window.removeEventListener(STORAGE_CHANGED_EVENT, handleStorageChanged)
  }, [])

  useEffect(() => {
    if (!banner) {
      return
    }

    const frame = window.requestAnimationFrame(() => {
      setBanner((current) => (current ? { ...current, visible: true } : undefined))
    })

    dismissTimerRef.current = window.setTimeout(() => {
      dismissBanner()
    }, DISMISS_MS)

    return () => {
      window.cancelAnimationFrame(frame)
    }
  }, [banner?.id])

  useEffect(() => {
    return () => {
      clearTimers()
    }
  }, [])

  const handleOpen = () => {
    dismissBanner()
    openPanel(STORAGE_WARNING_SLUG)
  }

  if (!banner) {
    return undefined
  }

  return (
    <div class="notification-banner-host notification-banner-host--storage-warning" aria-live="polite">
      <StorageWarningBanner banner={banner} onOpen={handleOpen} onDismiss={dismissBanner} />
    </div>
  )
}
