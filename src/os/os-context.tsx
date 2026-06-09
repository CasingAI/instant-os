import type { ComponentChildren } from 'preact'
import { createContext } from 'preact'
import { useCallback, useContext, useEffect, useMemo, useState } from 'preact/hooks'
import { persistWindowSize, resolveWindowDimensions } from '../window/window-bounds-storage.ts'
import { getFullscreenBounds, getMaximizedBounds } from '../window/window-metrics.ts'
import {
  clampFloatingPosition,
  getLeftSnapBounds,
  getRightSnapBounds,
  getSnapBounds,
  type SnapTarget,
} from '../window/window-snap.ts'
import type { AppId, BuiltinAppId, GeneratedAppId, WindowState, WindowRestoredBounds } from './types.ts'
import { isGeneratedAppId } from './types.ts'

type OsContextValue = {
  windows: WindowState[]
  activeWindowId: string | undefined
  openApp: (appId: AppId) => void
  openGeneratedApp: (appId: GeneratedAppId, title: string) => void
  closeWindow: (windowId: string) => void
  closeWindowsForApp: (appId: AppId) => void
  focusWindow: (windowId: string) => void
  moveWindow: (windowId: string, x: number, y: number) => void
  resizeWindow: (windowId: string, bounds: WindowRestoredBounds) => void
  releaseAnchoredWindow: (windowId: string, clientX: number, clientY: number) => WindowRestoredBounds
  applyWindowSnap: (windowId: string, target: SnapTarget) => void
  toggleFullscreen: (windowId: string) => void
  toggleMaximize: (windowId: string) => void
  minimizeWindow: (windowId: string) => void
  restoreWindow: (windowId: string) => void
  setAppWindowTitle: (appId: AppId, title: string) => void
}

const OsContext = createContext<OsContextValue | undefined>(undefined)

const DEFAULT_WINDOWS: Record<string, Pick<WindowState, 'title' | 'width' | 'height'>> = {
  browser: { title: '网络浏览器', width: 880, height: 720 },
  settings: { title: '系统设置', width: 780, height: 540 },
  photos: { title: '照片', width: 720, height: 620 },
  mail: { title: '邮件', width: 900, height: 640 },
  news: { title: '新闻', width: 920, height: 620 },
  weather: { title: '天气', width: 410, height: 680 },
  stocks: { title: '股票', width: 410, height: 680 },
  translate: { title: '翻译', width: 680, height: 520 },
  catgpt: { title: 'CatGPT', width: 860, height: 640 },
  appstore: { title: '应用集市', width: 820, height: 720 },
  'scene3d-lab': { title: '3D 实验室', width: 1180, height: 760 },
  icode: { title: 'iCode', width: 1280, height: 720 },
  gomoku: { title: '五子棋', width: 760, height: 680 },
}

const LEGACY_BUILTIN_WINDOW_TITLES: Partial<Record<BuiltinAppId, readonly string[]>> = {
  appstore: ['App Store'],
}

function resolveBuiltinWindowTitle(appId: BuiltinAppId, title: string): string {
  const currentTitle = DEFAULT_WINDOWS[appId]?.title
  const legacyTitles = LEGACY_BUILTIN_WINDOW_TITLES[appId]
  if (currentTitle && legacyTitles?.includes(title)) {
    return currentTitle
  }
  return title
}

const GENERATED_APP_DEFAULTS = { width: 480, height: 640 }

let windowCounter = 0
let zCounter = 10

function createWindow(appId: AppId, titleOverride?: string): WindowState {
  windowCounter += 1
  zCounter += 1
  const defaults = isGeneratedAppId(appId)
    ? { title: titleOverride ?? '微应用', ...GENERATED_APP_DEFAULTS }
    : { ...DEFAULT_WINDOWS[appId], title: titleOverride ?? DEFAULT_WINDOWS[appId]?.title ?? '应用' }
  const { width, height } = resolveWindowDimensions(appId, {
    width: defaults.width,
    height: defaults.height,
  })
  const offset = (windowCounter % 6) * 28

  return {
    id: `${appId}-${windowCounter}`,
    appId,
    title: defaults.title,
    minimized: false,
    maximized: false,
    fullscreen: false,
    zIndex: zCounter,
    x: 80 + offset,
    y: 48 + offset,
    width,
    height,
  }
}

export function OsProvider({ children }: { children: ComponentChildren }) {
  const [windows, setWindows] = useState<WindowState[]>([])
  const [activeWindowId, setActiveWindowId] = useState<string | undefined>(undefined)

  useEffect(() => {
    setWindows((current) =>
      current.map((window) => {
        if (isGeneratedAppId(window.appId)) {
          return window
        }
        const title = resolveBuiltinWindowTitle(window.appId as BuiltinAppId, window.title)
        return title === window.title ? window : { ...window, title }
      }),
    )
  }, [])

  const openApp = useCallback((appId: AppId) => {
    if (isGeneratedAppId(appId)) {
      throw new Error('请使用 openGeneratedApp 打开 AI 生成的应用')
    }

    const existing = windows.find((window) => window.appId === appId && !window.minimized)
    if (existing) {
      zCounter += 1
      const title = resolveBuiltinWindowTitle(appId as BuiltinAppId, existing.title)
      setWindows((current) =>
        current.map((window) =>
          window.id === existing.id
            ? { ...window, zIndex: zCounter, minimized: false, title }
            : window,
        ),
      )
      setActiveWindowId(existing.id)
      return
    }

    const minimized = windows.find((window) => window.appId === appId && window.minimized)
    if (minimized) {
      zCounter += 1
      const title = resolveBuiltinWindowTitle(appId as BuiltinAppId, minimized.title)
      setWindows((current) =>
        current.map((window) =>
          window.id === minimized.id
            ? { ...window, zIndex: zCounter, minimized: false, title }
            : window,
        ),
      )
      setActiveWindowId(minimized.id)
      return
    }

    const nextWindow = createWindow(appId)
    setWindows((current) => [...current, nextWindow])
    setActiveWindowId(nextWindow.id)
  }, [windows])

  const openGeneratedApp = useCallback((appId: GeneratedAppId, title: string) => {
    const existing = windows.find((window) => window.appId === appId && !window.minimized)
    if (existing) {
      zCounter += 1
      setWindows((current) =>
        current.map((window) =>
          window.id === existing.id
            ? { ...window, zIndex: zCounter, minimized: false, title }
            : window,
        ),
      )
      setActiveWindowId(existing.id)
      return
    }

    const minimized = windows.find((window) => window.appId === appId && window.minimized)
    if (minimized) {
      zCounter += 1
      setWindows((current) =>
        current.map((window) =>
          window.id === minimized.id
            ? { ...window, zIndex: zCounter, minimized: false, title }
            : window,
        ),
      )
      setActiveWindowId(minimized.id)
      return
    }

    const nextWindow = createWindow(appId, title)
    setWindows((current) => [...current, nextWindow])
    setActiveWindowId(nextWindow.id)
  }, [windows])

  const closeWindow = useCallback((windowId: string) => {
    setWindows((current) => {
      const closing = current.find((window) => window.id === windowId)
      if (closing) persistWindowSize(closing)
      return current.filter((window) => window.id !== windowId)
    })
    setActiveWindowId((current) => (current === windowId ? undefined : current))
  }, [])

  const closeWindowsForApp = useCallback((appId: AppId) => {
    setWindows((current) => {
      const closingIds = new Set(
        current.filter((window) => window.appId === appId).map((window) => window.id),
      )
      setActiveWindowId((active) => (active && closingIds.has(active) ? undefined : active))
      return current.filter((window) => window.appId !== appId)
    })
  }, [])

  const focusWindow = useCallback((windowId: string) => {
    zCounter += 1
    setWindows((current) =>
      current.map((window) =>
        window.id === windowId ? { ...window, zIndex: zCounter } : window,
      ),
    )
    setActiveWindowId(windowId)
  }, [])

  const moveWindow = useCallback((windowId: string, x: number, y: number) => {
    setWindows((current) =>
      current.map((window) =>
        window.id === windowId && !window.fullscreen && !window.maximized && !window.snap
          ? { ...window, x, y }
          : window,
      ),
    )
  }, [])

  const resizeWindow = useCallback((windowId: string, bounds: WindowRestoredBounds) => {
    setWindows((current) => {
      let resized: WindowState | undefined
      const next = current.map((window) => {
        if (window.id !== windowId || window.fullscreen || window.maximized || window.snap) {
          return window
        }
        resized = { ...window, ...bounds }
        return resized
      })
      if (resized) persistWindowSize(resized)
      return next
    })
  }, [])

  const releaseAnchoredWindow = useCallback((windowId: string, clientX: number, clientY: number) => {
    let dragBounds: WindowRestoredBounds = { x: 0, y: 0, width: 0, height: 0 }

    setWindows((current) =>
      current.map((window) => {
        if (window.id !== windowId) return window

        if (window.snap || window.maximized) {
          const restored = window.restoredBounds ?? {
            x: window.x,
            y: window.y,
            width: window.width,
            height: window.height,
          }
          const pointerOffsetX = Math.min(160, restored.width * 0.5)
          const nextPosition = clampFloatingPosition(
            clientX - pointerOffsetX,
            clientY - 17,
            restored.width,
          )

          dragBounds = {
            x: nextPosition.x,
            y: nextPosition.y,
            width: restored.width,
            height: restored.height,
          }

          return {
            ...window,
            ...dragBounds,
            snap: undefined,
            maximized: false,
            restoredBounds: undefined,
          }
        }

        dragBounds = {
          x: window.x,
          y: window.y,
          width: window.width,
          height: window.height,
        }
        return window
      }),
    )

    return dragBounds
  }, [])

  const applyWindowSnap = useCallback((windowId: string, target: SnapTarget) => {
    setWindows((current) => {
      const targetWindow = current.find((window) => window.id === windowId)
      if (!targetWindow || targetWindow.minimized || targetWindow.fullscreen) return current

      zCounter += 1
      const bounds = getSnapBounds(target)

      return current.map((window) => {
        if (window.id !== windowId) return window

        const restoredBounds =
          window.restoredBounds ??
          (!window.snap && !window.maximized
            ? { x: window.x, y: window.y, width: window.width, height: window.height }
            : {
                x: window.x,
                y: window.y,
                width: window.width,
                height: window.height,
              })

        if (target === 'top') {
          return {
            ...window,
            restoredBounds,
            ...bounds,
            maximized: true,
            snap: undefined,
            zIndex: zCounter,
          }
        }

        return {
          ...window,
          restoredBounds,
          ...bounds,
          maximized: false,
          snap: target,
          zIndex: zCounter,
        }
      })
    })
    setActiveWindowId(windowId)
  }, [])

  const toggleMaximize = useCallback((windowId: string) => {
    setWindows((current) => {
      const target = current.find((window) => window.id === windowId)
      if (!target || target.minimized || target.fullscreen) return current

      zCounter += 1

      if (target.maximized) {
        const restored = target.restoredBounds ?? {
          x: target.x,
          y: target.y,
          width: target.width,
          height: target.height,
        }

        return current.map((window) =>
          window.id === windowId
            ? {
                ...window,
                ...restored,
                maximized: false,
                snap: undefined,
                restoredBounds: undefined,
                zIndex: zCounter,
              }
            : window,
        )
      }

      const bounds = getMaximizedBounds()
      return current.map((window) =>
        window.id === windowId
          ? {
              ...window,
              restoredBounds: {
                x: window.x,
                y: window.y,
                width: window.width,
                height: window.height,
              },
              ...bounds,
              maximized: true,
              snap: undefined,
              zIndex: zCounter,
            }
          : window,
      )
    })
    setActiveWindowId(windowId)
  }, [])

  const toggleFullscreen = useCallback((windowId: string) => {
    setWindows((current) => {
      const target = current.find((window) => window.id === windowId)
      if (!target || target.minimized) return current

      zCounter += 1

      if (target.fullscreen) {
        const restored = target.restoredBounds ?? {
          x: target.x,
          y: target.y,
          width: target.width,
          height: target.height,
        }

        return current.map((window) =>
          window.id === windowId
            ? {
                ...window,
                ...restored,
                fullscreen: false,
                maximized: false,
                snap: undefined,
                restoredBounds: undefined,
                zIndex: zCounter,
              }
            : window,
        )
      }

      const bounds = getFullscreenBounds()
      return current.map((window) => {
        if (window.id === windowId) {
          const restoredBounds = window.restoredBounds ?? {
            x: window.x,
            y: window.y,
            width: window.width,
            height: window.height,
          }

          return {
            ...window,
            restoredBounds,
            ...bounds,
            fullscreen: true,
            maximized: false,
            snap: undefined,
            zIndex: zCounter,
          }
        }

        if (window.fullscreen && window.restoredBounds) {
          return {
            ...window,
            ...window.restoredBounds,
            fullscreen: false,
            maximized: false,
            restoredBounds: undefined,
          }
        }

        return window
      })
    })
    setActiveWindowId(windowId)
  }, [])

  const minimizeWindow = useCallback((windowId: string) => {
    setWindows((current) =>
      current.map((window) =>
        window.id === windowId ? { ...window, minimized: true } : window,
      ),
    )
    setActiveWindowId((current) => (current === windowId ? undefined : current))
  }, [])

  const restoreWindow = useCallback((windowId: string) => {
    zCounter += 1
    setWindows((current) =>
      current.map((window) =>
        window.id === windowId ? { ...window, minimized: false, zIndex: zCounter } : window,
      ),
    )
    setActiveWindowId(windowId)
  }, [])

  const setAppWindowTitle = useCallback((appId: AppId, title: string) => {
    setWindows((current) => {
      const target = current.find((window) => window.appId === appId)
      if (!target || target.title === title) {
        return current
      }
      return current.map((window) => (window.appId === appId ? { ...window, title } : window))
    })
  }, [])

  useEffect(() => {
    const onResize = () => {
      setWindows((current) =>
        current.map((window) => {
          if (window.minimized) {
            if (window.fullscreen) return { ...window, ...getFullscreenBounds() }
            if (window.maximized) return { ...window, ...getMaximizedBounds() }
            if (window.snap === 'left') return { ...window, ...getLeftSnapBounds() }
            if (window.snap === 'right') return { ...window, ...getRightSnapBounds() }
            return window
          }
          if (window.fullscreen) return { ...window, ...getFullscreenBounds() }
          if (window.maximized) return { ...window, ...getMaximizedBounds() }
          if (window.snap === 'left') return { ...window, ...getLeftSnapBounds() }
          if (window.snap === 'right') return { ...window, ...getRightSnapBounds() }
          return window
        }),
      )
    }

    window.addEventListener('resize', onResize)
    return () => window.removeEventListener('resize', onResize)
  }, [])

  const value = useMemo(
    () => ({
      windows,
      activeWindowId,
      openApp,
      openGeneratedApp,
      closeWindow,
      closeWindowsForApp,
      focusWindow,
      moveWindow,
      resizeWindow,
      releaseAnchoredWindow,
      applyWindowSnap,
      toggleFullscreen,
      toggleMaximize,
      minimizeWindow,
      restoreWindow,
      setAppWindowTitle,
    }),
    [windows, activeWindowId, openApp, openGeneratedApp, closeWindow, closeWindowsForApp, focusWindow, moveWindow, resizeWindow, releaseAnchoredWindow, applyWindowSnap, toggleFullscreen, toggleMaximize, minimizeWindow, restoreWindow, setAppWindowTitle],
  )

  return <OsContext.Provider value={value}>{children}</OsContext.Provider>
}

export function useOs() {
  const context = useContext(OsContext)
  if (!context) {
    throw new Error('useOs must be used within OsProvider')
  }
  return context
}
