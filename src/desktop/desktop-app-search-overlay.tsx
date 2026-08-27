import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'preact/hooks'
import { createPortal } from 'preact/compat'
import type { JSX } from 'preact'
import { ExtAppIcon } from '../apps/ext/ext-app-icon.tsx'
import { GeneratedAppIcon } from '../apps/generated/generated-app-icon.tsx'
import { HelpIcon } from '../icons/app-icons.tsx'
import { getAppDefinition } from '../os/app-registry.tsx'
import { useDevExtApps } from '../os/dev-ext-apps-context.tsx'
import { loadExperimentalSettings } from '../os/experimental-settings-storage.ts'
import { useGeneratedApps } from '../os/generated-apps-context.tsx'
import { useOs } from '../os/os-context.tsx'
import type { BuiltinAppId, ExtAppId, GeneratedAppId } from '../os/types.ts'
import { getFloatingOverlayRoot } from '../ui/floating-overlay-root.ts'
import { IosTextField } from '../ui/ios-text-field.tsx'
import { useOverlayPresence } from '../ui/use-overlay-presence.ts'
import '../ui/overlay-presence.css'
import {
  buildDesktopAppSearchCatalog,
  buildDesktopHelpPresetPrompt,
  rankDesktopAppSearchResults,
  type DesktopAppSearchEntry,
  type DesktopAppSearchResult,
} from './desktop-app-search.ts'
import './desktop-app-search-overlay.css'

type DesktopAppSearchOverlayProps = {
  open: boolean
  query: string
  onQueryChange: (query: string) => void
  onClose: () => void
}

function optionId(index: number): string {
  return `desktop-app-search-option-${index}`
}

/** 命中区间（码点 [start, end)）转高亮片段；空区间原样返回 */
function splitNameForHighlight(
  name: string,
  ranges: ReadonlyArray<readonly [number, number]>,
): Array<{ text: string; hit: boolean }> {
  const chars = [...name]
  if (ranges.length === 0) {
    return [{ text: name, hit: false }]
  }
  const hit = new Set<number>()
  for (const [start, end] of ranges) {
    for (let i = Math.max(0, start); i < Math.min(end, chars.length); i += 1) {
      hit.add(i)
    }
  }
  const parts: Array<{ text: string; hit: boolean }> = []
  for (let i = 0; i < chars.length; i += 1) {
    const isHit = hit.has(i)
    const last = parts[parts.length - 1]
    if (last && last.hit === isHit) {
      last.text += chars[i]
    } else {
      parts.push({ text: chars[i]!, hit: isHit })
    }
  }
  return parts
}

function SearchFieldIcon() {
  return (
    <svg
      class="desktop-app-search__magnifier"
      viewBox="0 0 20 20"
      aria-hidden="true"
      fill="none"
      stroke="currentColor"
      stroke-width="1.8"
      stroke-linecap="round"
    >
      <circle cx="8.5" cy="8.5" r="5.4" />
      <line x1="12.6" y1="12.6" x2="17" y2="17" />
    </svg>
  )
}

export function DesktopAppSearchOverlay({
  open,
  query,
  onQueryChange,
  onClose,
}: DesktopAppSearchOverlayProps) {
  const { openApp } = useOs()
  const { installedApps, pendingInstalls, openInstalledApp } = useGeneratedApps()
  const { sessionExtApps, openSessionExtApp } = useDevExtApps()
  const { mounted, exiting } = useOverlayPresence(open)
  const fieldWrapRef = useRef<HTMLDivElement>(null)
  const listRef = useRef<HTMLDivElement>(null)
  const [selectedIndex, setSelectedIndex] = useState(0)

  const speechApp = loadExperimentalSettings().speechApp
  const catalog = useMemo(() => {
    const installed = installedApps.filter(
      (app) => !pendingInstalls.some((item) => item.id === app.id),
    )
    return buildDesktopAppSearchCatalog({
      speechApp,
      installedApps: installed.map((app) => ({ id: app.id, name: app.name })),
      sessionExtApps: sessionExtApps.map((app) => ({
        id: app.id,
        name: app.manifest.name,
      })),
    })
  }, [installedApps, pendingInstalls, sessionExtApps, speechApp])

  const trimmedQuery = query.trim()
  const results = useMemo<DesktopAppSearchResult[]>(() => {
    if (!trimmedQuery) {
      return catalog.map((entry) => ({ entry }))
    }
    return rankDesktopAppSearchResults(catalog, query)
  }, [catalog, query, trimmedQuery])

  // 「让帮助 AI 代办」预设项：只要有输入就常驻（无结果时是唯一推荐）
  const helpActionIndex = trimmedQuery ? results.length : -1
  const totalCount = results.length + (helpActionIndex >= 0 ? 1 : 0)

  useEffect(() => {
    setSelectedIndex(0)
  }, [query])

  const activeIndex = totalCount === 0 ? 0 : Math.min(selectedIndex, totalCount - 1)

  useLayoutEffect(() => {
    if (!open || !mounted || exiting) {
      return
    }
    const input = fieldWrapRef.current?.querySelector('input')
    if (!input) {
      return
    }
    input.focus()
    const end = input.value.length
    input.setSelectionRange(end, end)
  }, [exiting, mounted, open])

  useLayoutEffect(() => {
    const selected = listRef.current?.querySelector<HTMLElement>('[data-selected="true"]')
    selected?.scrollIntoView({ block: 'nearest' })
  }, [activeIndex, results])

  const openEntry = useCallback(
    (entry: DesktopAppSearchEntry) => {
      if (entry.kind === 'builtin') {
        openApp(entry.id)
      } else if (entry.kind === 'generated') {
        openInstalledApp(entry.id as GeneratedAppId)
      } else {
        openSessionExtApp(entry.id as ExtAppId)
      }
      onClose()
    },
    [onClose, openApp, openInstalledApp, openSessionExtApp],
  )

  const openHelpAction = useCallback(() => {
    openApp('help', { helpQuery: buildDesktopHelpPresetPrompt(trimmedQuery) })
    onClose()
  }, [onClose, openApp, trimmedQuery])

  const activateIndex = useCallback(
    (index: number) => {
      if (helpActionIndex >= 0 && index === helpActionIndex) {
        openHelpAction()
        return
      }
      const selected = results[index]
      if (selected) {
        openEntry(selected.entry)
      }
    },
    [helpActionIndex, openEntry, openHelpAction, results],
  )

  useEffect(() => {
    if (!open || exiting) {
      return
    }

    const onKeyDown = (event: KeyboardEvent) => {
      if (event.isComposing) {
        return
      }
      if (event.key === 'Escape') {
        event.preventDefault()
        onClose()
        return
      }
      if (event.key === 'ArrowDown') {
        event.preventDefault()
        if (totalCount === 0) {
          return
        }
        setSelectedIndex(Math.min(activeIndex + 1, totalCount - 1))
        return
      }
      if (event.key === 'ArrowUp') {
        event.preventDefault()
        setSelectedIndex(Math.max(activeIndex - 1, 0))
        return
      }
      if (event.key === 'Enter') {
        event.preventDefault()
        activateIndex(activeIndex)
      }
    }

    window.addEventListener('keydown', onKeyDown, true)
    return () => window.removeEventListener('keydown', onKeyDown, true)
  }, [activateIndex, activeIndex, exiting, onClose, open, totalCount])

  const renderIcon = (entry: DesktopAppSearchEntry) => {
    if (entry.kind === 'builtin') {
      const definition = getAppDefinition(entry.id as BuiltinAppId)
      if (!definition) {
        return null
      }
      const Icon = definition.icon
      return <Icon size={28} />
    }
    if (entry.kind === 'generated') {
      const app = installedApps.find((item) => item.id === entry.id)
      if (!app) {
        return null
      }
      return <GeneratedAppIcon emoji={app.iconEmoji} themeColor={app.themeColor} size={28} />
    }
    const app = sessionExtApps.find((item) => item.id === entry.id)
    if (!app) {
      return null
    }
    return (
      <ExtAppIcon
        name={app.manifest.name}
        themeColor={app.manifest.themeColor}
        iconUrl={app.iconUrl}
        size={28}
      />
    )
  }

  const renderResultRow = (item: DesktopAppSearchResult, index: number) => {
    const selected = index === activeIndex
    const parts = splitNameForHighlight(item.entry.name, item.match?.nameRanges ?? [])
    const showId = Boolean(item.match && item.match.idRanges.length > 0)
    return (
      <button
        key={item.entry.id}
        type="button"
        id={optionId(index)}
        class={`desktop-app-search__item${selected ? ' desktop-app-search__item--active' : ''}`}
        role="option"
        tabIndex={-1}
        aria-selected={selected}
        data-selected={selected ? 'true' : undefined}
        onMouseEnter={() => setSelectedIndex(index)}
        onClick={() => openEntry(item.entry)}
      >
        <span class="desktop-app-search__icon">{renderIcon(item.entry)}</span>
        <span class="desktop-app-search__name">
          {parts.map((part, partIndex) =>
            part.hit ? (
              <mark class="desktop-app-search__hit" key={partIndex}>
                {part.text}
              </mark>
            ) : (
              <span key={partIndex}>{part.text}</span>
            ),
          )}
        </span>
        {showId ? <span class="desktop-app-search__id">{item.entry.id}</span> : null}
      </button>
    )
  }

  const renderHelpActionRow = (index: number) => {
    const selected = index === activeIndex
    return (
      <button
        key="desktop-help-action"
        type="button"
        id={optionId(index)}
        class={[
          'desktop-app-search__item',
          'desktop-app-search__item--help',
          selected ? 'desktop-app-search__item--active' : '',
        ]
          .filter(Boolean)
          .join(' ')}
        role="option"
        tabIndex={-1}
        aria-selected={selected}
        data-selected={selected ? 'true' : undefined}
        onMouseEnter={() => setSelectedIndex(index)}
        onClick={openHelpAction}
      >
        <span class="desktop-app-search__icon">
          <HelpIcon size={28} />
        </span>
        <span class="desktop-app-search__name">
          <span class="desktop-app-search__help-title">让「帮助」AI 代办</span>
          <span class="desktop-app-search__help-query">{trimmedQuery}</span>
        </span>
        <span class="desktop-app-search__id">回车发送</span>
      </button>
    )
  }

  if (!mounted) {
    return null
  }

  const rows: JSX.Element[] = []
  if (results.length > 0) {
    rows.push(
      <div class="desktop-app-search__section" key="section-apps">
        应用
      </div>,
    )
    results.forEach((item, index) => {
      rows.push(renderResultRow(item, index))
    })
  } else if (trimmedQuery) {
    rows.push(
      <p class="desktop-app-search__empty" key="empty">
        没有匹配的应用
      </p>,
    )
  }
  if (helpActionIndex >= 0) {
    rows.push(
      <div class="desktop-app-search__section" key="section-suggestions">
        建议
      </div>,
    )
    rows.push(renderHelpActionRow(helpActionIndex))
  }

  return createPortal(
    <div
      class={[
        'desktop-app-search__backdrop',
        'overlay-presence__backdrop',
        exiting ? 'overlay-presence__backdrop--exiting' : '',
      ]
        .filter(Boolean)
        .join(' ')}
      role="presentation"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) {
          onClose()
        }
      }}
    >
      <div
        class={[
          'desktop-app-search',
          'overlay-presence__sheet',
          exiting ? 'overlay-presence__sheet--exiting' : '',
        ]
          .filter(Boolean)
          .join(' ')}
        role="dialog"
        aria-modal="true"
        aria-label="搜索"
        onMouseDown={(event) => event.stopPropagation()}
      >
        <div class="desktop-app-search__field" ref={fieldWrapRef}>
          <SearchFieldIcon />
          <IosTextField
            type="text"
            voiceDictation={false}
            value={query}
            placeholder="搜索应用，或让 AI 帮你完成"
            aria-autocomplete="list"
            aria-controls="desktop-app-search-results"
            aria-activedescendant={totalCount > 0 ? optionId(activeIndex) : undefined}
            autoComplete="off"
            spellcheck={false}
            autoFocus
            onInput={(event) => onQueryChange((event.currentTarget as HTMLInputElement).value)}
          />
        </div>
        <div
          ref={listRef}
          class="desktop-app-search__results"
          id="desktop-app-search-results"
          role="listbox"
          aria-label="搜索结果"
        >
          {rows}
        </div>
      </div>
    </div>,
    getFloatingOverlayRoot(),
  )
}
