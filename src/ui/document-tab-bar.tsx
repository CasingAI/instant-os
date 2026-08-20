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
  /** 低于此数量时隐藏标签栏（带高度进出动画）。默认 2。 */
  minTabsToShow?: number
  onActivate: (tabId: string) => void
  onClose: (tabId: string) => void
}

type DisplayTab = {
  tab: DocumentTabItem
  exiting: boolean
}

/** 标签 flex 宽度过渡时长，与 CSS 保持一致。 */
const TAB_FLEX_TRANSITION_MS = 200

function listenTabFlexTransition(
  node: HTMLElement,
  onDone: () => void,
): () => void {
  const finish = (event: TransitionEvent) => {
    if (event.target !== node || event.propertyName !== 'flex-grow') return
    onDone()
  }
  node.addEventListener('transitionend', finish)
  const fallback = window.setTimeout(onDone, TAB_FLEX_TRANSITION_MS + 50)
  return () => {
    node.removeEventListener('transitionend', finish)
    window.clearTimeout(fallback)
  }
}

function prefersReducedMotion(): boolean {
  return window.matchMedia('(prefers-reduced-motion: reduce)').matches
}

/** 均分后单标签宽度低于此值时，才启用悬停/激活加宽。 */
const TAB_EXPAND_MIN_WIDTH = 96

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
  minTabsToShow = 2,
  onActivate,
  onClose,
}: DocumentTabBarProps) {
  const shouldShowBar = tabs.length >= minTabsToShow
  const [barVisible, setBarVisible] = useState(shouldShowBar)
  const [barAnimating, setBarAnimating] = useState<'enter' | 'exit' | undefined>(undefined)
  const prevShouldShowBarRef = useRef(shouldShowBar)
  const barRef = useRef<HTMLDivElement>(null)

  const [hoverTabId, setHoverTabId] = useState<string | undefined>(undefined)
  const [peekTabId, setPeekTabId] = useState<string | undefined>(undefined)
  const [tabsCrowded, setTabsCrowded] = useState(false)
  const tabsRowRef = useRef<HTMLDivElement>(null)
  const tabsRef = useRef<HTMLDivElement>(null)
  /** 标签栏隐藏期间已打开的标签；这些标签再次出现时不播宽度进入动画。 */
  const preBarTabIdsRef = useRef(new Set<string>())
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

  useLayoutEffect(() => {
    if (tabs.length < minTabsToShow) {
      preBarTabIdsRef.current = new Set(tabs.map((tab) => tab.id))
    }
  }, [tabs, minTabsToShow])

  useLayoutEffect(() => {
    const wasShowing = prevShouldShowBarRef.current
    prevShouldShowBarRef.current = shouldShowBar

    if (shouldShowBar && !wasShowing) {
      setBarVisible(true)
      setBarAnimating(prefersReducedMotion() ? undefined : 'enter')
    } else if (!shouldShowBar && wasShowing) {
      if (prefersReducedMotion()) {
        setBarVisible(false)
        setBarAnimating(undefined)
      } else {
        setBarAnimating('exit')
      }
    }
  }, [shouldShowBar])

  useEffect(() => {
    if (!barAnimating) return
    const node = barRef.current
    if (!node) {
      if (barAnimating === 'exit') {
        setBarVisible(false)
      }
      setBarAnimating(undefined)
      return
    }
    if (prefersReducedMotion()) {
      if (barAnimating === 'exit') setBarVisible(false)
      setBarAnimating(undefined)
      return
    }
    const finish = (event?: AnimationEvent) => {
      if (event && event.target !== node) return
      if (barAnimating === 'exit') setBarVisible(false)
      setBarAnimating(undefined)
    }
    node.addEventListener('animationend', finish)
    const fallback = window.setTimeout(() => finish(), 250)
    return () => {
      node.removeEventListener('animationend', finish)
      window.clearTimeout(fallback)
    }
  }, [barAnimating])

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

  if (!barVisible) return undefined

  return (
    <div
      ref={barRef}
      class={`doc-tab-bar${barAnimating === 'enter' ? ' doc-tab-bar--bar-enter' : ''}${barAnimating === 'exit' ? ' doc-tab-bar--bar-exit' : ''}${className ? ` ${className}` : ''}`}
    >
      <div
        ref={tabsRowRef}
        class="doc-tab-bar__row"
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
              enter={!entry.exiting && !preBarTabIdsRef.current.has(entry.tab.id)}
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
  const [enterActive, setEnterActive] = useState(false)
  const [exitActive, setExitActive] = useState(false)

  useLayoutEffect(() => {
    if (!entering) return
    if (prefersReducedMotion()) {
      setEnterActive(true)
      setEntering(false)
      return
    }
    const frame = window.requestAnimationFrame(() => setEnterActive(true))
    return () => window.cancelAnimationFrame(frame)
  }, [entering])

  useLayoutEffect(() => {
    if (!exiting) {
      setExitActive(false)
      return
    }
    if (prefersReducedMotion()) {
      onExitComplete()
      return
    }
    const frame = window.requestAnimationFrame(() => setExitActive(true))
    return () => window.cancelAnimationFrame(frame)
  }, [exiting, onExitComplete])

  useEffect(() => {
    if (!enterActive || !entering) return
    const node = tabRef.current
    if (!node) {
      setEntering(false)
      setEnterActive(false)
      return
    }
    if (prefersReducedMotion()) {
      setEntering(false)
      setEnterActive(false)
      return
    }
    return listenTabFlexTransition(node, () => {
      setEntering(false)
      setEnterActive(false)
    })
  }, [enterActive, entering])

  useEffect(() => {
    if (!exitActive || !exiting) return
    const node = tabRef.current
    if (!node) {
      onExitComplete()
      return
    }
    return listenTabFlexTransition(node, onExitComplete)
  }, [exitActive, exiting, onExitComplete])

  useEffect(() => {
    if (!active || exiting) return
    const frame = window.requestAnimationFrame(() => {
      tabRef.current?.scrollIntoView({ block: 'nearest', inline: 'nearest' })
    })
    return () => window.cancelAnimationFrame(frame)
  }, [active, exiting])

  return (
    <div
      ref={tabRef}
      class={`doc-tab-bar__tab${active ? ' doc-tab-bar__tab--active' : ''}${tab.dirty ? ' doc-tab-bar__tab--dirty' : ''}${entering ? ' doc-tab-bar__tab--enter' : ''}${entering && enterActive ? ' doc-tab-bar__tab--enter-active' : ''}${exiting ? ' doc-tab-bar__tab--exit' : ''}${exiting && exitActive ? ' doc-tab-bar__tab--exit-active' : ''}${expanded && !entering ? ' doc-tab-bar__tab--expanded' : ''}`}
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
