import { useCallback, useEffect, useRef, useState } from 'preact/hooks'
import { ChromoConsolePanel } from './chromo-console-panel.tsx'
import type { ChromoConsoleDisplayEntry } from './chromo-console-types.ts'
import type { ChromoNetworkEntry } from './chromo-bridge.ts'
import { ChromoNetworkPanel } from './chromo-network-panel.tsx'

const DEVTOOLS_HEIGHT_KEY = 'chromo-devtools-height'
const DEFAULT_DEVTOOLS_HEIGHT = 240
const MIN_DEVTOOLS_HEIGHT = 120

type ChromoDevToolsTab = 'console' | 'elements' | 'network'

type ChromoDevToolsPanelProps = {
  activeTab: ChromoDevToolsTab
  onTabChange: (tab: ChromoDevToolsTab) => void
  onClose: () => void
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
  onSelectNetwork: (entry: ChromoNetworkEntry) => void
}

const TABS: {
  id: ChromoDevToolsTab
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

function maxDevtoolsHeight(): number {
  return Math.max(MIN_DEVTOOLS_HEIGHT, Math.floor(window.innerHeight * 0.6))
}

export function ChromoDevToolsPanel({
  activeTab,
  onTabChange,
  onClose,
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
  onSelectNetwork,
}: ChromoDevToolsPanelProps) {
  const [height, setHeight] = useState(readStoredHeight)
  const resizingRef = useRef(false)
  const startYRef = useRef(0)
  const startHeightRef = useRef(height)

  const persistHeight = useCallback((nextHeight: number) => {
    const clamped = Math.min(maxDevtoolsHeight(), Math.max(MIN_DEVTOOLS_HEIGHT, nextHeight))
    setHeight(clamped)
    try {
      localStorage.setItem(DEVTOOLS_HEIGHT_KEY, String(clamped))
    } catch {
      // ignore
    }
  }, [])

  useEffect(() => {
    const onPointerMove = (event: PointerEvent) => {
      if (!resizingRef.current) {
        return
      }
      const delta = startYRef.current - event.clientY
      persistHeight(startHeightRef.current + delta)
    }

    const onPointerUp = () => {
      resizingRef.current = false
    }

    window.addEventListener('pointermove', onPointerMove)
    window.addEventListener('pointerup', onPointerUp)
    return () => {
      window.removeEventListener('pointermove', onPointerMove)
      window.removeEventListener('pointerup', onPointerUp)
    }
  }, [persistHeight])

  const onResizePointerDown = useCallback(
    (event: PointerEvent) => {
      event.preventDefault()
      resizingRef.current = true
      startYRef.current = event.clientY
      startHeightRef.current = height
    },
    [height],
  )

  return (
    <section
      class="chromo-devtools"
      aria-label="DevTools"
      style={{ height: `${height}px` }}
    >
      <div
        class="chromo-devtools__resize-handle"
        onPointerDown={onResizePointerDown}
        aria-hidden="true"
      />

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
            onSelect={onSelectNetwork}
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
