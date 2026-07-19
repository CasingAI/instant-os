import type { ComponentChildren } from 'preact'
import { useCallback, useEffect, useMemo, useRef, useState } from 'preact/hooks'
import { AppIconNotificationBadge } from '../icons/app-icon-notification-badge.tsx'
import { GeneratedAppIcon } from '../apps/generated/generated-app-icon.tsx'
import { ExtAppIcon } from '../apps/ext/ext-app-icon.tsx'
import { generatedAppIdToSlug } from '../apps/appstore/store-agent.ts'
import { resolveIcodeProjectId } from '../apps/icode/icode-publish.ts'
import { DesktopFolderIcon, type FolderPreviewApp } from '../desktop/desktop-folder-icon.tsx'
import { openDesktopFolder, toggleDesktopFolder, closeOpenDesktopFolder } from '../desktop/desktop-open-folder-session.ts'
import { getAppDefinition } from '../os/app-registry.tsx'
import { findFolderById } from '../os/desktop-folder-operations.ts'
import { isDesktopFolderId, type DesktopFolderId, type DesktopItemId } from '../os/desktop-folder-types.ts'
import {
  isBuiltinAppVisibleOnDock,
  isBuiltinAppVisibleOnDockWhenRunning,
} from '../os/launcher-app-visibility.ts'
import { EXPERIMENTAL_SETTINGS_CHANGED_EVENT, loadExperimentalSettings } from '../os/experimental-settings-storage.ts'
import {
  buildBuiltinIconContextMenuItems,
  buildDockWindowSubmenuOptions,
  buildGeneratedIconContextMenuItems,
} from '../os/build-icon-context-menu-items.ts'
import { useGeneratedApps } from '../os/generated-apps-context.tsx'
import { useDevExtApps } from '../os/dev-ext-apps-context.tsx'
import { useIconContextMenu } from '../os/icon-context-menu-context.tsx'
import { useLauncherLayout } from '../os/launcher-layout-context.tsx'
import { isPermanentlyPinnedToDock } from '../os/launcher-layout-storage.ts'
import { useOs } from '../os/os-context.tsx'
import { isExtAppId, isGeneratedAppId, type AppId, type BuiltinAppId, type ExtAppId, type GeneratedAppId } from '../os/types.ts'
import {
  clearDockDropSession,
  getDockDropSession,
  setDockDropSession,
  subscribeDockDropSession,
} from './dock-drop-session.ts'
import { resolveDockDropTarget } from './dock-drop-target.ts'
import { DOCK_SETTINGS_CHANGED_EVENT } from './dock-settings-storage.ts'
import { DOCK_VIEWPORT_FIT_CHANGED_EVENT } from './use-dock-viewport-fit.ts'
import { resolveEffectiveDockIconSizePx } from './dock-layout-metrics.ts'
import { useDockIconReorder } from './use-dock-icon-reorder.ts'
import '../icons/app-icon-tile.css'
import './dock.css'

type DockReorderSession = {
  itemId: DesktopItemId
  pointerX: number
  pointerY: number
  grabOffsetX: number
  grabOffsetY: number
}

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

type DockPinnedItemButtonProps = {
  itemId: DesktopItemId
  index: number
  className: string
  ariaLabel: string
  reorderingEnabled: boolean
  onOpen: () => void
  onContextMenu: (event: MouseEvent) => void
  onReorderStart: (
    itemId: DesktopItemId,
    index: number,
    clientX: number,
    clientY: number,
    grabOffsetX: number,
    grabOffsetY: number,
  ) => void
  onReorderMove: (clientX: number, clientY: number) => void
  onReorderEnd: () => void
  children: ComponentChildren
}

function DockPinnedItemButton({
  itemId,
  index,
  className,
  ariaLabel,
  reorderingEnabled,
  onOpen,
  onContextMenu,
  onReorderStart,
  onReorderMove,
  onReorderEnd,
  children,
}: DockPinnedItemButtonProps) {
  const { onClick, onPointerDown } = useDockIconReorder({
    itemId,
    index,
    reorderingEnabled,
    onOpen,
    onReorderStart,
    onReorderMove,
    onReorderEnd,
  })

  return (
    <button
      type="button"
      class={className}
      data-dock-item-id={itemId}
      data-dock-app-id={isDesktopFolderId(itemId) ? undefined : itemId}
      aria-label={ariaLabel}
      onClick={onClick}
      onPointerDown={onPointerDown}
      onContextMenu={onContextMenu}
    >
      {children}
    </button>
  )
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
  const { openSessionExtApp, removeSessionExtApp, getSessionExtApp } = useDevExtApps()
  const { showIconContextMenu } = useIconContextMenu()
  const {
    pinnedDockItemIds,
    desktopFolders,
    isPinnedToDock,
    pinToDock,
    pinToDockAtIndex,
    unpinFromDock,
    unpinItemFromDock,
    dissolveDesktopFolder,
  } = useLauncherLayout()
  const dropSession = useDockDropSession()
  const dockHidden = windows.some((window) => window.fullscreen && !window.minimized)
  const iconSize = useDockIconSize()

  const [reorderSession, setReorderSession] = useState<DockReorderSession | undefined>(undefined)
  const lastPointerRef = useRef({ x: 0, y: 0 })
  const reorderSessionRef = useRef<DockReorderSession | undefined>(undefined)

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

        if (isExtAppId(appId)) {
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

  function isAppRunning(appId: AppId): boolean {
    return windows.some((window) => window.appId === appId && !window.closing)
  }

  function resolvePrimaryAppWindow(appId: AppId) {
    return windows
      .filter((window) => window.appId === appId && !window.closing)
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

  const onReorderStart = useCallback(
    (
      itemId: DesktopItemId,
      index: number,
      clientX: number,
      clientY: number,
      grabOffsetX: number,
      grabOffsetY: number,
    ) => {
      closeOpenDesktopFolder()
      lastPointerRef.current = { x: clientX, y: clientY }
      const next: DockReorderSession = {
        itemId,
        pointerX: clientX,
        pointerY: clientY,
        grabOffsetX,
        grabOffsetY,
      }
      reorderSessionRef.current = next
      setReorderSession(next)
      setDockDropSession({ active: true, insertIndex: index })
    },
    [],
  )

  const onReorderMove = useCallback((clientX: number, clientY: number) => {
    lastPointerRef.current = { x: clientX, y: clientY }
    setReorderSession((session) => {
      if (!session) {
        return session
      }
      const next = { ...session, pointerX: clientX, pointerY: clientY }
      reorderSessionRef.current = next
      return next
    })

    const target = resolveDockDropTarget(clientX, clientY)
    if (target.overDock) {
      setDockDropSession({ active: true, insertIndex: target.insertIndex })
    } else {
      clearDockDropSession()
    }
  }, [])

  const onReorderEnd = useCallback(() => {
    const session = reorderSessionRef.current
    const pointer = lastPointerRef.current
    const target = resolveDockDropTarget(pointer.x, pointer.y)

    if (session) {
      if (target.overDock) {
        pinToDockAtIndex(session.itemId, target.insertIndex)
      } else if (isDesktopFolderId(session.itemId) || !isPermanentlyPinnedToDock(session.itemId)) {
        unpinItemFromDock(session.itemId)
      }
    }

    clearDockDropSession()
    reorderSessionRef.current = undefined
    setReorderSession(undefined)
  }, [pinToDockAtIndex, unpinItemFromDock])

  const reorderingEnabled = reorderSession !== undefined

  function renderDockItemIcon(itemId: DesktopItemId) {
    if (isDesktopFolderId(itemId)) {
      const folder = findFolderById(desktopFolders, itemId)
      if (!folder) {
        return undefined
      }
      return <DesktopFolderIcon apps={folderPreviewById.get(itemId) ?? []} size={iconSize} />
    }

    if (isGeneratedAppId(itemId)) {
      const app = installedApps.find((entry) => entry.id === itemId)
      if (!app) {
        return undefined
      }
      return <GeneratedAppIcon emoji={app.iconEmoji} themeColor={app.themeColor} size={iconSize} />
    }

    if (isExtAppId(itemId)) {
      const app = getSessionExtApp(itemId)
      if (!app) {
        return undefined
      }
      return (
        <ExtAppIcon
          name={app.manifest.name}
          themeColor={app.manifest.themeColor}
          iconUrl={app.iconUrl}
          size={iconSize}
          devBadge
        />
      )
    }

    const app = getAppDefinition(itemId)
    if (!app) {
      return undefined
    }
    return (
      <>
        <app.icon size={iconSize} />
        {app.id === 'appstore' && <AppIconNotificationBadge count={pendingUpdateCount} />}
      </>
    )
  }

  function renderPinnedBuiltinDockItem(appId: BuiltinAppId, index: number) {
    const app = getAppDefinition(appId)
    if (!app || !isBuiltinAppVisibleOnDock(app, loadExperimentalSettings())) {
      return undefined
    }

    const isRunning = isAppRunning(app.id)
    const pinned = isPinnedToDock(app.id)

    const handleOpen = () => {
      handleDockAppClick(app.id, () => openApp(app.id))
    }

    return (
      <DockPinnedItemButton
        key={app.id}
        itemId={app.id}
        index={index}
        className={`dock__item dock__item--pinned${isRunning ? ' dock__item--running' : ''}`}
        ariaLabel={app.name}
        reorderingEnabled={reorderingEnabled}
        onOpen={handleOpen}
        onReorderStart={onReorderStart}
        onReorderMove={onReorderMove}
        onReorderEnd={onReorderEnd}
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
      </DockPinnedItemButton>
    )
  }

  function renderPinnedGeneratedDockItem(appId: GeneratedAppId, index: number) {
    const app = installedApps.find((entry) => entry.id === appId)
    if (!app) {
      return undefined
    }

    const isRunning = isAppRunning(app.id)
    const slug = generatedAppIdToSlug(app.id)
    const icodeProjectId = resolveIcodeProjectId(app)
    const pinned = isPinnedToDock(app.id)

    const handleOpen = () => {
      handleDockAppClick(app.id, () => openInstalledApp(app.id))
    }

    return (
      <DockPinnedItemButton
        key={app.id}
        itemId={app.id}
        index={index}
        className={`dock__item dock__item--pinned${isRunning ? ' dock__item--running' : ''}`}
        ariaLabel={app.name}
        reorderingEnabled={reorderingEnabled}
        onOpen={handleOpen}
        onReorderStart={onReorderStart}
        onReorderMove={onReorderMove}
        onReorderEnd={onReorderEnd}
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
      </DockPinnedItemButton>
    )
  }

  function renderPinnedFolderDockItem(folderId: DesktopFolderId, index: number) {
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
      <DockPinnedItemButton
        key={folderId}
        itemId={folderId}
        index={index}
        className="dock__item dock__item--pinned dock__item--folder"
        ariaLabel={folder.name}
        reorderingEnabled={reorderingEnabled}
        onOpen={handleClick}
        onReorderStart={onReorderStart}
        onReorderMove={onReorderMove}
        onReorderEnd={onReorderEnd}
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
      </DockPinnedItemButton>
    )
  }

  function renderPinnedExtDockItem(appId: ExtAppId, index: number) {
    const app = getSessionExtApp(appId)
    if (!app) {
      return undefined
    }

    const isRunning = isAppRunning(app.id)
    const pinned = isPinnedToDock(app.id)

    const handleOpen = () => {
      handleDockAppClick(app.id, () => openSessionExtApp(app.id))
    }

    return (
      <DockPinnedItemButton
        key={app.id}
        itemId={app.id}
        index={index}
        className={`dock__item dock__item--pinned${isRunning ? ' dock__item--running' : ''}`}
        ariaLabel={app.manifest.name}
        reorderingEnabled={reorderingEnabled}
        onOpen={handleOpen}
        onReorderStart={onReorderStart}
        onReorderMove={onReorderMove}
        onReorderEnd={onReorderEnd}
        onContextMenu={(event) => {
          showIconContextMenu(event, [
            { type: 'action', label: '打开', onClick: handleOpen },
            { type: 'separator' },
            {
              type: 'action',
              label: pinned ? '从程序坞移除' : '添加到程序坞',
              onClick: pinned ? () => unpinFromDock(app.id) : () => pinToDock(app.id),
            },
            { type: 'separator' },
            {
              type: 'action',
              label: '从桌面移除',
              onClick: () => removeSessionExtApp(app.id),
            },
            ...(isRunning
              ? [
                  { type: 'separator' as const },
                  {
                    type: 'action' as const,
                    label: '强制退出',
                    onClick: () => closeWindowsForApp(app.id),
                  },
                ]
              : []),
          ])
        }}
      >
        <DockTooltip name={app.manifest.name} />
        <span class="dock__icon">
          <ExtAppIcon
            name={app.manifest.name}
            themeColor={app.manifest.themeColor}
            iconUrl={app.iconUrl}
            size={iconSize}
            devBadge
          />
        </span>
        {isRunning && <span class="dock__indicator" />}
      </DockPinnedItemButton>
    )
  }

  function renderPinnedDockItem(itemId: DesktopItemId, index: number) {
    if (isDesktopFolderId(itemId)) {
      return renderPinnedFolderDockItem(itemId, index)
    }

    if (isGeneratedAppId(itemId)) {
      return renderPinnedGeneratedDockItem(itemId, index)
    }

    if (isExtAppId(itemId)) {
      return renderPinnedExtDockItem(itemId, index)
    }

    return renderPinnedBuiltinDockItem(itemId, index)
  }

  function renderRunningBuiltinDockItem(appId: BuiltinAppId) {
    const app = getAppDefinition(appId)
    if (!app || !isBuiltinAppVisibleOnDockWhenRunning(app, loadExperimentalSettings())) {
      return undefined
    }

    const isRunning = isAppRunning(app.id)

    const handleOpen = () => {
      handleDockAppClick(app.id, () => openApp(app.id))
    }

    return (
      <button
        key={app.id}
        type="button"
        class={`dock__item${isRunning ? ' dock__item--running' : ''}`}
        data-dock-app-id={app.id}
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

    const isRunning = isAppRunning(app.id)
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
        data-dock-app-id={app.id}
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

  function renderRunningExtDockItem(appId: ExtAppId) {
    const app = getSessionExtApp(appId)
    if (!app) {
      return undefined
    }

    const isRunning = isAppRunning(app.id)

    const handleOpen = () => {
      handleDockAppClick(app.id, () => openSessionExtApp(app.id))
    }

    return (
      <button
        key={app.id}
        type="button"
        class={`dock__item${isRunning ? ' dock__item--running' : ''}`}
        data-dock-app-id={app.id}
        aria-label={app.manifest.name}
        onClick={handleOpen}
        onContextMenu={(event) => {
          showIconContextMenu(event, [
            { type: 'action', label: '打开', onClick: handleOpen },
            { type: 'separator' },
            { type: 'action', label: '添加到程序坞', onClick: () => pinToDock(app.id) },
            { type: 'separator' },
            {
              type: 'action',
              label: '强制退出',
              onClick: () => closeWindowsForApp(app.id),
            },
          ])
        }}
      >
        <DockTooltip name={app.manifest.name} />
        <span class="dock__icon">
          <ExtAppIcon
            name={app.manifest.name}
            themeColor={app.manifest.themeColor}
            iconUrl={app.iconUrl}
            size={iconSize}
            devBadge
          />
        </span>
        {isRunning && <span class="dock__indicator" />}
      </button>
    )
  }

  const draggingItemId = reorderSession?.itemId
  const visiblePinnedItemIds = draggingItemId
    ? pinnedDockItemIds.filter((itemId) => itemId !== draggingItemId)
    : pinnedDockItemIds

  const pinnedDockItems = visiblePinnedItemIds
    .map((itemId) => {
      const sourceIndex = pinnedDockItemIds.indexOf(itemId)
      return renderPinnedDockItem(itemId, sourceIndex)
    })
    .filter((item): item is NonNullable<typeof item> => item !== undefined)

  const runningDockItems = runningUnpinnedAppIds
    .map((appId) => {
      if (isGeneratedAppId(appId)) {
        return renderRunningGeneratedDockItem(appId)
      }
      if (isExtAppId(appId)) {
        return renderRunningExtDockItem(appId)
      }
      return renderRunningBuiltinDockItem(appId)
    })
    .filter((item): item is NonNullable<typeof item> => item !== undefined)

  const showDivider = pinnedDockItems.length > 0 && runningDockItems.length > 0
  const dropInsertIndex = dropSession.active ? dropSession.insertIndex : undefined
  const ghostIcon = draggingItemId ? renderDockItemIcon(draggingItemId) : undefined

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
      class={`dock${dockHidden ? ' dock--hidden' : ''}${dropSession.active ? ' dock--drop-target' : ''}${reorderSession ? ' dock--reordering' : ''}`}
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
      {reorderSession && ghostIcon && (
        <div
          class="dock__drag-ghost"
          style={{
            left: `${reorderSession.pointerX - reorderSession.grabOffsetX}px`,
            top: `${reorderSession.pointerY - reorderSession.grabOffsetY}px`,
            transformOrigin: `${reorderSession.grabOffsetX}px ${reorderSession.grabOffsetY}px`,
          }}
          aria-hidden="true"
        >
          <span class="dock__icon">{ghostIcon}</span>
        </div>
      )}
    </nav>
  )
}
