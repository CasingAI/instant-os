import type { ComponentChildren } from 'preact'
import { createContext } from 'preact'
import { useCallback, useContext, useEffect, useMemo, useRef, useState } from 'preact/hooks'
import { persistWindowSize, resolveWindowDimensions } from '../window/window-bounds-storage.ts'
import { getFullscreenBounds, getMaximizedBounds } from '../window/window-metrics.ts'
import { DOCK_SETTINGS_CHANGED_EVENT } from '../dock/dock-settings-storage.ts'
import { DOCK_VIEWPORT_FIT_CHANGED_EVENT } from '../dock/use-dock-viewport-fit.ts'
import {
  clampFloatingPosition,
  fitFloatingWindowBounds,
  getSnapBounds,
  isNarrowWorkArea,
  reanchorSnappedWindow,
  type SnapTarget,
} from '../window/window-snap.ts'
import { DESKTOP_REVEAL_RESTORE_MS } from '../window/desktop-reveal-timing.ts'
import { closeOpenDesktopFolder } from '../desktop/desktop-open-folder-session.ts'
import type { AppId, BuiltinAppId, GeneratedAppId, ExtAppId, OpenAppOptions, WindowState, WindowRestoredBounds } from './types.ts'
import { isExtAppId, isGeneratedAppId } from './types.ts'

export type AppCloseGuardContext = {
  appId: AppId
  windowId?: string
}

export type AppCloseGuard = (context: AppCloseGuardContext) => boolean

type OsContextValue = {
  windows: WindowState[]
  activeWindowId: string | undefined
  desktopRevealed: boolean
  desktopRevealRestoring: boolean
  toggleDesktopReveal: () => void
  hideDesktopReveal: () => void
  openApp: (appId: AppId, options?: OpenAppOptions) => void
  openGeneratedApp: (appId: GeneratedAppId, title: string) => void
  openExtApp: (appId: ExtAppId, title: string) => void
  closeWindow: (windowId: string) => void
  closeWindowsForApp: (appId: AppId) => void
  finalizeWindowClose: (windowId: string) => void
  registerAppCloseGuard: (appId: AppId, guard: AppCloseGuard | undefined) => void
  bypassAppCloseGuard: (appId: AppId) => void
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
  setAppWindowDocumentId: (appId: AppId, documentId: string | undefined) => void
  setAppWindowDocumentEdited: (appId: AppId, edited: boolean) => void
  closeProcessIsolatedApps: () => void
}

const OsContext = createContext<OsContextValue | undefined>(undefined)

const DEFAULT_WINDOWS: Record<string, Pick<WindowState, 'title' | 'width' | 'height'>> = {
  browser: { title: '网络浏览器', width: 880, height: 720 },
  settings: { title: '系统设置', width: 780, height: 540 },
  photos: { title: '照片', width: 720, height: 620 },
  files: { title: '文件', width: 900, height: 620 },
  textedit: { title: '文本编辑', width: 720, height: 560 },
  mail: { title: '邮件', width: 900, height: 640 },
  news: { title: '新闻', width: 920, height: 620 },
  books: { title: '书架', width: 920, height: 620 },
  weather: { title: '天气', width: 410, height: 680 },
  calendar: { title: '月历', width: 780, height: 540 },
  stocks: { title: '股票', width: 410, height: 680 },
  translate: { title: '翻译', width: 680, height: 520 },
  catgpt: { title: 'CatGPT', width: 860, height: 640 },
  appstore: { title: '应用集市', width: 820, height: 720 },
  'scene3d-lab': { title: '3D 实验室', width: 1180, height: 760 },
  'model-vision': { title: '模型识图', width: 1100, height: 740 },
  icode: { title: 'iCode', width: 1280, height: 720 },
  gomoku: { title: '五子棋', width: 760, height: 680 },
  speech: { title: '语音实验室', width: 720, height: 640 },
  'system-info': { title: '系统信息', width: 680, height: 480 },
  'task-manager': { title: '性能监视器', width: 760, height: 560 },
  'event-log': { title: '事件日志', width: 900, height: 620 },
  keychain: { title: '钥匙串', width: 680, height: 560 },
  help: { title: '帮助', width: 820, height: 640 },
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

function bumpZIndex(): number {
  zCounter += 1
  return zCounter
}

function createWindow(
  appId: AppId,
  titleOverride?: string,
  options?: { enterAnimation?: WindowState['enterAnimation']; documentId?: string },
): WindowState {
  windowCounter += 1
  const nextZ = bumpZIndex()
  const defaults = isGeneratedAppId(appId) || isExtAppId(appId)
    ? { title: titleOverride ?? '微应用', ...GENERATED_APP_DEFAULTS }
    : { ...DEFAULT_WINDOWS[appId], title: titleOverride ?? DEFAULT_WINDOWS[appId]?.title ?? '应用' }
  const { width, height } = resolveWindowDimensions(appId, {
    width: defaults.width,
    height: defaults.height,
  })
  const offset = (windowCounter % 6) * 28
  const cascadeX = 80 + offset
  const cascadeY = 48 + offset

  if (isNarrowWorkArea()) {
    const restoredBounds = fitFloatingWindowBounds(cascadeX, cascadeY, width, height)
    return {
      id: `${appId}-${windowCounter}`,
      appId,
      title: defaults.title,
      documentId: options?.documentId,
      minimized: false,
      maximized: true,
      fullscreen: false,
      zIndex: nextZ,
      restoredBounds,
      ...getMaximizedBounds(),
      enterAnimation: options?.enterAnimation,
    }
  }

  const bounds = fitFloatingWindowBounds(cascadeX, cascadeY, width, height)

  return {
    id: `${appId}-${windowCounter}`,
    appId,
    title: defaults.title,
    documentId: options?.documentId,
    minimized: false,
    maximized: false,
    fullscreen: false,
    zIndex: nextZ,
    ...bounds,
    enterAnimation: options?.enterAnimation,
  }
}

export function OsProvider({ children }: { children: ComponentChildren }) {
  const [windows, setWindows] = useState<WindowState[]>([])
  const [activeWindowId, setActiveWindowId] = useState<string | undefined>(undefined)
  const [desktopRevealed, setDesktopRevealed] = useState(false)
  const [desktopRevealRestoring, setDesktopRevealRestoring] = useState(false)
  const desktopRevealedRef = useRef(false)

  useEffect(() => {
    desktopRevealedRef.current = desktopRevealed
  }, [desktopRevealed])

  const startDesktopRestore = useCallback(() => {
    if (!desktopRevealedRef.current) {
      return
    }
    setDesktopRevealed(false)
    setDesktopRevealRestoring(true)
  }, [])

  useEffect(() => {
    if (!desktopRevealRestoring) {
      return
    }
    const timer = window.setTimeout(() => setDesktopRevealRestoring(false), DESKTOP_REVEAL_RESTORE_MS)
    return () => window.clearTimeout(timer)
  }, [desktopRevealRestoring])

  const hideDesktopReveal = startDesktopRestore

  const toggleDesktopReveal = useCallback(() => {
    if (desktopRevealedRef.current) {
      startDesktopRestore()
      return
    }
    setActiveWindowId(undefined)
    setDesktopRevealed(true)
  }, [startDesktopRestore])

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

  const closeGuardsRef = useRef(new Map<AppId, AppCloseGuard>())
  const bypassCloseGuardRef = useRef(new Set<AppId>())
  const windowsRef = useRef(windows)
  windowsRef.current = windows

  const openApp = useCallback((appId: AppId, options?: OpenAppOptions) => {
    if (isGeneratedAppId(appId)) {
      throw new Error('请使用 openGeneratedApp 打开 AI 生成的应用')
    }
    if (isExtAppId(appId)) {
      throw new Error('请使用 openExtApp 打开外链应用')
    }

    startDesktopRestore()
    closeOpenDesktopFolder()

    let resolvedActiveId: string | undefined
    const documentId = options?.documentId

    setWindows((current) => {
      const live = current.filter((window) => !window.closing)
      const existing = live.find((window) => window.appId === appId && !window.minimized)
      if (existing) {
        resolvedActiveId = existing.id
        const nextZ = bumpZIndex()
        const resolvedTitle = resolveBuiltinWindowTitle(appId as BuiltinAppId, existing.title)
        return current.map((window) =>
          window.id === existing.id
            ? {
                ...window,
                zIndex: nextZ,
                minimized: false,
                title: resolvedTitle,
                ...(documentId !== undefined ? { documentId } : {}),
              }
            : window,
        )
      }

      const minimized = live.find((window) => window.appId === appId && window.minimized)
      if (minimized) {
        resolvedActiveId = minimized.id
        const nextZ = bumpZIndex()
        const resolvedTitle = resolveBuiltinWindowTitle(appId as BuiltinAppId, minimized.title)
        return current.map((window) =>
          window.id === minimized.id
            ? {
                ...window,
                zIndex: nextZ,
                minimized: false,
                title: resolvedTitle,
                ...(documentId !== undefined ? { documentId } : {}),
              }
            : window,
        )
      }

      const nextWindow = createWindow(appId, undefined, {
        enterAnimation: 'scale-in',
        documentId,
      })
      resolvedActiveId = nextWindow.id
      return [...current, nextWindow]
    })

    if (resolvedActiveId !== undefined) {
      setActiveWindowId(resolvedActiveId)
    }
  }, [startDesktopRestore])

  const setAppWindowDocumentId = useCallback((appId: AppId, documentId: string | undefined) => {
    setWindows((current) =>
      current.map((window) =>
        window.appId === appId && !window.closing
          ? { ...window, documentId }
          : window,
      ),
    )
  }, [])

  const setAppWindowDocumentEdited = useCallback((appId: AppId, edited: boolean) => {
    setWindows((current) => {
      const target = current.find((window) => window.appId === appId && !window.closing)
      if (!target || target.documentEdited === edited) {
        return current
      }
      return current.map((window) =>
        window.appId === appId && !window.closing
          ? { ...window, documentEdited: edited }
          : window,
      )
    })
  }, [])

  const openGeneratedApp = useCallback((appId: GeneratedAppId, title: string) => {
    startDesktopRestore()
    closeOpenDesktopFolder()

    let resolvedActiveId: string | undefined

    setWindows((current) => {
      const live = current.filter((window) => !window.closing)
      const existing = live.find((window) => window.appId === appId && !window.minimized)
      if (existing) {
        resolvedActiveId = existing.id
        const nextZ = bumpZIndex()
        return current.map((window) =>
          window.id === existing.id
            ? { ...window, zIndex: nextZ, minimized: false, title }
            : window,
        )
      }

      const minimized = live.find((window) => window.appId === appId && window.minimized)
      if (minimized) {
        resolvedActiveId = minimized.id
        const nextZ = bumpZIndex()
        return current.map((window) =>
          window.id === minimized.id
            ? { ...window, zIndex: nextZ, minimized: false, title }
            : window,
        )
      }

      const nextWindow = createWindow(appId, title, { enterAnimation: 'scale-in' })
      resolvedActiveId = nextWindow.id
      return [...current, nextWindow]
    })

    if (resolvedActiveId !== undefined) {
      setActiveWindowId(resolvedActiveId)
    }
  }, [startDesktopRestore])

  const openExtApp = useCallback((appId: ExtAppId, title: string) => {
    startDesktopRestore()
    closeOpenDesktopFolder()

    let resolvedActiveId: string | undefined

    setWindows((current) => {
      const live = current.filter((window) => !window.closing)
      const existing = live.find((window) => window.appId === appId && !window.minimized)
      if (existing) {
        resolvedActiveId = existing.id
        const nextZ = bumpZIndex()
        return current.map((window) =>
          window.id === existing.id
            ? { ...window, zIndex: nextZ, minimized: false, title }
            : window,
        )
      }

      const minimized = live.find((window) => window.appId === appId && window.minimized)
      if (minimized) {
        resolvedActiveId = minimized.id
        const nextZ = bumpZIndex()
        return current.map((window) =>
          window.id === minimized.id
            ? { ...window, zIndex: nextZ, minimized: false, title }
            : window,
        )
      }

      const nextWindow = createWindow(appId, title, { enterAnimation: 'scale-in' })
      resolvedActiveId = nextWindow.id
      return [...current, nextWindow]
    })

    if (resolvedActiveId !== undefined) {
      setActiveWindowId(resolvedActiveId)
    }
  }, [startDesktopRestore])

  const registerAppCloseGuard = useCallback((appId: AppId, guard: AppCloseGuard | undefined) => {
    if (guard) {
      closeGuardsRef.current.set(appId, guard)
      return
    }
    closeGuardsRef.current.delete(appId)
  }, [])

  const bypassAppCloseGuard = useCallback((appId: AppId) => {
    bypassCloseGuardRef.current.add(appId)
  }, [])

  const shouldAllowAppClose = useCallback((appId: AppId, windowId?: string) => {
    if (bypassCloseGuardRef.current.has(appId)) {
      bypassCloseGuardRef.current.delete(appId)
      return true
    }

    const guard = closeGuardsRef.current.get(appId)
    if (!guard) {
      return true
    }

    return guard({ appId, windowId })
  }, [])

  const finalizeWindowClose = useCallback((windowId: string) => {
    setWindows((current) => {
      const target = current.find((window) => window.id === windowId)
      if (!target?.closing) {
        return current
      }
      persistWindowSize(target)
      return current.filter((window) => window.id !== windowId)
    })
  }, [])

  const closeWindow = useCallback((windowId: string) => {
    const closing = windowsRef.current.find((window) => window.id === windowId)
    if (!closing || closing.closing) {
      return
    }

    if (!shouldAllowAppClose(closing.appId, windowId)) {
      return
    }

    setWindows((current) =>
      current.map((window) =>
        window.id === windowId ? { ...window, closing: true } : window,
      ),
    )
    setActiveWindowId((current) => (current === windowId ? undefined : current))
  }, [shouldAllowAppClose])

  const closeWindowsForApp = useCallback((appId: AppId) => {
    const appWindows = windowsRef.current.filter((window) => window.appId === appId && !window.closing)
    if (appWindows.length === 0) {
      return
    }

    if (!shouldAllowAppClose(appId, appWindows[0]?.id)) {
      return
    }

    const closingIds = new Set(appWindows.map((window) => window.id))

    setWindows((current) =>
      current.map((window) =>
        closingIds.has(window.id) ? { ...window, closing: true } : window,
      ),
    )
    setActiveWindowId((active) => (active && closingIds.has(active) ? undefined : active))
  }, [shouldAllowAppClose])

  const closeProcessIsolatedApps = useCallback(() => {
    const appIds = new Set<AppId>()
    for (const window of windowsRef.current) {
      if (!window.closing && (isGeneratedAppId(window.appId) || window.appId === 'icode')) {
        appIds.add(window.appId)
      }
    }

    for (const appId of appIds) {
      closeWindowsForApp(appId)
    }
  }, [closeWindowsForApp])

  const focusWindow = useCallback((windowId: string) => {
    startDesktopRestore()
    const nextZ = bumpZIndex()
    setWindows((current) =>
      current.map((window) =>
        window.id === windowId ? { ...window, zIndex: nextZ } : window,
      ),
    )
    setActiveWindowId(windowId)
  }, [startDesktopRestore])

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
        if (window.id !== windowId || window.fullscreen) {
          return window
        }
        resized = window.maximized
          ? {
              ...window,
              ...bounds,
              maximized: false,
              restoredBounds: undefined,
            }
          : { ...window, ...bounds }
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
            restored.height,
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
    const nextZ = bumpZIndex()
    setWindows((current) => {
      const targetWindow = current.find((window) => window.id === windowId)
      if (!targetWindow || targetWindow.minimized || targetWindow.fullscreen) return current

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
            zIndex: nextZ,
          }
        }

        return {
          ...window,
          restoredBounds,
          ...bounds,
          maximized: false,
          snap: target,
          zIndex: nextZ,
        }
      })
    })
    setActiveWindowId(windowId)
  }, [])

  const toggleMaximize = useCallback((windowId: string) => {
    const nextZ = bumpZIndex()
    setWindows((current) => {
      const target = current.find((window) => window.id === windowId)
      if (!target || target.minimized || target.fullscreen) return current

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
                zIndex: nextZ,
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
              zIndex: nextZ,
            }
          : window,
      )
    })
    setActiveWindowId(windowId)
  }, [])

  const toggleFullscreen = useCallback((windowId: string) => {
    const nextZ = bumpZIndex()
    setWindows((current) => {
      const target = current.find((window) => window.id === windowId)
      if (!target || target.minimized) return current

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
                zIndex: nextZ,
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
            zIndex: nextZ,
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
    startDesktopRestore()
    closeOpenDesktopFolder()
    const nextZ = bumpZIndex()
    setWindows((current) =>
      current.map((window) =>
        window.id === windowId ? { ...window, minimized: false, zIndex: nextZ } : window,
      ),
    )
    setActiveWindowId(windowId)
  }, [startDesktopRestore])

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
    const reflowWindows = () => {
      setWindows((current) =>
        current.map((window) => {
          if (window.minimized) {
            if (window.fullscreen) return { ...window, ...getFullscreenBounds() }
            if (window.maximized) return { ...window, ...getMaximizedBounds() }
            if (window.snap) return { ...window, ...reanchorSnappedWindow(window) }
            return window
          }
          if (window.fullscreen) return { ...window, ...getFullscreenBounds() }
          if (window.maximized) return { ...window, ...getMaximizedBounds() }
          if (window.snap) return { ...window, ...reanchorSnappedWindow(window) }
          return { ...window, ...fitFloatingWindowBounds(window.x, window.y, window.width, window.height) }
        }),
      )
    }

    window.addEventListener('resize', reflowWindows)
    window.addEventListener(DOCK_SETTINGS_CHANGED_EVENT, reflowWindows)
    window.addEventListener(DOCK_VIEWPORT_FIT_CHANGED_EVENT, reflowWindows)
    return () => {
      window.removeEventListener('resize', reflowWindows)
      window.removeEventListener(DOCK_SETTINGS_CHANGED_EVENT, reflowWindows)
      window.removeEventListener(DOCK_VIEWPORT_FIT_CHANGED_EVENT, reflowWindows)
    }
  }, [])

  const value = useMemo(
    () => ({
      windows,
      activeWindowId,
      desktopRevealed,
      desktopRevealRestoring,
      toggleDesktopReveal,
      hideDesktopReveal,
      openApp,
      openGeneratedApp,
      openExtApp,
      closeWindow,
      closeWindowsForApp,
      finalizeWindowClose,
      registerAppCloseGuard,
      bypassAppCloseGuard,
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
      setAppWindowDocumentId,
      setAppWindowDocumentEdited,
      closeProcessIsolatedApps,
    }),
    [windows, activeWindowId, desktopRevealed, desktopRevealRestoring, toggleDesktopReveal, hideDesktopReveal, openApp, openGeneratedApp, openExtApp, closeWindow, closeWindowsForApp, finalizeWindowClose, registerAppCloseGuard, bypassAppCloseGuard, focusWindow, moveWindow, resizeWindow, releaseAnchoredWindow, applyWindowSnap, toggleFullscreen, toggleMaximize, minimizeWindow, restoreWindow, setAppWindowTitle, setAppWindowDocumentId, setAppWindowDocumentEdited, closeProcessIsolatedApps],
  )

  return <OsContext.Provider value={value}>{children}</OsContext.Provider>
}

export function useAppCloseGuard(appId: AppId, guard: AppCloseGuard) {
  const { registerAppCloseGuard } = useOs()
  const guardRef = useRef(guard)
  guardRef.current = guard

  useEffect(() => {
    registerAppCloseGuard(appId, (context) => guardRef.current(context))
    return () => registerAppCloseGuard(appId, undefined)
  }, [appId, registerAppCloseGuard])
}

export function useOs() {
  const context = useContext(OsContext)
  if (!context) {
    throw new Error('useOs must be used within OsProvider')
  }
  return context
}
