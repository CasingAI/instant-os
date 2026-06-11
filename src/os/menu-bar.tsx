import { useEffect, useMemo, useRef, useState } from 'preact/hooks'
import { BatteryIcon, InstantLogoIcon } from '../icons/app-icons.tsx'
import { useAboutApp } from './about-app-context.tsx'
import { getAppDefinition } from './app-registry.tsx'
import { useMenuBar } from './menu-bar-context.tsx'
import type { MenuDefinition, MenuItem } from './menu-bar-types.ts'
import { BatteryStatusPanel } from './menu-bar-status-panels.tsx'
import { useGeneratedApps } from './generated-apps-context.tsx'
import { formatOsDateTime } from './format-os-datetime.ts'
import { useNotificationCenter } from './notification-center-context.tsx'
import { useOs } from './os-context.tsx'
import { useDeviceBattery } from './use-device-battery.ts'
import type { AppId, BuiltinAppId } from './types.ts'
import { isGeneratedAppId } from './types.ts'
import './menu-bar.css'
import './menu-bar-popover.css'
import './notification-center.css'

const APPLE_MENU_LABEL = '__apple__'
const STATUS_BATTERY_LABEL = '__status_battery__'

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
  const { windows, activeWindowId, focusWindow, restoreWindow } = useOs()
  const { menusByApp } = useMenuBar()
  const { showFinderAbout, showInstantAbout } = useAboutApp()
  const battery = useDeviceBattery()
  const { pendingInstalls, failedInstalls } = useGeneratedApps()
  const { isOpen: notificationCenterOpen, togglePanel } = useNotificationCenter()
  const [openMenuLabel, setOpenMenuLabel] = useState<string | undefined>(undefined)
  const [now, setNow] = useState(() => new Date())
  const barRef = useRef<HTMLElement>(null)

  const hidden = windows.some((window) => window.fullscreen && !window.minimized)
  const activeWindow = windows.find((window) => window.id === activeWindowId && !window.minimized)

  const desktopMenus = useMemo<MenuDefinition[]>(
    () => [
      {
        label: '访达',
        items: [{ type: 'action', label: '关于访达', onClick: showFinderAbout }],
      },
    ],
    [showFinderAbout],
  )

  const appleMenu = useMemo<MenuDefinition>(
    () => ({
      label: APPLE_MENU_LABEL,
      items: [{ type: 'action', label: '关于 Instant', onClick: showInstantAbout }],
    }),
    [showInstantAbout],
  )

  const menus = activeWindow ? (menusByApp[activeWindow.appId] ?? []) : desktopMenus

  const { calendar, weekday, time } = formatOsDateTime(now)
  const activeNotificationCount = pendingInstalls.length + failedInstalls.length

  useEffect(() => {
    const id = window.setInterval(() => setNow(new Date()), 1000)
    return () => window.clearInterval(id)
  }, [])

  const prevActiveWindowIdRef = useRef(activeWindowId)

  useEffect(() => {
    if (prevActiveWindowIdRef.current === activeWindowId) {
      return
    }
    prevActiveWindowIdRef.current = activeWindowId
    setOpenMenuLabel(undefined)
  }, [activeWindowId])

  useEffect(() => {
    if (!openMenuLabel) {
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
      <div class="menu-bar__left">
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
        {menus.map((menu) => (
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
        ))}
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
