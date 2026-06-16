import { useCallback, useLayoutEffect, useMemo, useRef, useState } from 'preact/hooks'
import { GeneratedApp } from '../apps/generated/generated-app.tsx'
import { APP_COMPONENTS } from '../os/app-registry.tsx'
import { useOs } from '../os/os-context.tsx'
import { useFullscreenChromeReveal } from '../os/fullscreen-chrome-reveal-context.tsx'
import { isGeneratedAppId } from '../os/types.ts'
import type { BuiltinAppId, WindowState } from '../os/types.ts'
import { buildDesktopRevealTransform } from './build-desktop-reveal-transform.ts'
import { DesktopRevealPeekLayer } from './desktop-reveal-peek-layer.tsx'
import { buildMinimizeTransform } from './build-minimize-transform.ts'
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

export function WindowFrame({ window }: WindowFrameProps) {
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
  const canResize =
    !window.fullscreen && !window.maximized && !window.minimized && !isDesktopRevealed
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
    !window.fullscreen && !window.minimized && !isDesktopRevealed,
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
  const windowBounds = useMemo(
    () => ({
      x: window.x,
      y: window.y,
      width: window.width,
      height: window.height,
    }),
    [window.x, window.y, window.width, window.height],
  )
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
      : isDesktopRevealed
        ? desktopRevealTransform
        : undefined

  return (
    <>
      {dragging && <SnapPreview target={snapPreview} />}
      <section
        class={`window-frame${isActive ? ' window-frame--active' : ''}${dragging ? ' window-frame--dragging' : ''}${resizing ? ' window-frame--resizing' : ''}${isAnchoredLayout ? ' window-frame--anchored' : ''}${window.maximized ? ' window-frame--maximized' : ''}${window.snap ? ` window-frame--snapped-${window.snap}` : ''}${window.fullscreen ? ' window-frame--fullscreen' : ''}${immersiveFullscreen ? ' window-frame--fullscreen-immersive' : ''}${showImmersiveChrome ? ' window-frame--chrome-revealed' : ''}${showMinimizeVisual ? ' window-frame--minimized' : ''}${isMinimizing ? ' window-frame--minimizing' : ''}${isDesktopRevealed ? ' window-frame--desktop-revealed' : ''}${isEntering ? ' window-frame--entering' : ''}${isClosing ? ' window-frame--closing' : ''}`}
        aria-hidden={showMinimizeVisual || isClosing ? true : undefined}
        style={{
          zIndex: window.zIndex,
          left: `${window.x}px`,
          top: `${window.y}px`,
          width: `${window.width}px`,
          height: `${window.height}px`,
          transform: isEntering ? undefined : frameTransform,
          opacity: showMinimizeVisual ? 0 : undefined,
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
          if (isDesktopRevealed || isClosing || event.button !== 0) {
            return
          }
          focusWindow(window.id)
        }}
      >
        <header
          class="window-frame__titlebar"
          onPointerDown={onTitlebarPointerDown}
        >
          <div class="window-frame__controls">
            <button
              type="button"
              class="window-frame__control window-frame__control--close"
              aria-label="关闭"
              onClick={() => closeWindow(window.id)}
            />
            <button
              type="button"
              class="window-frame__control window-frame__control--minimize"
              aria-label="最小化"
              onClick={() => minimizeWindow(window.id)}
            />
            <button
              type="button"
              class="window-frame__control window-frame__control--fullscreen"
              aria-label={window.fullscreen ? '退出全屏' : '全屏'}
              onClick={() => toggleFullscreen(window.id)}
            />
          </div>
          <span class="window-frame__title">{window.title}</span>
        </header>
        <div class="window-frame__content">
          {!isActive && !isDesktopRevealed && (
            <div class="window-frame__focus-catcher" aria-hidden="true" />
          )}
          <WindowModalProvider>
            {isGeneratedAppId(window.appId) ? (
              <GeneratedApp appId={window.appId} windowId={window.id} />
            ) : (
              AppComponent && <AppComponent />
            )}
          </WindowModalProvider>
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

export function WindowManager() {
  const { windows, desktopRevealRestoring } = useOs()

  return (
    <div
      class={`window-manager${desktopRevealRestoring ? ' window-manager--desktop-restore' : ''}`}
      aria-live="polite"
    >
      {windows.map((window) => (
        <WindowFrame key={window.id} window={window} />
      ))}
      <DesktopRevealPeekLayer />
    </div>
  )
}
