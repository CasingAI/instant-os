import { memo } from 'preact/compat'
import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'preact/hooks'
import { BatteryIcon, CloudServiceIcon, ForwardIcon, InstantLogoIcon } from '../icons/app-icons.tsx'
import { AdaptiveActionMenu, type AdaptiveActionMenuItem } from '../ui/adaptive-action-menu.tsx'
import { isNarrowWorkArea } from '../window/window-snap.ts'
import { useAboutApp } from './about-app-context.tsx'
import { getAppDefinition } from './app-registry.tsx'
import { getThisDeviceAbout } from './builtin-app-about.ts'
import { useMenuBar } from './menu-bar-context.tsx'
import type { MenuDefinition, MenuItem, MenuItemLeaf } from './menu-bar-types.ts'
import { MenuOverflowModal } from './menu-bar-overflow-modal.tsx'
import { BatteryStatusPanel, CloudServiceStatusPanel } from './menu-bar-status-panels.tsx'
import { MenuBarVolumeIcon, MenuBarVolumePanel } from './menu-bar-volume-panel.tsx'
import { useGeneratedApps } from './generated-apps-context.tsx'
import { formatOsDateTime } from './format-os-datetime.ts'
import { isOsUsing24HourTime } from './os-clock.ts'
import { useOsNowDate } from './use-os-clock.ts'
import { useNotificationCenter } from './notification-center-context.tsx'
import { useAppNotifications } from './use-app-notifications.ts'
import { useProcessIsolationFallbackNotification } from './use-process-isolation-fallback-notification.ts'
import { useStorageWarningNotification } from './use-storage-warning-notification.ts'
import { useMountDisconnectedNotification } from './use-mount-disconnected-notification.ts'
import { useGithubDesktopMissingEmailNotification } from '../apps/github-desktop/use-github-desktop-missing-email-notification.ts'
import { reloadInstantOs } from './reload-instant-os.ts'
import { useOs } from './os-context.tsx'
import {
  getSystemVolumeState,
  setSystemVolume,
  subscribeSystemVolume,
  toggleSystemMute,
} from './system-volume.ts'
import { useFullscreenChromeReveal } from './fullscreen-chrome-reveal-context.tsx'
import { useDeviceBattery } from './use-device-battery.ts'
import { useProxyServerConnection } from './use-proxy-server-connection.ts'
import { openSettingsProxyServerView } from './proxy-server-settings-storage.ts'
import {
  getActiveCloudNetworkRequests,
  subscribeCloudNetworkRequests,
} from './cloud-network-store.ts'
import {
  getPowProgress,
  subscribePowProgress,
  type PowProgressState,
} from './pow-progress-store.ts'
import type { AppId, BuiltinAppId } from './types.ts'
import { isGeneratedAppId } from './types.ts'
import './menu-bar.css'
import './menu-bar-popover.css'
import './notification-center.css'

const APPLE_MENU_LABEL = '__apple__'
const MORE_MENU_LABEL = '__more__'
const STATUS_CLOUD_SERVICE_LABEL = '__status_cloud_service__'
const STATUS_BATTERY_LABEL = '__status_battery__'
const STATUS_VOLUME_LABEL = '__status_volume__'
const MENU_GAP_PX = 2
const MORE_MENU_BTN_SPACE_PX = 50

function appNameForWindow(appId: AppId, windowTitle: string): string {
  if (isGeneratedAppId(appId)) {
    return windowTitle
  }
  return getAppDefinition(appId as BuiltinAppId)?.name ?? windowTitle
}

type MenuDropdownProps = {
  menu: MenuDefinition
  onClose: () => void
  narrowLayout: boolean
}

function MenuDropdownAction({
  item,
  onClose,
}: {
  item: Extract<MenuItemLeaf, { type: 'action' }>
  onClose: () => void
}) {
  return (
    <button
      type="button"
      class="menu-bar__dropdown-item"
      role="menuitem"
      disabled={item.disabled}
      onClick={() => {
        if (item.disabled) {
          return
        }
        item.onClick()
        onClose()
      }}
    >
      <span class="menu-bar__dropdown-label">{item.label}</span>
      {item.shortcut ? <span class="menu-bar__shortcut">{item.shortcut}</span> : undefined}
    </button>
  )
}

function shouldUseMenuSheetLayout(): boolean {
  if (isNarrowWorkArea()) {
    return true
  }
  if (typeof window.matchMedia === 'function') {
    return window.matchMedia('(pointer: coarse)').matches
  }
  return false
}

function useMenuBarNarrowLayout(): boolean {
  const [narrowLayout, setNarrowLayout] = useState(() => shouldUseMenuSheetLayout())

  useEffect(() => {
    const update = () => {
      setNarrowLayout(shouldUseMenuSheetLayout())
    }

    update()
    window.addEventListener('resize', update)
    const media = window.matchMedia('(pointer: coarse)')
    media.addEventListener('change', update)
    return () => {
      window.removeEventListener('resize', update)
      media.removeEventListener('change', update)
    }
  }, [])

  return narrowLayout
}

function toAdaptiveMenuItems(
  items: MenuItemLeaf[],
  onParentClose: () => void,
): AdaptiveActionMenuItem[] {
  return items.map((item) => {
    if (item.type === 'separator') {
      return { type: 'separator' }
    }

    return {
      type: 'action',
      label: item.label,
      disabled: item.disabled,
      shortcut: item.shortcut,
      onClick: () => {
        item.onClick()
        onParentClose()
      },
    }
  })
}

const MENU_SUBMENU_MIN_WIDTH = 180

function submenuFitsInViewport(row: HTMLElement): boolean {
  const rowRect = row.getBoundingClientRect()
  const fitsRight = rowRect.right + MENU_SUBMENU_MIN_WIDTH + 8 <= window.innerWidth
  const fitsLeft = rowRect.left - MENU_SUBMENU_MIN_WIDTH - 8 >= 0
  return fitsRight || fitsLeft
}

function MenuDropdownSubmenu({
  item,
  onClose,
  narrowLayout,
}: {
  item: Extract<MenuItem, { type: 'submenu' }>
  onClose: () => void
  narrowLayout: boolean
}) {
  const [sheetOpen, setSheetOpen] = useState(false)
  const rowRef = useRef<HTMLDivElement>(null)
  const submenuRef = useRef<HTMLDivElement>(null)
  const [open, setOpen] = useState(false)
  const [alignLeft, setAlignLeft] = useState(false)
  const [forceSheet, setForceSheet] = useState(false)

  useLayoutEffect(() => {
    if (narrowLayout) {
      setForceSheet(false)
      return
    }
    const row = rowRef.current
    if (!row) {
      return
    }
    setForceSheet(!submenuFitsInViewport(row))
  }, [narrowLayout, item.label])

  const useSheet = narrowLayout || forceSheet

  useEffect(() => {
    if (useSheet || !open) {
      return
    }

    const row = rowRef.current
    const submenu = submenuRef.current
    if (!row || !submenu) {
      return
    }

    const rowRect = row.getBoundingClientRect()
    const submenuRect = submenu.getBoundingClientRect()
    const fitsRight = rowRect.right + submenuRect.width + 8 <= window.innerWidth
    const fitsLeft = rowRect.left - submenuRect.width - 8 >= 0
    setAlignLeft(!fitsRight && fitsLeft)

    const defaultTop = -5
    let top = defaultTop
    const overflowBottom = rowRect.top + defaultTop + submenuRect.height - (window.innerHeight - 8)
    if (overflowBottom > 0) {
      top -= overflowBottom
    }
    const overflowTop = 8 - (rowRect.top + top)
    if (overflowTop > 0) {
      top += overflowTop
    }
    submenu.style.top = `${top}px`
  }, [useSheet, open, item.items])

  if (useSheet) {
    return (
      <>
        <button
          type="button"
          class="menu-bar__dropdown-item menu-bar__dropdown-item--nav"
          role="menuitem"
          onClick={() => setSheetOpen(true)}
        >
          <span class="menu-bar__dropdown-label">{item.label}</span>
          <span class="menu-bar__submenu-chevron" aria-hidden="true">
            <ForwardIcon size={13} />
          </span>
        </button>
        <AdaptiveActionMenu
          open={sheetOpen}
          title={item.label}
          items={toAdaptiveMenuItems(item.items, onClose)}
          narrowLayout
          mount="portal"
          cancelLabel="返回"
          onClose={() => setSheetOpen(false)}
        />
      </>
    )
  }

  return (
    <div
      ref={rowRef}
      class={`menu-bar__submenu-row${open ? ' menu-bar__submenu-row--open' : ''}`}
      role="none"
      onMouseEnter={() => setOpen(true)}
      onMouseLeave={() => setOpen(false)}
    >
      <span class="menu-bar__dropdown-label">{item.label}</span>
      <span class="menu-bar__submenu-chevron" aria-hidden="true">
        ›
      </span>
      {open ? (
        <div
          ref={submenuRef}
          class={`menu-bar__dropdown menu-bar__submenu${alignLeft ? ' menu-bar__submenu--left' : ''}`}
          role="menu"
          aria-label={item.label}
        >
          {item.items.map((subItem, index) => {
            if (subItem.type === 'separator') {
              return <div key={`sep-${index}`} class="menu-bar__separator" role="separator" />
            }
            return (
              <MenuDropdownAction
                key={`${item.label}-${subItem.label}`}
                item={subItem}
                onClose={onClose}
              />
            )
          })}
        </div>
      ) : undefined}
    </div>
  )
}

function MenuDropdown({ menu, onClose, narrowLayout }: MenuDropdownProps) {
  const dropdownRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    const el = dropdownRef.current
    if (!el) return

    const adjustPosition = () => {
      el.style.marginLeft = '0px'

      let rect = el.getBoundingClientRect()
      const padding = 8
      let marginLeft = 0

      if (rect.right > window.innerWidth) {
        marginLeft -= (rect.right - window.innerWidth + padding)
      }

      if (marginLeft !== 0) {
        el.style.marginLeft = `${marginLeft}px`
        rect = el.getBoundingClientRect()
      }

      if (rect.left < padding) {
        marginLeft += (padding - rect.left)
        el.style.marginLeft = `${marginLeft}px`
      }
    }

    adjustPosition()
    window.addEventListener('resize', adjustPosition)
    return () => window.removeEventListener('resize', adjustPosition)
  }, [menu])

  return (
    <div ref={dropdownRef} class="menu-bar__dropdown" role="menu" aria-label={menu.label}>
      {menu.items.map((item, index) => {
        if (item.type === 'separator') {
          return <div key={`sep-${index}`} class="menu-bar__separator" role="separator" />
        }

        if (item.type === 'submenu') {
          return (
            <MenuDropdownSubmenu
              key={item.label}
              item={item}
              onClose={onClose}
              narrowLayout={narrowLayout}
            />
          )
        }

        return <MenuDropdownAction key={item.label} item={item} onClose={onClose} />
      })}
    </div>
  )
}

const MenuDropdownMemo = memo(MenuDropdown)

type MenuBarRightSectionProps = {
  openMenuLabel: string | undefined
  onToggleMenu: (label: string) => void
  notificationCenterOpen: boolean
  onToggleNotificationCenter: () => void
  activeNotificationCount: number
  onSelectWindow: (windowId: string) => void
  onOpenTaskManager: () => void
  onOpenCloudServiceSettings: () => void
}

function MenuBarRightSection({
  openMenuLabel,
  onToggleMenu,
  notificationCenterOpen,
  onToggleNotificationCenter,
  activeNotificationCount,
  onSelectWindow,
  onOpenTaskManager,
  onOpenCloudServiceSettings,
}: MenuBarRightSectionProps) {
  const battery = useDeviceBattery()
  const proxyServer = useProxyServerConnection()
  const now = useOsNowDate()
  const [volumeState, setVolumeState] = useState(() => getSystemVolumeState())
  const [powProgress, setPowProgress] = useState<PowProgressState>(() => getPowProgress())
  const [activeNetworkRequests, setActiveNetworkRequests] = useState(() =>
    getActiveCloudNetworkRequests(),
  )
  const { calendar, weekday, time } = formatOsDateTime(now, isOsUsing24HourTime())

  useEffect(() => {
    return subscribeSystemVolume(() => setVolumeState(getSystemVolumeState()))
  }, [])

  useEffect(() => {
    return subscribePowProgress(setPowProgress)
  }, [])

  useEffect(() => {
    return subscribeCloudNetworkRequests((state) => setActiveNetworkRequests(state.activeRequests))
  }, [])

  const cloudWorking = powProgress.active || activeNetworkRequests > 0

  return (
    <div class="menu-bar__right">
      {(proxyServer.connected || cloudWorking) && (
        <div class="menu-bar__menu">
          <button
            type="button"
            class={`menu-bar__status-trigger${openMenuLabel === STATUS_CLOUD_SERVICE_LABEL ? ' menu-bar__status-trigger--open' : ''}`}
            aria-haspopup="dialog"
            aria-expanded={openMenuLabel === STATUS_CLOUD_SERVICE_LABEL}
            aria-label={
              cloudWorking
                ? powProgress.active
                  ? '云服务：正在计算 AI Challenge…'
                  : '云服务：网络请求中…'
                : proxyServer.connected
                  ? proxyServer.proxyHost
                    ? `云服务已连接，${proxyServer.proxyHost}`
                    : '云服务已连接'
                  : '云服务未连接'
            }
            onClick={() => onToggleMenu(STATUS_CLOUD_SERVICE_LABEL)}
          >
            <CloudServiceIcon active={cloudWorking} />
          </button>
          {openMenuLabel === STATUS_CLOUD_SERVICE_LABEL && (
            <CloudServiceStatusPanel
              connection={proxyServer}
              powProgress={powProgress}
              activeNetworkRequests={activeNetworkRequests}
              onOpenCloudServiceSettings={onOpenCloudServiceSettings}
              onOpenTaskManager={onOpenTaskManager}
            />
          )}
        </div>
      )}
      <div class="menu-bar__menu">
        <button
          type="button"
          class={`menu-bar__status-trigger${openMenuLabel === STATUS_BATTERY_LABEL ? ' menu-bar__status-trigger--open' : ''}`}
          aria-haspopup="dialog"
          aria-expanded={openMenuLabel === STATUS_BATTERY_LABEL}
          aria-label={
            battery
              ? `电池 ${battery.levelPercent}%${battery.charging ? '，已连接电源' : ''}`
              : '电池状态'
          }
          onClick={() => onToggleMenu(STATUS_BATTERY_LABEL)}
        >
          {battery !== undefined && (
            <span class="menu-bar__battery">{battery.levelPercent}%</span>
          )}
          <BatteryIcon levelPercent={battery?.levelPercent} charging={battery?.charging} />
        </button>
        {openMenuLabel === STATUS_BATTERY_LABEL && (
          <BatteryStatusPanel
            battery={battery}
            onSelectWindow={onSelectWindow}
            onOpenTaskManager={onOpenTaskManager}
          />
        )}
      </div>
      <div class="menu-bar__menu">
        <button
          type="button"
          class={`menu-bar__status-trigger${openMenuLabel === STATUS_VOLUME_LABEL ? ' menu-bar__status-trigger--open' : ''}`}
          aria-haspopup="dialog"
          aria-expanded={openMenuLabel === STATUS_VOLUME_LABEL}
          aria-label={
            volumeState.muted || volumeState.volume === 0
              ? '音量，已静音'
              : `音量 ${Math.round(volumeState.volume * 100)}%`
          }
          onClick={() => onToggleMenu(STATUS_VOLUME_LABEL)}
        >
          <MenuBarVolumeIcon muted={volumeState.muted || volumeState.volume === 0} />
        </button>
        {openMenuLabel === STATUS_VOLUME_LABEL && <MenuBarVolumePanel />}
      </div>
      <button
        type="button"
        class={`menu-bar__datetime${notificationCenterOpen ? ' menu-bar__datetime--open' : ''}`}
        aria-haspopup="dialog"
        aria-expanded={notificationCenterOpen}
        aria-label={
          activeNotificationCount > 0
            ? `通知中心，${activeNotificationCount} 条通知`
            : '通知中心'
        }
        onClick={onToggleNotificationCenter}
      >
        <span class="menu-bar__datetime-calendar">{calendar}</span>
        <span class="menu-bar__datetime-weekday">{weekday}</span>
        <span class="menu-bar__datetime-time">{time}</span>
      </button>
    </div>
  )
}

export function MenuBar() {
  const { windows, activeWindowId, focusWindow, restoreWindow, openApp } = useOs()
  const { hasImmersiveFullscreen, chromeRevealed, setChromePinSource } = useFullscreenChromeReveal()
  const { menusByApp } = useMenuBar()
  const { showInstantAbout, showAbout } = useAboutApp()
  const { pendingInstalls, failedInstalls, completedInstalls } = useGeneratedApps()
  const appNotifications = useAppNotifications()
  const processIsolationFallbackActive = useProcessIsolationFallbackNotification()
  const storageWarning = useStorageWarningNotification()
  const mountDisconnected = useMountDisconnectedNotification()
  const githubDesktopMissingEmail = useGithubDesktopMissingEmailNotification()
  const { isOpen: notificationCenterOpen, togglePanel } = useNotificationCenter()
  const [openMenuLabel, setOpenMenuLabel] = useState<string | undefined>(undefined)
  const [visibleMenuCount, setVisibleMenuCount] = useState(Number.POSITIVE_INFINITY)
  const narrowLayout = useMenuBarNarrowLayout()
  const barRef = useRef<HTMLElement>(null)
  const leftRef = useRef<HTMLDivElement>(null)
  const menusRef = useRef<HTMLDivElement>(null)
  const closeMenu = useCallback(() => setOpenMenuLabel(undefined), [])

  const hasFullscreenWindow = windows.some((window) => window.fullscreen && !window.minimized)
  const hidden = hasImmersiveFullscreen
    ? !chromeRevealed
    : hasFullscreenWindow
  const activeWindow = windows.find((window) => window.id === activeWindowId && !window.minimized)

  const desktopMenus = useMemo<MenuDefinition[]>(
    () => [
      {
        label: 'Instant OS',
        items: [{ type: 'action', label: '关于 Instant', onClick: showInstantAbout }],
      },
    ],
    [showInstantAbout],
  )

  const appleMenu = useMemo<MenuDefinition>(
    () => ({
      label: APPLE_MENU_LABEL,
      items: [
        {
          type: 'action',
          label: '关于本机',
          onClick: async () => {
            const content = await getThisDeviceAbout()
            showAbout({
              ...content,
              onMoreInfo: () => openApp('system-info'),
            })
          },
        },
        { type: 'separator' },
        {
          type: 'action',
          label: '系统设置',
          onClick: () => openApp('settings'),
        },
        {
          type: 'action',
          label: '性能监视器',
          onClick: () => openApp('task-manager'),
        },
        {
          type: 'action',
          label: '服务',
          onClick: () => openApp('services'),
        },
        {
          type: 'action',
          label: '空间嗅探',
          onClick: () => openApp('space-sniffer'),
        },
        {
          type: 'action',
          label: '事件日志',
          onClick: () => openApp('event-log'),
        },
        {
          type: 'action',
          label: '钥匙串',
          onClick: () => openApp('keychain'),
        },
        {
          type: 'action',
          label: '注册表',
          onClick: () => openApp('registry'),
        },
        {
          type: 'action',
          label: '帮助',
          onClick: () => openApp('help'),
        },
        { type: 'separator' },
        {
          type: 'action',
          label: '重新启动',
          onClick: () => reloadInstantOs(),
        },
      ],
    }),
    [showAbout, openApp],
  )

  const menus = activeWindow ? (menusByApp[activeWindow.appId] ?? []) : desktopMenus
  const hasMenuOverflow = visibleMenuCount < menus.length
  const overflowMenus = hasMenuOverflow ? menus.slice(visibleMenuCount) : []

  const activeNotificationCount =
    pendingInstalls.length +
    failedInstalls.length +
    completedInstalls.length +
    appNotifications.length +
    (processIsolationFallbackActive ? 1 : 0) +
    (storageWarning ? 1 : 0) +
    (mountDisconnected ? 1 : 0) +
    (githubDesktopMissingEmail ? 1 : 0)

  useEffect(() => {
    setChromePinSource('menu-bar', !!openMenuLabel || notificationCenterOpen)
  }, [notificationCenterOpen, openMenuLabel, setChromePinSource])

  // 部分环境（如桌面壳、无系统快捷键的浏览器）会把音量键派发给页面；可用时作为增强
  useEffect(() => {
    const handleVolumeKeyDown = (event: KeyboardEvent) => {
      const target = event.target as HTMLElement | null
      const tag = target?.tagName
      if (tag === 'INPUT' || tag === 'TEXTAREA' || target?.isContentEditable) {
        return
      }
      switch (event.code) {
        case 'VolumeUp':
          event.preventDefault()
          setSystemVolume(Math.min(1, getSystemVolumeState().volume + 0.05))
          break
        case 'VolumeDown':
          event.preventDefault()
          setSystemVolume(Math.max(0, getSystemVolumeState().volume - 0.05))
          break
        case 'VolumeMute':
          event.preventDefault()
          toggleSystemMute()
          break
      }
    }
    window.addEventListener('keydown', handleVolumeKeyDown)
    return () => window.removeEventListener('keydown', handleVolumeKeyDown)
  }, [])

  const prevActiveWindowIdRef = useRef(activeWindowId)

  useEffect(() => {
    if (prevActiveWindowIdRef.current === activeWindowId) {
      return
    }
    prevActiveWindowIdRef.current = activeWindowId
    setOpenMenuLabel(undefined)
  }, [activeWindowId])

  useLayoutEffect(() => {
    const left = leftRef.current
    const menusEl = menusRef.current
    if (!left || !menusEl) {
      return
    }

    const measure = () => {
      const items = Array.from(menusEl.querySelectorAll<HTMLElement>('[data-menu-index]'))
      if (items.length === 0) {
        setVisibleMenuCount(0)
        return
      }

      const brand = left.querySelector<HTMLElement>('.menu-bar__menu--brand')
      const fallback = left.querySelector<HTMLElement>('.menu-bar__fallback-name')

      let available = left.clientWidth
      if (brand) {
        available -= brand.offsetWidth + MENU_GAP_PX
      }
      if (fallback) {
        available -= fallback.offsetWidth + MENU_GAP_PX
      }

      if (available <= 0) {
        return
      }

      const moreMeasure = menusEl.querySelector<HTMLElement>('.menu-bar__more-measure')
      const moreBtnSpace = moreMeasure
        ? moreMeasure.offsetWidth + MENU_GAP_PX
        : MORE_MENU_BTN_SPACE_PX

      const widths: number[] = []
      let totalWidth = 0
      for (let index = 0; index < items.length; index += 1) {
        const width = items[index].offsetWidth
        widths.push(width)
        totalWidth += width + (index > 0 ? MENU_GAP_PX : 0)
      }

      if (totalWidth <= available) {
        setVisibleMenuCount(items.length)
        return
      }

      let fit = items.length
      let visibleWidth = totalWidth
      while (fit > 0 && visibleWidth + moreBtnSpace > available) {
        fit -= 1
        visibleWidth -= widths[fit] + (fit > 0 ? MENU_GAP_PX : 0)
      }

      setVisibleMenuCount(Math.max(0, fit))
    }

    measure()

    if (typeof ResizeObserver !== 'undefined') {
      const observer = new ResizeObserver(measure)
      observer.observe(left)
      const bar = barRef.current
      if (bar) {
        observer.observe(bar)
      }
      return () => observer.disconnect()
    }

    window.addEventListener('resize', measure)
    return () => window.removeEventListener('resize', measure)
  }, [menus.length, menus.map((menu) => menu.label).join('\0')])

  useEffect(() => {
    if (!openMenuLabel || openMenuLabel === MORE_MENU_LABEL || openMenuLabel === APPLE_MENU_LABEL) {
      return
    }

    const index = menus.findIndex((menu) => menu.label === openMenuLabel)
    if (index >= visibleMenuCount) {
      setOpenMenuLabel(undefined)
    }
  }, [menus, openMenuLabel, visibleMenuCount])

  useEffect(() => {
    if (!openMenuLabel || openMenuLabel === MORE_MENU_LABEL) {
      return
    }

    const handlePointerDown = (event: PointerEvent) => {
      if (!barRef.current?.contains(event.target as Node)) {
        setOpenMenuLabel(undefined)
      }
    }

    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        setOpenMenuLabel(undefined)
      }
    }

    window.addEventListener('pointerdown', handlePointerDown)
    window.addEventListener('keydown', handleKeyDown)
    return () => {
      window.removeEventListener('pointerdown', handlePointerDown)
      window.removeEventListener('keydown', handleKeyDown)
    }
  }, [openMenuLabel])

  const toggleMenu = useCallback((label: string) => {
    setOpenMenuLabel((current) => (current === label ? undefined : label))
  }, [])

  const handleSelectWindow = useCallback(
    (windowId: string) => {
      const target = windows.find((window) => window.id === windowId)
      if (!target) {
        return
      }
      if (target.minimized) {
        restoreWindow(windowId)
      } else {
        focusWindow(windowId)
      }
      closeMenu()
    },
    [closeMenu, focusWindow, restoreWindow, windows],
  )

  const handleOpenTaskManager = useCallback(() => {
    openApp('task-manager')
    closeMenu()
  }, [closeMenu, openApp])

  const handleOpenCloudServiceSettings = useCallback(() => {
    openApp('settings')
    openSettingsProxyServerView()
    closeMenu()
  }, [closeMenu, openApp])

  return (
    <header ref={barRef} class={`menu-bar${hidden ? ' menu-bar--hidden' : ''}`}>
      <div class="menu-bar__left" ref={leftRef}>
        <div class="menu-bar__menu menu-bar__menu--brand">
          <button
            type="button"
            class={`menu-bar__brand${openMenuLabel === APPLE_MENU_LABEL ? ' menu-bar__brand--open' : ''}`}
            aria-haspopup="menu"
            aria-expanded={openMenuLabel === APPLE_MENU_LABEL}
            aria-label="Instant 菜单"
            onClick={() => toggleMenu(APPLE_MENU_LABEL)}
          >
            <InstantLogoIcon size={15} />
          </button>
          {openMenuLabel === APPLE_MENU_LABEL && (
            <MenuDropdownMemo
              menu={appleMenu}
              narrowLayout={narrowLayout}
              onClose={closeMenu}
            />
          )}
        </div>
        {menus.length > 0 && (
          <div class="menu-bar__menus" ref={menusRef}>
            {menus.map((menu, index) => {
              if (hasMenuOverflow && index >= visibleMenuCount) {
                return undefined
              }

              return (
                <div key={menu.label} class="menu-bar__menu">
                  <button
                    type="button"
                    class={`menu-bar__trigger${openMenuLabel === menu.label ? ' menu-bar__trigger--open' : ''}`}
                    aria-haspopup="menu"
                    aria-expanded={openMenuLabel === menu.label}
                    onClick={() => toggleMenu(menu.label)}
                  >
                    {menu.label}
                  </button>
                  {openMenuLabel === menu.label && (
                    <MenuDropdownMemo
                      menu={menu}
                      narrowLayout={narrowLayout}
                      onClose={closeMenu}
                    />
                  )}
                </div>
              )
            })}
            {hasMenuOverflow && (
              <div class="menu-bar__menu menu-bar__menu--more">
                <button
                  type="button"
                  class={`menu-bar__trigger${openMenuLabel === MORE_MENU_LABEL ? ' menu-bar__trigger--open' : ''}`}
                  aria-haspopup="menu"
                  aria-expanded={openMenuLabel === MORE_MENU_LABEL}
                  aria-label="更多菜单"
                  onClick={() => toggleMenu(MORE_MENU_LABEL)}
                >
                  更多
                </button>
                <MenuOverflowModal
                  open={openMenuLabel === MORE_MENU_LABEL}
                  menus={overflowMenus}
                  onClose={() => setOpenMenuLabel(undefined)}
                />
              </div>
            )}
            <div class="menu-bar__measure" aria-hidden="true">
              {menus.map((menu, index) => (
                <div
                  key={`measure-${menu.label}`}
                  class="menu-bar__menu menu-bar__menu--measure"
                  data-menu-index={index}
                >
                  <span class="menu-bar__trigger">{menu.label}</span>
                </div>
              ))}
              <span class="menu-bar__trigger menu-bar__more-measure">更多</span>
            </div>
          </div>
        )}
        {activeWindow && menus.length === 0 && (
          <span class="menu-bar__fallback-name">
            {appNameForWindow(activeWindow.appId, activeWindow.title)}
          </span>
        )}
      </div>
      <div class="menu-bar__center" />
      <MenuBarRightSection
        openMenuLabel={openMenuLabel}
        onToggleMenu={toggleMenu}
        notificationCenterOpen={notificationCenterOpen}
        onToggleNotificationCenter={togglePanel}
        activeNotificationCount={activeNotificationCount}
        onSelectWindow={handleSelectWindow}
        onOpenTaskManager={handleOpenTaskManager}
        onOpenCloudServiceSettings={handleOpenCloudServiceSettings}
      />
    </header>
  )
}
