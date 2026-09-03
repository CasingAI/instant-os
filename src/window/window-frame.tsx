import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'preact/hooks'
import type { ComponentChildren, JSX } from 'preact'
import { flip3dWheelDelta, useWheelStepGesture } from '../desktop/use-wheel-step-gesture.ts'
import { useOs } from '../os/os-context.tsx'
import { useFullscreenChromeReveal } from '../os/fullscreen-chrome-reveal-context.tsx'
import type { WindowState } from '../os/types.ts'
import { buildDesktopRevealTransform } from './build-desktop-reveal-transform.ts'
import {
  buildFlip3dBackEnterTransform,
  buildFlip3dTransform,
  flip3dPerspectiveOrigin,
  hitTestFlip3dWindowId,
  FLIP3D_PERSPECTIVE_PX,
  FLIP3D_Z_BASE,
} from './build-flip3d-transform.ts'
import { FLIP3D_FLIGHT_OUT_MS, resolveFlip3dVisual } from './flip3d.ts'
import { Flip3dGhostFrame } from './flip3d-ghost-frame.tsx'
import { useFlip3dLayers, useFlip3dScene, useFlip3dShadowReveal } from './flip3d-context.tsx'
import { DesktopRevealPeekLayer } from './desktop-reveal-peek-layer.tsx'
import { buildMinimizeTransform } from './build-minimize-transform.ts'
import type { WindowBounds } from './window-metrics.ts'
import { SnapPreview } from './window-snap-preview.tsx'
import { useWindowDrag } from './use-window-drag.ts'
import { useWindowResize } from './use-window-resize.ts'
import {
  clampFloatingSize,
  MIN_MINI_WINDOW_HEIGHT,
  MIN_MINI_WINDOW_WIDTH,
  type ResizeDirection,
} from './window-resize.ts'
import { WindowModalProvider } from './window-modal-context.tsx'
import { WindowAppBody } from './window-app-body.tsx'

const EDGE_DIRECTIONS: ResizeDirection[] = ['n', 's', 'e', 'w']
const CORNER_DIRECTIONS: ResizeDirection[] = ['nw', 'ne', 'sw', 'se']
import './window-frame.css'

function Flip3dCastShadow({ hidden }: { hidden?: boolean }) {
  const flip3dShadowReveal = useFlip3dShadowReveal()
  if (hidden || (flip3dShadowReveal !== 'hold' && flip3dShadowReveal !== 'fade')) {
    return undefined
  }
  return (
    <div
      class={`window-frame__cast-shadow${flip3dShadowReveal === 'fade' ? ' window-frame__cast-shadow--in' : ''}`}
      aria-hidden="true"
    />
  )
}

type WindowFrameProps = {
  window: WindowState
}

function useFlip3dFrame(windowId: string, bounds: WindowBounds) {
  const { flip3dActive, flip3dRestoring, exitFlip3d } = useFlip3dScene()
  const { flip3dEntering, flip3dOrder, flip3dSnapIds, flip3dFlight, finishFlip3dFlight } =
    useFlip3dLayers()
  const visual = resolveFlip3dVisual(flip3dOrder, windowId, flip3dSnapIds)
  const flight = flip3dFlight?.windowId === windowId ? flip3dFlight : undefined
  const frameRef = useRef<HTMLElement>(null)
  const finishFlightRef = useRef(finishFlip3dFlight)
  finishFlightRef.current = finishFlip3dFlight
  const inFlip3d = (flip3dActive || flip3dRestoring) && visual !== undefined
  const viewport = { width: window.innerWidth, height: window.innerHeight }
  const count = Math.max(flip3dOrder.length, 1)
  const transform = flight
    ? flight.fromTransform
    : flip3dActive && visual
      ? visual.fromBack
        ? buildFlip3dBackEnterTransform(bounds, viewport, count)
        : buildFlip3dTransform(bounds, visual.rank, viewport, count)
      : undefined
  const zIndex = flight
    ? flight.zIndex
    : flip3dActive && visual
      ? FLIP3D_Z_BASE - visual.rank
      : undefined

  useLayoutEffect(() => {
    if (!flight) {
      return
    }
    const node = frameRef.current
    if (!node) {
      return
    }

    let done = false
    const animation = node.animate(
      [
        { transform: flight.fromTransform, opacity: flight.fromOpacity },
        { transform: flight.toTransform, opacity: flight.toOpacity },
      ],
      {
        duration: FLIP3D_FLIGHT_OUT_MS,
        easing: 'cubic-bezier(0.22, 0.61, 0.36, 1)',
        fill: 'forwards',
      },
    )
    const finish = () => {
      if (done) {
        return
      }
      done = true
      finishFlightRef.current(flight.id)
    }
    const fallback = window.setTimeout(finish, FLIP3D_FLIGHT_OUT_MS)
    void animation.finished.then(finish).catch(() => {})
    return () => {
      window.clearTimeout(fallback)
      animation.cancel()
    }
  }, [flight])

  return {
    frameRef,
    inFlip3d,
    transform,
    zIndex,
    opacity: flight?.fromOpacity ?? visual?.opacity,
    skipTransition: Boolean(
      flight || (visual?.skipTransition && flip3dActive && !flip3dEntering && !flip3dRestoring),
    ),
    selectWindow: () => exitFlip3d(windowId),
  }
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
  const isActive = activeWindowId === window.id
  const isMini = window.chromeKind === 'mini'
  const isCompactChrome = isMini || window.chromeKind === 'dialog'
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
    frameRef: flip3dFrameRef,
    inFlip3d,
    transform: flip3dTransform,
    zIndex: flip3dZIndex,
    opacity: flip3dOpacity,
    skipTransition: flip3dInstant,
    selectWindow: selectFlip3dWindow,
  } = useFlip3dFrame(window.id, windowBounds)
  const layoutLocked = isDesktopRevealed || inFlip3d
  const canResize =
    !isMini && !window.fullscreen && !window.minimized && !layoutLocked
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
    // 迷你窗不吸边：吸附语义（半屏/满高）是为可缩放窗口设计的
    isMini ? undefined : applyWindowSnap,
    isMini ? undefined : () => toggleMaximize(window.id),
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

  // 迷你窗尺寸由内容撑起：窗管是数字 bounds 驱动（拖拽/flip3d/最小化都吃 x/y/w/h），
  // 宽高数字必须存在，但由窗框量测正文自然大小后 resizeWindow 回写，而不是手调常数。
  // 首帧在布局 effect 里同步 fit（避免以下限尺寸闪一帧），之后 ResizeObserver 跟随内容；
  // chrome 开销（标题栏/边框）按当前窗宽高与内容区实差折算，不写死。
  const miniContentRef = useRef<HTMLDivElement>(null)
  const miniWinRef = useRef(window)
  miniWinRef.current = window
  useLayoutEffect(() => {
    if (!isMini) return
    const container = miniContentRef.current
    if (!container) return
    const body = container.querySelector<HTMLDivElement>(':scope > .window-app-body')
    if (!body) return
    const sync = () => {
      const win = miniWinRef.current
      const extraW = win.width - container.clientWidth
      const extraH = win.height - container.clientHeight
      const next = clampFloatingSize(
        body.offsetWidth + extraW,
        body.offsetHeight + extraH,
        { minWidth: MIN_MINI_WINDOW_WIDTH, minHeight: MIN_MINI_WINDOW_HEIGHT },
      )
      if (Math.abs(next.width - win.width) < 1 && Math.abs(next.height - win.height) < 1) return
      resizeWindow(win.id, { x: win.x, y: win.y, width: next.width, height: next.height })
    }
    sync()
    const observer = new ResizeObserver(sync)
    observer.observe(body)
    return () => observer.disconnect()
  }, [isMini, resizeWindow, window.id])

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
        ref={flip3dFrameRef}
        data-flip3d-window={window.id}
        class={`window-frame${isCompactChrome ? ' window-frame--dialog' : ''}${isMini ? ' window-frame--mini' : ''}${isActive ? ' window-frame--active' : ''}${dragging ? ' window-frame--dragging' : ''}${resizing ? ' window-frame--resizing' : ''}${isAnchoredLayout ? ' window-frame--anchored' : ''}${window.maximized ? ' window-frame--maximized' : ''}${window.snap ? ` window-frame--snapped-${window.snap}` : ''}${window.fullscreen ? ' window-frame--fullscreen' : ''}${immersiveFullscreen ? ' window-frame--fullscreen-immersive' : ''}${showImmersiveChrome ? ' window-frame--chrome-revealed' : ''}${showMinimizeVisual ? ' window-frame--minimized' : ''}${isMinimizing ? ' window-frame--minimizing' : ''}${isDesktopRevealed ? ' window-frame--desktop-revealed' : ''}${inFlip3d ? ' window-frame--flip3d' : ''}${flip3dInstant ? ' window-frame--flip3d-instant' : ''}${isEntering ? ' window-frame--entering' : ''}${isClosing ? ' window-frame--closing' : ''}`}
        aria-hidden={showMinimizeVisual || isClosing ? true : undefined}
        style={{
          zIndex: flip3dZIndex ?? window.zIndex,
          left: `${window.x}px`,
          top: `${window.y}px`,
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
        <Flip3dCastShadow hidden={inFlip3d || isAnchored || window.fullscreen || showMinimizeVisual} />
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
              {isCompactChrome ? undefined : (
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
                aria-label={window.fullscreen ? '退出全屏' : '全屏'}
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
          <div class="window-frame__content" ref={miniContentRef}>
            {!isActive && !isDesktopRevealed && !inFlip3d && (
              <div class="window-frame__focus-catcher" aria-hidden="true" />
            )}
            <WindowModalProvider>
              <WindowAppBody window={window} />
            </WindowModalProvider>
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
  return <ChromeWindowFrame window={window} />
}

export function WindowManager() {
  const { windows, desktopRevealRestoring } = useOs()
  const { flip3dActive, cycleFlip3d, exitFlip3d } = useFlip3dScene()
  const { flip3dOrder, flip3dGhosts, dismissFlip3dGhostFrame } = useFlip3dLayers()

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

  useWheelStepGesture(
    flip3dActive,
    (event) => flip3dWheelDelta(event.deltaX, event.deltaY),
    cycleFlip3d,
  )

  const onScenePointerDown = flip3dActive
    ? (event: JSX.TargetedPointerEvent<HTMLDivElement>) => {
        if (event.button !== 0) {
          return
        }
        const scene = event.currentTarget
        const rect = scene.getBoundingClientRect()
        const boundsById = new Map(
          windows.map((frame) => [
            frame.id,
            { x: frame.x, y: frame.y, width: frame.width, height: frame.height },
          ]),
        )
        const hitId = hitTestFlip3dWindowId(
          event.clientX - rect.left,
          event.clientY - rect.top,
          flip3dOrder,
          boundsById,
          { width: rect.width, height: rect.height },
        )
        event.preventDefault()
        event.stopPropagation()
        exitFlip3d(hitId)
      }
    : undefined

  return (
    <Flip3dSceneChrome
      desktopRevealRestoring={desktopRevealRestoring}
      onScenePointerDown={onScenePointerDown}
      extra={<DesktopRevealPeekLayer />}
    >
      {windows.map((frame) => (
        <WindowFrame key={frame.id} window={frame} />
      ))}
      {flip3dGhosts.map((ghost) => (
        <Flip3dGhostFrame
          key={ghost.id}
          ghost={ghost}
          count={Math.max(flip3dOrder.length, 1)}
          onDone={dismissFlip3dGhostFrame}
        />
      ))}
    </Flip3dSceneChrome>
  )
}

function Flip3dSceneChrome({
  children,
  extra,
  desktopRevealRestoring,
  onScenePointerDown,
}: {
  children: ComponentChildren
  extra?: ComponentChildren
  desktopRevealRestoring: boolean
  onScenePointerDown?: (event: JSX.TargetedPointerEvent<HTMLDivElement>) => void
}) {
  const { flip3dActive, flip3dRestoring } = useFlip3dScene()
  const { flip3dEntering } = useFlip3dLayers()
  const flip3dShadowReveal = useFlip3dShadowReveal()
  const inFlip3dScene = flip3dActive || flip3dRestoring

  return (
    <div
      class={`window-manager${desktopRevealRestoring ? ' window-manager--desktop-restore' : ''}${inFlip3dScene ? ' window-manager--flip3d' : ''}${flip3dEntering ? ' window-manager--flip3d-enter' : ''}${flip3dRestoring ? ' window-manager--flip3d-restore' : ''}${flip3dShadowReveal === 'hold' ? ' window-manager--flip3d-shadow-hold' : ''}${flip3dShadowReveal === 'fade' ? ' window-manager--flip3d-shadow-fade' : ''}${flip3dShadowReveal === 'settle' ? ' window-manager--flip3d-shadow-settle' : ''}`}
      aria-live="polite"
      style={
        inFlip3dScene
          ? {
              perspective: `${FLIP3D_PERSPECTIVE_PX}px`,
              perspectiveOrigin: flip3dPerspectiveOrigin(),
            }
          : undefined
      }
    >
      <div class="window-manager__flip3d-scene" onPointerDown={onScenePointerDown}>
        {children}
      </div>
      {extra}
    </div>
  )
}
