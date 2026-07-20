import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'preact/hooks'
import './document-tab-bar.css'

export type DocumentTabItem = {
  id: string
  title: string
  pathTitle?: string
  dirty?: boolean
}

type DocumentTabBarProps = {
  tabs: readonly DocumentTabItem[]
  activeTabId: string | undefined
  ariaLabel?: string
  closeDisabled?: boolean
  class?: string
  onActivate: (tabId: string) => void
  onClose: (tabId: string) => void
}

type DisplayTab = {
  tab: DocumentTabItem
  exiting: boolean
}

/** 均分后单标签宽度低于此值时，才启用悬停/激活加宽。 */
const TAB_EXPAND_MIN_WIDTH = 96

let tabEnterAnimationReady = false

function prefersReducedMotion(): boolean {
  return window.matchMedia('(prefers-reduced-motion: reduce)').matches
}

function measureTabsCrowded(tabsEl: HTMLElement): boolean {
  const tabCount = tabsEl.querySelectorAll('.doc-tab-bar__tab:not(.doc-tab-bar__tab--exit)').length
  if (tabCount === 0) return false
  const width = tabsEl.clientWidth
  if (width <= 0) return false
  return width / tabCount < TAB_EXPAND_MIN_WIDTH
}

export function DocumentTabBar({
  tabs,
  activeTabId,
  ariaLabel = '打开的文件',
  closeDisabled = false,
  class: className,
  onActivate,
  onClose,
}: DocumentTabBarProps) {
  const [hoverTabId, setHoverTabId] = useState<string | undefined>(undefined)
  const [peekTabId, setPeekTabId] = useState<string | undefined>(undefined)
  const [tabsCrowded, setTabsCrowded] = useState(false)
  const tabsRowRef = useRef<HTMLDivElement>(null)
  const tabsRef = useRef<HTMLDivElement>(null)
  const seenTabIdsRef = useRef(new Set<string>())
  const peekPointerIdRef = useRef<number | undefined>(undefined)

  const [displayTabs, setDisplayTabs] = useState<DisplayTab[]>(() =>
    tabs.map((tab) => ({ tab, exiting: false })),
  )

  useLayoutEffect(() => {
    const reducedMotion = prefersReducedMotion()
    setDisplayTabs((prev) => {
      const nextIds = new Set(tabs.map((tab) => tab.id))
      const exitingEntries: DisplayTab[] = []

      for (const entry of prev) {
        if (nextIds.has(entry.tab.id)) continue
        if (entry.exiting) {
          exitingEntries.push(entry)
          continue
        }
        if (reducedMotion) continue
        exitingEntries.push({ tab: entry.tab, exiting: true })
      }

      const result: DisplayTab[] = tabs.map((tab) => ({ tab, exiting: false }))
      for (const entry of exitingEntries) {
        const oldIndex = prev.findIndex((item) => item.tab.id === entry.tab.id)
        const insertAt = Math.min(Math.max(oldIndex, 0), result.length)
        result.splice(insertAt, 0, entry)
      }

      return result
    })
  }, [tabs])

  useEffect(() => {
    if (tabEnterAnimationReady) return
    const frame = window.requestAnimationFrame(() => {
      tabEnterAnimationReady = true
    })
    return () => window.cancelAnimationFrame(frame)
  }, [])

  useLayoutEffect(() => {
    for (const tab of tabs) {
      seenTabIdsRef.current.add(tab.id)
    }
  }, [tabs])

  const clearPeek = useCallback(() => {
    peekPointerIdRef.current = undefined
    setPeekTabId(undefined)
  }, [])

  useLayoutEffect(() => {
    const tabsEl = tabsRef.current
    if (!tabsEl) return

    const update = () => {
      setTabsCrowded(measureTabsCrowded(tabsEl))
    }

    update()
    const observer = new ResizeObserver(update)
    observer.observe(tabsEl)
    return () => observer.disconnect()
  }, [displayTabs])

  const finishTabExit = useCallback((tabId: string) => {
    setDisplayTabs((prev) => prev.filter((entry) => entry.tab.id !== tabId))
  }, [])

  const expandedTabId = tabsCrowded ? peekTabId ?? hoverTabId ?? activeTabId : undefined

  return (
    <div
      ref={tabsRowRef}
      class={`doc-tab-bar${className ? ` ${className}` : ''}`}
      onPointerUp={(event) => {
        if (peekPointerIdRef.current === event.pointerId) clearPeek()
      }}
      onPointerCancel={clearPeek}
      onPointerLeave={(event) => {
        if (event.pointerType === 'mouse') return
        const row = tabsRowRef.current
        if (!row) return
        const next = event.relatedTarget
        if (next instanceof Node && row.contains(next)) return
        clearPeek()
      }}
    >
      <div
        ref={tabsRef}
        class="doc-tab-bar__tabs"
        role="tablist"
        aria-label={ariaLabel}
        onMouseLeave={(event) => {
          const tabsEl = event.currentTarget
          const next = event.relatedTarget
          if (next instanceof Node && tabsEl.contains(next)) return
          setHoverTabId(undefined)
        }}
      >
        {displayTabs.map((entry) => (
          <DocumentTabChip
            key={entry.tab.id}
            tab={entry.tab}
            active={!entry.exiting && entry.tab.id === activeTabId}
            disabled={closeDisabled || entry.exiting}
            enter={
              !entry.exiting &&
              tabEnterAnimationReady &&
              !seenTabIdsRef.current.has(entry.tab.id)
            }
            exiting={entry.exiting}
            expanded={!entry.exiting && expandedTabId === entry.tab.id}
            onActivate={() => {
              if (entry.exiting) return
              onActivate(entry.tab.id)
            }}
            onClose={() => {
              if (entry.exiting) return
              onClose(entry.tab.id)
            }}
            onExitComplete={() => finishTabExit(entry.tab.id)}
            onMouseEnter={() => {
              if (entry.exiting) return
              setHoverTabId(entry.tab.id)
            }}
            onPeekStart={(event) => {
              if (entry.exiting || event.pointerType === 'mouse') return
              if ((event.target as HTMLElement).closest('.doc-tab-bar__tab-close')) return
              peekPointerIdRef.current = event.pointerId
              setPeekTabId(entry.tab.id)
            }}
          />
        ))}
      </div>
    </div>
  )
}

type DocumentTabChipProps = {
  tab: DocumentTabItem
  active: boolean
  disabled: boolean
  enter?: boolean
  exiting?: boolean
  expanded?: boolean
  onActivate: () => void
  onClose: () => void
  onExitComplete: () => void
  onMouseEnter: () => void
  onPeekStart: (event: PointerEvent) => void
}

function DocumentTabChip({
  tab,
  active,
  disabled,
  enter = false,
  exiting = false,
  expanded = false,
  onActivate,
  onClose,
  onExitComplete,
  onMouseEnter,
  onPeekStart,
}: DocumentTabChipProps) {
  const tabRef = useRef<HTMLDivElement>(null)
  const [entering, setEntering] = useState(enter && !exiting)

  useEffect(() => {
    if (!active || exiting) return
    const frame = window.requestAnimationFrame(() => {
      tabRef.current?.scrollIntoView({ block: 'nearest', inline: 'nearest' })
    })
    return () => window.cancelAnimationFrame(frame)
  }, [active, exiting])

  useEffect(() => {
    if (!entering) return
    const node = tabRef.current
    if (!node) {
      setEntering(false)
      return
    }
    const finish = () => setEntering(false)
    node.addEventListener('animationend', finish)
    const fallback = window.setTimeout(finish, prefersReducedMotion() ? 0 : 250)
    return () => {
      node.removeEventListener('animationend', finish)
      window.clearTimeout(fallback)
    }
  }, [entering])

  useEffect(() => {
    if (!exiting) return
    const node = tabRef.current
    if (!node || prefersReducedMotion()) {
      onExitComplete()
      return
    }
    const finish = (event?: AnimationEvent) => {
      if (event && event.target !== node) return
      onExitComplete()
    }
    node.addEventListener('animationend', finish)
    const fallback = window.setTimeout(() => finish(), 250)
    return () => {
      node.removeEventListener('animationend', finish)
      window.clearTimeout(fallback)
    }
  }, [exiting, onExitComplete])

  return (
    <div
      ref={tabRef}
      class={`doc-tab-bar__tab${active ? ' doc-tab-bar__tab--active' : ''}${tab.dirty ? ' doc-tab-bar__tab--dirty' : ''}${entering ? ' doc-tab-bar__tab--enter' : ''}${exiting ? ' doc-tab-bar__tab--exit' : ''}${expanded ? ' doc-tab-bar__tab--expanded' : ''}`}
      role="tab"
      aria-selected={active}
      aria-hidden={exiting ? true : undefined}
      onMouseEnter={onMouseEnter}
      onPointerDown={onPeekStart}
    >
      <button
        type="button"
        class="doc-tab-bar__tab-close"
        aria-label={`关闭 ${tab.title}`}
        disabled={disabled}
        onClick={(event) => {
          event.stopPropagation()
          onClose()
        }}
      >
        ×
      </button>
      <button
        type="button"
        class="doc-tab-bar__tab-main"
        title={tab.pathTitle ?? tab.title}
        onClick={onActivate}
      >
        {tab.dirty ? <span class="doc-tab-bar__tab-dot" aria-hidden="true" /> : undefined}
        <span class="doc-tab-bar__tab-title">{tab.title}</span>
      </button>
    </div>
  )
}
