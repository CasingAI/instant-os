import type { ComponentType } from 'preact'
import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'preact/hooks'
import { GeneratedAppIcon } from '../apps/generated/generated-app-icon.tsx'
import { generatedAppIdToSlug } from '../apps/appstore/store-agent.ts'
import { AppIconNotificationBadge } from '../icons/app-icon-notification-badge.tsx'
import { APP_REGISTRY } from '../os/app-registry.tsx'
import {
  buildBuiltinIconContextMenuItems,
  buildGeneratedIconContextMenuItems,
} from '../os/build-icon-context-menu-items.ts'
import { AppUninstallConfirmSheet } from '../os/app-uninstall-confirm-sheet.tsx'
import { useGeneratedApps } from '../os/generated-apps-context.tsx'
import { useIconContextMenu } from '../os/icon-context-menu-context.tsx'
import { useLauncherLayout } from '../os/launcher-layout-context.tsx'
import {
  isPermanentlyPinnedToDock,
  reconcileDesktopIconOrder,
} from '../os/launcher-layout-storage.ts'
import { isBuiltinAppVisibleOnDesktop } from '../os/launcher-app-visibility.ts'
import { useOs } from '../os/os-context.tsx'
import { useExperimentalSettings } from '../os/use-experimental-settings.ts'
import type { AppId, BuiltinAppId, GeneratedAppId } from '../os/types.ts'
import {
  buildPreviewOrder,
  getIconSlotPosition,
  getPageSlice,
} from './desktop-icon-layout.ts'
import {
  chunkDesktopPages,
  computeDesktopGridMetrics,
  computeDesktopGridPixelSize,
  pointerToGlobalIconIndex,
} from './desktop-grid-layout.ts'
import { useDesktopIconReorder } from './use-desktop-icon-reorder.ts'
import { useDesktopPagePager } from './use-desktop-page-pager.ts'
import '../icons/app-icon-tile.css'
import './desktop.css'

type DesktopEntry =
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

type DesktopReorderController = {
  reorderingEnabled: boolean
  draggingAppId: AppId | undefined
  onReorderStart: (appId: AppId, globalIndex: number, clientX: number, clientY: number) => void
  onReorderMove: (clientX: number, clientY: number) => void
  onReorderEnd: () => void
}

type DesktopIconProps = {
  appId: BuiltinAppId
  name: string
  Icon: ComponentType<{ size?: number }>
  badgeCount?: number
  globalIndex: number
  didSwipeRef: { current: boolean }
  reorder: DesktopReorderController
}

function DesktopIcon({
  appId,
  name,
  Icon,
  badgeCount = 0,
  globalIndex,
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

  const { onPointerDown } = useDesktopIconReorder({
    appId,
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
      <span class="desktop-icon__image">
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
  globalIndex: number
  didSwipeRef: { current: boolean }
  reorder: DesktopReorderController
}

function GeneratedDesktopIcon({
  appId,
  name,
  emoji,
  themeColor,
  progress,
  textLength,
  globalIndex,
  didSwipeRef,
  reorder,
}: GeneratedDesktopIconProps) {
  const { openInstalledApp, openMarketplaceDetail, uninstallApp } = useGeneratedApps()
  const { showIconContextMenu } = useIconContextMenu()
  const { isPinnedToDock, pinToDock, unpinFromDock } = useLauncherLayout()
  const [uninstallConfirmOpen, setUninstallConfirmOpen] = useState(false)
  const downloading = progress !== undefined && progress < 100
  const slug = generatedAppIdToSlug(appId)
  const canUninstall = !downloading

  const handleOpen = () => {
    openInstalledApp(appId)
  }

  const pinned = isPinnedToDock(appId)

  const { onPointerDown } = useDesktopIconReorder({
    appId,
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
        onPointerDown={onPointerDown}
        onContextMenu={(event) => {
          showIconContextMenu(
            event,
            buildGeneratedIconContextMenuItems({
              onOpen: handleOpen,
              onViewInMarketplace: () => openMarketplaceDetail(slug),
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

function renderDesktopEntry(
  entry: DesktopEntry,
  globalIndex: number,
  didSwipeRef: { current: boolean },
  reorder: DesktopReorderController,
) {
  if (entry.kind === 'builtin') {
    return (
      <DesktopIcon
        appId={entry.appId}
        name={entry.name}
        Icon={entry.Icon}
        badgeCount={entry.badgeCount}
        globalIndex={globalIndex}
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
      globalIndex={globalIndex}
      didSwipeRef={didSwipeRef}
      reorder={reorder}
    />
  )
}

export function Desktop() {
  const { installedApps, pendingInstalls, pendingUpdateCount } = useGeneratedApps()
  const { desktopIconOrder, updateDesktopIconOrder } = useLauncherLayout()
  const pagerRef = useRef<HTMLDivElement>(null)
  const gridRef = useRef<HTMLDivElement>(null)
  const [pagerSize, setPagerSize] = useState({ width: 0, height: 0 })
  const [reorderSession, setReorderSession] = useState<
    | {
        appId: AppId
        pointerX: number
        pointerY: number
        hoverIndex: number
      }
    | undefined
  >(undefined)
  const [previewOrder, setPreviewOrder] = useState<AppId[] | undefined>(undefined)
  const previewOrderRef = useRef<AppId[] | undefined>(undefined)

  useExperimentalSettings()
  const desktopApps = APP_REGISTRY.filter((app) => isBuiltinAppVisibleOnDesktop(app))
  const installedDesktopApps = installedApps.filter(
    (app) => !pendingInstalls.some((item) => item.id === app.id),
  )

  const desktopEntries = useMemo((): DesktopEntry[] => {
    return [
      ...desktopApps.map(
        (app): DesktopEntry => ({
          kind: 'builtin',
          appId: app.id,
          name: app.name,
          Icon: app.icon,
          badgeCount: app.id === 'appstore' ? pendingUpdateCount : 0,
        }),
      ),
      ...installedDesktopApps.map(
        (app): DesktopEntry => ({
          kind: 'generated',
          appId: app.id,
          name: app.name,
          emoji: app.iconEmoji,
          themeColor: app.themeColor,
        }),
      ),
      ...pendingInstalls.map(
        (item): DesktopEntry => ({
          kind: 'generated',
          appId: item.id,
          name: item.listing.name,
          emoji: item.listing.iconEmoji,
          themeColor: item.listing.themeColor,
          progress: item.progress,
          textLength: item.textLength,
        }),
      ),
    ]
  }, [desktopApps, installedDesktopApps, pendingInstalls, pendingUpdateCount])

  const visibleAppIds = useMemo(() => desktopEntries.map((entry) => entry.appId), [desktopEntries])

  const orderedAppIds = useMemo(
    () => reconcileDesktopIconOrder(desktopIconOrder, visibleAppIds),
    [desktopIconOrder, visibleAppIds],
  )

  useEffect(() => {
    if (reorderSession !== undefined) {
      return
    }

    if (desktopIconOrder.length === 0 && visibleAppIds.length > 0) {
      updateDesktopIconOrder(visibleAppIds)
      return
    }

    const missingAppIds = visibleAppIds.filter((appId) => !desktopIconOrder.includes(appId))
    if (missingAppIds.length > 0) {
      updateDesktopIconOrder([...desktopIconOrder, ...missingAppIds])
    }
  }, [
    desktopIconOrder,
    reorderSession,
    updateDesktopIconOrder,
    visibleAppIds,
  ])

  const displayOrder = previewOrder ?? orderedAppIds

  const entryByAppId = useMemo(() => {
    const map = new Map<AppId, DesktopEntry>()
    for (const entry of desktopEntries) {
      map.set(entry.appId, entry)
    }
    return map
  }, [desktopEntries])

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

  const {
    currentPage,
    goToPage,
    didSwipeRef,
    translateX,
    animating,
    cancelInteraction: cancelPageInteraction,
    pagePagerHandlers,
  } = useDesktopPagePager(pageCount, pagerSize.width, reorderSession === undefined)

  const onReorderStart = useCallback(
    (appId: AppId, globalIndex: number, clientX: number, clientY: number) => {
      cancelPageInteraction()
      previewOrderRef.current = orderedAppIds
      setPreviewOrder(orderedAppIds)
      setReorderSession({
        appId,
        pointerX: clientX,
        pointerY: clientY,
        hoverIndex: globalIndex,
      })
    },
    [cancelPageInteraction, orderedAppIds],
  )

  const onReorderMove = useCallback(
    (clientX: number, clientY: number) => {
      const grid = gridRef.current
      if (!grid) {
        return
      }

      setReorderSession((session) => {
        if (!session) {
          return session
        }

        const hoverIndex = pointerToGlobalIconIndex(
          clientX,
          clientY,
          grid,
          currentPage,
          gridMetrics,
          orderedAppIds.length,
        )

        const base = previewOrderRef.current ?? orderedAppIds
        const nextPreview = buildPreviewOrder(base, session.appId, hoverIndex)
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
    [currentPage, gridMetrics, orderedAppIds],
  )

  const onReorderEnd = useCallback(() => {
    const finalOrder = previewOrderRef.current
    if (finalOrder) {
      updateDesktopIconOrder(finalOrder)
    }
    previewOrderRef.current = undefined
    setPreviewOrder(undefined)
    setReorderSession(undefined)
    cancelPageInteraction()
  }, [cancelPageInteraction, updateDesktopIconOrder])

  const reorderController = useMemo(
    (): DesktopReorderController => ({
      reorderingEnabled: reorderSession !== undefined,
      draggingAppId: reorderSession?.appId,
      onReorderStart,
      onReorderMove,
      onReorderEnd,
    }),
    [onReorderEnd, onReorderMove, onReorderStart, reorderSession],
  )

  const draggingEntry = reorderSession
    ? entryByAppId.get(reorderSession.appId)
    : undefined

  useLayoutEffect(() => {
    const pager = pagerRef.current
    if (!pager) {
      return
    }

    const updateSize = () => {
      setPagerSize({ width: pager.clientWidth, height: pager.clientHeight })
    }

    updateSize()
    const observer = new ResizeObserver(updateSize)
    observer.observe(pager)
    return () => observer.disconnect()
  }, [])

  const layoutReady = pagerSize.width > 0 && pagerSize.height > 0

  const pagesWidth = pageCount * pagerSize.width

  return (
    <section
      class={`desktop${reorderSession ? ' desktop--reordering' : ''}${layoutReady ? '' : ' desktop--measuring'}`}
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
            const pageAppIds = getPageSlice(displayOrder, pageIndex, gridMetrics.iconsPerPage)

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
                    {pageAppIds.map((appId, slotOnPage) => {
                      const entry = entryByAppId.get(appId)
                      if (!entry) {
                        return undefined
                      }

                      const isDragging = reorderSession?.appId === appId
                      const slotPosition = getIconSlotPosition(slotOnPage, gridMetrics.cols)
                      const globalIndex = displayOrder.indexOf(appId)

                      return (
                        <div
                          key={appId}
                          class={`desktop-icon-wrap${isDragging ? ' desktop-icon-wrap--source' : ''}`}
                          style={{
                            '--wiggle-index': `${slotOnPage}`,
                            transform: `translate3d(${slotPosition.left}px, ${slotPosition.top}px, 0)`,
                          }}
                        >
                          {!isDragging &&
                            renderDesktopEntry(entry, globalIndex, didSwipeRef, reorderController)}
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
            left: `${reorderSession.pointerX}px`,
            top: `${reorderSession.pointerY}px`,
          }}
        >
          {draggingEntry.kind === 'builtin' ? (
            <>
              <span class="desktop-icon__image">
                <draggingEntry.Icon size={72} />
                {draggingEntry.badgeCount !== undefined && (
                  <AppIconNotificationBadge count={draggingEntry.badgeCount} />
                )}
              </span>
              <span class="desktop-icon__label">{draggingEntry.name}</span>
            </>
          ) : (
            <>
              <span class="desktop-icon__image">
                <GeneratedAppIcon
                  emoji={draggingEntry.emoji}
                  themeColor={draggingEntry.themeColor}
                  size={72}
                  progress={draggingEntry.progress}
                  textLength={draggingEntry.textLength}
                />
              </span>
              <span class="desktop-icon__label">{draggingEntry.name}</span>
            </>
          )}
        </div>
      )}

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
