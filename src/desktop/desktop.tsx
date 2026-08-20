import type { ComponentType } from 'preact'
import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'preact/hooks'
import { GeneratedAppIcon } from '../apps/generated/generated-app-icon.tsx'
import { ExtAppIcon } from '../apps/ext/ext-app-icon.tsx'
import { generatedAppIdToSlug } from '../apps/appstore/store-agent.ts'
import { resolveIcodeProjectId } from '../apps/icode/icode-publish.ts'
import { useInternalProjects } from '../apps/icode/icode-storage.ts'
import type { ICodeInternalProject } from '../apps/icode/icode-types.ts'
import { AppIconNotificationBadge } from '../icons/app-icon-notification-badge.tsx'
import { APP_REGISTRY } from '../os/app-registry.tsx'
import {
  buildBuiltinIconContextMenuItems,
  buildGeneratedIconContextMenuItems,
} from '../os/build-icon-context-menu-items.ts'
import { AppUninstallConfirmSheet } from '../os/app-uninstall-confirm-sheet.tsx'
import { findFolderById, moveAppOutOfFolder, reconcileDesktopFolders } from '../os/desktop-folder-operations.ts'
import {
  isDesktopFolderId,
  type DesktopFolderId,
  type DesktopItemId,
} from '../os/desktop-folder-types.ts'
import { useGeneratedApps } from '../os/generated-apps-context.tsx'
import { useDevExtApps } from '../os/dev-ext-apps-context.tsx'
import { useIconContextMenu } from '../os/icon-context-menu-context.tsx'
import { useLauncherLayout } from '../os/launcher-layout-context.tsx'
import {
  isPermanentlyPinnedToDock,
  reconcileDesktopIconOrder,
} from '../os/launcher-layout-storage.ts'
import { isBuiltinAppVisibleOnDesktop } from '../os/launcher-app-visibility.ts'
import { EXPERIMENTAL_SETTINGS_CHANGED_EVENT, loadExperimentalSettings } from '../os/experimental-settings-storage.ts'
import { useOs } from '../os/os-context.tsx'
import { useFlip3dScene } from '../window/flip3d-context.tsx'
import { runDesktopClickAction, runDesktopHoldAction } from './run-desktop-click-action.ts'
import type { AppId, BuiltinAppId, ExtAppId, GeneratedAppId } from '../os/types.ts'
import {
  buildPreviewOrder,
  getIconSlotPosition,
  getPageSlice,
} from './desktop-icon-layout.ts'
import {
  chunkDesktopPages,
  computeDesktopGridMetrics,
  computeDesktopGridPixelSize,
  resolvePointerIconTarget,
} from './desktop-grid-layout.ts'
import { DesktopFolderIcon, type FolderPreviewApp } from './desktop-folder-icon.tsx'
import { warmFolderMiniIconSnapshotCache } from './desktop-folder-mini-icon-service.tsx'
import {
  registerCloseOpenDesktopFolder,
  registerOpenDesktopFolder,
  setOpenDesktopFolderId,
} from './desktop-open-folder-session.ts'
import {
  DesktopFolderOverlay,
  resolveFolderAppEntry,
  type FolderAppEntry,
} from './desktop-folder-overlay.tsx'
import { resolveMergeTargetItem } from './desktop-merge-target.ts'
import { useDesktopIconReorder } from './use-desktop-icon-reorder.ts'
import { clearDockDropSession, setDockDropSession } from '../dock/dock-drop-session.ts'
import { resolveDockDropTarget } from '../dock/dock-drop-target.ts'
import { useDesktopPagePager } from './use-desktop-page-pager.ts'
import {
  desktopAppSearchSeedFromKey,
  isDesktopAppSearchBlockedTarget,
  isDesktopAppSearchTriggerKey,
} from './desktop-app-search.ts'
import { DesktopAppSearchOverlay } from './desktop-app-search-overlay.tsx'
import '../icons/app-icon-tile.css'
import './desktop.css'

type DesktopAppEntry =
  | { kind: 'builtin'; appId: BuiltinAppId; name: string; Icon: ComponentType<{ size?: number }>; badgeCount?: number }
  | {
      kind: 'generated'
      appId: GeneratedAppId
      name: string
      emoji: string
      themeColor: string
      progress?: number
      textLength?: number
    }
  | {
      kind: 'ext'
      appId: ExtAppId
      name: string
      themeColor: string
      iconUrl: string
    }

type DesktopFolderEntry = {
  kind: 'folder'
  folderId: DesktopFolderId
  name: string
  previewApps: FolderPreviewApp[]
}

type DesktopEntry = DesktopAppEntry | DesktopFolderEntry

type DesktopReorderController = {
  reorderingEnabled: boolean
  draggingItemId: DesktopItemId | undefined
  mergeTargetId: DesktopItemId | undefined
  onReorderStart: (
    itemId: DesktopItemId,
    globalIndex: number,
    clientX: number,
    clientY: number,
    grabOffsetX: number,
    grabOffsetY: number,
  ) => void
  onReorderMove: (clientX: number, clientY: number) => void
  onReorderEnd: () => void
}

type DesktopIconProps = {
  appId: BuiltinAppId
  name: string
  Icon: ComponentType<{ size?: number }>
  badgeCount?: number
  itemId: DesktopItemId
  globalIndex: number
  mergeTarget: boolean
  didSwipeRef: { current: boolean }
  reorder: DesktopReorderController
}

function DesktopIcon({
  appId,
  name,
  Icon,
  badgeCount = 0,
  itemId,
  globalIndex,
  mergeTarget,
  didSwipeRef,
  reorder,
}: DesktopIconProps) {
  const { openApp } = useOs()
  const { showIconContextMenu } = useIconContextMenu()
  const { isPinnedToDock, pinToDock, unpinFromDock } = useLauncherLayout()

  const handleOpen = () => {
    openApp(appId)
  }

  const pinned = isPinnedToDock(appId)

  const { onClick, onPointerDown } = useDesktopIconReorder({
    itemId,
    globalIndex,
    didSwipeRef,
    reorderingEnabled: reorder.reorderingEnabled,
    onOpen: handleOpen,
    onReorderStart: reorder.onReorderStart,
    onReorderMove: reorder.onReorderMove,
    onReorderEnd: reorder.onReorderEnd,
  })

  return (
    <button
      type="button"
      class="desktop-icon"
      onClick={onClick}
      onPointerDown={onPointerDown}
      onContextMenu={(event) => {
        showIconContextMenu(
          event,
          buildBuiltinIconContextMenuItems(handleOpen, {
            isPinnedToDock: pinned,
            onPinToDock: () => pinToDock(appId),
            onUnpinFromDock:
              pinned && !isPermanentlyPinnedToDock(appId) ? () => unpinFromDock(appId) : undefined,
          }),
        )
      }}
    >
      <span class={`desktop-icon__image${mergeTarget ? ' desktop-icon__image--merge-target' : ''}`}>
        <Icon size={72} />
        <AppIconNotificationBadge count={badgeCount} />
      </span>
      <span class="desktop-icon__label">{name}</span>
    </button>
  )
}

type GeneratedDesktopIconProps = {
  appId: GeneratedAppId
  name: string
  emoji: string
  themeColor: string
  progress?: number
  textLength?: number
  itemId: DesktopItemId
  globalIndex: number
  mergeTarget?: boolean
  didSwipeRef: { current: boolean }
  reorder: DesktopReorderController
  internalProjects: readonly ICodeInternalProject[]
}

function GeneratedDesktopIcon({
  appId,
  name,
  emoji,
  themeColor,
  progress,
  textLength,
  itemId,
  globalIndex,
  didSwipeRef,
  reorder,
  internalProjects,
}: GeneratedDesktopIconProps) {
  const { openInstalledApp, openMarketplaceDetail, openIcodeProject, uninstallApp, getInstalledApp } = useGeneratedApps()
  const { showIconContextMenu } = useIconContextMenu()
  const { isPinnedToDock, pinToDock, unpinFromDock } = useLauncherLayout()
  const [uninstallConfirmOpen, setUninstallConfirmOpen] = useState(false)
  const downloading = progress !== undefined && progress < 100
  const slug = generatedAppIdToSlug(appId)
  const installedApp = getInstalledApp(appId)
  const icodeProjectId = installedApp
    ? resolveIcodeProjectId(installedApp, internalProjects)
    : undefined
  const canUninstall = !downloading

  const handleOpen = () => {
    openInstalledApp(appId)
  }

  const pinned = isPinnedToDock(appId)

  const { onClick, onPointerDown } = useDesktopIconReorder({
    itemId,
    globalIndex,
    disabled: downloading,
    didSwipeRef,
    reorderingEnabled: reorder.reorderingEnabled,
    onOpen: handleOpen,
    onReorderStart: reorder.onReorderStart,
    onReorderMove: reorder.onReorderMove,
    onReorderEnd: reorder.onReorderEnd,
  })

  const handleConfirmUninstall = () => {
    uninstallApp(appId)
    setUninstallConfirmOpen(false)
  }

  return (
    <>
      <button
        type="button"
        class="desktop-icon"
        disabled={downloading}
        onClick={onClick}
        onPointerDown={onPointerDown}
        onContextMenu={(event) => {
          showIconContextMenu(
            event,
            buildGeneratedIconContextMenuItems({
              onOpen: handleOpen,
              appSlug: slug,
              icodeProjectId,
              onViewInMarketplace: openMarketplaceDetail,
              onViewInIcode: openIcodeProject,
              onUninstall: canUninstall ? () => setUninstallConfirmOpen(true) : undefined,
              openDisabled: downloading,
              isPinnedToDock: pinned,
              onPinToDock: () => pinToDock(appId),
              onUnpinFromDock: () => unpinFromDock(appId),
            }),
          )
        }}
      >
        <span class="desktop-icon__image">
          <GeneratedAppIcon
            emoji={emoji}
            themeColor={themeColor}
            size={72}
            progress={progress}
            textLength={textLength}
          />
        </span>
        <span class="desktop-icon__label">{name}</span>
      </button>

      {uninstallConfirmOpen && (
        <AppUninstallConfirmSheet
          appName={name}
          onCancel={() => setUninstallConfirmOpen(false)}
          onConfirm={handleConfirmUninstall}
        />
      )}
    </>
  )
}

type ExtDesktopIconProps = {
  appId: ExtAppId
  name: string
  themeColor: string
  iconUrl: string
  itemId: DesktopItemId
  globalIndex: number
  mergeTarget?: boolean
  didSwipeRef: { current: boolean }
  reorder: DesktopReorderController
}

function ExtDesktopIcon({
  appId,
  name,
  themeColor,
  iconUrl,
  itemId,
  globalIndex,
  didSwipeRef,
  reorder,
}: ExtDesktopIconProps) {
  const { openSessionExtApp, removeSessionExtApp } = useDevExtApps()
  const { showIconContextMenu } = useIconContextMenu()
  const { isPinnedToDock, pinToDock, unpinFromDock } = useLauncherLayout()

  const handleOpen = () => {
    openSessionExtApp(appId)
  }

  const pinned = isPinnedToDock(appId)

  const { onClick, onPointerDown } = useDesktopIconReorder({
    itemId,
    globalIndex,
    didSwipeRef,
    reorderingEnabled: reorder.reorderingEnabled,
    onOpen: handleOpen,
    onReorderStart: reorder.onReorderStart,
    onReorderMove: reorder.onReorderMove,
    onReorderEnd: reorder.onReorderEnd,
  })

  return (
    <button
      type="button"
      class="desktop-icon"
      onClick={onClick}
      onPointerDown={onPointerDown}
      onContextMenu={(event) => {
        showIconContextMenu(event, [
          { type: 'action', label: '打开', onClick: handleOpen },
          { type: 'separator' },
          {
            type: 'action',
            label: pinned ? '从程序坞移除' : '添加到程序坞',
            onClick: pinned ? () => unpinFromDock(appId) : () => pinToDock(appId),
          },
          { type: 'separator' },
          {
            type: 'action',
            label: '从桌面移除',
            onClick: () => removeSessionExtApp(appId),
          },
        ])
      }}
    >
      <span class="desktop-icon__image">
        <ExtAppIcon name={name} themeColor={themeColor} iconUrl={iconUrl} size={72} devBadge />
      </span>
      <span class="desktop-icon__label">{name}</span>
    </button>
  )
}

type FolderDesktopIconProps = {
  entry: DesktopFolderEntry
  itemId: DesktopItemId
  globalIndex: number
  mergeTarget: boolean
  didSwipeRef: { current: boolean }
  reorder: DesktopReorderController
  onOpenFolder: (folderId: DesktopFolderId) => void
}

function FolderDesktopIcon({
  entry,
  itemId,
  globalIndex,
  mergeTarget,
  didSwipeRef,
  reorder,
  onOpenFolder,
}: FolderDesktopIconProps) {
  const { showIconContextMenu } = useIconContextMenu()
  const { dissolveDesktopFolder } = useLauncherLayout()

  const handleOpen = () => {
    onOpenFolder(entry.folderId)
  }

  const { onClick, onPointerDown } = useDesktopIconReorder({
    itemId,
    globalIndex,
    didSwipeRef,
    reorderingEnabled: reorder.reorderingEnabled,
    onOpen: handleOpen,
    onReorderStart: reorder.onReorderStart,
    onReorderMove: reorder.onReorderMove,
    onReorderEnd: reorder.onReorderEnd,
  })

  return (
    <button
      type="button"
      class="desktop-icon"
      onClick={onClick}
      onPointerDown={onPointerDown}
      onContextMenu={(event) => {
        showIconContextMenu(event, [
          { type: 'action', label: '打开', onClick: handleOpen },
          { type: 'separator' },
          {
            type: 'action',
            label: '解散文件夹',
            onClick: () => dissolveDesktopFolder(entry.folderId),
          },
        ])
      }}
    >
      <DesktopFolderIcon apps={entry.previewApps} mergeTarget={mergeTarget} />
      <span class="desktop-icon__label">{entry.name}</span>
    </button>
  )
}

function renderDesktopEntry(
  entry: DesktopEntry,
  itemId: DesktopItemId,
  globalIndex: number,
  mergeTarget: boolean,
  didSwipeRef: { current: boolean },
  reorder: DesktopReorderController,
  onOpenFolder: (folderId: DesktopFolderId) => void,
  internalProjects: readonly ICodeInternalProject[],
) {
  if (entry.kind === 'folder') {
    return (
      <FolderDesktopIcon
        entry={entry}
        itemId={itemId}
        globalIndex={globalIndex}
        mergeTarget={mergeTarget}
        didSwipeRef={didSwipeRef}
        reorder={reorder}
        onOpenFolder={onOpenFolder}
      />
    )
  }

  if (entry.kind === 'builtin') {
    return (
      <DesktopIcon
        appId={entry.appId}
        name={entry.name}
        Icon={entry.Icon}
        badgeCount={entry.badgeCount}
        itemId={itemId}
        globalIndex={globalIndex}
        mergeTarget={mergeTarget}
        didSwipeRef={didSwipeRef}
        reorder={reorder}
      />
    )
  }

  if (entry.kind === 'ext') {
    return (
      <ExtDesktopIcon
        appId={entry.appId}
        name={entry.name}
        themeColor={entry.themeColor}
        iconUrl={entry.iconUrl}
        itemId={itemId}
        globalIndex={globalIndex}
        mergeTarget={mergeTarget}
        didSwipeRef={didSwipeRef}
        reorder={reorder}
      />
    )
  }

  return (
    <GeneratedDesktopIcon
      appId={entry.appId}
      name={entry.name}
      emoji={entry.emoji}
      themeColor={entry.themeColor}
      progress={entry.progress}
      textLength={entry.textLength}
      itemId={itemId}
      globalIndex={globalIndex}
      mergeTarget={mergeTarget}
      didSwipeRef={didSwipeRef}
      reorder={reorder}
      internalProjects={internalProjects}
    />
  )
}

function renderDragGhost(entry: DesktopEntry) {
  if (entry.kind === 'folder') {
    return (
      <>
        <DesktopFolderIcon apps={entry.previewApps} />
        <span class="desktop-icon__label">{entry.name}</span>
      </>
    )
  }

  if (entry.kind === 'builtin') {
    return (
      <>
        <span class="desktop-icon__image">
          <entry.Icon size={72} />
          {entry.badgeCount !== undefined && (
            <AppIconNotificationBadge count={entry.badgeCount} />
          )}
        </span>
        <span class="desktop-icon__label">{entry.name}</span>
      </>
    )
  }

  if (entry.kind === 'ext') {
    return (
      <>
        <span class="desktop-icon__image">
          <ExtAppIcon
            name={entry.name}
            themeColor={entry.themeColor}
            iconUrl={entry.iconUrl}
            size={72}
            devBadge
          />
        </span>
        <span class="desktop-icon__label">{entry.name}</span>
      </>
    )
  }

  return (
    <>
      <span class="desktop-icon__image">
        <GeneratedAppIcon
          emoji={entry.emoji}
          themeColor={entry.themeColor}
          size={72}
          progress={entry.progress}
          textLength={entry.textLength}
        />
      </span>
      <span class="desktop-icon__label">{entry.name}</span>
    </>
  )
}

export function Desktop() {
  const { windows, activeWindowId, desktopRevealed, toggleDesktopReveal, hideDesktopReveal } =
    useOs()
  const { enterFlip3d, flip3dActive, flip3dRestoring } = useFlip3dScene()
  const internalProjects = useInternalProjects()
  const { installedApps, pendingInstalls, pendingUpdateCount } = useGeneratedApps()
  const { sessionExtApps } = useDevExtApps()
  const {
    pinnedDockItemIds,
    desktopIconOrder,
    desktopFolders,
    updateDesktopIconOrder,
    syncDesktopLayout,
    mergeDesktopItems: mergeItems,
    moveAppOutOfFolder: moveAppOutOfFolderAction,
    pinToDockAtIndex,
  } = useLauncherLayout()
  const pagerRef = useRef<HTMLDivElement>(null)
  const gridRef = useRef<HTMLDivElement>(null)
  const [pagerSize, setPagerSize] = useState({ width: 0, height: 0 })
  const [openFolderId, setOpenFolderId] = useState<DesktopFolderId | undefined>(undefined)
  const [appSearchOpen, setAppSearchOpen] = useState(false)
  const [appSearchQuery, setAppSearchQuery] = useState('')

  const closeAppSearch = useCallback(() => {
    setAppSearchOpen(false)
    setAppSearchQuery('')
  }, [])

  useEffect(() => {
    registerCloseOpenDesktopFolder(() => setOpenFolderId(undefined))
    registerOpenDesktopFolder((folderId) => setOpenFolderId(folderId))
    return () => {
      registerCloseOpenDesktopFolder(undefined)
      registerOpenDesktopFolder(undefined)
    }
  }, [])

  useEffect(() => {
    setOpenDesktopFolderId(openFolderId)
  }, [openFolderId])
  const [reorderSession, setReorderSession] = useState<
    | {
        itemId: DesktopItemId
        pointerX: number
        pointerY: number
        grabOffsetX: number
        grabOffsetY: number
        hoverIndex: number
      }
    | undefined
  >(undefined)
  const [previewOrder, setPreviewOrder] = useState<DesktopItemId[] | undefined>(undefined)
  const [mergeTargetId, setMergeTargetId] = useState<DesktopItemId | undefined>(undefined)
  const previewOrderRef = useRef<DesktopItemId[] | undefined>(undefined)
  const mergeTargetRef = useRef<DesktopItemId | undefined>(undefined)
  const draggingItemIdRef = useRef<DesktopItemId | undefined>(undefined)
  const lastDragPointerRef = useRef({ x: 0, y: 0 })
  const reorderPlacementPageRef = useRef(0)

  const [, setExperimentalSettingsVersion] = useState(0)

  useEffect(() => {
    const handleChange = () => setExperimentalSettingsVersion((v) => v + 1)
    window.addEventListener(EXPERIMENTAL_SETTINGS_CHANGED_EVENT, handleChange)
    return () => window.removeEventListener(EXPERIMENTAL_SETTINGS_CHANGED_EVENT, handleChange)
  }, [])

  useEffect(() => {
    void warmFolderMiniIconSnapshotCache()
  }, [])

  const desktopApps = APP_REGISTRY.filter(
    (app) => isBuiltinAppVisibleOnDesktop(app, loadExperimentalSettings()),
  )
  const installedDesktopApps = installedApps.filter(
    (app) => !pendingInstalls.some((item) => item.id === app.id),
  )

  const appEntries = useMemo((): DesktopAppEntry[] => {
    return [
      ...desktopApps.map(
        (app): DesktopAppEntry => ({
          kind: 'builtin',
          appId: app.id,
          name: app.name,
          Icon: app.icon,
          badgeCount: app.id === 'appstore' ? pendingUpdateCount : 0,
        }),
      ),
      ...installedDesktopApps.map(
        (app): DesktopAppEntry => ({
          kind: 'generated',
          appId: app.id,
          name: app.name,
          emoji: app.iconEmoji,
          themeColor: app.themeColor,
        }),
      ),
      ...pendingInstalls.map(
        (item): DesktopAppEntry => ({
          kind: 'generated',
          appId: item.id,
          name: item.listing.name,
          emoji: item.listing.iconEmoji,
          themeColor: item.listing.themeColor,
          progress: item.progress,
          textLength: item.textLength,
        }),
      ),
      ...sessionExtApps.map(
        (app): DesktopAppEntry => ({
          kind: 'ext',
          appId: app.id,
          name: app.manifest.name,
          themeColor: app.manifest.themeColor,
          iconUrl: app.iconUrl,
        }),
      ),
    ]
  }, [desktopApps, installedDesktopApps, pendingInstalls, pendingUpdateCount, sessionExtApps])

  const persistableVisibleAppIds = useMemo(
    () =>
      appEntries
        .filter((entry) => entry.kind !== 'ext')
        .map((entry) => entry.appId),
    [appEntries],
  )

  const sessionExtAppIds = useMemo(
    () => sessionExtApps.map((app) => app.id),
    [sessionExtApps],
  )

  const appEntryById = useMemo(() => {
    const map = new Map<AppId, DesktopAppEntry>()
    for (const entry of appEntries) {
      map.set(entry.appId, entry)
    }
    return map
  }, [appEntries])

  const folderBuiltinMap = useMemo(() => {
    const map = new Map<BuiltinAppId, FolderAppEntry>()
    for (const app of desktopApps) {
      map.set(app.id, {
        kind: 'builtin',
        appId: app.id,
        name: app.name,
        Icon: app.icon,
        badgeCount: app.id === 'appstore' ? pendingUpdateCount : 0,
      })
    }
    return map
  }, [desktopApps, pendingUpdateCount])

  const folderGeneratedMap = useMemo(() => {
    const map = new Map<GeneratedAppId, FolderAppEntry>()
    for (const app of installedDesktopApps) {
      map.set(app.id, {
        kind: 'generated',
        appId: app.id,
        name: app.name,
        emoji: app.iconEmoji,
        themeColor: app.themeColor,
      })
    }
    return map
  }, [installedDesktopApps])

  const folderAppEntryById = useMemo(() => {
    const map = new Map<AppId, FolderAppEntry>()
    for (const [, entry] of folderBuiltinMap) {
      map.set(entry.appId, entry)
    }
    for (const [, entry] of folderGeneratedMap) {
      map.set(entry.appId, entry)
    }
    return map
  }, [folderBuiltinMap, folderGeneratedMap])

  const buildPreviewApps = useCallback(
    (appIds: AppId[]): FolderPreviewApp[] => {
      const previews: FolderPreviewApp[] = []
      for (const appId of appIds) {
        const entry = appEntryById.get(appId)
        if (!entry) {
          continue
        }
        if (entry.kind === 'builtin') {
          previews.push({ appId: entry.appId, kind: 'builtin', Icon: entry.Icon })
        } else if (entry.kind === 'generated') {
          previews.push({
            appId: entry.appId,
            kind: 'generated',
            emoji: entry.emoji,
            themeColor: entry.themeColor,
          })
        }
      }
      return previews
    },
    [appEntryById],
  )

  const orderedItemIds = useMemo(() => {
    const base = reconcileDesktopIconOrder(desktopIconOrder, persistableVisibleAppIds, desktopFolders)
    const trailingExtIds = sessionExtAppIds.filter((appId) => !base.includes(appId))
    return [...base, ...trailingExtIds]
  }, [desktopIconOrder, desktopFolders, persistableVisibleAppIds, sessionExtAppIds])

  useEffect(() => {
    if (reorderSession !== undefined) {
      return
    }

    const reconciledFolders = reconcileDesktopFolders(desktopFolders, persistableVisibleAppIds)
    const reconciledOrder = reconcileDesktopIconOrder(
      desktopIconOrder,
      persistableVisibleAppIds,
      reconciledFolders,
    )

    const foldersChanged =
      JSON.stringify(reconciledFolders) !== JSON.stringify(desktopFolders)
    const orderChanged = reconciledOrder.join('|') !== desktopIconOrder.join('|')

    if (foldersChanged || orderChanged) {
      syncDesktopLayout(reconciledOrder, reconciledFolders)
    }
  }, [
    desktopFolders,
    desktopIconOrder,
    reorderSession,
    syncDesktopLayout,
    persistableVisibleAppIds,
  ])

  const displayOrder = previewOrder ?? orderedItemIds

  const entryByItemId = useMemo(() => {
    const map = new Map<DesktopItemId, DesktopEntry>()
    for (const itemId of displayOrder) {
      if (isDesktopFolderId(itemId)) {
        const folder = findFolderById(desktopFolders, itemId)
        if (folder) {
          map.set(itemId, {
            kind: 'folder',
            folderId: folder.id,
            name: folder.name,
            previewApps: buildPreviewApps(folder.appIds),
          })
        }
        continue
      }

      const appEntry = appEntryById.get(itemId)
      if (appEntry) {
        map.set(itemId, appEntry)
      }
    }
    return map
  }, [appEntryById, buildPreviewApps, desktopFolders, displayOrder])

  const openFolder = openFolderId ? findFolderById(desktopFolders, openFolderId) : undefined
  const openFolderApps = useMemo((): FolderAppEntry[] => {
    if (!openFolder) {
      return []
    }
    const apps: FolderAppEntry[] = []
    for (const appId of openFolder.appIds) {
      const entry = resolveFolderAppEntry(appId, folderAppEntryById)
      if (entry) {
        apps.push(entry)
      }
    }
    return apps
  }, [folderAppEntryById, openFolder])

  const gridMetrics = useMemo(
    () => computeDesktopGridMetrics(pagerSize.width, pagerSize.height),
    [pagerSize.width, pagerSize.height],
  )

  const gridPixelSize = useMemo(
    () => computeDesktopGridPixelSize(gridMetrics.cols, gridMetrics.rows),
    [gridMetrics.cols, gridMetrics.rows],
  )

  const pageCount = useMemo(
    () => chunkDesktopPages(displayOrder, gridMetrics.iconsPerPage).length,
    [displayOrder, gridMetrics.iconsPerPage],
  )

  const onDesktopEmptyTap = useCallback(
    (event: PointerEvent) => {
      const target = event.target as HTMLElement
      if (target.closest('.desktop-icon') || target.closest('.desktop__page-dot')) {
        return
      }
      runDesktopClickAction({
        enterFlip3d,
        toggleDesktopReveal,
        hideDesktopReveal,
        desktopRevealed,
      })
    },
    [desktopRevealed, enterFlip3d, hideDesktopReveal, toggleDesktopReveal],
  )

  const onDesktopEmptyHold = useCallback(() => {
    runDesktopHoldAction({
      enterFlip3d,
      toggleDesktopReveal,
      hideDesktopReveal,
      desktopRevealed,
    })
  }, [desktopRevealed, enterFlip3d, hideDesktopReveal, toggleDesktopReveal])

  const hasFrontmostWindow = windows.some(
    (window) => window.id === activeWindowId && !window.minimized,
  )
  const keyboardPageNavEnabled =
    openFolderId === undefined && (desktopRevealed || !hasFrontmostWindow)
  const desktopSearchArmed =
    keyboardPageNavEnabled && !flip3dActive && !flip3dRestoring && reorderSession === undefined
  const wheelPageNavEnabled = openFolderId === undefined && !flip3dActive && !flip3dRestoring

  useEffect(() => {
    if (desktopSearchArmed) {
      return
    }
    setAppSearchOpen(false)
    setAppSearchQuery('')
  }, [desktopSearchArmed])

  useEffect(() => {
    if (!desktopSearchArmed || appSearchOpen) {
      return
    }

    const onKeyDown = (event: KeyboardEvent) => {
      if (event.defaultPrevented || isDesktopAppSearchBlockedTarget(event.target)) {
        return
      }
      if (!isDesktopAppSearchTriggerKey(event)) {
        return
      }
      const seed = desktopAppSearchSeedFromKey(event)
      if (seed) {
        event.preventDefault()
      }
      setAppSearchQuery(seed)
      setAppSearchOpen(true)
    }

    const onCompositionStart = (event: CompositionEvent) => {
      if (isDesktopAppSearchBlockedTarget(event.target)) {
        return
      }
      setAppSearchOpen(true)
    }

    window.addEventListener('keydown', onKeyDown)
    window.addEventListener('compositionstart', onCompositionStart)
    return () => {
      window.removeEventListener('keydown', onKeyDown)
      window.removeEventListener('compositionstart', onCompositionStart)
    }
  }, [appSearchOpen, desktopSearchArmed])

  const {
    currentPage,
    goToPage,
    didSwipeRef,
    translateX,
    animating,
    cancelInteraction: cancelPageInteraction,
    pagePagerHandlers,
  } = useDesktopPagePager(
    pageCount,
    pagerSize.width,
    reorderSession === undefined,
    onDesktopEmptyTap,
    keyboardPageNavEnabled && !appSearchOpen,
    wheelPageNavEnabled,
    onDesktopEmptyHold,
  )

  const onReorderStart = useCallback(
    (
      itemId: DesktopItemId,
      globalIndex: number,
      clientX: number,
      clientY: number,
      grabOffsetX: number,
      grabOffsetY: number,
    ) => {
      cancelPageInteraction()
      reorderPlacementPageRef.current = currentPage
      previewOrderRef.current = orderedItemIds
      mergeTargetRef.current = undefined
      draggingItemIdRef.current = itemId
      lastDragPointerRef.current = { x: clientX, y: clientY }
      setMergeTargetId(undefined)
      setPreviewOrder(orderedItemIds)
      setReorderSession({
        itemId,
        pointerX: clientX,
        pointerY: clientY,
        grabOffsetX,
        grabOffsetY,
        hoverIndex: globalIndex,
      })
    },
    [cancelPageInteraction, currentPage, orderedItemIds],
  )

  const onReorderMove = useCallback(
    (clientX: number, clientY: number) => {
      const dockTarget = resolveDockDropTarget(clientX, clientY)
      if (dockTarget.overDock) {
        setDockDropSession({ active: true, insertIndex: dockTarget.insertIndex })
        mergeTargetRef.current = undefined
        setMergeTargetId(undefined)
        lastDragPointerRef.current = { x: clientX, y: clientY }
        setReorderSession((session) => {
          if (!session) {
            return session
          }
          return {
            ...session,
            pointerX: clientX,
            pointerY: clientY,
          }
        })
        return
      }

      clearDockDropSession()

      const pager = pagerRef.current
      if (!pager) {
        return
      }

      const { globalIndex: hoverIndex, targetPage } = resolvePointerIconTarget(
        clientX,
        clientY,
        pager,
        reorderPlacementPageRef.current,
        pageCount,
        gridMetrics,
        gridPixelSize,
        orderedItemIds.length,
      )

      if (targetPage !== reorderPlacementPageRef.current) {
        reorderPlacementPageRef.current = targetPage
        goToPage(targetPage)
      }

      const draggingItemId = draggingItemIdRef.current
      if (!draggingItemId) {
        return
      }

      lastDragPointerRef.current = { x: clientX, y: clientY }

      const currentOrder = previewOrderRef.current ?? orderedItemIds
      const mergeTarget = resolveMergeTargetItem(
        clientX,
        clientY,
        pager,
        reorderPlacementPageRef.current,
        pagerSize.width,
        gridMetrics,
        gridPixelSize,
        currentOrder,
        draggingItemId,
      )

      mergeTargetRef.current = mergeTarget
      setMergeTargetId(mergeTarget)

      setReorderSession((session) => {
        if (!session) {
          return session
        }

        const base = previewOrderRef.current ?? orderedItemIds
        const nextPreview = buildPreviewOrder(base, session.itemId, hoverIndex)
        previewOrderRef.current = nextPreview
        setPreviewOrder(nextPreview)

        return {
          ...session,
          pointerX: clientX,
          pointerY: clientY,
          hoverIndex,
        }
      })
    },
    [
      goToPage,
      gridMetrics,
      gridPixelSize,
      orderedItemIds,
      pageCount,
      pagerSize.width,
    ],
  )

  const onReorderEnd = useCallback(() => {
    const mergeTarget = mergeTargetRef.current
    const draggedId = draggingItemIdRef.current
    const dockTarget = resolveDockDropTarget(
      lastDragPointerRef.current.x,
      lastDragPointerRef.current.y,
    )

    if (dockTarget.overDock && draggedId) {
      pinToDockAtIndex(draggedId, dockTarget.insertIndex)
    } else if (mergeTarget && draggedId && mergeTarget !== draggedId) {
      mergeItems(draggedId, mergeTarget, previewOrderRef.current)
    } else {
      const finalOrder = previewOrderRef.current
      if (finalOrder) {
        updateDesktopIconOrder(finalOrder)
      }
    }

    clearDockDropSession()
    previewOrderRef.current = undefined
    mergeTargetRef.current = undefined
    draggingItemIdRef.current = undefined
    setMergeTargetId(undefined)
    setPreviewOrder(undefined)
    setReorderSession(undefined)
    reorderPlacementPageRef.current = 0
    cancelPageInteraction()
  }, [cancelPageInteraction, mergeItems, pinToDockAtIndex, updateDesktopIconOrder])

  const onDragOutToDesktop = useCallback(
    (
      appId: AppId,
      clientX: number,
      clientY: number,
      grabOffsetX: number,
      grabOffsetY: number,
    ) => {
      if (!openFolderId) {
        return
      }

      const nextLayout = moveAppOutOfFolder(
        {
          pinnedDockItemIds,
          desktopIconOrder: orderedItemIds,
          desktopFolders,
        },
        openFolderId,
        appId,
      )
      const nextOrder = nextLayout.desktopIconOrder
      const globalIndex = nextOrder.indexOf(appId)
      if (globalIndex < 0) {
        return
      }

      moveAppOutOfFolderAction(openFolderId, appId)
      setOpenFolderId(undefined)
      cancelPageInteraction()

      const targetPage = Math.floor(globalIndex / gridMetrics.iconsPerPage)
      reorderPlacementPageRef.current = targetPage
      if (targetPage !== currentPage) {
        goToPage(targetPage)
      }

      previewOrderRef.current = nextOrder
      mergeTargetRef.current = undefined
      draggingItemIdRef.current = appId
      setMergeTargetId(undefined)
      setPreviewOrder(nextOrder)
      setReorderSession({
        itemId: appId,
        pointerX: clientX,
        pointerY: clientY,
        grabOffsetX,
        grabOffsetY,
        hoverIndex: globalIndex,
      })
    },
    [
      cancelPageInteraction,
      currentPage,
      desktopFolders,
      goToPage,
      gridMetrics.iconsPerPage,
      moveAppOutOfFolderAction,
      openFolderId,
      orderedItemIds,
      pinnedDockItemIds,
    ],
  )

  const reorderController = useMemo(
    (): DesktopReorderController => ({
      reorderingEnabled: reorderSession !== undefined,
      draggingItemId: reorderSession?.itemId,
      mergeTargetId,
      onReorderStart,
      onReorderMove,
      onReorderEnd,
    }),
    [mergeTargetId, onReorderEnd, onReorderMove, onReorderStart, reorderSession],
  )

  const draggingEntry = reorderSession
    ? entryByItemId.get(reorderSession.itemId)
    : undefined

  useLayoutEffect(() => {
    const pager = pagerRef.current
    if (!pager) {
      return
    }

    let frameId: number | undefined

    const updateSize = () => {
      if (frameId !== undefined) {
        return
      }
      frameId = requestAnimationFrame(() => {
        frameId = undefined
        const width = pager.clientWidth
        const height = pager.clientHeight
        setPagerSize((prev) =>
          prev.width === width && prev.height === height
            ? prev
            : { width, height },
        )
      })
    }

    updateSize()
    const observer = new ResizeObserver(updateSize)
    observer.observe(pager)
    return () => {
      if (frameId !== undefined) {
        cancelAnimationFrame(frameId)
      }
      observer.disconnect()
    }
  }, [])

  const layoutReady = pagerSize.width > 0 && pagerSize.height > 0

  const pagesWidth = pageCount * pagerSize.width

  return (
    <section
      class={`desktop${reorderSession ? ' desktop--reordering' : ''}${layoutReady ? '' : ' desktop--measuring'}${flip3dActive ? ' desktop--hidden' : ''}`}
      aria-label="桌面"
    >
      <div
        class="desktop__pager"
        ref={pagerRef}
        onPointerDown={pagePagerHandlers.onPointerDown}
        onPointerMove={pagePagerHandlers.onPointerMove}
        onPointerUp={pagePagerHandlers.onPointerUp}
        onPointerCancel={pagePagerHandlers.onPointerCancel}
      >
        <div
          class={`desktop__pages${animating ? ' desktop__pages--animating' : ''}`}
          style={{
            width: `${pagesWidth}px`,
            transform: `translate3d(${translateX}px, 0, 0)`,
          }}
        >
          {Array.from({ length: pageCount }, (_, pageIndex) => {
            const pageItemIds = getPageSlice(displayOrder, pageIndex, gridMetrics.iconsPerPage)

            return (
              <div
                key={`page-${pageIndex}`}
                class="desktop__page"
                style={{ width: `${pagerSize.width}px` }}
              >
                <div class="desktop__page-center">
                  <div
                    ref={pageIndex === currentPage ? gridRef : undefined}
                    class="desktop__grid"
                    style={{
                      width: `${gridPixelSize.width}px`,
                      height: `${gridPixelSize.height}px`,
                    }}
                  >
                    {pageItemIds.map((itemId, slotOnPage) => {
                      const entry = entryByItemId.get(itemId)
                      if (!entry) {
                        return undefined
                      }

                      const isDragging = reorderSession?.itemId === itemId
                      const isMergeTarget =
                        mergeTargetId === itemId && reorderSession?.itemId !== itemId
                      const slotPosition = getIconSlotPosition(slotOnPage, gridMetrics.cols)
                      const globalIndex = displayOrder.indexOf(itemId)

                      return (
                        <div
                          key={itemId}
                          class={`desktop-icon-wrap${isDragging ? ' desktop-icon-wrap--source' : ''}${isMergeTarget ? ' desktop-icon-wrap--merge-target' : ''}`}
                          style={{
                            '--wiggle-index': `${slotOnPage}`,
                            transform: `translate3d(${slotPosition.left}px, ${slotPosition.top}px, 0)`,
                          }}
                        >
                          {!isDragging &&
                            renderDesktopEntry(
                              entry,
                              itemId,
                              globalIndex,
                              isMergeTarget,
                              didSwipeRef,
                              reorderController,
                              setOpenFolderId,
                              internalProjects,
                            )}
                        </div>
                      )
                    })}
                  </div>
                </div>
              </div>
            )
          })}
        </div>
      </div>

      {reorderSession && draggingEntry && (
        <div
          class="desktop__drag-ghost"
          style={{
            left: `${reorderSession.pointerX - reorderSession.grabOffsetX}px`,
            top: `${reorderSession.pointerY - reorderSession.grabOffsetY}px`,
            transformOrigin: `${reorderSession.grabOffsetX}px ${reorderSession.grabOffsetY}px`,
          }}
        >
          {renderDragGhost(draggingEntry)}
        </div>
      )}

      <DesktopFolderOverlay
        open={openFolderId !== undefined}
        folderId={openFolder?.id}
        folderName={openFolder?.name ?? ''}
        apps={openFolderApps}
        onClose={() => setOpenFolderId(undefined)}
        onDragOutToDesktop={onDragOutToDesktop}
        onContinueDragOnDesktop={onReorderMove}
        onFinishDragOnDesktop={onReorderEnd}
      />

      <DesktopAppSearchOverlay
        open={appSearchOpen}
        query={appSearchQuery}
        onQueryChange={setAppSearchQuery}
        onClose={closeAppSearch}
      />

      {pageCount > 1 && (
        <div class="desktop__page-dots" role="tablist" aria-label="桌面分页">
          {Array.from({ length: pageCount }, (_, pageIndex) => (
            <button
              key={`dot-${pageIndex}`}
              type="button"
              class={`desktop__page-dot${pageIndex === currentPage ? ' desktop__page-dot--active' : ''}`}
              role="tab"
              aria-selected={pageIndex === currentPage}
              aria-label={`第 ${pageIndex + 1} 页`}
              onClick={() => goToPage(pageIndex)}
            />
          ))}
        </div>
      )}
    </section>
  )
}
