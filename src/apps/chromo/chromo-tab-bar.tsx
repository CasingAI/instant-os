import { useCallback, useLayoutEffect, useRef, useState } from 'preact/hooks'
import { CloseIcon, PlusIcon, TabsIcon } from '../../icons/app-icons.tsx'

export type ChromoTabSummary = {
  id: string
  title: string
  url?: string
  loading: boolean
  siteInitial: string | undefined
}

type ChromoTabBarProps = {
  tabs: ChromoTabSummary[]
  activeTabId: string
  overflowOpen: boolean
  onSelectTab: (tabId: string) => void
  onCloseTab: (tabId: string) => void
  onNewTab: () => void
  onToggleOverflow: () => void
  onHiddenTabsChange?: (hiddenTabIds: string[]) => void
}

const TAB_ANIMATION_MS = 180
const TAB_OVERLAP_PX = 16

let tabGradientSeq = 0

function setsEqual(left: Set<string>, right: Set<string>): boolean {
  if (left.size !== right.size) {
    return false
  }

  for (const value of left) {
    if (!right.has(value)) {
      return false
    }
  }

  return true
}

function arraysEqual(left: string[], right: string[]): boolean {
  if (left.length !== right.length) {
    return false
  }

  for (let index = 0; index < left.length; index += 1) {
    if (left[index] !== right[index]) {
      return false
    }
  }

  return true
}

function computeVisibleTabIds(
  tabs: ChromoTabSummary[],
  activeTabId: string,
  maxVisible: number,
): Set<string> {
  if (tabs.length <= maxVisible) {
    return new Set(tabs.map((tab) => tab.id))
  }

  const leadingIds = tabs.slice(0, maxVisible).map((tab) => tab.id)
  const visible = new Set(leadingIds)

  if (!visible.has(activeTabId)) {
    const lastId = leadingIds[leadingIds.length - 1]
    if (lastId) {
      visible.delete(lastId)
    }
    visible.add(activeTabId)
  }

  return visible
}

export function ChromoTabBar({
  tabs,
  activeTabId,
  overflowOpen,
  onSelectTab,
  onCloseTab,
  onNewTab,
  onToggleOverflow,
  onHiddenTabsChange,
}: ChromoTabBarProps) {
  const gradientNsRef = useRef(`chromo-tab-${++tabGradientSeq}`)
  const idleFillId = `${gradientNsRef.current}-idle`
  const activeFillId = `${gradientNsRef.current}-active`
  const tabsScrollRef = useRef<HTMLDivElement>(null)
  const prevTabIdsRef = useRef<Set<string>>(new Set(tabs.map((tab) => tab.id)))
  const prevHiddenTabIdsRef = useRef<string[]>([])
  const [heldEnteringTabIds, setHeldEnteringTabIds] = useState<Set<string>>(() => new Set())
  const [exitingTabIds, setExitingTabIds] = useState<Set<string>>(() => new Set())
  const [visibleTabIds, setVisibleTabIds] = useState<Set<string>>(() => new Set(tabs.map((tab) => tab.id)))

  const tabLayoutKey = tabs
    .map((tab) => `${tab.id}:${tab.title}:${tab.loading ? 1 : 0}`)
    .join('|')

  const currentTabIds = tabs.map((tab) => tab.id)
  const newlyAddedTabIds = currentTabIds.filter((id) => !prevTabIdsRef.current.has(id))
  const enteringTabIds = new Set([
    ...[...heldEnteringTabIds].filter((id) => currentTabIds.includes(id)),
    ...newlyAddedTabIds,
  ])

  const measureVisibleTabs = useCallback(() => {
    const scroll = tabsScrollRef.current
    if (!scroll) {
      return
    }

    const tabElements = Array.from(scroll.querySelectorAll<HTMLElement>('[data-tab-index]'))
    const allTabIds = tabs.map((tab) => tab.id)

    const commitVisibleTabIds = (next: Set<string>) => {
      setVisibleTabIds((prev) => (setsEqual(prev, next) ? prev : next))
    }

    if (tabElements.length === 0) {
      commitVisibleTabIds(new Set(allTabIds))
      return
    }

    const available = scroll.clientWidth
    const overlap = TAB_OVERLAP_PX
    let totalWidth = 0
    const widths: number[] = []

    for (let index = 0; index < tabElements.length; index += 1) {
      const width = tabElements[index].offsetWidth
      widths.push(width)
      totalWidth += width - (index > 0 ? overlap : 0)
    }

    if (totalWidth <= available) {
      commitVisibleTabIds(new Set(allTabIds))
      return
    }

    let fit = tabElements.length
    let visibleWidth = totalWidth

    while (fit > 0 && visibleWidth > available) {
      fit -= 1
      visibleWidth -= widths[fit] - (fit > 0 ? overlap : 0)
    }

    commitVisibleTabIds(computeVisibleTabIds(tabs, activeTabId, Math.max(1, fit)))
  }, [activeTabId, tabLayoutKey, tabs])

  useLayoutEffect(() => {
    prevTabIdsRef.current = new Set(currentTabIds)

    if (newlyAddedTabIds.length === 0) {
      return
    }

    setHeldEnteringTabIds((prev) => new Set([...prev, ...newlyAddedTabIds]))
    const timer = window.setTimeout(() => {
      setHeldEnteringTabIds((prev) => {
        const next = new Set(prev)
        for (const id of newlyAddedTabIds) {
          next.delete(id)
        }
        return next
      })
    }, TAB_ANIMATION_MS)

    return () => window.clearTimeout(timer)
  }, [tabLayoutKey])

  useLayoutEffect(() => {
    measureVisibleTabs()
  }, [measureVisibleTabs, tabLayoutKey, activeTabId])

  useLayoutEffect(() => {
    const scroll = tabsScrollRef.current
    if (!scroll || typeof ResizeObserver === 'undefined') {
      return
    }

    const observer = new ResizeObserver(() => measureVisibleTabs())
    observer.observe(scroll)
    return () => observer.disconnect()
  }, [measureVisibleTabs])

  useLayoutEffect(() => {
    const hiddenTabIds = tabs
      .filter((tab) => !visibleTabIds.has(tab.id))
      .map((tab) => tab.id)

    if (arraysEqual(hiddenTabIds, prevHiddenTabIdsRef.current)) {
      return
    }

    prevHiddenTabIdsRef.current = hiddenTabIds
    onHiddenTabsChange?.(hiddenTabIds)
  }, [onHiddenTabsChange, tabLayoutKey, visibleTabIds, tabs])

  const hasOverflow = tabs.some((tab) => !visibleTabIds.has(tab.id))

  const handleCloseTab = (tabId: string) => {
    if (exitingTabIds.has(tabId)) {
      return
    }

    setExitingTabIds((prev) => new Set([...prev, tabId]))
    window.setTimeout(() => {
      onCloseTab(tabId)
      setExitingTabIds((prev) => {
        const next = new Set(prev)
        next.delete(tabId)
        return next
      })
    }, TAB_ANIMATION_MS)
  }

  return (
    <div class="chromo__tabs-row">
      <svg class="chromo__tab-defs" width="0" height="0" aria-hidden="true" focusable="false">
        <defs>
          <linearGradient id={idleFillId} x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stop-color="#9bc4e8" />
            <stop offset="48%" stop-color="#6d9ac4" />
            <stop offset="100%" stop-color="#547eaa" />
          </linearGradient>
          <linearGradient id={activeFillId} x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stop-color="#fafafa" />
            <stop offset="100%" stop-color="#f0f0f0" />
          </linearGradient>
        </defs>
      </svg>
      <div class="chromo__tabs" ref={tabsScrollRef} role="tablist" aria-label="标签页">
        {tabs.map((tab, index) => {
          const active = tab.id === activeTabId
          const entering = enteringTabIds.has(tab.id)
          const exiting = exitingTabIds.has(tab.id)
          const overflowing = hasOverflow && !visibleTabIds.has(tab.id)

          return (
            <div
              key={tab.id}
              class={[
                'chromo__tab',
                active ? 'chromo__tab--active' : '',
                entering ? 'chromo__tab--entering' : '',
                exiting ? 'chromo__tab--exiting' : '',
                overflowing ? 'chromo__tab--overflowing' : '',
              ]
                .filter(Boolean)
                .join(' ')}
              data-tab-index={index}
              aria-hidden={overflowing}
              role="presentation"
              style={{ zIndex: overflowing ? 0 : active ? 20 : index + 1 }}
            >
              <span class="chromo__tab-shape" aria-hidden="true">
                <svg class="chromo__tab-shape-left" viewBox="0 0 18 28" preserveAspectRatio="none">
                  <path
                    d="M18 0 C14 0 12 1 10 5 L4 24 C2 27 1 28 0 28 H18 Z"
                    fill={`url(#${active ? activeFillId : idleFillId})`}
                  />
                </svg>
                <span class="chromo__tab-shape-mid" />
                <svg class="chromo__tab-shape-right" viewBox="0 0 18 28" preserveAspectRatio="none">
                  <path
                    d="M0 0 C4 0 6 1 8 5 L14 24 C16 27 17 28 18 28 H0 Z"
                    fill={`url(#${active ? activeFillId : idleFillId})`}
                  />
                </svg>
              </span>
              <button
                type="button"
                class="chromo__tab-main"
                role="tab"
                aria-selected={active}
                tabIndex={overflowing ? -1 : 0}
                onClick={() => onSelectTab(tab.id)}
              >
                {tab.loading ? (
                  <span class="chromo__tab-spinner" aria-hidden="true" />
                ) : tab.siteInitial ? (
                  <span class="chromo__tab-favicon" aria-hidden="true">
                    {tab.siteInitial}
                  </span>
                ) : null}
                <span class="chromo__tab-title">{tab.title}</span>
              </button>
              <button
                type="button"
                class="chromo__tab-close"
                aria-label={`关闭 ${tab.title}`}
                onClick={(event) => {
                  event.stopPropagation()
                  handleCloseTab(tab.id)
                }}
              >
                <CloseIcon />
              </button>
            </div>
          )
        })}
      </div>
      {hasOverflow && (
        <button
          type="button"
          class={[
            'chromo__tab-overflow-btn',
            overflowOpen ? 'chromo__tab-overflow-btn--active' : '',
          ]
            .filter(Boolean)
            .join(' ')}
          aria-label="被隐藏的标签页"
          aria-expanded={overflowOpen}
          onClick={onToggleOverflow}
        >
          <TabsIcon />
        </button>
      )}
      <button type="button" class="chromo__tab-new" onClick={onNewTab} aria-label="新建标签页">
        <PlusIcon />
      </button>
    </div>
  )
}
