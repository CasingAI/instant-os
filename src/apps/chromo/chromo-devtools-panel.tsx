import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'preact/hooks'
import type { RefObject } from 'preact'
import { memo } from 'preact/compat'
import { ChromoConsolePanel } from './chromo-console-panel.tsx'
import type { ChromoConsoleDisplayEntry } from './chromo-console-types.ts'
import type {
  ChromoNetworkEntry,
  ChromoNetworkBodyReadResult,
  ChromoNetworkBodyReadLinesOptions,
  ChromoNetworkBodyReadLinesResult,
  ChromoNetworkHotProbeResult,
} from './chromo-bridge.ts'
import type { ChromoDevToolsDockSide, ChromoDevToolsPanelTab } from './chromo-devtools-hub.ts'
import { ChromoExtensionsPanel } from './chromo-extensions-panel.tsx'
import { ChromoNetworkPanel } from './chromo-network-panel.tsx'
import {
  ChromoApplicationPanel,
  type ChromoApplicationApi,
} from './chromo-application-panel.tsx'
import type { ChromoPageFault } from './chromo-page-fault.ts'
import { ChromoPageFaultView } from './chromo-page-fault-view.tsx'

const DEVTOOLS_DOCK_SIDE_KEY = 'chromo-devtools-dock-side'
const DEVTOOLS_HEIGHT_KEY = 'chromo-devtools-height'
const DEVTOOLS_WIDTH_KEY = 'chromo-devtools-width'

const DEFAULT_DEVTOOLS_HEIGHT = 240
const DEFAULT_DEVTOOLS_WIDTH = 420
const MIN_DEVTOOLS_HEIGHT = 120
const MIN_DEVTOOLS_WIDTH = 280
/** 相对容器的最大占比 */
const MAX_SIZE_RATIO = 0.75
/** 左/右 dock 时为网页保留的最小宽度 */
const MIN_VIEWPORT_WIDTH = 200
/** bottom dock 时为网页保留的最小高度 */
const MIN_VIEWPORT_HEIGHT = 200
/** 窄屏侧栏 overlay 宽度比 */
const NARROW_SIDE_RATIO = 0.85
/** 窄屏侧栏宽度上限 */
const NARROW_SIDE_CAP = 420
/** 窄屏 bottom overlay 高度比 */
const NARROW_BOTTOM_RATIO = 0.55

type ChromoDevToolsPanelProps = {
  mode?: 'embedded' | 'window'
  /** 与 Chromo 窄屏布局同步，用于侧栏/底部 overlay 上限 */
  narrowLayout?: boolean
  activeTab: ChromoDevToolsPanelTab
  onTabChange: (tab: ChromoDevToolsPanelTab) => void
  onClose: () => void
  dockSide: ChromoDevToolsDockSide
  onDockSideChange: (side: ChromoDevToolsDockSide) => void
  onUndock?: () => void
  preserveLog: boolean
  onPreserveLogChange: (preserve: boolean) => void
  onClear: () => void
  entries: ChromoConsoleDisplayEntry[]
  pageReady: boolean
  evalInPage: (code: string) => Promise<unknown>
  replHistory: string[]
  onReplHistoryChange: (history: string[]) => void
  onAppendEntries: (entries: ChromoConsoleDisplayEntry[]) => void
  networkEntries: ChromoNetworkEntry[]
  selectedNetworkId?: string
  disableNetworkCache?: boolean
  onDisableNetworkCacheChange?: (disable: boolean) => void
  readNetworkBody?: (entryId: string) => Promise<ChromoNetworkBodyReadResult>
  readNetworkBodyLines?: (
    entryId: string,
    options?: ChromoNetworkBodyReadLinesOptions,
  ) => Promise<ChromoNetworkBodyReadLinesResult>
  probeNetworkHot?: (
    method: string,
    url: string,
  ) => Promise<ChromoNetworkHotProbeResult>
  pageLoading?: boolean
  pageError?: string
  pageFault?: ChromoPageFault
  onSelectNetwork: (entry: ChromoNetworkEntry) => void
  onCloseNetworkDetail?: () => void
  pageUrl?: string
  vConsoleEnabled?: boolean
  vConsoleBusy?: boolean
  vConsoleError?: string
  onVConsoleEnabledChange?: (enabled: boolean) => void
  debugPanelEnabled?: boolean
  onDebugPanelEnabledChange?: (enabled: boolean) => void
  /** Viewer iframe bridge ready (DebugPanel lives in viewer). */
  viewerReady?: boolean
  /** Clear global cookie / storage / hot cache (affects all Chromo tabs). */
  onClearBrowsingData?: () => Promise<void>
  applicationApi?: ChromoApplicationApi
}

const TABS: {
  id: ChromoDevToolsPanelTab
  label: string
  disabled?: boolean
  title?: string
}[] = [
  { id: 'console', label: '控制台' },
  { id: 'network', label: '网络' },
  { id: 'application', label: '应用程序' },
  { id: 'extensions', label: '扩展' },
]

const DOCK_ACTIONS: {
  id: ChromoDevToolsDockSide | 'undocked'
  label: string
}[] = [
  { id: 'undocked', label: '在独立窗口中打开' },
  { id: 'left', label: '停靠到左侧' },
  { id: 'bottom', label: '停靠到底部' },
  { id: 'right', label: '停靠到右侧' },
]

function SettingsIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" aria-hidden="true">
      <path
        fill="currentColor"
        d="M19.14 12.94c.04-.31.06-.63.06-.94s-.02-.63-.06-.94l2.03-1.58a.49.49 0 0 0 .12-.61l-1.92-3.32a.488.488 0 0 0-.59-.22l-2.39.96c-.5-.38-1.03-.7-1.62-.94l-.36-2.54a.484.484 0 0 0-.48-.41h-3.84c-.24 0-.43.17-.47.41l-.36 2.54c-.59.24-1.13.57-1.62.94l-2.39-.96c-.22-.08-.47 0-.59.22L2.74 8.87c-.12.21-.08.47.12.61l2.03 1.58c-.04.31-.06.63-.06.94s.02.63.06.94l-2.03 1.58a.49.49 0 0 0-.12.61l1.92 3.32c.12.22.37.29.59.22l2.39-.96c.5.38 1.03.7 1.62.94l.36 2.54c.04.24.24.41.48.41h3.84c.24 0 .44-.17.47-.41l.36-2.54c.59-.24 1.13-.56 1.62-.94l2.39.96c.22.08.47 0 .59-.22l1.92-3.32c.12-.22.07-.47-.12-.61l-2.01-1.58zM12 15.6A3.6 3.6 0 1 1 12 8.4a3.6 3.6 0 0 1 0 7.2z"
      />
    </svg>
  )
}

function readStoredDockSide(): ChromoDevToolsDockSide {
  try {
    const raw = localStorage.getItem(DEVTOOLS_DOCK_SIDE_KEY)
    if (raw === 'bottom' || raw === 'left' || raw === 'right') {
      return raw
    }
  } catch {
    // ignore
  }
  return 'bottom'
}

export function readChromoDevToolsDockSide(): ChromoDevToolsDockSide {
  return readStoredDockSide()
}

function readStoredHeight(): number {
  try {
    const raw = localStorage.getItem(DEVTOOLS_HEIGHT_KEY)
    const parsed = raw ? Number.parseInt(raw, 10) : NaN
    if (Number.isFinite(parsed) && parsed >= MIN_DEVTOOLS_HEIGHT) {
      return parsed
    }
  } catch {
    // ignore
  }
  return DEFAULT_DEVTOOLS_HEIGHT
}

function readStoredWidth(): number {
  try {
    const raw = localStorage.getItem(DEVTOOLS_WIDTH_KEY)
    const parsed = raw ? Number.parseInt(raw, 10) : NaN
    if (Number.isFinite(parsed) && parsed >= MIN_DEVTOOLS_WIDTH) {
      return parsed
    }
  } catch {
    // ignore
  }
  return DEFAULT_DEVTOOLS_WIDTH
}

function clampSize(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value))
}

/** 左/右 dock 最大宽度：宽屏按 75% 且为网页留 200px；窄屏 overlay 按 85%/420 */
function maxDevtoolsWidthForContainer(containerWidth: number, narrowLayout: boolean): number {
  if (containerWidth <= 0) {
    return MIN_DEVTOOLS_WIDTH
  }
  if (narrowLayout) {
    return Math.max(0, Math.min(Math.floor(containerWidth * NARROW_SIDE_RATIO), NARROW_SIDE_CAP))
  }
  return Math.max(
    0,
    Math.min(
      Math.floor(containerWidth * MAX_SIZE_RATIO),
      Math.max(0, containerWidth - MIN_VIEWPORT_WIDTH),
    ),
  )
}

/** bottom dock 最大高度；窄屏 overlay 按 55% */
function maxDevtoolsHeightForContainer(containerHeight: number, narrowLayout: boolean): number {
  if (containerHeight <= 0) {
    return MIN_DEVTOOLS_HEIGHT
  }
  if (narrowLayout) {
    return Math.max(0, Math.floor(containerHeight * NARROW_BOTTOM_RATIO))
  }
  return Math.max(
    0,
    Math.min(
      Math.floor(containerHeight * MAX_SIZE_RATIO),
      Math.max(0, containerHeight - MIN_VIEWPORT_HEIGHT),
    ),
  )
}

function minDevtoolsWidthForContainer(containerWidth: number, maxWidth: number): number {
  if (containerWidth <= 0) {
    return MIN_DEVTOOLS_WIDTH
  }
  return Math.min(MIN_DEVTOOLS_WIDTH, maxWidth)
}

function minDevtoolsHeightForContainer(containerHeight: number, maxHeight: number): number {
  if (containerHeight <= 0) {
    return MIN_DEVTOOLS_HEIGHT
  }
  return Math.min(MIN_DEVTOOLS_HEIGHT, maxHeight)
}

type EffectiveSizes = { width: number; height: number }

function computeEffectiveSizes(
  containerWidth: number,
  containerHeight: number,
  narrowLayout: boolean,
  preferredWidth: number,
  preferredHeight: number,
): EffectiveSizes {
  const maxWidth = maxDevtoolsWidthForContainer(containerWidth, narrowLayout)
  const maxHeight = maxDevtoolsHeightForContainer(containerHeight, narrowLayout)
  const minWidth = minDevtoolsWidthForContainer(containerWidth, maxWidth)
  const minHeight = minDevtoolsHeightForContainer(containerHeight, maxHeight)
  return {
    width: clampSize(preferredWidth, minWidth, Math.max(minWidth, maxWidth)),
    height: clampSize(preferredHeight, minHeight, Math.max(minHeight, maxHeight)),
  }
}

function computeDragBounds(
  containerWidth: number,
  containerHeight: number,
  narrowLayout: boolean,
): { minWidth: number; maxWidth: number; minHeight: number; maxHeight: number } {
  const maxWidth = maxDevtoolsWidthForContainer(containerWidth, narrowLayout)
  const maxHeight = maxDevtoolsHeightForContainer(containerHeight, narrowLayout)
  return {
    minWidth: minDevtoolsWidthForContainer(containerWidth, maxWidth),
    maxWidth,
    minHeight: minDevtoolsHeightForContainer(containerHeight, maxHeight),
    maxHeight,
  }
}

function DockSideIcon({ side }: { side: ChromoDevToolsDockSide | 'undocked' }) {
  const stroke = 'currentColor'
  const fill = 'none'
  const strokeWidth = 1.2

  if (side === 'undocked') {
    return (
      <svg width="16" height="16" viewBox="0 0 16 16" aria-hidden="true">
        <rect x="1.5" y="3.5" width="9" height="9" rx="1" fill={fill} stroke={stroke} stroke-width={strokeWidth} />
        <rect x="5.5" y="1.5" width="9" height="9" rx="1" fill={fill} stroke={stroke} stroke-width={strokeWidth} />
      </svg>
    )
  }

  if (side === 'left') {
    return (
      <svg width="16" height="16" viewBox="0 0 16 16" aria-hidden="true">
        <rect x="2" y="2.5" width="12" height="11" rx="1" fill={fill} stroke={stroke} stroke-width={strokeWidth} />
        <rect x="2" y="2.5" width="4" height="11" rx="1" fill={stroke} stroke="none" />
      </svg>
    )
  }

  if (side === 'bottom') {
    return (
      <svg width="16" height="16" viewBox="0 0 16 16" aria-hidden="true">
        <rect x="2" y="2.5" width="12" height="11" rx="1" fill={fill} stroke={stroke} stroke-width={strokeWidth} />
        <rect x="2" y="8.5" width="12" height="5" rx="1" fill={stroke} stroke="none" />
      </svg>
    )
  }

  return (
    <svg width="16" height="16" viewBox="0 0 16 16" aria-hidden="true">
      <rect x="2" y="2.5" width="12" height="11" rx="1" fill={fill} stroke={stroke} stroke-width={strokeWidth} />
      <rect x="10" y="2.5" width="4" height="11" rx="1" fill={stroke} stroke="none" />
    </svg>
  )
}

type ChromoDevToolsPanelBodyProps = {
  activeTab: ChromoDevToolsPanelTab
  entries: ChromoConsoleDisplayEntry[]
  pageReady: boolean
  evalInPage: (code: string) => Promise<unknown>
  replHistory: string[]
  onReplHistoryChange: (history: string[]) => void
  onAppendEntries: (entries: ChromoConsoleDisplayEntry[]) => void
  onClear?: () => void
  networkEntries: ChromoNetworkEntry[]
  selectedNetworkId?: string
  disableNetworkCache?: boolean
  onDisableNetworkCacheChange?: (disable: boolean) => void
  preserveLog?: boolean
  onPreserveLogChange?: (preserve: boolean) => void
  readNetworkBody?: (entryId: string) => Promise<ChromoNetworkBodyReadResult>
  readNetworkBodyLines?: (
    entryId: string,
    options?: ChromoNetworkBodyReadLinesOptions,
  ) => Promise<ChromoNetworkBodyReadLinesResult>
  probeNetworkHot?: (
    method: string,
    url: string,
  ) => Promise<ChromoNetworkHotProbeResult>
  pageLoading?: boolean
  pageError?: string
  onSelectNetwork: (entry: ChromoNetworkEntry) => void
  onCloseNetworkDetail?: () => void
  pageUrl?: string
  vConsoleEnabled?: boolean
  vConsoleBusy?: boolean
  vConsoleError?: string
  onVConsoleEnabledChange?: (enabled: boolean) => void
  debugPanelEnabled?: boolean
  onDebugPanelEnabledChange?: (enabled: boolean) => void
  viewerReady?: boolean
  applicationApi?: ChromoApplicationApi
  onClearBrowsingData?: () => Promise<void>
}

const ChromoDevToolsPanelBody = memo(function ChromoDevToolsPanelBody({
  activeTab,
  entries,
  pageReady,
  evalInPage,
  replHistory,
  onReplHistoryChange,
  onAppendEntries,
  onClear: onClearConsole,
  networkEntries,
  selectedNetworkId,
  disableNetworkCache,
  onDisableNetworkCacheChange,
  preserveLog = false,
  onPreserveLogChange,
  readNetworkBody,
  readNetworkBodyLines,
  probeNetworkHot,
  pageLoading,
  pageError,
  onSelectNetwork,
  onCloseNetworkDetail,
  pageUrl,
  vConsoleEnabled = false,
  vConsoleBusy = false,
  vConsoleError,
  onVConsoleEnabledChange,
  debugPanelEnabled = false,
  onDebugPanelEnabledChange,
  viewerReady = true,
  applicationApi,
  onClearBrowsingData,
}: ChromoDevToolsPanelBodyProps) {
  if (activeTab === 'console') {
    return (
      <ChromoConsolePanel
        entries={entries}
        pageReady={pageReady}
        pageLoading={pageLoading}
        evalInPage={evalInPage}
        replHistory={replHistory}
        onReplHistoryChange={onReplHistoryChange}
        onAppendEntries={onAppendEntries}
        onClear={onClearConsole}
      />
    )
  }

  if (activeTab === 'network') {
    return (
      <ChromoNetworkPanel
        entries={networkEntries}
        selectedId={selectedNetworkId}
        pageLoading={pageLoading}
        pageError={pageError}
        pageUrl={pageUrl}
        disableNetworkCache={disableNetworkCache}
        onDisableNetworkCacheChange={onDisableNetworkCacheChange}
        preserveLog={preserveLog}
        onPreserveLogChange={onPreserveLogChange}
        onClear={onClearConsole}
        readNetworkBody={readNetworkBody}
        readNetworkBodyLines={readNetworkBodyLines}
        probeNetworkHot={probeNetworkHot}
        evalInPage={evalInPage}
        listCookies={applicationApi?.listCookies}
        onSelect={onSelectNetwork}
        onCloseDetail={onCloseNetworkDetail}
      />
    )
  }

  if (activeTab === 'application') {
    if (!applicationApi) {
      return <div class="chromo-devtools__placeholder">应用程序 API 未就绪</div>
    }
    return (
      <ChromoApplicationPanel
        pageReady={pageReady}
        pageLoading={pageLoading}
        pageUrl={pageUrl}
        api={applicationApi}
        onClearBrowsingData={onClearBrowsingData}
      />
    )
  }

  if (activeTab === 'extensions') {
    return (
      <ChromoExtensionsPanel
        pageReady={pageReady}
        pageLoading={pageLoading}
        viewerReady={viewerReady}
        vConsoleEnabled={vConsoleEnabled}
        vConsoleBusy={vConsoleBusy}
        vConsoleError={vConsoleError}
        onVConsoleEnabledChange={onVConsoleEnabledChange ?? (() => undefined)}
        debugPanelEnabled={debugPanelEnabled}
        onDebugPanelEnabledChange={onDebugPanelEnabledChange ?? (() => undefined)}
      />
    )
  }

  return <div class="chromo-devtools__placeholder">未知面板</div>
})

/** 内嵌模式：观测 chromo__devtools-area，仅在 clamp 结果变化时 setState */
function useEmbeddedEffectiveLayout(
  enabled: boolean,
  panelRef: RefObject<HTMLElement>,
  narrowLayout: boolean,
  preferredWidth: number,
  preferredHeight: number,
): {
  effectiveWidth: number
  effectiveHeight: number
  getDragBounds: () => { minWidth: number; maxWidth: number; minHeight: number; maxHeight: number }
} {
  const containerRef = useRef({ width: 0, height: 0 })
  const layoutInputRef = useRef({ narrowLayout, preferredWidth, preferredHeight })
  layoutInputRef.current = { narrowLayout, preferredWidth, preferredHeight }

  const [effective, setEffective] = useState<EffectiveSizes>(() =>
    computeEffectiveSizes(0, 0, narrowLayout, preferredWidth, preferredHeight),
  )
  const observerRafRef = useRef(0)

  const syncEffective = useCallback((force = false) => {
    const { width, height } = containerRef.current
    const { narrowLayout: narrow, preferredWidth: pw, preferredHeight: ph } = layoutInputRef.current
    const next = computeEffectiveSizes(width, height, narrow, pw, ph)
    setEffective((prev) =>
      force || prev.width !== next.width || prev.height !== next.height ? next : prev,
    )
  }, [])

  useLayoutEffect(() => {
    syncEffective(true)
  }, [preferredWidth, preferredHeight, narrowLayout, syncEffective])

  useEffect(() => {
    if (!enabled) {
      return
    }

    const container = panelRef.current?.parentElement
    if (!container) {
      return
    }

    const scheduleSync = () => {
      containerRef.current = {
        width: container.clientWidth,
        height: container.clientHeight,
      }
      if (observerRafRef.current) {
        return
      }
      observerRafRef.current = requestAnimationFrame(() => {
        observerRafRef.current = 0
        syncEffective(false)
      })
    }

    scheduleSync()
    const observer = new ResizeObserver(scheduleSync)
    observer.observe(container)
    return () => {
      observer.disconnect()
      if (observerRafRef.current) {
        cancelAnimationFrame(observerRafRef.current)
      }
    }
  }, [enabled, panelRef, syncEffective])

  const getDragBounds = useCallback(() => {
    const { width, height } = containerRef.current
    return computeDragBounds(width, height, layoutInputRef.current.narrowLayout)
  }, [])

  return {
    effectiveWidth: effective.width,
    effectiveHeight: effective.height,
    getDragBounds,
  }
}

export function ChromoDevToolsPanel({
  mode = 'embedded',
  narrowLayout = false,
  activeTab,
  onTabChange,
  onClose,
  dockSide,
  onDockSideChange,
  onUndock,
  preserveLog,
  onPreserveLogChange,
  onClear,
  entries,
  pageReady,
  evalInPage,
  replHistory,
  onReplHistoryChange,
  onAppendEntries,
  networkEntries,
  selectedNetworkId,
  disableNetworkCache,
  onDisableNetworkCacheChange,
  readNetworkBody,
  readNetworkBodyLines,
  probeNetworkHot,
  pageLoading,
  pageError,
  pageFault,
  onSelectNetwork,
  onCloseNetworkDetail,
  pageUrl,
  vConsoleEnabled = false,
  vConsoleBusy = false,
  vConsoleError,
  onVConsoleEnabledChange,
  debugPanelEnabled = false,
  onDebugPanelEnabledChange,
  viewerReady = true,
  onClearBrowsingData,
  applicationApi,
}: ChromoDevToolsPanelProps) {
  const isWindowMode = mode === 'window'
  const panelRef = useRef<HTMLElement>(null)
  const settingsRef = useRef<HTMLDivElement>(null)
  const [settingsOpen, setSettingsOpen] = useState(false)
  const [clearBrowsingBusy, setClearBrowsingBusy] = useState(false)

  /** 用户偏好尺寸（localStorage）；容器缩小时不改写 */
  const [preferredHeight, setPreferredHeight] = useState(readStoredHeight)
  const [preferredWidth, setPreferredWidth] = useState(readStoredWidth)

  const { effectiveWidth, effectiveHeight, getDragBounds } = useEmbeddedEffectiveLayout(
    !isWindowMode,
    panelRef,
    narrowLayout,
    preferredWidth,
    preferredHeight,
  )

  const resizingRef = useRef(false)
  const pointerIdRef = useRef<number | null>(null)
  const startPointerRef = useRef({ x: 0, y: 0 })
  const startSizeRef = useRef(0)
  const liveSizeRef = useRef<number | null>(null)
  const dragRafRef = useRef(0)
  const boundsRef = useRef({ minWidth: 0, maxWidth: 0, minHeight: 0, maxHeight: 0 })
  const captureTargetRef = useRef<HTMLElement | null>(null)
  const endDragListenersRef = useRef<(() => void) | null>(null)
  /** 拖拽中的实时尺寸；rAF 节流，避免每像素触发整树重渲染 + localStorage */
  const [dragSize, setDragSize] = useState<number | null>(null)

  const selectedDockAction: ChromoDevToolsDockSide | 'undocked' = isWindowMode
    ? 'undocked'
    : dockSide

  const displayWidth = dragSize ?? effectiveWidth
  const displayHeight = dragSize ?? effectiveHeight

  const scheduleDragSize = useCallback((size: number) => {
    liveSizeRef.current = size
    if (dragRafRef.current) {
      return
    }
    dragRafRef.current = requestAnimationFrame(() => {
      dragRafRef.current = 0
      if (liveSizeRef.current !== null) {
        setDragSize(liveSizeRef.current)
      }
    })
  }, [])

  const commitPreferredSize = useCallback(
    (size: number) => {
      if (dockSide === 'bottom') {
        setPreferredHeight(size)
        try {
          localStorage.setItem(DEVTOOLS_HEIGHT_KEY, String(size))
        } catch {
          // ignore
        }
        return
      }
      setPreferredWidth(size)
      try {
        localStorage.setItem(DEVTOOLS_WIDTH_KEY, String(size))
      } catch {
        // ignore
      }
    },
    [dockSide],
  )

  const persistDockSide = useCallback(
    (nextSide: ChromoDevToolsDockSide) => {
      onDockSideChange(nextSide)
      try {
        localStorage.setItem(DEVTOOLS_DOCK_SIDE_KEY, nextSide)
      } catch {
        // ignore
      }
    },
    [onDockSideChange],
  )

  const stopResize = useCallback(
    (commit = true) => {
      if (!resizingRef.current) {
        return
      }
      endDragListenersRef.current?.()
      endDragListenersRef.current = null
      if (dragRafRef.current) {
        cancelAnimationFrame(dragRafRef.current)
        dragRafRef.current = 0
      }
      if (captureTargetRef.current && pointerIdRef.current !== null) {
        try {
          captureTargetRef.current.releasePointerCapture(pointerIdRef.current)
        } catch {
          // ignore
        }
      }
      if (commit && liveSizeRef.current !== null) {
        commitPreferredSize(liveSizeRef.current)
      }
      resizingRef.current = false
      liveSizeRef.current = null
      setDragSize(null)
      captureTargetRef.current = null
      pointerIdRef.current = null
      document.body.style.removeProperty('user-select')
      document.body.style.removeProperty('cursor')
    },
    [commitPreferredSize],
  )

  useEffect(() => {
    return () => {
      stopResize(false)
    }
  }, [stopResize])

  const onResizePointerDown = useCallback(
    (event: PointerEvent) => {
      event.preventDefault()
      event.stopPropagation()

      const handle = event.currentTarget as HTMLDivElement
      const pointerId = event.pointerId
      try {
        handle.setPointerCapture(pointerId)
      } catch {
        // ignore
      }
      captureTargetRef.current = handle
      pointerIdRef.current = pointerId
      resizingRef.current = true
      startPointerRef.current = { x: event.clientX, y: event.clientY }
      boundsRef.current = getDragBounds()

      if (dockSide === 'bottom') {
        startSizeRef.current = effectiveHeight
        document.body.style.cursor = 'ns-resize'
      } else {
        startSizeRef.current = effectiveWidth
        document.body.style.cursor = 'ew-resize'
      }

      document.body.style.userSelect = 'none'

      const onMove = (moveEvent: PointerEvent) => {
        if (!resizingRef.current || moveEvent.pointerId !== pointerId) {
          return
        }
        moveEvent.preventDefault()

        const { minWidth: minW, maxWidth: maxW, minHeight: minH, maxHeight: maxH } =
          boundsRef.current

        if (dockSide === 'bottom') {
          const delta = startPointerRef.current.y - moveEvent.clientY
          const next = clampSize(startSizeRef.current + delta, minH, Math.max(minH, maxH))
          scheduleDragSize(next)
          return
        }

        const delta =
          dockSide === 'left'
            ? moveEvent.clientX - startPointerRef.current.x
            : startPointerRef.current.x - moveEvent.clientX
        const next = clampSize(startSizeRef.current + delta, minW, Math.max(minW, maxW))
        scheduleDragSize(next)
      }

      const onUp = (upEvent: PointerEvent) => {
        if (upEvent.pointerId !== pointerId) {
          return
        }
        stopResize(true)
      }

      const onCancel = (cancelEvent: PointerEvent) => {
        if (cancelEvent.pointerId !== pointerId) {
          return
        }
        stopResize(false)
      }

      endDragListenersRef.current = () => {
        document.removeEventListener('pointermove', onMove)
        document.removeEventListener('pointerup', onUp)
        document.removeEventListener('pointercancel', onCancel)
      }

      document.addEventListener('pointermove', onMove)
      document.addEventListener('pointerup', onUp)
      document.addEventListener('pointercancel', onCancel)
    },
    [dockSide, effectiveHeight, effectiveWidth, getDragBounds, scheduleDragSize, stopResize],
  )

  const onDockActionClick = useCallback(
    (action: ChromoDevToolsDockSide | 'undocked') => {
      setSettingsOpen(false)
      if (action === 'undocked') {
        if (!isWindowMode) {
          onUndock?.()
        }
        return
      }
      persistDockSide(action)
    },
    [isWindowMode, onUndock, persistDockSide],
  )

  useEffect(() => {
    if (!settingsOpen) {
      return
    }
    const onPointerDown = (event: PointerEvent) => {
      const root = settingsRef.current
      if (!root) {
        return
      }
      if (event.target instanceof Node && !root.contains(event.target)) {
        setSettingsOpen(false)
      }
    }
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        setSettingsOpen(false)
      }
    }
    document.addEventListener('pointerdown', onPointerDown)
    document.addEventListener('keydown', onKeyDown)
    return () => {
      document.removeEventListener('pointerdown', onPointerDown)
      document.removeEventListener('keydown', onKeyDown)
    }
  }, [settingsOpen])

  const panelStyle = isWindowMode
    ? { height: '100%', width: '100%' }
    : dockSide === 'bottom'
      ? { height: `${displayHeight}px` }
      : { width: `${displayWidth}px` }

  const resizeHandleClass = [
    'chromo-devtools__resize-handle',
    dockSide === 'left'
      ? 'chromo-devtools__resize-handle--left'
      : dockSide === 'right'
        ? 'chromo-devtools__resize-handle--right'
        : 'chromo-devtools__resize-handle--bottom',
  ].join(' ')

  return (
    <section
      ref={panelRef}
      class={[
        'chromo-devtools',
        isWindowMode ? 'chromo-devtools--window' : `chromo-devtools--dock-${dockSide}`,
      ].join(' ')}
      aria-label="开发者工具"
      style={panelStyle}
    >
      {!isWindowMode ? (
        <div
          class={resizeHandleClass}
          onPointerDown={onResizePointerDown}
          aria-hidden="true"
        />
      ) : null}

      <header class="chromo-devtools__header">
        <div class="chromo-devtools__tabs" role="tablist" aria-label="开发者工具标签">
          {TABS.map((tab) => (
            <button
              key={tab.id}
              type="button"
              role="tab"
              class={[
                'chromo-devtools__tab',
                activeTab === tab.id ? 'chromo-devtools__tab--active' : '',
              ]
                .filter(Boolean)
                .join(' ')}
              aria-selected={activeTab === tab.id}
              disabled={tab.disabled}
              title={tab.title}
              onClick={() => {
                if (!tab.disabled) {
                  onTabChange(tab.id)
                }
              }}
            >
              {tab.label}
            </button>
          ))}
        </div>

        <div class="chromo-devtools__actions">
          {activeTab === 'console' ? (
            <button type="button" class="chromo-devtools__action" onClick={onClear}>
              清空
            </button>
          ) : null}
          <div class="chromo-devtools__settings" ref={settingsRef}>
            <button
              type="button"
              class={[
                'chromo-devtools__settings-btn',
                settingsOpen ? 'chromo-devtools__settings-btn--active' : '',
              ]
                .filter(Boolean)
                .join(' ')}
              aria-label="设置"
              title="设置"
              aria-expanded={settingsOpen}
              aria-haspopup="dialog"
              onClick={() => setSettingsOpen((open) => !open)}
            >
              <SettingsIcon />
            </button>
            {settingsOpen ? (
              <div
                class="chromo-devtools__settings-popover"
                role="dialog"
                aria-label="开发者工具设置"
              >
                <div class="chromo-devtools__settings-section">
                  <div class="chromo-devtools__settings-section-label">停靠位置</div>
                  <div class="chromo-devtools__dock-side" role="group" aria-label="停靠位置">
                    {DOCK_ACTIONS.map((side) => (
                      <button
                        key={side.id}
                        type="button"
                        class={[
                          'chromo-devtools__dock-side-btn',
                          selectedDockAction === side.id
                            ? 'chromo-devtools__dock-side-btn--active'
                            : '',
                        ]
                          .filter(Boolean)
                          .join(' ')}
                        aria-label={side.label}
                        title={side.label}
                        aria-pressed={selectedDockAction === side.id}
                        onClick={() => onDockActionClick(side.id)}
                      >
                        <DockSideIcon side={side.id} />
                      </button>
                    ))}
                  </div>
                </div>
                {onClearBrowsingData ? (
                  <div class="chromo-devtools__settings-section">
                    <div class="chromo-devtools__settings-section-label">浏览数据</div>
                    <p class="chromo-devtools__settings-hint">
                      清空全局 Cookie、Storage 与热缓存，影响所有 Chromo 标签页。
                    </p>
                    <button
                      type="button"
                      class="chromo-devtools__settings-danger"
                      disabled={clearBrowsingBusy || !pageReady}
                      onClick={() => {
                        if (clearBrowsingBusy || !onClearBrowsingData) {
                          return
                        }
                        const ok = window.confirm(
                          '将清空所有 Chromo 标签页的 Cookie、网页 Storage 与热缓存。确定继续？',
                        )
                        if (!ok) {
                          return
                        }
                        setClearBrowsingBusy(true)
                        void onClearBrowsingData()
                          .catch((error) => {
                            const message =
                              error instanceof Error ? error.message : String(error)
                            window.alert(`清空浏览数据失败：${message}`)
                          })
                          .finally(() => {
                            setClearBrowsingBusy(false)
                            setSettingsOpen(false)
                          })
                      }}
                    >
                      {clearBrowsingBusy
                        ? '清空中…'
                        : '清空 Cookie / Storage / 缓存'}
                    </button>
                  </div>
                ) : null}
              </div>
            ) : null}
          </div>
          <button
            type="button"
            class="chromo-devtools__action chromo-devtools__action--close"
            onClick={onClose}
            aria-label="关闭开发者工具"
          >
            ×
          </button>
        </div>
      </header>

      <div class="chromo-devtools__content" role="tabpanel">
        {pageFault?.severity === 'fatal' ? (
          <ChromoPageFaultView fault={pageFault} variant="panel" />
        ) : (
          <ChromoDevToolsPanelBody
            activeTab={activeTab}
            entries={entries}
            pageReady={pageReady}
            evalInPage={evalInPage}
            replHistory={replHistory}
            onReplHistoryChange={onReplHistoryChange}
            onAppendEntries={onAppendEntries}
            onClear={onClear}
            networkEntries={networkEntries}
            selectedNetworkId={selectedNetworkId}
            disableNetworkCache={disableNetworkCache}
            onDisableNetworkCacheChange={onDisableNetworkCacheChange}
            preserveLog={preserveLog}
            onPreserveLogChange={onPreserveLogChange}
            readNetworkBody={readNetworkBody}
            readNetworkBodyLines={readNetworkBodyLines}
            probeNetworkHot={probeNetworkHot}
            pageLoading={pageLoading}
            pageError={pageError}
            onSelectNetwork={onSelectNetwork}
            onCloseNetworkDetail={onCloseNetworkDetail}
            pageUrl={pageUrl}
            vConsoleEnabled={vConsoleEnabled}
            vConsoleBusy={vConsoleBusy}
            vConsoleError={vConsoleError}
            onVConsoleEnabledChange={onVConsoleEnabledChange}
            debugPanelEnabled={debugPanelEnabled}
            onDebugPanelEnabledChange={onDebugPanelEnabledChange}
            viewerReady={viewerReady}
            applicationApi={applicationApi}
            onClearBrowsingData={onClearBrowsingData}
          />
        )}
      </div>
    </section>
  )
}

export type { ChromoDevToolsDockSide, ChromoDevToolsPanelTab }
