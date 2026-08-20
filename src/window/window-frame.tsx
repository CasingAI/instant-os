import type { ComponentType } from 'preact'
import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'preact/hooks'
import { GeneratedApp } from '../apps/generated/generated-app.tsx'
import { ExtApp } from '../apps/ext/ext-app.tsx'
import { APP_COMPONENTS } from '../os/app-registry.tsx'
import { useOs } from '../os/os-context.tsx'
import { useFullscreenChromeReveal } from '../os/fullscreen-chrome-reveal-context.tsx'
import { isExtAppId, isGeneratedAppId } from '../os/types.ts'
import type { BuiltinAppId, WindowState } from '../os/types.ts'
import { buildDesktopRevealTransform } from './build-desktop-reveal-transform.ts'
import {
  buildFlip3dBackEnterTransform,
  buildFlip3dTransform,
  computeFlip3dBackEnterLayout,
  computeFlip3dLayout,
  flip3dPerspectiveOrigin,
  FLIP3D_PERSPECTIVE_PX,
  FLIP3D_Z_BASE,
} from './build-flip3d-transform.ts'
import { resolveFlip3dVisual } from './flip3d.ts'
import { Flip3dGhostFrame } from './flip3d-ghost-frame.tsx'
import { DesktopRevealPeekLayer } from './desktop-reveal-peek-layer.tsx'
import { buildMinimizeTransform } from './build-minimize-transform.ts'
import type { WindowBounds } from './window-metrics.ts'
import { SnapPreview } from './window-snap-preview.tsx'
import { useWindowDrag } from './use-window-drag.ts'
import { useWindowResize } from './use-window-resize.ts'
import { type ResizeDirection } from './window-resize.ts'
import { WindowModalProvider } from './window-modal-context.tsx'

const EDGE_DIRECTIONS: ResizeDirection[] = ['n', 's', 'e', 'w']
const CORNER_DIRECTIONS: ResizeDirection[] = ['nw', 'ne', 'sw', 'se']
import './window-frame.css'

type WindowFrameProps = {
  window: WindowState
}

function useFlip3dFrame(windowId: string, bounds: WindowBounds) {
  const { flip3dActive, flip3dRestoring, flip3dEntering, flip3dOrder, flip3dSnapIds, exitFlip3d } =
    useOs()
  const visual = resolveFlip3dVisual(flip3dOrder, windowId, flip3dSnapIds)
  const inFlip3d = (flip3dActive || flip3dRestoring) && visual !== undefined
  const viewport = { width: window.innerWidth, height: window.innerHeight }
  const count = Math.max(flip3dOrder.length, 1)
  const layout =
    flip3dActive && visual
      ? visual.fromBack
        ? computeFlip3dBackEnterLayout(bounds, viewport, count)
        : computeFlip3dLayout(bounds, visual.rank, viewport, count)
      : undefined
  const transform =
    flip3dActive && visual
      ? visual.fromBack
        ? buildFlip3dBackEnterTransform(bounds, viewport, count)
        : buildFlip3dTransform(bounds, visual.rank, viewport, count)
      : undefined
  const zIndex = inFlip3d && visual ? FLIP3D_Z_BASE - visual.rank : undefined
  return {
    inFlip3d,
    transform,
    left: layout?.left,
    top: layout?.top,
    zIndex,
    opacity: visual?.opacity,
    skipTransition: Boolean(
      visual?.skipTransition && flip3dActive && !flip3dEntering && !flip3dRestoring,
    ),
    selectWindow: () => exitFlip3d(windowId),
  }
}

function renderAppBody(
  window: WindowState,
  AppComponent: ComponentType<{ windowId?: string }> | undefined,
) {
  if (isExtAppId(window.appId)) {
    return <ExtApp appId={window.appId} windowId={window.id} />
  }
  if (isGeneratedAppId(window.appId)) {
    return <GeneratedApp appId={window.appId} windowId={window.id} />
  }
  return AppComponent ? <AppComponent windowId={window.id} /> : undefined
}

/**
 * 无窗口应用宿主：默认不可见；展开为 panel 时使用与普通窗口相同的系统标题栏，
 * 且保持 App 挂载路径稳定，避免解压过程中组件卸载。
 */
function WindowlessAppHost({ window }: WindowFrameProps) {
  const {
    activeWindowId,
    focusWindow,
    moveWindow,
    releaseAnchoredWindow,
    applyWindowSnap,
    closeWindow,
    finalizeWindowClose,
    minimizeWindow,
    toggleFullscreen,
  } = useOs()
  const AppComponent = isGeneratedAppId(window.appId)
    ? undefined
    : APP_COMPONENTS[window.appId as BuiltinAppId]
  const revealed = !!window.windowlessPanel && !window.minimized
  const isActive = activeWindowId === window.id
  const isClosing = window.closing
  const [isEntering, setIsEntering] = useState(false)
  const wasRevealedRef = useRef(false)
  const windowBounds = useMemo(
    () => ({
      x: window.x,
      y: window.y,
      width: window.width,
      height: window.height,
    }),
    [window.x, window.y, window.width, window.height],
  )
  const {
    inFlip3d,
    transform: flip3dTransform,
    left: flip3dLeft,
    top: flip3dTop,
    zIndex: flip3dZIndex,
    opacity: flip3dOpacity,
    skipTransition: flip3dInstant,
    selectWindow: selectFlip3dWindow,
  } = useFlip3dFrame(window.id, windowBounds)
  const [minimizeTransform, setMinimizeTransform] = useState<string | undefined>(undefined)
  const prevMinimizedRef = useRef(window.minimized)
  const [isMinimizing, setIsMinimizing] = useState(false)
  const [minimizeVisualSettled, setMinimizeVisualSettled] = useState(window.minimized)
  const showMinimizeVisual = isMinimizing || minimizeVisualSettled
  const showAsWindowFrame = revealed || isMinimizing

  useLayoutEffect(() => {
    const wasMinimized = prevMinimizedRef.current
    prevMinimizedRef.current = window.minimized

    if (window.minimized && !wasMinimized) {
      setMinimizeTransform(buildMinimizeTransform(windowBounds, window.appId))
      setMinimizeVisualSettled(false)
      setIsMinimizing(true)
      const timer = globalThis.setTimeout(() => {
        setIsMinimizing(false)
        setMinimizeVisualSettled(true)
      }, 420)
      return () => globalThis.clearTimeout(timer)
    }

    if (!window.minimized) {
      setMinimizeTransform(undefined)
      setIsMinimizing(false)
      setMinimizeVisualSettled(false)
    }
  }, [window.minimized, windowBounds, window.appId])

  useLayoutEffect(() => {
    const wasRevealed = wasRevealedRef.current
    wasRevealedRef.current = revealed
    if (revealed && !wasRevealed && window.enterAnimation === 'scale-in') {
      setIsEntering(true)
    }
    if (!revealed && !isMinimizing) {
      setIsEntering(false)
    }
  }, [isMinimizing, revealed, window.enterAnimation])

  const getDragBounds = useCallback(
    () => ({
      x: window.x,
      y: window.y,
      width: window.width,
      height: window.height,
    }),
    [window.x, window.y, window.width, window.height],
  )

  const { dragging, snapPreview, onTitlebarPointerDown } = useWindowDrag(
    window.id,
    false,
    getDragBounds,
    moveWindow,
    focusWindow,
    releaseAnchoredWindow,
    applyWindowSnap,
    undefined,
    revealed && !isEntering && !isMinimizing && !inFlip3d,
  )

  useEffect(() => {
    if (!window.closing) return
    finalizeWindowClose(window.id)
  }, [finalizeWindowClose, window.closing, window.id])

  if (isClosing) {
    return undefined
  }

  const closeDisabled = !!window.chromeCloseDisabled
  const minimizeDisabled = !!window.chromeMinimizeDisabled
  const zoomDisabled = !!window.chromeZoomDisabled
  const isDialogChrome = window.chromeKind === 'dialog'

  return (
    <>
      {dragging && <SnapPreview target={snapPreview} />}
      <section
        class={
          showAsWindowFrame
            ? `window-frame${isDialogChrome ? ' window-frame--dialog' : ''}${isActive ? ' window-frame--active' : ''}${dragging ? ' window-frame--dragging' : ''}${showMinimizeVisual ? ' window-frame--minimized' : ''}${isMinimizing ? ' window-frame--minimizing' : ''}${inFlip3d ? ' window-frame--flip3d' : ''}${flip3dInstant ? ' window-frame--flip3d-instant' : ''}${isEntering ? ' window-frame--entering' : ''}`
            : 'windowless-app-host'
        }
        aria-hidden={showMinimizeVisual ? true : undefined}
        style={{
          zIndex: flip3dZIndex ?? window.zIndex,
          left: `${flip3dLeft ?? window.x}px`,
          top: `${flip3dTop ?? window.y}px`,
          width: `${window.width}px`,
          height: `${window.height}px`,
          transform: isEntering
            ? undefined
            : showMinimizeVisual
              ? minimizeTransform
              : inFlip3d
                ? flip3dTransform
                : undefined,
          opacity: showMinimizeVisual ? 0 : inFlip3d ? flip3dOpacity : undefined,
        }}
        onAnimationEnd={(event) => {
          if (event.animationName === 'window-frame-open') {
            setIsEntering(false)
          }
        }}
        onPointerDownCapture={
          revealed && !isMinimizing
            ? (event) => {
                if (event.button !== 0) return
                if (inFlip3d) {
                  event.preventDefault()
                  event.stopPropagation()
                  selectFlip3dWindow()
                  return
                }
                focusWindow(window.id)
              }
            : undefined
        }
      >
        <div class={showAsWindowFrame ? 'window-frame__chrome' : 'windowless-app-host__chrome'}>
          {showAsWindowFrame ? (
            <header class="window-frame__titlebar" onPointerDown={onTitlebarPointerDown}>
              <div class="window-frame__controls">
                <button
                  type="button"
                  class="window-frame__control window-frame__control--close"
                  aria-label="关闭"
                  disabled={closeDisabled}
                  aria-disabled={closeDisabled || undefined}
                  onClick={() => {
                    if (closeDisabled) return
                    closeWindow(window.id)
                  }}
                />
                {isDialogChrome ? undefined : (
                  <>
                    <button
                      type="button"
                      class="window-frame__control window-frame__control--minimize"
                      aria-label="最小化"
                      disabled={minimizeDisabled}
                      aria-disabled={minimizeDisabled || undefined}
                      onClick={() => {
                        if (minimizeDisabled) return
                        minimizeWindow(window.id)
                      }}
                    />
                    <button
                      type="button"
                      class="window-frame__control window-frame__control--fullscreen"
                      aria-label="全屏"
                      disabled={zoomDisabled}
                      aria-disabled={zoomDisabled || undefined}
                      onClick={() => {
                        if (zoomDisabled) return
                        toggleFullscreen(window.id)
                      }}
                    />
                  </>
                )}
              </div>
              <span class="window-frame__title">{window.title}</span>
              <span class="window-frame__title-trailing" aria-live="polite" />
            </header>
          ) : undefined}
          <div class={showAsWindowFrame ? 'window-frame__content' : 'windowless-app-host__content'}>
            <WindowModalProvider>{renderAppBody(window, AppComponent)}</WindowModalProvider>
          </div>
        </div>
      </section>
    </>
  )
}

function ChromeWindowFrame({ window }: WindowFrameProps) {
  const {
    activeWindowId,
    desktopRevealed,
    focusWindow,
    moveWindow,
    resizeWindow,
    releaseAnchoredWindow,
    applyWindowSnap,
    toggleFullscreen,
    toggleMaximize,
    closeWindow,
    finalizeWindowClose,
    minimizeWindow,
  } = useOs()
  const { hasImmersiveFullscreen, chromeRevealed } = useFullscreenChromeReveal()
  const AppComponent = isGeneratedAppId(window.appId)
    ? undefined
    : APP_COMPONENTS[window.appId as BuiltinAppId]
  const isActive = activeWindowId === window.id
  const isAnchored = !window.fullscreen && (window.maximized || !!window.snap)
  const isDesktopRevealed = desktopRevealed && !window.minimized
  const windowBounds = useMemo(
    () => ({
      x: window.x,
      y: window.y,
      width: window.width,
      height: window.height,
    }),
    [window.x, window.y, window.width, window.height],
  )
  const {
    inFlip3d,
    transform: flip3dTransform,
    left: flip3dLeft,
    top: flip3dTop,
    zIndex: flip3dZIndex,
    opacity: flip3dOpacity,
    skipTransition: flip3dInstant,
    selectWindow: selectFlip3dWindow,
  } = useFlip3dFrame(window.id, windowBounds)
  const layoutLocked = isDesktopRevealed || inFlip3d
  const canResize =
    !window.fullscreen && !window.minimized && !layoutLocked
  const getDragBounds = useCallback(
    () => ({
      x: window.x,
      y: window.y,
      width: window.width,
      height: window.height,
    }),
    [window.x, window.y, window.width, window.height],
  )
  const { dragging, snapPreview, onTitlebarPointerDown } = useWindowDrag(
    window.id,
    isAnchored,
    getDragBounds,
    moveWindow,
    focusWindow,
    releaseAnchoredWindow,
    applyWindowSnap,
    () => toggleMaximize(window.id),
    !window.fullscreen && !window.minimized && !layoutLocked,
  )
  const { resizing, onResizeHandlePointerDown, onResizeHandleDoubleClick } = useWindowResize(
    window.id,
    getDragBounds,
    resizeWindow,
    focusWindow,
    canResize,
    window.snap,
  )
  const isAnchoredLayout = window.maximized || !!window.snap || window.fullscreen
  const [minimizeTransform, setMinimizeTransform] = useState<string | undefined>(undefined)
  const desktopRevealTransform = useMemo(
    () => buildDesktopRevealTransform(windowBounds),
    [windowBounds],
  )
  const [isEntering, setIsEntering] = useState(window.enterAnimation === 'scale-in')
  const prevMinimizedRef = useRef(window.minimized)
  const [isMinimizing, setIsMinimizing] = useState(false)
  const [minimizeVisualSettled, setMinimizeVisualSettled] = useState(window.minimized)
  const isClosing = window.closing
  const immersiveFullscreen = window.fullscreen && hasImmersiveFullscreen
  const showImmersiveChrome = immersiveFullscreen && chromeRevealed && isActive
  const showMinimizeVisual = isMinimizing || minimizeVisualSettled
  const closeDisabled = !!window.chromeCloseDisabled
  const minimizeDisabled = !!window.chromeMinimizeDisabled
  const zoomDisabled = !!window.chromeZoomDisabled

  useLayoutEffect(() => {
    const wasMinimized = prevMinimizedRef.current
    prevMinimizedRef.current = window.minimized

    if (window.minimized && !wasMinimized) {
      setMinimizeTransform(buildMinimizeTransform(windowBounds, window.appId))
      setMinimizeVisualSettled(false)
      setIsMinimizing(true)
      const timer = globalThis.setTimeout(() => {
        setIsMinimizing(false)
        setMinimizeVisualSettled(true)
      }, 420)
      return () => globalThis.clearTimeout(timer)
    }

    if (!window.minimized) {
      setMinimizeTransform(undefined)
      setIsMinimizing(false)
      setMinimizeVisualSettled(false)
    }
  }, [window.minimized, windowBounds, window.appId])

  const frameTransform = showMinimizeVisual
    ? minimizeTransform
    : isClosing || isEntering
      ? undefined
      : inFlip3d
        ? flip3dTransform
        : isDesktopRevealed
          ? desktopRevealTransform
          : undefined

  return (
    <>
      {dragging && <SnapPreview target={snapPreview} />}
      <section
        class={`window-frame${isActive ? ' window-frame--active' : ''}${dragging ? ' window-frame--dragging' : ''}${resizing ? ' window-frame--resizing' : ''}${isAnchoredLayout ? ' window-frame--anchored' : ''}${window.maximized ? ' window-frame--maximized' : ''}${window.snap ? ` window-frame--snapped-${window.snap}` : ''}${window.fullscreen ? ' window-frame--fullscreen' : ''}${immersiveFullscreen ? ' window-frame--fullscreen-immersive' : ''}${showImmersiveChrome ? ' window-frame--chrome-revealed' : ''}${showMinimizeVisual ? ' window-frame--minimized' : ''}${isMinimizing ? ' window-frame--minimizing' : ''}${isDesktopRevealed ? ' window-frame--desktop-revealed' : ''}${inFlip3d ? ' window-frame--flip3d' : ''}${flip3dInstant ? ' window-frame--flip3d-instant' : ''}${isEntering ? ' window-frame--entering' : ''}${isClosing ? ' window-frame--closing' : ''}`}
        aria-hidden={showMinimizeVisual || isClosing ? true : undefined}
        style={{
          zIndex: flip3dZIndex ?? window.zIndex,
          left: `${flip3dLeft ?? window.x}px`,
          top: `${flip3dTop ?? window.y}px`,
          width: `${window.width}px`,
          height: `${window.height}px`,
          transform: isEntering ? undefined : frameTransform,
          opacity: showMinimizeVisual ? 0 : inFlip3d ? flip3dOpacity : undefined,
        }}
        onAnimationEnd={(event) => {
          if (event.animationName === 'window-frame-open') {
            setIsEntering(false)
          }
          if (event.animationName === 'window-frame-close') {
            finalizeWindowClose(window.id)
          }
        }}
        onPointerDownCapture={(event) => {
          if (isClosing || event.button !== 0) {
            return
          }
          if (inFlip3d) {
            event.preventDefault()
            event.stopPropagation()
            selectFlip3dWindow()
            return
          }
          if (isDesktopRevealed) {
            return
          }
          focusWindow(window.id)
        }}
      >
        <div class="window-frame__chrome">
          <header
            class="window-frame__titlebar"
            onPointerDown={onTitlebarPointerDown}
          >
            <div class="window-frame__controls">
              <button
                type="button"
                class="window-frame__control window-frame__control--close"
                aria-label="关闭"
                disabled={closeDisabled}
                aria-disabled={closeDisabled || undefined}
                onClick={() => {
                  if (closeDisabled) return
                  closeWindow(window.id)
                }}
              />
              <button
                type="button"
                class="window-frame__control window-frame__control--minimize"
                aria-label="最小化"
                disabled={minimizeDisabled}
                aria-disabled={minimizeDisabled || undefined}
                onClick={() => {
                  if (minimizeDisabled) return
                  minimizeWindow(window.id)
                }}
              />
              <button
                type="button"
                class="window-frame__control window-frame__control--fullscreen"
                aria-label={window.fullscreen ? '退出全屏' : '全屏'}
                disabled={zoomDisabled}
                aria-disabled={zoomDisabled || undefined}
                onClick={() => {
                  if (zoomDisabled) return
                  toggleFullscreen(window.id)
                }}
              />
            </div>
            <span class="window-frame__title">
              {window.documentReadOnly ? (
                <span class="window-frame__title-prefix">只读 - </span>
              ) : undefined}
              {window.title}
            </span>
            <span class="window-frame__title-trailing" aria-live="polite">
              {window.documentEdited ? '已编辑' : ''}
            </span>
          </header>
          <div class="window-frame__content">
            {!isActive && !isDesktopRevealed && !inFlip3d && (
              <div class="window-frame__focus-catcher" aria-hidden="true" />
            )}
            <WindowModalProvider>{renderAppBody(window, AppComponent)}</WindowModalProvider>
          </div>
        </div>
        {canResize && (
          <div class="window-frame__resize-layer" aria-hidden="true">
            {EDGE_DIRECTIONS.map((direction) => (
              <div
                key={direction}
                class={`window-frame__resize window-frame__resize--${direction}`}
                onPointerDown={onResizeHandlePointerDown(direction)}
                onDblClick={onResizeHandleDoubleClick(direction)}
              />
            ))}
            {CORNER_DIRECTIONS.map((direction) => (
              <div
                key={direction}
                class={`window-frame__resize window-frame__resize--${direction}`}
                onPointerDown={onResizeHandlePointerDown(direction)}
                onDblClick={onResizeHandleDoubleClick(direction)}
              />
            ))}
          </div>
        )}
      </section>
    </>
  )
}

export function WindowFrame({ window }: WindowFrameProps) {
  if (window.windowless) {
    return <WindowlessAppHost window={window} />
  }
  return <ChromeWindowFrame window={window} />
}

export function WindowManager() {
  const {
    windows,
    desktopRevealRestoring,
    flip3dActive,
    flip3dRestoring,
    flip3dEntering,
    flip3dOrder,
    flip3dGhosts,
    cycleFlip3d,
    dismissFlip3dGhostFrame,
    exitFlip3d,
  } = useOs()

  useEffect(() => {
    if (!flip3dActive) {
      return
    }
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'ArrowRight' || event.key === 'ArrowDown') {
        event.preventDefault()
        event.stopPropagation()
        cycleFlip3d(1)
        return
      }
      if (event.key === 'ArrowLeft' || event.key === 'ArrowUp') {
        event.preventDefault()
        event.stopPropagation()
        cycleFlip3d(-1)
        return
      }
      if (event.key === 'Escape' || event.key === 'Enter') {
        event.preventDefault()
        event.stopPropagation()
        exitFlip3d()
      }
    }
    window.addEventListener('keydown', onKeyDown, true)
    return () => window.removeEventListener('keydown', onKeyDown, true)
  }, [cycleFlip3d, exitFlip3d, flip3dActive])

  const inFlip3dScene = flip3dActive || flip3dRestoring

  return (
    <div
      class={`window-manager${desktopRevealRestoring ? ' window-manager--desktop-restore' : ''}${inFlip3dScene ? ' window-manager--flip3d' : ''}${flip3dEntering ? ' window-manager--flip3d-enter' : ''}${flip3dRestoring ? ' window-manager--flip3d-restore' : ''}`}
      aria-live="polite"
      style={
        inFlip3dScene
          ? {
              perspective: `${FLIP3D_PERSPECTIVE_PX}px`,
              perspectiveOrigin: flip3dPerspectiveOrigin(),
            }
          : undefined
      }
      onPointerDown={
        flip3dActive
          ? (event) => {
              if (event.button !== 0 || event.target !== event.currentTarget) {
                return
              }
              event.preventDefault()
              event.stopPropagation()
              exitFlip3d()
            }
          : undefined
      }
    >
      <div class="window-manager__flip3d-scene">
        {windows.map((window) => (
          <WindowFrame key={window.id} window={window} />
        ))}
        {flip3dGhosts.map((ghost) => (
          <Flip3dGhostFrame
            key={ghost.id}
            ghost={ghost}
            count={Math.max(flip3dOrder.length, 1)}
            onDone={dismissFlip3dGhostFrame}
          />
        ))}
      </div>
      <DesktopRevealPeekLayer />
    </div>
  )
}
