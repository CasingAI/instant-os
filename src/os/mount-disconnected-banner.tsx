import { useEffect, useRef, useState } from 'preact/hooks'
import { useNotificationCenter } from './notification-center-context.tsx'
import { activateMountDisconnectedNotification } from './mount-disconnected-notification-store.ts'
import {
  messageForMountDisconnected,
  MOUNT_DISCONNECTED_SLUG,
  SHOW_MOUNT_DISCONNECTED_NOTIFICATION_EVENT,
  type MountDisconnectedNotificationDetail,
} from './mount-disconnected.ts'
import './notification-banner.css'

const DISMISS_MS = 5200
const EXIT_ANIMATION_MS = 340

type MountDisconnectedBannerRecord = {
  id: number
  label: string
  visible: boolean
}

function MountDisconnectedBanner({
  banner,
  onOpen,
  onDismiss,
}: {
  banner: MountDisconnectedBannerRecord
  onOpen: () => void
  onDismiss: () => void
}) {
  const { title, subtitle } = messageForMountDisconnected(banner.label)

  return (
    <article
      class={`notification-banner${banner.visible ? ' notification-banner--visible' : ''} notification-banner--warning`}
      role="status"
    >
      <button type="button" class="notification-banner__body" onClick={onOpen}>
        <span class="notification-banner__icon" aria-hidden="true">
          ⏏
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

export function MountDisconnectedBannerHost() {
  const { openPanel } = useNotificationCenter()
  const [banner, setBanner] = useState<MountDisconnectedBannerRecord | undefined>(undefined)
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

  const showBanner = (label: string) => {
    clearTimers()
    bannerIdRef.current += 1
    activateMountDisconnectedNotification(label)
    setBanner({
      id: bannerIdRef.current,
      label,
      visible: false,
    })
  }

  useEffect(() => {
    const handleShow = (event: Event) => {
      const detail = (event as CustomEvent<MountDisconnectedNotificationDetail>).detail
      const label = detail?.label?.trim()
      if (!label) return
      showBanner(label)
    }

    window.addEventListener(SHOW_MOUNT_DISCONNECTED_NOTIFICATION_EVENT, handleShow)
    return () =>
      window.removeEventListener(SHOW_MOUNT_DISCONNECTED_NOTIFICATION_EVENT, handleShow)
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
    openPanel(MOUNT_DISCONNECTED_SLUG)
  }

  if (!banner) {
    return undefined
  }

  return (
    <div
      class="notification-banner-host notification-banner-host--mount-disconnected"
      aria-live="polite"
    >
      <MountDisconnectedBanner banner={banner} onOpen={handleOpen} onDismiss={dismissBanner} />
    </div>
  )
}
