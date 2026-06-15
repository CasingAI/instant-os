import type { ComponentType } from 'preact'
import { useCallback, useEffect, useMemo, useRef, useState } from 'preact/hooks'
import { generatedAppIdToSlug } from '../apps/appstore/store-agent.ts'
import { resolveIcodeProjectId } from '../apps/icode/icode-publish.ts'
import { GeneratedAppIcon } from '../apps/generated/generated-app-icon.tsx'
import {
  buildBuiltinIconContextMenuItems,
  buildGeneratedIconContextMenuItems,
} from '../os/build-icon-context-menu-items.ts'
import type { DesktopFolderId } from '../os/desktop-folder-types.ts'
import { useGeneratedApps } from '../os/generated-apps-context.tsx'
import { useIconContextMenu } from '../os/icon-context-menu-context.tsx'
import { useLauncherLayout } from '../os/launcher-layout-context.tsx'
import { isPermanentlyPinnedToDock } from '../os/launcher-layout-storage.ts'
import { useOs } from '../os/os-context.tsx'
import type { AppId, BuiltinAppId, GeneratedAppId } from '../os/types.ts'
import { useOverlayPresence } from '../ui/use-overlay-presence.ts'
import {
  buildFolderPreviewOrder,
  isPointerOutsideElement,
  resolveFolderGridHoverIndex,
} from './folder-overlay-grid-layout.ts'
import { useDesktopIconReorder } from './use-desktop-icon-reorder.ts'
import './desktop-folder-overlay.css'

const FOLDER_OVERLAY_EXIT_MS = 280

type FolderBuiltinApp = {
  kind: 'builtin'
  appId: BuiltinAppId
  name: string
  Icon: ComponentType<{ size?: number }>
  badgeCount?: number
}

type FolderGeneratedApp = {
  kind: 'generated'
  appId: GeneratedAppId
  name: string
  emoji: string
  themeColor: string
}

export type FolderAppEntry = FolderBuiltinApp | FolderGeneratedApp

type DesktopFolderOverlayProps = {
  open: boolean
  folderId: DesktopFolderId | undefined
  folderName: string
  apps: FolderAppEntry[]
  onClose: () => void
  onDragOutToDesktop: (
    appId: AppId,
    clientX: number,
    clientY: number,
    grabOffsetX: number,
    grabOffsetY: number,
  ) => void
  onContinueDragOnDesktop: (clientX: number, clientY: number) => void
  onFinishDragOnDesktop: () => void
}

type FolderReorderSession = {
  appId: AppId
  pointerX: number
  pointerY: number
  grabOffsetX: number
  grabOffsetY: number
  hoverIndex: number
}

type FolderReorderController = {
  reorderingEnabled: boolean
  draggingAppId: AppId | undefined
  onReorderStart: (
    appId: AppId,
    index: number,
    clientX: number,
    clientY: number,
    grabOffsetX: number,
    grabOffsetY: number,
  ) => void
  onReorderMove: (clientX: number, clientY: number) => void
  onReorderEnd: () => void
}

export function DesktopFolderOverlay({
  open,
  folderId,
  folderName,
  apps,
  onClose,
  onDragOutToDesktop,
  onContinueDragOnDesktop,
  onFinishDragOnDesktop,
}: DesktopFolderOverlayProps) {
  const { renameDesktopFolder, updateFolderAppOrder, moveAppOutOfFolder } = useLauncherLayout()
  const { mounted, exiting } = useOverlayPresence(open, FOLDER_OVERLAY_EXIT_MS)
  const snapshotRef = useRef({ folderId, folderName, apps })
  const overlayPanelRef = useRef<HTMLDivElement>(null)
  const gridRef = useRef<HTMLDivElement>(null)
  const previewAppIdsRef = useRef<AppId[] | undefined>(undefined)
  const reorderSessionRef = useRef<FolderReorderSession | undefined>(undefined)
  const draggedOutsideRef = useRef(false)
  const [handedOffToDesktop, setHandedOffToDesktop] = useState(false)
  const didSwipeRef = useRef(false)
  const titleInputRef = useRef<HTMLInputElement>(null)
  const [editingName, setEditingName] = useState(false)
  const [draftName, setDraftName] = useState(folderName)
  const [reorderSession, setReorderSession] = useState<FolderReorderSession | undefined>(undefined)
  const [previewAppIds, setPreviewAppIds] = useState<AppId[] | undefined>(undefined)

  if (open && folderId) {
    snapshotRef.current = { folderId, folderName, apps }
  }

  const snapshot = snapshotRef.current
  const activeFolderId = open && folderId ? folderId : snapshot.folderId
  const activeFolderName = open ? folderName : snapshot.folderName
  const liveApps = open ? apps : snapshot.apps

  const appEntryById = useMemo(() => {
    const map = new Map<AppId, FolderAppEntry>()
    for (const app of liveApps) {
      map.set(app.appId, app)
    }
    return map
  }, [liveApps])

  const baseAppIds = useMemo((): AppId[] => liveApps.map((app) => app.appId), [liveApps])
  const displayAppIds = previewAppIds ?? baseAppIds
  const displayApps = useMemo(
    () =>
      displayAppIds
        .map((appId) => appEntryById.get(appId))
        .filter((entry): entry is FolderAppEntry => entry !== undefined),
    [appEntryById, displayAppIds],
  )

  const draggingEntry = reorderSession ? appEntryById.get(reorderSession.appId) : undefined

  useEffect(() => {
    setDraftName(activeFolderName)
  }, [activeFolderName])

  useEffect(() => {
    if (editingName) {
      titleInputRef.current?.focus()
      titleInputRef.current?.select()
    }
  }, [editingName])

  useEffect(() => {
    if (!open) {
      if (!draggedOutsideRef.current) {
        setHandedOffToDesktop(false)
      }
      setReorderSession(undefined)
      setPreviewAppIds(undefined)
      previewAppIdsRef.current = undefined
      reorderSessionRef.current = undefined
    }
  }, [open])

  useEffect(() => {
    reorderSessionRef.current = reorderSession
  }, [reorderSession])

  const commitRename = useCallback(() => {
    if (!activeFolderId) {
      return
    }
    const trimmed = draftName.trim()
    if (trimmed && trimmed !== activeFolderName) {
      renameDesktopFolder(activeFolderId, trimmed)
    } else {
      setDraftName(activeFolderName)
    }
    setEditingName(false)
  }, [activeFolderId, activeFolderName, draftName, renameDesktopFolder])

  const onReorderStart = useCallback(
    (
      appId: AppId,
      index: number,
      clientX: number,
      clientY: number,
      grabOffsetX: number,
      grabOffsetY: number,
    ) => {
      draggedOutsideRef.current = false
      previewAppIdsRef.current = baseAppIds
      setPreviewAppIds(baseAppIds)
      setReorderSession({
        appId,
        pointerX: clientX,
        pointerY: clientY,
        grabOffsetX,
        grabOffsetY,
        hoverIndex: index,
      })
      reorderSessionRef.current = {
        appId,
        pointerX: clientX,
        pointerY: clientY,
        grabOffsetX,
        grabOffsetY,
        hoverIndex: index,
      }
    },
    [baseAppIds],
  )

  const onReorderMove = useCallback(
    (clientX: number, clientY: number) => {
      if (draggedOutsideRef.current) {
        onContinueDragOnDesktop(clientX, clientY)
        return
      }

      const session = reorderSessionRef.current
      const panel = overlayPanelRef.current
      if (!session) {
        return
      }

      if (panel && isPointerOutsideElement(clientX, clientY, panel)) {
        draggedOutsideRef.current = true
        setHandedOffToDesktop(true)
        onDragOutToDesktop(
          session.appId,
          clientX,
          clientY,
          session.grabOffsetX,
          session.grabOffsetY,
        )
        onContinueDragOnDesktop(clientX, clientY)
        previewAppIdsRef.current = undefined
        reorderSessionRef.current = undefined
        setPreviewAppIds(undefined)
        setReorderSession(undefined)
        return
      }

      const grid = gridRef.current
      if (!grid) {
        return
      }

      const hoverIndex = resolveFolderGridHoverIndex(
        clientX,
        clientY,
        grid,
        baseAppIds.length,
      )
      const base = previewAppIdsRef.current ?? baseAppIds
      const nextPreview = buildFolderPreviewOrder(base, session.appId, hoverIndex)
      previewAppIdsRef.current = nextPreview
      setPreviewAppIds(nextPreview)

      const nextSession = {
        ...session,
        pointerX: clientX,
        pointerY: clientY,
        hoverIndex,
      }
      reorderSessionRef.current = nextSession
      setReorderSession(nextSession)
    },
    [baseAppIds, onContinueDragOnDesktop, onDragOutToDesktop],
  )

  const onReorderEnd = useCallback(() => {
    if (draggedOutsideRef.current) {
      draggedOutsideRef.current = false
      setHandedOffToDesktop(false)
      onFinishDragOnDesktop()
      previewAppIdsRef.current = undefined
      reorderSessionRef.current = undefined
      setPreviewAppIds(undefined)
      setReorderSession(undefined)
      return
    }

    const session = reorderSessionRef.current
    const panel = overlayPanelRef.current

    if (!session || !activeFolderId) {
      previewAppIdsRef.current = undefined
      reorderSessionRef.current = undefined
      setPreviewAppIds(undefined)
      setReorderSession(undefined)
      return
    }

    if (panel && isPointerOutsideElement(session.pointerX, session.pointerY, panel)) {
      moveAppOutOfFolder(activeFolderId, session.appId)
      onClose()
    } else {
      const finalOrder = previewAppIdsRef.current ?? baseAppIds
      updateFolderAppOrder(activeFolderId, finalOrder)
    }

    previewAppIdsRef.current = undefined
    reorderSessionRef.current = undefined
    setPreviewAppIds(undefined)
    setReorderSession(undefined)
  }, [
    activeFolderId,
    baseAppIds,
    moveAppOutOfFolder,
    onClose,
    onFinishDragOnDesktop,
    updateFolderAppOrder,
  ])

  const reorderController = useMemo(
    (): FolderReorderController => ({
      reorderingEnabled: reorderSession !== undefined,
      draggingAppId: reorderSession?.appId,
      onReorderStart,
      onReorderMove,
      onReorderEnd,
    }),
    [onReorderEnd, onReorderMove, onReorderStart, reorderSession],
  )

  if (!mounted || !activeFolderId) {
    return undefined
  }

  return (
    <div
      class={[
        'desktop-folder-overlay-backdrop',
        handedOffToDesktop ? ' desktop-folder-overlay-backdrop--handed-off' : '',
        reorderSession ? ' desktop-folder-overlay-backdrop--reordering' : '',
        exiting ? 'desktop-folder-overlay-backdrop--exiting' : '',
      ]
        .filter(Boolean)
        .join(' ')}
      role="presentation"
      onClick={reorderSession ? undefined : onClose}
    >
      <div
        ref={overlayPanelRef}
        class={[
          'desktop-folder-overlay',
          reorderSession ? 'desktop-folder-overlay--reordering' : '',
          exiting ? 'desktop-folder-overlay--exiting' : '',
        ]
          .filter(Boolean)
          .join(' ')}
        role="dialog"
        aria-modal="true"
        aria-label={`文件夹：${activeFolderName}`}
        onClick={(event) => event.stopPropagation()}
      >
        <span class="desktop-folder-overlay__gloss" aria-hidden="true" />
        <span
          class="desktop-folder-overlay__edge desktop-folder-overlay__edge--top"
          aria-hidden="true"
        />

        <div class="desktop-folder-overlay__header">
          {editingName ? (
            <input
              ref={titleInputRef}
              class="desktop-folder-overlay__title-input"
              value={draftName}
              onInput={(event) => setDraftName((event.target as HTMLInputElement).value)}
              onBlur={commitRename}
              onKeyDown={(event) => {
                if (event.key === 'Enter') {
                  commitRename()
                }
                if (event.key === 'Escape') {
                  setDraftName(activeFolderName)
                  setEditingName(false)
                }
              }}
            />
          ) : (
            <h2
              class="desktop-folder-overlay__title"
              onDblClick={() => setEditingName(true)}
            >
              {activeFolderName}
            </h2>
          )}
        </div>

        <div class="desktop-folder-overlay__well">
          <div class="desktop-folder-overlay__scroll">
          <div ref={gridRef} class="desktop-folder-overlay__grid">
            {displayApps.map((app, index) => (
              <FolderAppIcon
                key={app.appId}
                app={app}
                folderId={activeFolderId}
                index={index}
                isDragging={reorderSession?.appId === app.appId}
                didSwipeRef={didSwipeRef}
                reorder={reorderController}
                onClose={onClose}
              />
            ))}
          </div>
          </div>
        </div>
      </div>

      {reorderSession && draggingEntry && (
        <div
          class="desktop-folder-overlay__drag-ghost"
          style={{
            left: `${reorderSession.pointerX - reorderSession.grabOffsetX}px`,
            top: `${reorderSession.pointerY - reorderSession.grabOffsetY}px`,
            transformOrigin: `${reorderSession.grabOffsetX}px ${reorderSession.grabOffsetY}px`,
          }}
        >
          <FolderAppIconPreview app={draggingEntry} />
        </div>
      )}
    </div>
  )
}

type FolderAppIconProps = {
  app: FolderAppEntry
  folderId: DesktopFolderId
  index: number
  isDragging: boolean
  didSwipeRef: { current: boolean }
  reorder: FolderReorderController
  onClose: () => void
}

function FolderAppIcon({
  app,
  folderId,
  index,
  isDragging,
  didSwipeRef,
  reorder,
  onClose,
}: FolderAppIconProps) {
  const { openApp } = useOs()
  const { openInstalledApp, openMarketplaceDetail, openIcodeProject, getInstalledApp } = useGeneratedApps()
  const { showIconContextMenu } = useIconContextMenu()
  const { isPinnedToDock, pinToDock, unpinFromDock, moveAppOutOfFolder } = useLauncherLayout()

  const handleOpen = () => {
    if (app.kind === 'builtin') {
      openApp(app.appId)
    } else {
      openInstalledApp(app.appId)
    }
    onClose()
  }

  const pinned = isPinnedToDock(app.appId)

  const { onClick, onPointerDown } = useDesktopIconReorder({
    itemId: app.appId,
    globalIndex: index,
    didSwipeRef,
    reorderingEnabled: reorder.reorderingEnabled,
    onOpen: handleOpen,
    onReorderStart: (itemId, globalIndex, clientX, clientY, grabOffsetX, grabOffsetY) => {
      reorder.onReorderStart(
        itemId as AppId,
        globalIndex,
        clientX,
        clientY,
        grabOffsetX,
        grabOffsetY,
      )
    },
    onReorderMove: reorder.onReorderMove,
    onReorderEnd: reorder.onReorderEnd,
  })

  const handleContextMenu = (event: MouseEvent) => {
    const moveOut = () => moveAppOutOfFolder(folderId, app.appId)

    if (app.kind === 'builtin') {
      showIconContextMenu(
        event,
        [
          ...buildBuiltinIconContextMenuItems(handleOpen, {
            isPinnedToDock: pinned,
            onPinToDock: () => pinToDock(app.appId),
            onUnpinFromDock:
              pinned && !isPermanentlyPinnedToDock(app.appId)
                ? () => unpinFromDock(app.appId)
                : undefined,
          }),
          { type: 'separator' },
          { type: 'action', label: '移到桌面', onClick: moveOut },
        ],
      )
      return
    }

    const slug = generatedAppIdToSlug(app.appId)
    const installedApp = getInstalledApp(app.appId)
    const icodeProjectId = installedApp ? resolveIcodeProjectId(installedApp) : undefined
    showIconContextMenu(
      event,
      [
        ...buildGeneratedIconContextMenuItems({
          onOpen: handleOpen,
          appSlug: slug,
          icodeProjectId,
          onViewInMarketplace: openMarketplaceDetail,
          onViewInIcode: openIcodeProject,
          isPinnedToDock: pinned,
          onPinToDock: () => pinToDock(app.appId),
          onUnpinFromDock: () => unpinFromDock(app.appId),
        }),
        { type: 'separator' },
        { type: 'action', label: '移到桌面', onClick: moveOut },
      ],
    )
  }

  return (
    <button
      type="button"
      class={`desktop-folder-overlay__icon${isDragging ? ' desktop-folder-overlay__icon--source' : ''}`}
      style={{ '--folder-icon-index': `${index}` }}
      onClick={onClick}
      onPointerDown={onPointerDown}
      onContextMenu={handleContextMenu}
    >
      {!isDragging && <FolderAppIconPreview app={app} />}
    </button>
  )
}

function FolderAppIconPreview({ app }: { app: FolderAppEntry }) {
  return (
    <>
      <span class="desktop-folder-overlay__icon-image">
        {app.kind === 'builtin' ? (
          <app.Icon size={64} />
        ) : (
          <GeneratedAppIcon emoji={app.emoji} themeColor={app.themeColor} size={64} />
        )}
      </span>
      <span class="desktop-folder-overlay__icon-label">{app.name}</span>
    </>
  )
}

export function resolveFolderAppEntry(
  appId: AppId,
  entryByAppId: Map<AppId, FolderAppEntry>,
): FolderAppEntry | undefined {
  return entryByAppId.get(appId)
}
