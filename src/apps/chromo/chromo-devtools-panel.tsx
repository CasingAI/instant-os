import { useCallback, useEffect, useRef, useState } from 'preact/hooks'
import { ChromoConsolePanel } from './chromo-console-panel.tsx'
import type { ChromoConsoleDisplayEntry } from './chromo-console-types.ts'
import type { ChromoNetworkEntry, ChromoNetworkBodyReadResult } from './chromo-bridge.ts'
import type { ChromoDevToolsDockSide, ChromoDevToolsPanelTab } from './chromo-devtools-hub.ts'
import { ChromoNetworkPanel } from './chromo-network-panel.tsx'

const DEVTOOLS_DOCK_SIDE_KEY = 'chromo-devtools-dock-side'
const DEVTOOLS_HEIGHT_KEY = 'chromo-devtools-height'
const DEVTOOLS_WIDTH_KEY = 'chromo-devtools-width'

const DEFAULT_DEVTOOLS_HEIGHT = 240
const DEFAULT_DEVTOOLS_WIDTH = 420
const MIN_DEVTOOLS_HEIGHT = 120
const MIN_DEVTOOLS_WIDTH = 280

type ChromoDevToolsPanelProps = {
  mode?: 'embedded' | 'window'
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
  pageLoading?: boolean
  pageError?: string
  onSelectNetwork: (entry: ChromoNetworkEntry) => void
  onCloseNetworkDetail?: () => void
  pageUrl?: string
}

const TABS: {
  id: ChromoDevToolsPanelTab
  label: string
  disabled?: boolean
  title?: string
}[] = [
  { id: 'console', label: 'Console' },
  {
    id: 'elements',
    label: 'Elements',
    disabled: true,
    title: '需 virtual-chromo 协议扩展后可用',
  },
  {
    id: 'network',
    label: 'Network',
  },
]

const DOCK_ACTIONS: {
  id: ChromoDevToolsDockSide | 'undocked'
  label: string
}[] = [
  { id: 'undocked', label: 'Undock into separate window' },
  { id: 'left', label: 'Dock to left' },
  { id: 'bottom', label: 'Dock to bottom' },
  { id: 'right', label: 'Dock to right' },
]

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

function maxDevtoolsHeight(): number {
  return Math.max(MIN_DEVTOOLS_HEIGHT, Math.floor(window.innerHeight * 0.75))
}

function maxDevtoolsWidth(): number {
  return Math.max(MIN_DEVTOOLS_WIDTH, Math.floor(window.innerWidth * 0.75))
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

export function ChromoDevToolsPanel({
  mode = 'embedded',
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
  pageLoading,
  pageError,
  onSelectNetwork,
  onCloseNetworkDetail,
  pageUrl,
}: ChromoDevToolsPanelProps) {
  const [height, setHeight] = useState(readStoredHeight)
  const [width, setWidth] = useState(readStoredWidth)

  const resizingRef = useRef(false)
  const pointerIdRef = useRef<number | null>(null)
  const startPointerRef = useRef({ x: 0, y: 0 })
  const startSizeRef = useRef(0)
  const resizeHandleRef = useRef<HTMLDivElement>(null)
  const captureTargetRef = useRef<HTMLElement | null>(null)

  const isWindowMode = mode === 'window'
  const selectedDockAction: ChromoDevToolsDockSide | 'undocked' = isWindowMode
    ? 'undocked'
    : dockSide

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

  const persistHeight = useCallback((nextHeight: number) => {
    const clamped = Math.min(maxDevtoolsHeight(), Math.max(MIN_DEVTOOLS_HEIGHT, nextHeight))
    setHeight(clamped)
    try {
      localStorage.setItem(DEVTOOLS_HEIGHT_KEY, String(clamped))
    } catch {
      // ignore
    }
  }, [])

  const persistWidth = useCallback((nextWidth: number) => {
    const clamped = Math.min(maxDevtoolsWidth(), Math.max(MIN_DEVTOOLS_WIDTH, nextWidth))
    setWidth(clamped)
    try {
      localStorage.setItem(DEVTOOLS_WIDTH_KEY, String(clamped))
    } catch {
      // ignore
    }
  }, [])

  const stopResize = useCallback(() => {
    if (!resizingRef.current) {
      return
    }
    if (captureTargetRef.current && pointerIdRef.current !== null) {
      try {
        captureTargetRef.current.releasePointerCapture(pointerIdRef.current)
      } catch {
        // ignore
      }
    }
    resizingRef.current = false
    captureTargetRef.current = null
    pointerIdRef.current = null
    document.body.style.removeProperty('user-select')
    document.body.style.removeProperty('cursor')
  }, [])

  const onResizePointerMove = useCallback(
    (event: PointerEvent) => {
      if (!resizingRef.current) {
        return
      }
      event.preventDefault()

      if (dockSide === 'bottom') {
        const delta = startPointerRef.current.y - event.clientY
        persistHeight(startSizeRef.current + delta)
        return
      }

      if (dockSide === 'left') {
        const delta = event.clientX - startPointerRef.current.x
        persistWidth(startSizeRef.current + delta)
        return
      }

      const delta = startPointerRef.current.x - event.clientX
      persistWidth(startSizeRef.current + delta)
    },
    [dockSide, persistHeight, persistWidth],
  )

  const onPointerUp = useCallback(
    (event: PointerEvent) => {
      if (pointerIdRef.current !== event.pointerId) {
        return
      }
      stopResize()
    },
    [stopResize],
  )

  const onPointerCancel = useCallback(
    (event: PointerEvent) => {
      if (pointerIdRef.current !== event.pointerId) {
        return
      }
      stopResize()
    },
    [stopResize],
  )

  useEffect(() => {
    if (isWindowMode) {
      return
    }
    const handle = resizeHandleRef.current
    if (!handle) {
      return
    }

    handle.addEventListener('pointermove', onResizePointerMove)
    handle.addEventListener('pointerup', onPointerUp)
    handle.addEventListener('pointercancel', onPointerCancel)
    return () => {
      handle.removeEventListener('pointermove', onResizePointerMove)
      handle.removeEventListener('pointerup', onPointerUp)
      handle.removeEventListener('pointercancel', onPointerCancel)
    }
  }, [isWindowMode, onPointerCancel, onPointerUp, onResizePointerMove])

  const onResizePointerDown = useCallback(
    (event: PointerEvent) => {
      event.preventDefault()
      event.stopPropagation()

      const handle = event.currentTarget as HTMLDivElement
      handle.setPointerCapture(event.pointerId)
      captureTargetRef.current = handle
      pointerIdRef.current = event.pointerId
      resizingRef.current = true
      startPointerRef.current = { x: event.clientX, y: event.clientY }

      if (dockSide === 'bottom') {
        startSizeRef.current = height
        document.body.style.cursor = 'ns-resize'
      } else {
        startSizeRef.current = width
        document.body.style.cursor = 'ew-resize'
      }

      document.body.style.userSelect = 'none'
    },
    [dockSide, height, width],
  )

  const onDockActionClick = useCallback(
    (action: ChromoDevToolsDockSide | 'undocked') => {
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

  const panelStyle = isWindowMode
    ? { height: '100%', width: '100%' }
    : dockSide === 'bottom'
      ? { height: `${height}px` }
      : { width: `${width}px` }

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
      class={[
        'chromo-devtools',
        isWindowMode ? 'chromo-devtools--window' : `chromo-devtools--dock-${dockSide}`,
      ].join(' ')}
      aria-label="DevTools"
      style={panelStyle}
    >
      {!isWindowMode ? (
        <div
          ref={resizeHandleRef}
          class={resizeHandleClass}
          onPointerDown={onResizePointerDown}
          aria-hidden="true"
        />
      ) : null}

      <header class="chromo-devtools__header">
        <div class="chromo-devtools__tabs" role="tablist" aria-label="DevTools 标签">
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
          <div class="chromo-devtools__dock-side" role="group" aria-label="Dock side">
            <span class="chromo-devtools__dock-side-label">Dock side</span>
            {DOCK_ACTIONS.map((side) => (
              <button
                key={side.id}
                type="button"
                class={[
                  'chromo-devtools__dock-side-btn',
                  selectedDockAction === side.id ? 'chromo-devtools__dock-side-btn--active' : '',
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

          {activeTab === 'network' ? (
            <label class="chromo-devtools__preserve">
              <input
                type="checkbox"
                checked={Boolean(disableNetworkCache)}
                onChange={(event) =>
                  onDisableNetworkCacheChange?.(
                    (event.currentTarget as HTMLInputElement).checked,
                  )
                }
              />
              Disable cache
            </label>
          ) : null}
          <label class="chromo-devtools__preserve">
            <input
              type="checkbox"
              checked={preserveLog}
              onChange={(event) =>
                onPreserveLogChange((event.currentTarget as HTMLInputElement).checked)
              }
            />
            Preserve log
          </label>
          <button type="button" class="chromo-devtools__action" onClick={onClear}>
            清空
          </button>
          <button
            type="button"
            class="chromo-devtools__action chromo-devtools__action--close"
            onClick={onClose}
            aria-label="关闭 DevTools"
          >
            ×
          </button>
        </div>
      </header>

      <div class="chromo-devtools__content" role="tabpanel">
        {activeTab === 'console' ? (
          <ChromoConsolePanel
            entries={entries}
            pageReady={pageReady}
            evalInPage={evalInPage}
            replHistory={replHistory}
            onReplHistoryChange={onReplHistoryChange}
            onAppendEntries={onAppendEntries}
          />
        ) : activeTab === 'network' ? (
          <ChromoNetworkPanel
            entries={networkEntries}
            selectedId={selectedNetworkId}
            pageLoading={pageLoading}
            pageError={pageError}
            pageUrl={pageUrl}
            disableNetworkCache={disableNetworkCache}
            readNetworkBody={readNetworkBody}
            onSelect={onSelectNetwork}
            onCloseDetail={onCloseNetworkDetail}
          />
        ) : (
          <div class="chromo-devtools__placeholder">
            此面板需要 virtual-chromo 协议扩展，当前版本不可用。
          </div>
        )}
      </div>
    </section>
  )
}

export type { ChromoDevToolsDockSide, ChromoDevToolsPanelTab }
