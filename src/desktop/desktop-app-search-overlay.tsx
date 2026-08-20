import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'preact/hooks'
import { createPortal } from 'preact/compat'
import { ExtAppIcon } from '../apps/ext/ext-app-icon.tsx'
import { GeneratedAppIcon } from '../apps/generated/generated-app-icon.tsx'
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
  filterDesktopAppSearchResults,
  type DesktopAppSearchEntry,
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

  const results = useMemo(
    () => filterDesktopAppSearchResults(catalog, query),
    [catalog, query],
  )

  useEffect(() => {
    setSelectedIndex(0)
  }, [query])

  const activeIndex = results.length === 0 ? 0 : Math.min(selectedIndex, results.length - 1)

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
        if (results.length === 0) {
          return
        }
        setSelectedIndex(Math.min(activeIndex + 1, results.length - 1))
        return
      }
      if (event.key === 'ArrowUp') {
        event.preventDefault()
        setSelectedIndex(Math.max(activeIndex - 1, 0))
        return
      }
      if (event.key === 'Enter') {
        event.preventDefault()
        const selected = results[activeIndex]
        if (selected) {
          openEntry(selected)
        }
      }
    }

    window.addEventListener('keydown', onKeyDown, true)
    return () => window.removeEventListener('keydown', onKeyDown, true)
  }, [activeIndex, exiting, onClose, open, openEntry, results])

  const renderIcon = (entry: DesktopAppSearchEntry) => {
    if (entry.kind === 'builtin') {
      const definition = getAppDefinition(entry.id as BuiltinAppId)
      if (!definition) {
        return null
      }
      const Icon = definition.icon
      return <Icon size={32} />
    }
    if (entry.kind === 'generated') {
      const app = installedApps.find((item) => item.id === entry.id)
      if (!app) {
        return null
      }
      return <GeneratedAppIcon emoji={app.iconEmoji} themeColor={app.themeColor} size={32} />
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
        size={32}
      />
    )
  }

  if (!mounted) {
    return null
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
        aria-label="搜索应用"
        onMouseDown={(event) => event.stopPropagation()}
      >
        <div class="desktop-app-search__field" ref={fieldWrapRef}>
          <IosTextField
            type="text"
            voiceDictation={false}
            value={query}
            placeholder="搜索应用"
            aria-autocomplete="list"
            aria-controls="desktop-app-search-results"
            aria-activedescendant={results.length > 0 ? optionId(activeIndex) : undefined}
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
          aria-label="应用"
        >
          {results.length === 0 ? (
            <p class="desktop-app-search__empty">没有找到应用</p>
          ) : (
            results.map((entry, index) => {
              const selected = index === activeIndex
              return (
                <button
                  key={entry.id}
                  type="button"
                  id={optionId(index)}
                  class={`desktop-app-search__item${selected ? ' desktop-app-search__item--active' : ''}`}
                  role="option"
                  tabIndex={-1}
                  aria-selected={selected}
                  data-selected={selected ? 'true' : undefined}
                  onMouseEnter={() => setSelectedIndex(index)}
                  onClick={() => openEntry(entry)}
                >
                  <span class="desktop-app-search__icon">{renderIcon(entry)}</span>
                  <span class="desktop-app-search__name">{entry.name}</span>
                </button>
              )
            })
          )}
        </div>
      </div>
    </div>,
    getFloatingOverlayRoot(),
  )
}
