import { useEffect, useRef, useState } from 'preact/hooks'
import { GeneratedAppIcon } from '../apps/generated/generated-app-icon.tsx'
import type { PendingInstall, StoreListing } from '../apps/appstore/types.ts'
import type { GeneratedAppId } from './types.ts'
import { useGeneratedApps } from './generated-apps-context.tsx'
import { useAppNotifications } from './use-app-notifications.ts'
import { useNotificationCenter } from './notification-center-context.tsx'
import './notification-banner.css'

type BannerMode = 'progress' | 'complete' | 'failed'

type BannerRecord = {
  id: GeneratedAppId
  listing: StoreListing
  isUpdate?: boolean
  mode: BannerMode
  progress: number
  phase: PendingInstall['phase']
  error?: string
  visible: boolean
}

type AppBannerRecord = {
  id: string
  appName: string
  appSlug: string
  iconEmoji: string
  themeColor: string
  error: string
  visible: boolean
}

const COMPLETE_DISMISS_MS = 2800
const FAILED_DISMISS_MS = 5200
const EXIT_ANIMATION_MS = 340

function lightenColor(hex: string): string {
  return adjustHex(hex, 30)
}

function darkenColor(hex: string): string {
  return adjustHex(hex, -35)
}

function adjustHex(hex: string, amount: number): string {
  const normalized = hex.replace('#', '')
  if (normalized.length !== 6) {
    return hex
  }
  const r = Math.max(0, Math.min(255, parseInt(normalized.slice(0, 2), 16) + amount))
  const g = Math.max(0, Math.min(255, parseInt(normalized.slice(2, 4), 16) + amount))
  const b = Math.max(0, Math.min(255, parseInt(normalized.slice(4, 6), 16) + amount))
  return `${r.toString(16).padStart(2, '0')}${g.toString(16).padStart(2, '0')}${b.toString(16).padStart(2, '0')}`
}

function progressLabel(phase: PendingInstall['phase'], isUpdate?: boolean): string {
  if (phase === 'thinking') {
    return isUpdate ? '正在思考更新' : '正在思考'
  }
  return isUpdate ? '正在更新' : '正在生成'
}

type NotificationBannerProps = {
  banner: BannerRecord
  onOpen: () => void
  onDismiss: () => void
}

function NotificationBanner({ banner, onOpen, onDismiss }: NotificationBannerProps) {
  const title =
    banner.mode === 'failed'
      ? banner.isUpdate
        ? '更新失败'
        : '生成失败'
      : banner.mode === 'complete'
        ? banner.isUpdate
          ? '更新完成'
          : '安装完成'
        : banner.isUpdate
          ? '正在更新'
          : '正在生成'

  const subtitle =
    banner.mode === 'failed'
      ? `「${banner.listing.name}」 · ${banner.error ?? '请稍后重试'}`
      : banner.mode === 'complete'
        ? `「${banner.listing.name}」已就绪`
        : `「${banner.listing.name}」 · ${progressLabel(banner.phase, banner.isUpdate)}`

  return (
    <article
      class={`notification-banner${banner.visible ? ' notification-banner--visible' : ''}${banner.mode === 'complete' ? ' notification-banner--complete' : ''}${banner.mode === 'failed' ? ' notification-banner--failed' : ''}`}
      role="status"
    >
      <button type="button" class="notification-banner__body" onClick={onOpen}>
        <span class="notification-banner__icon">
          <GeneratedAppIcon
            emoji={banner.listing.iconEmoji}
            themeColor={banner.listing.themeColor}
            size={36}
            progress={banner.mode === 'progress' ? banner.progress : undefined}
          />
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
      {banner.mode === 'progress' && (
        <span class="notification-banner__progress" aria-hidden="true">
          <span
            class="notification-banner__progress-fill"
            style={{ width: `${Math.round(banner.progress)}%` }}
          />
        </span>
      )}
    </article>
  )
}

export function NotificationBannerHost() {
  const { pendingInstalls, failedInstalls } = useGeneratedApps()
  const appNotifications = useAppNotifications()
  const { openPanel } = useNotificationCenter()
  const [banners, setBanners] = useState<BannerRecord[]>([])
  const [appBanners, setAppBanners] = useState<AppBannerRecord[]>([])
  const prevPendingRef = useRef<Map<GeneratedAppId, PendingInstall>>(new Map())
  const dismissTimersRef = useRef(new Map<GeneratedAppId | string, number>())
  const prevAppNotificationIdsRef = useRef<Set<string>>(new Set())

  useEffect(() => {
    const prev = prevPendingRef.current
    const current = new Map(pendingInstalls.map((item) => [item.id, item]))

    setBanners((existing) => {
      let next = [...existing]

      for (const [id, item] of current) {
        if (!prev.has(id)) {
          next = [
            ...next.filter((banner) => banner.id !== id),
            {
              id,
              listing: item.listing,
              isUpdate: item.isUpdate,
              mode: 'progress',
              progress: item.progress,
              phase: item.phase,
              visible: false,
            },
          ]
        }
      }

      for (const [id, item] of prev) {
        if (!current.has(id)) {
          const failed = failedInstalls.find((entry) => entry.id === id)
          const index = next.findIndex((banner) => banner.id === id)
          if (index >= 0 && next[index].mode === 'progress') {
            next[index] = failed
              ? {
                  ...next[index],
                  mode: 'failed',
                  error: failed.error,
                  visible: next[index].visible,
                }
              : {
                  ...next[index],
                  mode: 'complete',
                  progress: 100,
                  visible: next[index].visible,
                }
          } else if (index < 0) {
            next = [
              ...next,
              failed
                ? {
                    id,
                    listing: item.listing,
                    isUpdate: item.isUpdate,
                    mode: 'failed',
                    progress: 0,
                    phase: 'generating',
                    error: failed.error,
                    visible: false,
                  }
                : {
                    id,
                    listing: item.listing,
                    isUpdate: item.isUpdate,
                    mode: 'complete',
                    progress: 100,
                    phase: 'generating',
                    visible: false,
                  },
            ]
          }
        }
      }

      return next
    })

    prevPendingRef.current = current
  }, [pendingInstalls, failedInstalls])

  useEffect(() => {
    setBanners((existing) =>
      existing.map((banner) => {
        const pending = pendingInstalls.find((item) => item.id === banner.id)
        if (!pending || banner.mode !== 'progress') {
          return banner
        }
        return {
          ...banner,
          progress: pending.progress,
          phase: pending.phase,
          isUpdate: pending.isUpdate,
        }
      }),
    )
  }, [pendingInstalls])

  useEffect(() => {
    const id = window.requestAnimationFrame(() => {
      setBanners((existing) =>
        existing.map((banner) => (banner.visible ? banner : { ...banner, visible: true })),
      )
    })
    return () => window.cancelAnimationFrame(id)
  }, [banners.length])

  useEffect(() => {
    for (const banner of banners) {
      if (banner.mode === 'progress' || dismissTimersRef.current.has(banner.id)) {
        continue
      }

      const dismissMs = banner.mode === 'failed' ? FAILED_DISMISS_MS : COMPLETE_DISMISS_MS
      const timer = window.setTimeout(() => {
        setBanners((existing) =>
          existing.map((entry) =>
            entry.id === banner.id ? { ...entry, visible: false } : entry,
          ),
        )

        window.setTimeout(() => {
          setBanners((existing) => existing.filter((entry) => entry.id !== banner.id))
          dismissTimersRef.current.delete(banner.id)
        }, EXIT_ANIMATION_MS)
      }, dismissMs)

      dismissTimersRef.current.set(banner.id, timer)
    }
  }, [banners])

  useEffect(() => {
    return () => {
      for (const timer of dismissTimersRef.current.values()) {
        window.clearTimeout(timer)
      }
      dismissTimersRef.current.clear()
    }
  }, [])

  useEffect(() => {
    const prevIds = prevAppNotificationIdsRef.current
    const currentIds = new Set(appNotifications.map((n) => n.id))

    for (const notification of appNotifications) {
      if (!prevIds.has(notification.id)) {
        setAppBanners((existing) => [
          ...existing.filter((b) => b.id !== notification.id),
          { ...notification, id: `app-${notification.id}`, visible: false },
        ])
      }
    }

    prevAppNotificationIdsRef.current = currentIds
  }, [appNotifications])

  useEffect(() => {
    const id = window.requestAnimationFrame(() => {
      setAppBanners((existing) =>
        existing.map((banner) => (banner.visible ? banner : { ...banner, visible: true })),
      )
    })
    return () => window.cancelAnimationFrame(id)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [appBanners.length])

  useEffect(() => {
    for (const banner of appBanners) {
      if (dismissTimersRef.current.has(banner.id)) {
        continue
      }

      const timer = window.setTimeout(() => {
        setAppBanners((existing) =>
          existing.map((entry) =>
            entry.id === banner.id ? { ...entry, visible: false } : entry,
          ),
        )

        window.setTimeout(() => {
          setAppBanners((existing) => existing.filter((entry) => entry.id !== banner.id))
          dismissTimersRef.current.delete(banner.id)
        }, EXIT_ANIMATION_MS)
      }, FAILED_DISMISS_MS)

      dismissTimersRef.current.set(banner.id, timer)
    }
  }, [appBanners])

  const dismissBanner = (id: GeneratedAppId | string) => {
    const timer = dismissTimersRef.current.get(id)
    if (timer) {
      window.clearTimeout(timer)
      dismissTimersRef.current.delete(id)
    }

    if (id.startsWith('app-')) {
      setAppBanners((existing) =>
        existing.map((banner) => (banner.id === id ? { ...banner, visible: false } : banner)),
      )
      window.setTimeout(() => {
        setAppBanners((existing) => existing.filter((banner) => banner.id !== id))
      }, EXIT_ANIMATION_MS)
      return
    }

    setBanners((existing) =>
      existing.map((banner) => (banner.id === id ? { ...banner, visible: false } : banner)),
    )
    window.setTimeout(() => {
      setBanners((existing) => existing.filter((banner) => banner.id !== id))
    }, EXIT_ANIMATION_MS)
  }

  const allBannersEmpty = banners.length === 0 && appBanners.length === 0
  if (allBannersEmpty) {
    return undefined
  }

  return (
    <div class="notification-banner-host" aria-live="polite">
      {banners.map((banner) => (
        <NotificationBanner
          key={banner.id}
          banner={banner}
          onOpen={() => {
            openPanel(banner.listing.slug)
          }}
          onDismiss={() => dismissBanner(banner.id)}
        />
      ))}
      {appBanners.map((banner) => (
        <article
          key={banner.id}
          class={`notification-banner notification-banner--failed${banner.visible ? ' notification-banner--visible' : ''}`}
          role="status"
        >
          <button
            type="button"
            class="notification-banner__body"
            onClick={() => {
              openPanel(banner.appSlug)
            }}
          >
            <span class="notification-banner__icon">
              <span
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  width: 36,
                  height: 44,
                  borderRadius: '2px 4px 4px 2px',
                  background: `linear-gradient(145deg, #${lightenColor(banner.themeColor)} 0%, ${banner.themeColor} 45%, #${darkenColor(banner.themeColor)} 100%)`,
                  boxShadow: 'inset 2px 0 3px rgba(255,255,255,0.2), inset -1px 0 2px rgba(0,0,0,0.15)',
                  position: 'relative',
                  overflow: 'hidden',
                  fontSize: 20,
                  lineHeight: 1,
                }}
              >
                <span
                  style={{
                    position: 'absolute',
                    top: 0, left: 0, right: 0, height: '40%',
                    background: 'linear-gradient(180deg, rgba(255,255,255,0.3) 0%, transparent 100%)',
                    pointerEvents: 'none',
                  }}
                />
                {banner.iconEmoji}
              </span>
            </span>
            <span class="notification-banner__copy">
              <span class="notification-banner__title">生成失败</span>
              <span class="notification-banner__subtitle">
                「{banner.appName}」 · {banner.error}
              </span>
            </span>
          </button>
          <button
            type="button"
            class="notification-banner__close"
            aria-label="关闭通知"
            onClick={() => dismissBanner(banner.id)}
          >
            ×
          </button>
        </article>
      ))}
    </div>
  )
}
