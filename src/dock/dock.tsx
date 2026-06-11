import { useEffect, useState } from 'preact/hooks'
import { AppIconNotificationBadge } from '../icons/app-icon-notification-badge.tsx'
import { GeneratedAppIcon } from '../apps/generated/generated-app-icon.tsx'
import { generatedAppIdToSlug } from '../apps/appstore/store-agent.ts'
import { getAppDefinition } from '../os/app-registry.tsx'
import { isBuiltinAppVisibleOnDock } from '../os/launcher-app-visibility.ts'
import {
  buildBuiltinIconContextMenuItems,
  buildDockWindowSubmenuOptions,
  buildGeneratedIconContextMenuItems,
} from '../os/build-icon-context-menu-items.ts'
import { useGeneratedApps } from '../os/generated-apps-context.tsx'
import { useIconContextMenu } from '../os/icon-context-menu-context.tsx'
import { useLauncherLayout } from '../os/launcher-layout-context.tsx'
import { isPermanentlyPinnedToDock } from '../os/launcher-layout-storage.ts'
import { useOs } from '../os/os-context.tsx'
import { isGeneratedAppId, type AppId, type GeneratedAppId } from '../os/types.ts'
import {
  DOCK_SETTINGS_CHANGED_EVENT,
} from './dock-settings-storage.ts'
import { DOCK_VIEWPORT_FIT_CHANGED_EVENT } from './use-dock-viewport-fit.ts'
import { resolveEffectiveDockIconSizePx } from './dock-layout-metrics.ts'
import '../icons/app-icon-tile.css'
import './dock.css'

function DockTooltip({ name }: { name: string }) {
  return <span class="dock__tooltip">{name}</span>
}

function useDockIconSize(): number {
  const [iconSize, setIconSize] = useState(resolveEffectiveDockIconSizePx)

  useEffect(() => {
    const syncIconSize = () => {
      setIconSize(resolveEffectiveDockIconSizePx())
    }

    window.addEventListener(DOCK_SETTINGS_CHANGED_EVENT, syncIconSize)
    window.addEventListener(DOCK_VIEWPORT_FIT_CHANGED_EVENT, syncIconSize)
    return () => {
      window.removeEventListener(DOCK_SETTINGS_CHANGED_EVENT, syncIconSize)
      window.removeEventListener(DOCK_VIEWPORT_FIT_CHANGED_EVENT, syncIconSize)
    }
  }, [])

  return iconSize
}

export function Dock() {
  const {
    windows,
    openApp,
    restoreWindow,
    closeWindow,
    closeWindowsForApp,
    minimizeWindow,
    toggleMaximize,
    toggleFullscreen,
    desktopRevealed,
    toggleDesktopReveal,
  } = useOs()
  const { installedApps, openInstalledApp, openMarketplaceDetail, pendingUpdateCount } =
    useGeneratedApps()
  const { showIconContextMenu } = useIconContextMenu()
  const { pinnedDockAppIds, isPinnedToDock, pinToDock, unpinFromDock } = useLauncherLayout()
  const dockHidden = windows.some((window) => window.fullscreen && !window.minimized)
  const iconSize = useDockIconSize()

  const runningAppIds = [...new Set(windows.map((window) => window.appId))]
  const runningUnpinnedAppIds = runningAppIds.filter((appId) => !isPinnedToDock(appId))

  function buildWindowSubmenu(appId: AppId) {
    return buildDockWindowSubmenuOptions(windows, appId, {
      closeWindow,
      minimizeWindow,
      toggleMaximize,
      toggleFullscreen,
      restoreWindow,
    })
  }

  function handleGeneratedClick(appId: GeneratedAppId) {
    const minimized = windows.find((window) => window.appId === appId && window.minimized)
    if (minimized) {
      restoreWindow(minimized.id)
      return
    }
    openInstalledApp(appId)
  }

  function renderBuiltinDockItem(appId: AppId) {
    if (isGeneratedAppId(appId)) {
      return undefined
    }

    const app = getAppDefinition(appId)
    if (!app || !isBuiltinAppVisibleOnDock(app)) {
      return undefined
    }

    const isRunning = windows.some((window) => window.appId === app.id)
    const minimized = windows.find((window) => window.appId === app.id && window.minimized)
    const pinned = isPinnedToDock(app.id)

    const handleOpen = () => {
      if (minimized) {
        restoreWindow(minimized.id)
        return
      }
      openApp(app.id)
    }

    return (
      <button
        key={app.id}
        type="button"
        class={`dock__item${isRunning ? ' dock__item--running' : ''}`}
        aria-label={app.name}
        onClick={handleOpen}
        onContextMenu={(event) => {
          showIconContextMenu(
            event,
            buildBuiltinIconContextMenuItems(
              handleOpen,
              {
                isPinnedToDock: pinned,
                onPinToDock: () => pinToDock(app.id),
                onUnpinFromDock:
                  pinned && !isPermanentlyPinnedToDock(app.id) ? () => unpinFromDock(app.id) : undefined,
              },
              {
                onForceQuit: isRunning ? () => closeWindowsForApp(app.id) : undefined,
                windowSubmenu: isRunning ? buildWindowSubmenu(app.id) : undefined,
              },
            ),
          )
        }}
      >
        <DockTooltip name={app.name} />
        <span class="dock__icon">
          <app.icon size={iconSize} />
          {app.id === 'appstore' && <AppIconNotificationBadge count={pendingUpdateCount} />}
        </span>
        {isRunning && <span class="dock__indicator" />}
      </button>
    )
  }

  function renderGeneratedDockItem(appId: GeneratedAppId) {
    const app = installedApps.find((entry) => entry.id === appId)
    if (!app) {
      return undefined
    }

    const isRunning = windows.some((window) => window.appId === app.id)
    const slug = generatedAppIdToSlug(app.id)
    const pinned = isPinnedToDock(app.id)

    const handleOpen = () => {
      handleGeneratedClick(app.id)
    }

    return (
      <button
        key={app.id}
        type="button"
        class={`dock__item${isRunning ? ' dock__item--running' : ''}`}
        aria-label={app.name}
        onClick={handleOpen}
        onContextMenu={(event) => {
          showIconContextMenu(
            event,
            buildGeneratedIconContextMenuItems({
              onOpen: handleOpen,
              onViewInMarketplace: () => openMarketplaceDetail(slug),
              isPinnedToDock: pinned,
              onPinToDock: () => pinToDock(app.id),
              onUnpinFromDock: () => unpinFromDock(app.id),
              onForceQuit: isRunning ? () => closeWindowsForApp(app.id) : undefined,
              windowSubmenu: isRunning ? buildWindowSubmenu(app.id) : undefined,
            }),
          )
        }}
      >
        <DockTooltip name={app.name} />
        <span class="dock__icon">
          <GeneratedAppIcon emoji={app.iconEmoji} themeColor={app.themeColor} size={iconSize} />
        </span>
        {isRunning && <span class="dock__indicator" />}
      </button>
    )
  }

  const pinnedDockItems = pinnedDockAppIds
    .map((appId) =>
      isGeneratedAppId(appId) ? renderGeneratedDockItem(appId) : renderBuiltinDockItem(appId),
    )
    .filter((item): item is NonNullable<typeof item> => item !== undefined)

  const runningDockItems = runningUnpinnedAppIds
    .map((appId) =>
      isGeneratedAppId(appId)
        ? renderGeneratedDockItem(appId)
        : renderBuiltinDockItem(appId),
    )
    .filter((item): item is NonNullable<typeof item> => item !== undefined)

  const showDivider = pinnedDockItems.length > 0 && runningDockItems.length > 0

  return (
    <nav class={`dock${dockHidden ? ' dock--hidden' : ''}`} aria-label="程序坞">
      <div class="dock__row">
        <button
          type="button"
          class="dock__reveal-zone dock__reveal-zone--left"
          aria-label={desktopRevealed ? '显示窗口' : '显示桌面'}
          onPointerDown={(event) => {
            event.preventDefault()
            toggleDesktopReveal()
          }}
        />
        <div class="dock__plate-anchor">
          <div class="dock__plate">
            {pinnedDockItems}
            {showDivider && <div class="dock__divider" aria-hidden="true" />}
            {runningDockItems}
          </div>
        </div>
        <button
          type="button"
          class="dock__reveal-zone dock__reveal-zone--right"
          aria-label={desktopRevealed ? '显示窗口' : '显示桌面'}
          onPointerDown={(event) => {
            event.preventDefault()
            toggleDesktopReveal()
          }}
        />
      </div>
    </nav>
  )
}
