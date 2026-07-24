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

  useLayoutEffect(() => {
    const wasRevealed = wasRevealedRef.current
    wasRevealedRef.current = revealed
    if (revealed && !wasRevealed && window.enterAnimation === 'scale-in') {
      setIsEntering(true)
    }
    if (!revealed) {
      setIsEntering(false)
    }
  }, [revealed, window.enterAnimation])

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
    revealed && !isEntering,
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
          revealed
            ? `window-frame${isDialogChrome ? ' window-frame--dialog' : ''}${isActive ? ' window-frame--active' : ''}${dragging ? ' window-frame--dragging' : ''}${isEntering ? ' window-frame--entering' : ''}`
            : 'windowless-app-host'
        }
        style={{
          zIndex: window.zIndex,
          left: `${window.x}px`,
          top: `${window.y}px`,
          width: `${window.width}px`,
          height: `${window.height}px`,
        }}
        onAnimationEnd={(event) => {
          if (event.animationName === 'window-frame-open') {
            setIsEntering(false)
          }
        }}
        onPointerDownCapture={
          revealed
            ? (event) => {
                if (event.button !== 0) return
                focusWindow(window.id)
              }
            : undefined
        }
      >
        <div class={revealed ? 'window-frame__chrome' : 'windowless-app-host__chrome'}>
          {revealed ? (
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
          <div class={revealed ? 'window-frame__content' : 'windowless-app-host__content'}>
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
  const canResize =
    !window.fullscreen && !window.minimized && !isDesktopRevealed
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
            {!isActive && !isDesktopRevealed && (
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
