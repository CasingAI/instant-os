import type { ComponentChildren } from 'preact'
import { createContext } from 'preact'
import { useCallback, useContext, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'preact/hooks'
import { persistWindowSize, resolveWindowDimensions } from '../window/window-bounds-storage.ts'
import { getFullscreenBounds, getMaximizedBounds } from '../window/window-metrics.ts'
import {
  MIN_DIALOG_WINDOW_HEIGHT,
  MIN_DIALOG_WINDOW_WIDTH,
} from '../window/window-resize.ts'
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
import {
  appendFlip3dGhost,
  createFlip3dGhost,
  cycleFlip3dOrder,
  dismissFlip3dGhost,
  FLIP3D_RESTORE_MS,
  FLIP3D_SHADOW_IN_MS,
  listFlip3dWindowIds,
  peeledFlip3dWindowId,
  type Flip3dEnterResult,
  type Flip3dGhost,
} from '../window/flip3d.ts'
import { closeOpenDesktopFolder } from '../desktop/desktop-open-folder-session.ts'
import { startBackgroundRefreshService } from './background-refresh-service.ts'
import { startSystemServices } from './system-services.ts'
import { isMultiWindowApp } from './app-multi-window.ts'
import { isWindowlessApp } from './app-windowless.ts'
import { resolveSingleWindowForApp } from './single-window.ts'
import { registerOsOpenApp } from './os-open-app-bridge.ts'
import { enqueueTerminalPendingAction } from '../terminal/terminal-pending-actions.ts'
import { WEBVIEW_OFFSCREEN_VIEWPORT } from '../apps/webview/webview-constants.ts'
import { isBuiltinAppId } from './builtin-app-display-names.ts'
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
  flip3dActive: boolean
  flip3dRestoring: boolean
  flip3dEntering: boolean
  flip3dOrder: string[]
  flip3dSnapIds: string[]
  flip3dGhosts: Flip3dGhost[]
  flip3dShadowReveal: 'off' | 'hold' | 'fade' | 'settle'
  enterFlip3d: () => Flip3dEnterResult
  cycleFlip3d: (delta: 1 | -1) => void
  dismissFlip3dGhostFrame: (ghostId: string) => void
  exitFlip3d: (windowId?: string) => void
  openApp: (appId: AppId, options?: OpenAppOptions) => string | undefined
  openGeneratedApp: (appId: GeneratedAppId, title: string) => void
  openExtApp: (appId: ExtAppId, title: string) => void
  closeWindow: (windowId: string) => void
  closeWindowsForApp: (appId: AppId) => void
  finalizeWindowClose: (windowId: string) => void
  registerAppCloseGuard: (appId: AppId, guard: AppCloseGuard | undefined) => void
  bypassAppCloseGuard: (appId: AppId) => void
  registerWindowCloseGuard: (windowId: string, guard: AppCloseGuard | undefined) => void
  bypassWindowCloseGuard: (windowId: string) => void
  cancelPendingAppQuit: (appId: AppId) => void
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
  setAppWindowUrl: (appId: AppId, url: string | undefined) => void
  setAppWindowDocumentEdited: (appId: AppId, edited: boolean) => void
  setWindowTitle: (windowId: string, title: string) => void
  setWindowDocumentId: (windowId: string, documentId: string | undefined) => void
  setWindowDocumentEdited: (windowId: string, edited: boolean) => void
  setWindowDocumentReadOnly: (windowId: string, readOnly: boolean) => void
  /**
   * 将无窗口会话展开为可拖动的系统面板窗口（统一标题栏）。
   * 用于解压进度等；默认按小型对话框样式（只提供关闭键）。
   */
  revealWindowlessPanel: (
    windowId: string,
    options?: {
      title?: string
      width?: number
      height?: number
      chromeKind?: 'window' | 'dialog'
      chromeCloseDisabled?: boolean
      chromeMinimizeDisabled?: boolean
      chromeZoomDisabled?: boolean
    },
  ) => void
  closeProcessIsolatedApps: () => void
}

const OsContext = createContext<OsContextValue | undefined>(undefined)

const DEFAULT_WINDOWS: Record<BuiltinAppId, Pick<WindowState, 'title' | 'width' | 'height'>> = {
  browser: { title: '网页浏览器', width: 880, height: 720 },
  chromo: { title: 'Chromo', width: 960, height: 720 },
  'page-devtools': { title: '开发者工具', width: 720, height: 480 },
  webview: {
    title: 'WebView',
    width: WEBVIEW_OFFSCREEN_VIEWPORT.width,
    height: WEBVIEW_OFFSCREEN_VIEWPORT.height,
  },
  settings: { title: '系统设置', width: 780, height: 540 },
  files: { title: '文件', width: 900, height: 620 },
  'file-info': { title: '文件信息', width: 340, height: 520 },
  textedit: { title: '文本编辑', width: 720, height: 560 },
  pages: { title: '文稿', width: 840, height: 720 },
  preview: { title: '预览', width: 780, height: 640 },
  vscode: { title: 'Virtual Studio Code Desktop', width: 1100, height: 720 },
  mail: { title: '邮件', width: 900, height: 640 },
  news: { title: '新闻', width: 920, height: 620 },
  books: { title: '书架', width: 920, height: 620 },
  music: { title: '音乐', width: 820, height: 600 },
  stems: { title: '音乐实验室', width: 860, height: 640 },
  weather: { title: '天气', width: 410, height: 680 },
  calendar: { title: '月历', width: 780, height: 540 },
  stocks: { title: '股票', width: 410, height: 680 },
  translate: { title: '翻译', width: 680, height: 520 },
  catgpt: { title: 'CatGPT', width: 860, height: 640 },
  produde: { title: 'ProDude', width: 860, height: 640 },
  appstore: { title: '应用集市', width: 820, height: 720 },
  'scene3d-lab': { title: '3D 实验室', width: 1180, height: 760 },
  'pose-lab': { title: '视角实验室', width: 980, height: 640 },
  'model-vision': { title: '模型识图', width: 1100, height: 740 },
  icode: { title: 'iCode', width: 1280, height: 720 },
  registry: { title: '注册表', width: 720, height: 580 },
  gomoku: { title: '五子棋', width: 760, height: 680 },
  speech: { title: '语音实验室', width: 720, height: 640 },
  'system-info': { title: '系统信息', width: 680, height: 480 },
  'task-manager': { title: '性能监视器', width: 760, height: 560 },
  services: { title: '服务', width: 820, height: 560 },
  'event-log': { title: '事件日志', width: 900, height: 620 },
  keychain: { title: '钥匙串', width: 680, height: 560 },
  'github-desktop': { title: 'GitHub Desktop', width: 980, height: 680 },
  help: { title: '帮助', width: 820, height: 640 },
  terminal: { title: '终端', width: 760, height: 520 },
  /** @deprecated 模拟终端已弃用，窗口尺寸保留仅为过渡，后续移除 */
  'simulated-terminal': { title: '模拟终端', width: 760, height: 520 },
  'archive-utility': { title: '压缩包实用工具', width: 860, height: 560 },
  'space-sniffer': { title: '空间嗅探', width: 1020, height: 720 },
  packages: { title: '包管理', width: 720, height: 520 },
  'virtual-js': { title: 'Virtual JS', width: 860, height: 640 },
  'ui-kit': { title: 'UI 组件库', width: 980, height: 700 },
  'srml-demo': { title: 'SRML 演示', width: 1040, height: 700 },
  'midi-demo': { title: 'MIDI 演示', width: 960, height: 680 },
  'llm-playground': { title: 'LLM Playground', width: 1060, height: 720 },
  attunebench: { title: '评测', width: 900, height: 700 },
  welcome: { title: '欢迎中心', width: 900, height: 600 },
  'welcome-next': { title: '欢迎', width: 680, height: 640 },
  'welcome-hello': { title: '你好', width: 720, height: 540 },
}

const LEGACY_BUILTIN_WINDOW_TITLES: Partial<Record<BuiltinAppId, readonly string[]>> = {
  appstore: ['App Store'],
  welcome: ['欢迎'],
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

/** 剩余可见窗中 zIndex 最高的一扇；无可选时返回 undefined。 */
function pickTopVisibleWindowId(
  windows: WindowState[],
  excludeIds?: ReadonlySet<string>,
): string | undefined {
  let topId: string | undefined
  let topZ = -Infinity
  for (const window of windows) {
    if (excludeIds?.has(window.id) || window.closing || window.minimized) {
      continue
    }
    // 未展开的无窗口会话不算「可见窗」
    if (window.windowless && !window.windowlessPanel) {
      continue
    }
    if (window.zIndex > topZ) {
      topZ = window.zIndex
      topId = window.id
    }
  }
  return topId
}

function createWindow(
  appId: AppId,
  titleOverride?: string,
  options?: {
    enterAnimation?: WindowState['enterAnimation']
    documentId?: string
    url?: string
  },
): WindowState {
  windowCounter += 1
  const nextZ = bumpZIndex()
  const windowless = isWindowlessApp(appId)
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

  // 无窗口应用：不占可视窗框，也不走窄屏最大化；尺寸先按默认面板居中，
  // 避免之后展开时 left/top 过渡从 (0,0) 飘到屏幕中央。
  // 对话框高度不受普通窗口 MIN_WINDOW_HEIGHT(160) 约束。
  if (windowless) {
    const panelWidth = Math.max(MIN_DIALOG_WINDOW_WIDTH, defaults.width ?? width)
    const panelHeight = Math.max(MIN_DIALOG_WINDOW_HEIGHT, defaults.height ?? height)
    const work = getMaximizedBounds()
    const x = Math.round(work.x + Math.max(0, (work.width - panelWidth) / 2))
    const y = Math.round(work.y + Math.max(24, (work.height - panelHeight) / 3))
    const bounds = fitFloatingWindowBounds(x, y, panelWidth, panelHeight, {
      minWidth: MIN_DIALOG_WINDOW_WIDTH,
      minHeight: MIN_DIALOG_WINDOW_HEIGHT,
    })
    return {
      id: `${appId}-${windowCounter}`,
      appId,
      title: defaults.title,
      documentId: options?.documentId,
      url: options?.url,
      minimized: false,
      maximized: false,
      fullscreen: false,
      windowless: true,
      zIndex: nextZ,
      ...bounds,
    }
  }

  if (isNarrowWorkArea()) {
    const restoredBounds = fitFloatingWindowBounds(cascadeX, cascadeY, width, height)
    return {
      id: `${appId}-${windowCounter}`,
      appId,
      title: defaults.title,
      documentId: options?.documentId,
      url: options?.url,
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
    url: options?.url,
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
  const windowsRef = useRef(windows)
  const [activeWindowId, setActiveWindowId] = useState<string | undefined>(undefined)
  const [desktopRevealed, setDesktopRevealed] = useState(false)
  const [desktopRevealRestoring, setDesktopRevealRestoring] = useState(false)
  const desktopRevealedRef = useRef(false)
  const [flip3dActive, setFlip3dActive] = useState(false)
  const [flip3dRestoring, setFlip3dRestoring] = useState(false)
  const [flip3dEntering, setFlip3dEntering] = useState(false)
  const [flip3dOrder, setFlip3dOrder] = useState<string[]>([])
  const [flip3dSnapIds, setFlip3dSnapIds] = useState<string[]>([])
  const [flip3dGhosts, setFlip3dGhosts] = useState<Flip3dGhost[]>([])
  const [flip3dShadowReveal, setFlip3dShadowReveal] = useState<'off' | 'hold' | 'fade' | 'settle'>(
    'off',
  )
  const flip3dActiveRef = useRef(false)
  const flip3dOrderRef = useRef<string[]>([])
  const flip3dAnimGenRef = useRef(0)
  const flip3dCycleTimerRef = useRef<number | undefined>(undefined)
  const flip3dGhostSeqRef = useRef(0)

  useEffect(() => {
    desktopRevealedRef.current = desktopRevealed
  }, [desktopRevealed])

  useEffect(() => {
    flip3dActiveRef.current = flip3dActive
  }, [flip3dActive])

  useEffect(() => {
    flip3dOrderRef.current = flip3dOrder
  }, [flip3dOrder])

  const clearFlip3dGhosts = useCallback(() => {
    setFlip3dGhosts([])
  }, [])

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

  const bumpFlip3dAnim = useCallback(() => {
    flip3dAnimGenRef.current += 1
    if (flip3dCycleTimerRef.current !== undefined) {
      window.clearTimeout(flip3dCycleTimerRef.current)
      flip3dCycleTimerRef.current = undefined
    }
    return flip3dAnimGenRef.current
  }, [])

  const raiseWindow = useCallback((windowId: string) => {
    const nextZ = bumpZIndex()
    setWindows((current) =>
      current.map((window) =>
        window.id === windowId ? { ...window, zIndex: nextZ } : window,
      ),
    )
    setActiveWindowId(windowId)
  }, [])

  const applyFlip3dOrder = useCallback((next: string[]) => {
    flip3dOrderRef.current = next
    setFlip3dOrder(next)
  }, [])

  const startFlip3dRestore = useCallback((focusId?: string) => {
    if (!flip3dActiveRef.current) {
      return
    }
    bumpFlip3dAnim()
    clearFlip3dGhosts()
    setFlip3dSnapIds([])
    setFlip3dEntering(false)
    if (focusId) {
      raiseWindow(focusId)
    }
    setFlip3dActive(false)
    setFlip3dRestoring(true)
  }, [bumpFlip3dAnim, clearFlip3dGhosts, raiseWindow])

  useEffect(() => {
    if (!flip3dRestoring) {
      return
    }
    // CSS 过渡比 timeout 晚一帧才起；多留一截再拆 3D 场景，避免落地瞬间改 class 顿一下。
    const timer = window.setTimeout(() => {
      setFlip3dRestoring(false)
      setFlip3dOrder([])
      setFlip3dShadowReveal('hold')
    }, FLIP3D_RESTORE_MS + 80)
    return () => window.clearTimeout(timer)
  }, [flip3dRestoring])

  useLayoutEffect(() => {
    if (flip3dShadowReveal !== 'hold') {
      return
    }
    let inner = 0
    const outer = window.requestAnimationFrame(() => {
      inner = window.requestAnimationFrame(() => {
        setFlip3dShadowReveal('fade')
      })
    })
    return () => {
      window.cancelAnimationFrame(outer)
      window.cancelAnimationFrame(inner)
    }
  }, [flip3dShadowReveal])

  useEffect(() => {
    if (flip3dShadowReveal !== 'fade') {
      return
    }
    const timer = window.setTimeout(() => setFlip3dShadowReveal('settle'), FLIP3D_SHADOW_IN_MS)
    return () => window.clearTimeout(timer)
  }, [flip3dShadowReveal])

  useLayoutEffect(() => {
    if (flip3dShadowReveal !== 'settle') {
      return
    }
    const frame = window.requestAnimationFrame(() => {
      setFlip3dShadowReveal('off')
    })
    return () => window.cancelAnimationFrame(frame)
  }, [flip3dShadowReveal])

  const enterFlip3d = useCallback((): Flip3dEnterResult => {
    if (flip3dActiveRef.current) {
      return 'already-active'
    }
    const ids = listFlip3dWindowIds(windowsRef.current)
    if (ids.length === 0) {
      return 'empty'
    }
    if (desktopRevealedRef.current) {
      startDesktopRestore()
    }
    closeOpenDesktopFolder()
    bumpFlip3dAnim()
    clearFlip3dGhosts()
    setFlip3dSnapIds([])
    setFlip3dRestoring(false)
    setFlip3dShadowReveal('off')
    applyFlip3dOrder(ids)
    // 保持 enter 过渡直到第一次切换/退出。到点改时长会把快结束的动画重开一截，末尾就会顿一下。
    setFlip3dEntering(true)
    setFlip3dActive(true)
    return 'entered'
  }, [applyFlip3dOrder, bumpFlip3dAnim, clearFlip3dGhosts, startDesktopRestore])

  const dismissFlip3dGhostFrame = useCallback((ghostId: string) => {
    setFlip3dGhosts((current) => dismissFlip3dGhost(current, ghostId))
  }, [])

  useLayoutEffect(() => {
    if (flip3dSnapIds.length === 0) {
      return
    }
    let inner = 0
    const outer = window.requestAnimationFrame(() => {
      inner = window.requestAnimationFrame(() => {
        setFlip3dSnapIds([])
      })
    })
    return () => {
      window.cancelAnimationFrame(outer)
      window.cancelAnimationFrame(inner)
    }
  }, [flip3dSnapIds])

  const cycleFlip3d = useCallback((delta: 1 | -1) => {
    if (!flip3dActiveRef.current) {
      return
    }
    setFlip3dEntering(false)
    const order = flip3dOrderRef.current
    const peeledId = peeledFlip3dWindowId(order, delta)
    if (!peeledId) {
      return
    }
    const peeled = windowsRef.current.find((window) => window.id === peeledId)
    if (peeled) {
      flip3dGhostSeqRef.current += 1
      setFlip3dGhosts((current) =>
        appendFlip3dGhost(
          current,
          createFlip3dGhost(peeled, delta, `flip3d-ghost-${flip3dGhostSeqRef.current}`),
        ),
      )
    }
    setFlip3dSnapIds([peeledId])
    applyFlip3dOrder(cycleFlip3dOrder(order, delta))
  }, [applyFlip3dOrder])

  const exitFlip3d = useCallback((windowId?: string) => {
    if (!flip3dActiveRef.current) {
      return
    }
    const targetId = windowId ?? flip3dOrderRef.current[0]
    startFlip3dRestore(targetId)
  }, [startFlip3dRestore])

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

  // 系统级背景刷新：随 OS 挂载启动，按用户设置的间隔定期更新模型定价等远端数据
  useEffect(() => startBackgroundRefreshService(), [])
  // 系统服务：按启动类型（自动/延迟/手动/禁用）开机拉起
  useEffect(() => startSystemServices(), [])

  const closeGuardsRef = useRef(new Map<AppId, AppCloseGuard>())
  const bypassCloseGuardRef = useRef(new Set<AppId>())
  const windowCloseGuardsRef = useRef(new Map<string, AppCloseGuard>())
  const bypassWindowCloseGuardRef = useRef(new Set<string>())
  const pendingQuitAppsRef = useRef(new Set<AppId>())
  windowsRef.current = windows

  useEffect(() => {
    if (!flip3dActive) {
      return
    }
    const liveIds = new Set(listFlip3dWindowIds(windows))
    setFlip3dOrder((current) => {
      const next = current.filter((id) => liveIds.has(id))
      if (next.length === current.length && next.every((id, index) => id === current[index])) {
        return current
      }
      return next
    })
    setFlip3dGhosts((current) => {
      const next = current.filter((ghost) => liveIds.has(ghost.windowId))
      return next.length === current.length ? current : next
    })
  }, [windows, flip3dActive])

  useEffect(() => {
    if (flip3dActive && flip3dOrder.length === 0) {
      startFlip3dRestore()
    }
  }, [flip3dActive, flip3dOrder.length, startFlip3dRestore])

  const openApp = useCallback((appId: AppId, options?: OpenAppOptions): string | undefined => {
    if (isGeneratedAppId(appId)) {
      throw new Error('请使用 openGeneratedApp 打开 AI 生成的应用')
    }
    if (isExtAppId(appId)) {
      throw new Error('请使用 openExtApp 打开外链应用')
    }
    if (!isBuiltinAppId(appId)) {
      throw new Error(`未找到应用: ${appId}`)
    }

    /** @deprecated 模拟终端已弃用，此 terminalAction 注入逻辑保留仅为过渡，后续移除 */
    if (appId === 'simulated-terminal' && options?.terminalAction) {
      enqueueTerminalPendingAction(options.terminalAction)
    }

    startDesktopRestore()
    closeOpenDesktopFolder()

    let resolvedActiveId: string | undefined
    const documentId = options?.documentId
    const url = options?.url
    if (documentId !== undefined && url !== undefined) {
      throw new Error('documentId 与 url 不能同时指定')
    }
    const multiWindow = isMultiWindowApp(appId)

    const applyOpenPayload = <T extends WindowState>(window: T): T => {
      if (documentId !== undefined) {
        return { ...window, documentId, url: undefined }
      }
      if (url !== undefined) {
        return { ...window, url, documentId: undefined }
      }
      return window
    }

    setWindows((current) => {
      const live = current.filter((window) => !window.closing)

      if (multiWindow) {
        if (documentId !== undefined) {
          const sameDocument = live.find((window) => window.appId === appId && window.documentId === documentId)
          if (sameDocument) {
            resolvedActiveId = sameDocument.id
            const nextZ = bumpZIndex()
            const next = current.map((window) =>
              window.id === sameDocument.id
                ? { ...window, zIndex: nextZ, minimized: false }
                : window,
            )
            windowsRef.current = next
            return next
          }
        }

        const nextWindow = createWindow(appId, undefined, {
          enterAnimation: isWindowlessApp(appId) ? undefined : 'scale-in',
          documentId,
          url,
        })
        resolvedActiveId = nextWindow.id
        const next = [...current, nextWindow]
        windowsRef.current = next
        return next
      }

      const existing = live.find((window) => window.appId === appId && !window.minimized)
      if (existing) {
        resolvedActiveId = existing.id
        const nextZ = bumpZIndex()
        const resolvedTitle = resolveBuiltinWindowTitle(appId as BuiltinAppId, existing.title)
        const next = current.map((window) =>
          window.id === existing.id
            ? applyOpenPayload({
                ...window,
                zIndex: nextZ,
                minimized: false,
                title: resolvedTitle,
              })
            : window,
        )
        windowsRef.current = next
        return next
      }

      const minimized = live.find((window) => window.appId === appId && window.minimized)
      if (minimized) {
        resolvedActiveId = minimized.id
        const nextZ = bumpZIndex()
        const resolvedTitle = resolveBuiltinWindowTitle(appId as BuiltinAppId, minimized.title)
        const next = current.map((window) =>
          window.id === minimized.id
            ? applyOpenPayload({
                ...window,
                zIndex: nextZ,
                minimized: false,
                title: resolvedTitle,
              })
            : window,
        )
        windowsRef.current = next
        return next
      }

      const nextWindow = createWindow(appId, undefined, {
        enterAnimation: 'scale-in',
        documentId,
        url,
      })
      resolvedActiveId = nextWindow.id
      const next = [...current, nextWindow]
      windowsRef.current = next
      return next
    })

    if (resolvedActiveId !== undefined) {
      setActiveWindowId(resolvedActiveId)
    }
    return resolvedActiveId
  }, [startDesktopRestore])

  const setAppWindowDocumentId = useCallback((appId: AppId, documentId: string | undefined) => {
    setWindows((current) =>
      current.map((window) =>
        window.appId === appId && !window.closing
          ? {
              ...window,
              documentId,
              ...(documentId !== undefined ? { url: undefined } : {}),
            }
          : window,
      ),
    )
  }, [])

  const setAppWindowUrl = useCallback((appId: AppId, url: string | undefined) => {
    setWindows((current) =>
      current.map((window) =>
        window.appId === appId && !window.closing
          ? {
              ...window,
              url,
              ...(url !== undefined ? { documentId: undefined } : {}),
            }
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

  const setWindowTitle = useCallback((windowId: string, title: string) => {
    setWindows((current) => {
      const target = current.find((window) => window.id === windowId)
      if (!target || target.title === title) {
        return current
      }
      return current.map((window) => (window.id === windowId ? { ...window, title } : window))
    })
  }, [])

  const setWindowDocumentId = useCallback((windowId: string, documentId: string | undefined) => {
    setWindows((current) =>
      current.map((window) => (window.id === windowId ? { ...window, documentId } : window)),
    )
  }, [])

  const setWindowDocumentEdited = useCallback((windowId: string, edited: boolean) => {
    setWindows((current) => {
      const target = current.find((window) => window.id === windowId)
      if (!target || target.documentEdited === edited) {
        return current
      }
      return current.map((window) =>
        window.id === windowId ? { ...window, documentEdited: edited } : window,
      )
    })
  }, [])

  const setWindowDocumentReadOnly = useCallback((windowId: string, readOnly: boolean) => {
    setWindows((current) => {
      const target = current.find((window) => window.id === windowId)
      if (!target || target.documentReadOnly === readOnly) {
        return current
      }
      return current.map((window) =>
        window.id === windowId ? { ...window, documentReadOnly: readOnly } : window,
      )
    })
  }, [])

  const revealWindowlessPanel = useCallback(
    (
      windowId: string,
      options?: {
        title?: string
        width?: number
        height?: number
        chromeKind?: 'window' | 'dialog'
        chromeCloseDisabled?: boolean
        chromeMinimizeDisabled?: boolean
        chromeZoomDisabled?: boolean
      },
    ) => {
      startDesktopRestore()
      const nextZ = bumpZIndex()
      setWindows((current) => {
        const target = current.find((window) => window.id === windowId && !window.closing)
        if (!target?.windowless) return current

        const chromeKind = options?.chromeKind ?? 'dialog'
        const width = Math.max(
          MIN_DIALOG_WINDOW_WIDTH,
          options?.width ?? target.width ?? 420,
        )
        const height = Math.max(
          MIN_DIALOG_WINDOW_HEIGHT,
          options?.height ?? target.height ?? 220,
        )
        const work = getMaximizedBounds()
        const x = Math.round(work.x + Math.max(0, (work.width - width) / 2))
        const y = Math.round(work.y + Math.max(24, (work.height - height) / 3))
        const bounds = fitFloatingWindowBounds(x, y, width, height, {
          minWidth: MIN_DIALOG_WINDOW_WIDTH,
          minHeight: MIN_DIALOG_WINDOW_HEIGHT,
        })

        return current.map((window) =>
          window.id === windowId
            ? {
                ...window,
                ...bounds,
                title: options?.title ?? window.title,
                windowlessPanel: true,
                enterAnimation: 'scale-in',
                chromeKind,
                chromeCloseDisabled: options?.chromeCloseDisabled ?? false,
                chromeMinimizeDisabled:
                  chromeKind === 'dialog' ? true : (options?.chromeMinimizeDisabled ?? false),
                chromeZoomDisabled:
                  chromeKind === 'dialog' ? true : (options?.chromeZoomDisabled ?? false),
                minimized: false,
                maximized: false,
                fullscreen: false,
                snap: undefined,
                zIndex: nextZ,
              }
            : window,
        )
      })
      setActiveWindowId(windowId)
    },
    [startDesktopRestore],
  )

  const openGeneratedApp = useCallback((appId: GeneratedAppId, title: string) => {
    startDesktopRestore()
    closeOpenDesktopFolder()

    let resolvedActiveId: string | undefined

    setWindows((current) => {
      // 生成应用强制单窗口：重复打开聚焦既有窗口（含最小化后恢复）
      const existing = resolveSingleWindowForApp(current, appId)
      if (existing) {
        resolvedActiveId = existing.id
        const nextZ = bumpZIndex()
        return current.map((window) =>
          window.id === existing.id
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

  const registerWindowCloseGuard = useCallback((windowId: string, guard: AppCloseGuard | undefined) => {
    if (guard) {
      windowCloseGuardsRef.current.set(windowId, guard)
      return
    }
    windowCloseGuardsRef.current.delete(windowId)
  }, [])

  const bypassWindowCloseGuard = useCallback((windowId: string) => {
    bypassWindowCloseGuardRef.current.add(windowId)
  }, [])

  const cancelPendingAppQuit = useCallback((appId: AppId) => {
    pendingQuitAppsRef.current.delete(appId)
  }, [])

  const closeWindowRef = useRef<(windowId: string) => void>(() => {})

  const shouldAllowClose = useCallback((appId: AppId, windowId: string) => {
    if (bypassWindowCloseGuardRef.current.has(windowId)) {
      bypassWindowCloseGuardRef.current.delete(windowId)
      return true
    }

    const windowGuard = windowCloseGuardsRef.current.get(windowId)
    if (windowGuard) {
      return windowGuard({ appId, windowId })
    }

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

  const continuePendingAppQuit = useCallback((appId: AppId) => {
    if (!pendingQuitAppsRef.current.has(appId)) {
      return
    }
    queueMicrotask(() => {
      if (!pendingQuitAppsRef.current.has(appId)) {
        return
      }
      const target = windowsRef.current.find((window) => window.appId === appId && !window.closing)
      if (!target) {
        pendingQuitAppsRef.current.delete(appId)
        return
      }
      closeWindowRef.current(target.id)
    })
  }, [])

  const finalizeWindowClose = useCallback((windowId: string) => {
    let closedAppId: AppId | undefined
    setWindows((current) => {
      const target = current.find((window) => window.id === windowId)
      if (!target?.closing) {
        return current
      }
      closedAppId = target.appId
      persistWindowSize(target)
      windowCloseGuardsRef.current.delete(windowId)
      bypassWindowCloseGuardRef.current.delete(windowId)
      return current.filter((window) => window.id !== windowId)
    })
    if (closedAppId !== undefined) {
      continuePendingAppQuit(closedAppId)
    }
  }, [continuePendingAppQuit])

  const closeWindow = useCallback((windowId: string) => {
    const closing = windowsRef.current.find((window) => window.id === windowId)
    if (!closing || closing.closing) {
      return
    }

    if (!shouldAllowClose(closing.appId, windowId)) {
      return
    }

    setWindows((current) =>
      current.map((window) =>
        window.id === windowId ? { ...window, closing: true } : window,
      ),
    )
    const nextActiveId = pickTopVisibleWindowId(windowsRef.current, new Set([windowId]))
    setActiveWindowId((current) => (current === windowId ? nextActiveId : current))
  }, [shouldAllowClose])
  closeWindowRef.current = closeWindow

  const closeWindowsForApp = useCallback((appId: AppId) => {
    const appWindows = windowsRef.current.filter((window) => window.appId === appId && !window.closing)
    if (appWindows.length === 0) {
      return
    }

    if (isMultiWindowApp(appId)) {
      pendingQuitAppsRef.current.add(appId)
      closeWindow(appWindows[0]!.id)
      return
    }

    if (!shouldAllowClose(appId, appWindows[0]!.id)) {
      return
    }

    const closingIds = new Set(appWindows.map((window) => window.id))

    setWindows((current) =>
      current.map((window) =>
        closingIds.has(window.id) ? { ...window, closing: true } : window,
      ),
    )
    const nextActiveId = pickTopVisibleWindowId(windowsRef.current, closingIds)
    setActiveWindowId((active) => (active && closingIds.has(active) ? nextActiveId : active))
  }, [closeWindow, shouldAllowClose])

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
    if (flip3dActiveRef.current) {
      exitFlip3d(windowId)
      return
    }
    raiseWindow(windowId)
  }, [exitFlip3d, raiseWindow, startDesktopRestore])

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
    const nextActiveId = pickTopVisibleWindowId(windowsRef.current, new Set([windowId]))
    setActiveWindowId((current) => (current === windowId ? nextActiveId : current))
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
      flip3dActive,
      flip3dRestoring,
      flip3dEntering,
      flip3dOrder,
      flip3dSnapIds,
      flip3dGhosts,
      flip3dShadowReveal,
      enterFlip3d,
      cycleFlip3d,
      dismissFlip3dGhostFrame,
      exitFlip3d,
      openApp,
      openGeneratedApp,
      openExtApp,
      closeWindow,
      closeWindowsForApp,
      finalizeWindowClose,
      registerAppCloseGuard,
      bypassAppCloseGuard,
      registerWindowCloseGuard,
      bypassWindowCloseGuard,
      cancelPendingAppQuit,
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
      setAppWindowUrl,
      setAppWindowDocumentEdited,
      setWindowTitle,
      setWindowDocumentId,
      setWindowDocumentEdited,
      setWindowDocumentReadOnly,
      revealWindowlessPanel,
      closeProcessIsolatedApps,
    }),
    [windows, activeWindowId, desktopRevealed, desktopRevealRestoring, toggleDesktopReveal, hideDesktopReveal, flip3dActive, flip3dRestoring, flip3dEntering, flip3dOrder, flip3dSnapIds, flip3dGhosts, flip3dShadowReveal, enterFlip3d, cycleFlip3d, dismissFlip3dGhostFrame, exitFlip3d, openApp, openGeneratedApp, openExtApp, closeWindow, closeWindowsForApp, finalizeWindowClose, registerAppCloseGuard, bypassAppCloseGuard, registerWindowCloseGuard, bypassWindowCloseGuard, cancelPendingAppQuit, focusWindow, moveWindow, resizeWindow, releaseAnchoredWindow, applyWindowSnap, toggleFullscreen, toggleMaximize, minimizeWindow, restoreWindow, setAppWindowTitle, setAppWindowDocumentId, setAppWindowUrl, setAppWindowDocumentEdited, setWindowTitle, setWindowDocumentId, setWindowDocumentEdited, setWindowDocumentReadOnly, revealWindowlessPanel, closeProcessIsolatedApps],
  )

  useEffect(() => registerOsOpenApp(openApp), [openApp])

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

export function useWindowCloseGuard(windowId: string | undefined, guard: AppCloseGuard) {
  const { registerWindowCloseGuard } = useOs()
  const guardRef = useRef(guard)
  guardRef.current = guard

  useEffect(() => {
    if (!windowId) return
    registerWindowCloseGuard(windowId, (context) => guardRef.current(context))
    return () => registerWindowCloseGuard(windowId, undefined)
  }, [windowId, registerWindowCloseGuard])
}

export function useOs() {
  const context = useContext(OsContext)
  if (!context) {
    throw new Error('useOs must be used within OsProvider')
  }
  return context
}
