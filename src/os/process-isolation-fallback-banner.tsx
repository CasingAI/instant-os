import { useEffect, useRef, useState } from 'preact/hooks'
import { useNotificationCenter } from './notification-center-context.tsx'
import { ProcessIsolationFallbackEmoji } from './process-isolation-fallback-emoji.tsx'
import {
  activateProcessIsolationFallbackNotification,
} from './process-isolation-fallback-notification-store.ts'
import {
  messageForProcessIsolationFallback,
  PROCESS_ISOLATION_FALLBACK_SLUG,
  SHOW_PROCESS_ISOLATION_FALLBACK_NOTIFICATION_EVENT,
} from './process-isolation-fallback.ts'
import './notification-banner.css'

const DISMISS_MS = 5200
const EXIT_ANIMATION_MS = 340

type ProcessIsolationFallbackBannerRecord = {
  id: number
  visible: boolean
}

function ProcessIsolationFallbackBanner({
  banner,
  onOpen,
  onDismiss,
}: {
  banner: ProcessIsolationFallbackBannerRecord
  onOpen: () => void
  onDismiss: () => void
}) {
  const { title, subtitle } = messageForProcessIsolationFallback()

  return (
    <article
      class={`notification-banner${banner.visible ? ' notification-banner--visible' : ''} notification-banner--warning`}
      role="status"
    >
      <button type="button" class="notification-banner__body" onClick={onOpen}>
        <ProcessIsolationFallbackEmoji variant="banner" />
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

export function ProcessIsolationFallbackBannerHost() {
  const { openPanel } = useNotificationCenter()
  const [banner, setBanner] = useState<ProcessIsolationFallbackBannerRecord | undefined>(undefined)
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

  const showBanner = () => {
    clearTimers()
    bannerIdRef.current += 1
    activateProcessIsolationFallbackNotification()
    setBanner({
      id: bannerIdRef.current,
      visible: false,
    })
  }

  useEffect(() => {
    const handleShow = () => {
      showBanner()
    }

    window.addEventListener(SHOW_PROCESS_ISOLATION_FALLBACK_NOTIFICATION_EVENT, handleShow)
    return () =>
      window.removeEventListener(SHOW_PROCESS_ISOLATION_FALLBACK_NOTIFICATION_EVENT, handleShow)
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
    openPanel(PROCESS_ISOLATION_FALLBACK_SLUG)
  }

  if (!banner) {
    return undefined
  }

  return (
    <div
      class="notification-banner-host notification-banner-host--process-isolation-fallback"
      aria-live="polite"
    >
      <ProcessIsolationFallbackBanner banner={banner} onOpen={handleOpen} onDismiss={dismissBanner} />
    </div>
  )
}
