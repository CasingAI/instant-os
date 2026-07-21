import { useEffect, useRef, useState } from 'preact/hooks'
import { GithubDesktopIcon } from '../../icons/app-icons.tsx'
import { useNotificationCenter } from '../../os/notification-center-context.tsx'
import '../../os/notification-banner.css'
import { activateGithubDesktopMissingEmailNotification } from './github-desktop-missing-email-notification-store.ts'
import {
  GITHUB_DESKTOP_MISSING_EMAIL_SLUG,
  SHOW_GITHUB_DESKTOP_MISSING_EMAIL_NOTIFICATION_EVENT,
  messageForGithubDesktopMissingEmail,
} from './github-desktop-missing-email.ts'

const DISMISS_MS = 5200
const EXIT_ANIMATION_MS = 340

type BannerRecord = {
  id: number
  visible: boolean
}

function MissingEmailBanner({
  banner,
  onOpen,
  onDismiss,
}: {
  banner: BannerRecord
  onOpen: () => void
  onDismiss: () => void
}) {
  const { title, subtitle } = messageForGithubDesktopMissingEmail()

  return (
    <article
      class={`notification-banner${banner.visible ? ' notification-banner--visible' : ''} notification-banner--warning`}
      role="status"
    >
      <button type="button" class="notification-banner__body" onClick={onOpen}>
        <span class="notification-banner__icon" aria-hidden="true">
          <GithubDesktopIcon size={22} />
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

export function GithubDesktopMissingEmailBannerHost() {
  const { openPanel } = useNotificationCenter()
  const [banner, setBanner] = useState<BannerRecord | undefined>(undefined)
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
    activateGithubDesktopMissingEmailNotification()
    setBanner({
      id: bannerIdRef.current,
      visible: false,
    })
  }

  useEffect(() => {
    const handleShow = () => {
      showBanner()
    }

    window.addEventListener(SHOW_GITHUB_DESKTOP_MISSING_EMAIL_NOTIFICATION_EVENT, handleShow)
    return () =>
      window.removeEventListener(SHOW_GITHUB_DESKTOP_MISSING_EMAIL_NOTIFICATION_EVENT, handleShow)
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
    openPanel(GITHUB_DESKTOP_MISSING_EMAIL_SLUG)
  }

  if (!banner) {
    return undefined
  }

  return (
    <div
      class="notification-banner-host notification-banner-host--github-desktop-missing-email"
      aria-live="polite"
    >
      <MissingEmailBanner banner={banner} onOpen={handleOpen} onDismiss={dismissBanner} />
    </div>
  )
}
