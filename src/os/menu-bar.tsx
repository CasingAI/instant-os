import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'preact/hooks'
import { BatteryIcon, InstantLogoIcon } from '../icons/app-icons.tsx'
import { useAboutApp } from './about-app-context.tsx'
import { getAppDefinition } from './app-registry.tsx'
import { getThisDeviceAbout } from './builtin-app-about.ts'
import { useMenuBar } from './menu-bar-context.tsx'
import type { MenuDefinition, MenuItem } from './menu-bar-types.ts'
import { MenuOverflowModal } from './menu-bar-overflow-modal.tsx'
import { BatteryStatusPanel } from './menu-bar-status-panels.tsx'
import { useGeneratedApps } from './generated-apps-context.tsx'
import { formatOsDateTime } from './format-os-datetime.ts'
import { useNotificationCenter } from './notification-center-context.tsx'
import { useProcessIsolationFallbackNotification } from './use-process-isolation-fallback-notification.ts'
import { reloadInstantOs } from './reload-instant-os.ts'
import { useOs } from './os-context.tsx'
import { useFullscreenChromeReveal } from './fullscreen-chrome-reveal-context.tsx'
import { useDeviceBattery } from './use-device-battery.ts'
import type { AppId, BuiltinAppId } from './types.ts'
import { isGeneratedAppId } from './types.ts'
import './menu-bar.css'
import './menu-bar-popover.css'
import './notification-center.css'

const APPLE_MENU_LABEL = '__apple__'
const MORE_MENU_LABEL = '__more__'
const STATUS_BATTERY_LABEL = '__status_battery__'
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
}

function MenuDropdown({ menu, onClose }: MenuDropdownProps) {
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

  const handleItemClick = (item: MenuItem) => {
    if (item.type !== 'action' || item.disabled) {
      return
    }
    item.onClick()
    onClose()
  }

  return (
    <div ref={dropdownRef} class="menu-bar__dropdown" role="menu" aria-label={menu.label}>
      {menu.items.map((item, index) => {
        if (item.type === 'separator') {
          return <div key={`sep-${index}`} class="menu-bar__separator" role="separator" />
        }

        return (
          <button
            key={item.label}
            type="button"
            class="menu-bar__dropdown-item"
            role="menuitem"
            disabled={item.disabled}
            onClick={() => handleItemClick(item)}
          >
            <span class="menu-bar__dropdown-label">{item.label}</span>
            {item.shortcut && <span class="menu-bar__shortcut">{item.shortcut}</span>}
          </button>
        )
      })}
    </div>
  )
}

export function MenuBar() {
  const { windows, activeWindowId, focusWindow, restoreWindow, openApp } = useOs()
  const { hasImmersiveFullscreen, chromeRevealed, setChromePinSource } = useFullscreenChromeReveal()
  const { menusByApp } = useMenuBar()
  const { showInstantAbout, showAbout } = useAboutApp()
  const battery = useDeviceBattery()
  const { pendingInstalls, failedInstalls } = useGeneratedApps()
  const processIsolationFallbackActive = useProcessIsolationFallbackNotification()
  const { isOpen: notificationCenterOpen, togglePanel } = useNotificationCenter()
  const [openMenuLabel, setOpenMenuLabel] = useState<string | undefined>(undefined)
  const [visibleMenuCount, setVisibleMenuCount] = useState(Number.POSITIVE_INFINITY)
  const [now, setNow] = useState(() => new Date())
  const barRef = useRef<HTMLElement>(null)
  const leftRef = useRef<HTMLDivElement>(null)
  const menusRef = useRef<HTMLDivElement>(null)

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
          label: '任务管理器',
          onClick: () => openApp('task-manager'),
        },
        {
          type: 'action',
          label: '钥匙串',
          onClick: () => openApp('keychain'),
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

  const { calendar, weekday, time } = formatOsDateTime(now)
  const activeNotificationCount =
    pendingInstalls.length +
    failedInstalls.length +
    (processIsolationFallbackActive ? 1 : 0)

  useEffect(() => {
    const id = window.setInterval(() => setNow(new Date()), 1000)
    return () => window.clearInterval(id)
  }, [])

  useEffect(() => {
    setChromePinSource('menu-bar', !!openMenuLabel || notificationCenterOpen)
  }, [notificationCenterOpen, openMenuLabel, setChromePinSource])

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

  const toggleMenu = (label: string) => {
    setOpenMenuLabel((current) => (current === label ? undefined : label))
  }

  const handleSelectWindow = (windowId: string) => {
    const target = windows.find((window) => window.id === windowId)
    if (!target) {
      return
    }
    if (target.minimized) {
      restoreWindow(windowId)
    } else {
      focusWindow(windowId)
    }
    setOpenMenuLabel(undefined)
  }

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
            <MenuDropdown menu={appleMenu} onClose={() => setOpenMenuLabel(undefined)} />
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
                    <MenuDropdown menu={menu} onClose={() => setOpenMenuLabel(undefined)} />
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
      <div class="menu-bar__right">
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
            onClick={() => toggleMenu(STATUS_BATTERY_LABEL)}
          >
            {battery !== undefined && (
              <span class="menu-bar__battery">{battery.levelPercent}%</span>
            )}
            <BatteryIcon levelPercent={battery?.levelPercent} charging={battery?.charging} />
          </button>
          {openMenuLabel === STATUS_BATTERY_LABEL && (
            <BatteryStatusPanel battery={battery} onSelectWindow={handleSelectWindow} />
          )}
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
          onClick={togglePanel}
        >
          <span class="menu-bar__datetime-calendar">{calendar}</span><span class="menu-bar__datetime-weekday">{weekday}</span><span class="menu-bar__datetime-time">{time}</span>
        </button>
      </div>
    </header>
  )
}
