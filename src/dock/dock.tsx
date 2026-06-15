import type { ComponentChildren } from 'preact'
import { useEffect, useMemo, useState } from 'preact/hooks'
import { AppIconNotificationBadge } from '../icons/app-icon-notification-badge.tsx'
import { GeneratedAppIcon } from '../apps/generated/generated-app-icon.tsx'
import { generatedAppIdToSlug } from '../apps/appstore/store-agent.ts'
import { resolveIcodeProjectId } from '../apps/icode/icode-publish.ts'
import { DesktopFolderIcon, type FolderPreviewApp } from '../desktop/desktop-folder-icon.tsx'
import { openDesktopFolder, toggleDesktopFolder, closeOpenDesktopFolder } from '../desktop/desktop-open-folder-session.ts'
import { getAppDefinition } from '../os/app-registry.tsx'
import { findFolderById } from '../os/desktop-folder-operations.ts'
import { isDesktopFolderId, type DesktopFolderId, type DesktopItemId } from '../os/desktop-folder-types.ts'
import { isBuiltinAppVisibleOnDock } from '../os/launcher-app-visibility.ts'
import { EXPERIMENTAL_SETTINGS_CHANGED_EVENT, loadExperimentalSettings } from '../os/experimental-settings-storage.ts'
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
import { isGeneratedAppId, type AppId, type BuiltinAppId, type GeneratedAppId } from '../os/types.ts'
import { getDockDropSession, subscribeDockDropSession } from './dock-drop-session.ts'
import { DOCK_SETTINGS_CHANGED_EVENT } from './dock-settings-storage.ts'
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

function useDockDropSession() {
  const [dropSession, setDropSession] = useState(getDockDropSession)

  useEffect(() => subscribeDockDropSession(() => setDropSession(getDockDropSession())), [])

  return dropSession
}

export function Dock() {
  const {
    windows,
    activeWindowId,
    openApp,
    restoreWindow,
    closeWindow,
    closeWindowsForApp,
    minimizeWindow,
    focusWindow,
    toggleMaximize,
    toggleFullscreen,
    desktopRevealed,
    toggleDesktopReveal,
  } = useOs()
  const { installedApps, openInstalledApp, openMarketplaceDetail, openIcodeProject, pendingUpdateCount } =
    useGeneratedApps()
  const { showIconContextMenu } = useIconContextMenu()
  const {
    pinnedDockItemIds,
    desktopFolders,
    isPinnedToDock,
    pinToDock,
    unpinFromDock,
    unpinItemFromDock,
    dissolveDesktopFolder,
  } = useLauncherLayout()
  const dropSession = useDockDropSession()
  const dockHidden = windows.some((window) => window.fullscreen && !window.minimized)
  const iconSize = useDockIconSize()

  const runningAppIds = [...new Set(windows.map((window) => window.appId))]
  const runningUnpinnedAppIds = runningAppIds.filter((appId) => !isPinnedToDock(appId))

  const [, setExperimentalSettingsVersion] = useState(0)

  useEffect(() => {
    const handleChange = () => setExperimentalSettingsVersion((v) => v + 1)
    window.addEventListener(EXPERIMENTAL_SETTINGS_CHANGED_EVENT, handleChange)
    return () => window.removeEventListener(EXPERIMENTAL_SETTINGS_CHANGED_EVENT, handleChange)
  }, [])

  const folderPreviewById = useMemo(() => {
    const map = new Map<DesktopFolderId, FolderPreviewApp[]>()

    for (const folder of desktopFolders) {
      const previews: FolderPreviewApp[] = []
      for (const appId of folder.appIds) {
        if (isGeneratedAppId(appId)) {
          const app = installedApps.find((entry) => entry.id === appId)
          if (!app) {
            continue
          }
          previews.push({
            appId: app.id,
            kind: 'generated',
            emoji: app.iconEmoji,
            themeColor: app.themeColor,
          })
          continue
        }

        const app = getAppDefinition(appId)
        if (!app) {
          continue
        }
        previews.push({ appId: app.id, kind: 'builtin', Icon: app.icon })
      }
      map.set(folder.id, previews)
    }

    return map
  }, [desktopFolders, installedApps])

  function resolvePrimaryAppWindow(appId: AppId) {
    return windows
      .filter((window) => window.appId === appId)
      .sort((left, right) => right.zIndex - left.zIndex)[0]
  }

  function handleDockAppClick(appId: AppId, launch: () => void) {
    closeOpenDesktopFolder()
    const primary = resolvePrimaryAppWindow(appId)
    if (!primary) {
      launch()
      return
    }
    if (primary.minimized) {
      restoreWindow(primary.id)
      return
    }
    const activeWindow = windows.find((window) => window.id === activeWindowId)
    const isAppFrontmost = activeWindow?.appId === appId && !activeWindow.minimized
    if (isAppFrontmost) {
      minimizeWindow(primary.id)
      return
    }
    focusWindow(primary.id)
  }

  function handleDesktopRevealZonePointerDown(event: Event) {
    event.preventDefault()
    closeOpenDesktopFolder()
    toggleDesktopReveal()
  }

  function buildWindowSubmenu(appId: AppId) {
    return buildDockWindowSubmenuOptions(windows, appId, {
      closeWindow,
      minimizeWindow,
      toggleMaximize,
      toggleFullscreen,
      restoreWindow,
    })
  }

  function renderPinnedBuiltinDockItem(appId: BuiltinAppId) {
    const app = getAppDefinition(appId)
    if (!app || !isBuiltinAppVisibleOnDock(app, loadExperimentalSettings())) {
      return undefined
    }

    const isRunning = windows.some((window) => window.appId === app.id)
    const pinned = isPinnedToDock(app.id)

    const handleOpen = () => {
      handleDockAppClick(app.id, () => openApp(app.id))
    }

    return (
      <button
        key={app.id}
        type="button"
        class={`dock__item dock__item--pinned${isRunning ? ' dock__item--running' : ''}`}
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

  function renderPinnedGeneratedDockItem(appId: GeneratedAppId) {
    const app = installedApps.find((entry) => entry.id === appId)
    if (!app) {
      return undefined
    }

    const isRunning = windows.some((window) => window.appId === app.id)
    const slug = generatedAppIdToSlug(app.id)
    const icodeProjectId = resolveIcodeProjectId(app)
    const pinned = isPinnedToDock(app.id)

    const handleOpen = () => {
      handleDockAppClick(app.id, () => openInstalledApp(app.id))
    }

    return (
      <button
        key={app.id}
        type="button"
        class={`dock__item dock__item--pinned${isRunning ? ' dock__item--running' : ''}`}
        aria-label={app.name}
        onClick={handleOpen}
        onContextMenu={(event) => {
          showIconContextMenu(
            event,
            buildGeneratedIconContextMenuItems({
              onOpen: handleOpen,
              appSlug: slug,
              icodeProjectId,
              onViewInMarketplace: openMarketplaceDetail,
              onViewInIcode: openIcodeProject,
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

  function renderPinnedFolderDockItem(folderId: DesktopFolderId) {
    const folder = findFolderById(desktopFolders, folderId)
    if (!folder) {
      return undefined
    }

    const previewApps = folderPreviewById.get(folderId) ?? []
    const handleClick = () => {
      toggleDesktopFolder(folderId)
    }
    const handleOpen = () => {
      openDesktopFolder(folderId)
    }

    return (
      <button
        key={folderId}
        type="button"
        class="dock__item dock__item--pinned dock__item--folder"
        aria-label={folder.name}
        onClick={handleClick}
        onContextMenu={(event) => {
          showIconContextMenu(event, [
            { type: 'action', label: '打开', onClick: handleOpen },
            { type: 'separator' },
            { type: 'action', label: '从程序坞移除', onClick: () => unpinItemFromDock(folderId) },
            { type: 'separator' },
            {
              type: 'action',
              label: '解散文件夹',
              onClick: () => dissolveDesktopFolder(folderId),
            },
          ])
        }}
      >
        <DockTooltip name={folder.name} />
        <span class="dock__icon">
          <DesktopFolderIcon apps={previewApps} size={iconSize} />
        </span>
      </button>
    )
  }

  function renderPinnedDockItem(itemId: DesktopItemId) {
    if (isDesktopFolderId(itemId)) {
      return renderPinnedFolderDockItem(itemId)
    }

    if (isGeneratedAppId(itemId)) {
      return renderPinnedGeneratedDockItem(itemId)
    }

    return renderPinnedBuiltinDockItem(itemId)
  }

  function renderRunningBuiltinDockItem(appId: BuiltinAppId) {
    const app = getAppDefinition(appId)
    if (!app || !isBuiltinAppVisibleOnDock(app, loadExperimentalSettings())) {
      return undefined
    }

    const isRunning = windows.some((window) => window.appId === app.id)

    const handleOpen = () => {
      handleDockAppClick(app.id, () => openApp(app.id))
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
                isPinnedToDock: false,
                onPinToDock: () => pinToDock(app.id),
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

  function renderRunningGeneratedDockItem(appId: GeneratedAppId) {
    const app = installedApps.find((entry) => entry.id === appId)
    if (!app) {
      return undefined
    }

    const isRunning = windows.some((window) => window.appId === app.id)
    const slug = generatedAppIdToSlug(app.id)
    const icodeProjectId = resolveIcodeProjectId(app)

    const handleOpen = () => {
      handleDockAppClick(app.id, () => openInstalledApp(app.id))
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
              appSlug: slug,
              icodeProjectId,
              onViewInMarketplace: openMarketplaceDetail,
              onViewInIcode: openIcodeProject,
              isPinnedToDock: false,
              onPinToDock: () => pinToDock(app.id),
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

  const pinnedDockItems = pinnedDockItemIds
    .map((itemId) => renderPinnedDockItem(itemId))
    .filter((item): item is NonNullable<typeof item> => item !== undefined)

  const runningDockItems = runningUnpinnedAppIds
    .map((appId) =>
      isGeneratedAppId(appId)
        ? renderRunningGeneratedDockItem(appId)
        : renderRunningBuiltinDockItem(appId),
    )
    .filter((item): item is NonNullable<typeof item> => item !== undefined)

  const showDivider = pinnedDockItems.length > 0 && runningDockItems.length > 0
  const dropInsertIndex = dropSession.active ? dropSession.insertIndex : undefined

  const pinnedZoneContent: ComponentChildren[] = []
  for (let index = 0; index <= pinnedDockItems.length; index += 1) {
    if (dropInsertIndex === index) {
      pinnedZoneContent.push(
        <div key={`drop-${index}`} class="dock__drop-indicator" aria-hidden="true" />,
      )
    }
    if (index < pinnedDockItems.length) {
      pinnedZoneContent.push(pinnedDockItems[index])
    }
  }

  return (
    <nav
      class={`dock${dockHidden ? ' dock--hidden' : ''}${dropSession.active ? ' dock--drop-target' : ''}`}
      aria-label="程序坞"
    >
      <div class="dock__row">
        <button
          type="button"
          class="dock__reveal-zone dock__reveal-zone--left"
          aria-label={desktopRevealed ? '显示窗口' : '显示桌面'}
          onPointerDown={handleDesktopRevealZonePointerDown}
        />
        <div class="dock__plate-anchor">
          <div class="dock__plate">
            <div class="dock__pinned-zone">{pinnedZoneContent}</div>
            {showDivider && <div class="dock__divider" aria-hidden="true" />}
            {runningDockItems}
          </div>
        </div>
        <button
          type="button"
          class="dock__reveal-zone dock__reveal-zone--right"
          aria-label={desktopRevealed ? '显示窗口' : '显示桌面'}
          onPointerDown={handleDesktopRevealZonePointerDown}
        />
      </div>
    </nav>
  )
}
