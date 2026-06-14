import { useEffect } from 'preact/hooks'
import { CloseIcon } from '../../icons/app-icons.tsx'
import '../../ui/overlay-presence.css'
import { useOverlayPresence } from '../../ui/use-overlay-presence.ts'
import { displayUrl } from './normalize-browser-url.ts'
import type { SafariTabSummary } from './safari-tab-bar.tsx'

type SafariTabsPanelProps = {
  open: boolean
  tabs: SafariTabSummary[]
  activeTabId: string
  onClose: () => void
  onSelectTab: (tabId: string) => void
  onCloseTab: (tabId: string) => void
}

export function SafariTabsPanel({
  open,
  tabs,
  activeTabId,
  onClose,
  onSelectTab,
  onCloseTab,
}: SafariTabsPanelProps) {
  const { mounted, exiting } = useOverlayPresence(open)

  useEffect(() => {
    if (!open && tabs.length === 0) {
      return
    }

    if (open && tabs.length === 0) {
      onClose()
    }
  }, [open, onClose, tabs.length])

  if (!mounted) {
    return undefined
  }

  const handleSelect = (tabId: string) => {
    onSelectTab(tabId)
    onClose()
  }

  return (
    <div
      class={[
        'safari-tabs-panel-backdrop',
        'overlay-presence__backdrop',
        exiting ? 'overlay-presence__backdrop--exiting' : '',
      ]
        .filter(Boolean)
        .join(' ')}
      role="presentation"
      onClick={onClose}
    >
      <aside
        class={[
          'safari-tabs-panel',
          'overlay-presence__sheet',
          exiting ? 'overlay-presence__sheet--exiting' : '',
        ]
          .filter(Boolean)
          .join(' ')}
        role="dialog"
        aria-modal="true"
        aria-label="被隐藏的标签页"
        onClick={(event) => event.stopPropagation()}
      >
        <header class="safari-tabs-panel__header">
          <div>
            <h2 class="safari-tabs-panel__title">被隐藏的标签页</h2>
            <p class="safari-tabs-panel__subtitle">{tabs.length} 个标签页</p>
          </div>
          <button type="button" class="safari-tabs-panel__close" onClick={onClose} aria-label="关闭">
            <CloseIcon />
          </button>
        </header>

        {tabs.length === 0 ? (
          <div class="safari-tabs-panel__empty">
            <p>没有隐藏的标签页</p>
            <span>标签栏可以完整显示全部标签页</span>
          </div>
        ) : (
          <ul class="safari-tabs-panel__list">
            {tabs.map((tab) => {
              const active = tab.id === activeTabId
              return (
                <li
                  key={tab.id}
                  class={['safari-tabs-panel__item', active ? 'safari-tabs-panel__item--active' : '']
                    .filter(Boolean)
                    .join(' ')}
                >
                  <button
                    type="button"
                    class="safari-tabs-panel__main"
                    onClick={() => handleSelect(tab.id)}
                  >
                    {tab.loading ? (
                      <span class="safari-tabs-panel__spinner" aria-hidden="true" />
                    ) : tab.isStartPage ? (
                      <span
                        class="safari-tabs-panel__favicon safari-tabs-panel__favicon--start"
                        aria-hidden="true"
                      >
                        ⌘
                      </span>
                    ) : (
                      <span class="safari-tabs-panel__favicon" aria-hidden="true">
                        {tab.siteInitial}
                      </span>
                    )}
                    <span class="safari-tabs-panel__main-text">
                      <span class="safari-tabs-panel__item-title">{tab.title}</span>
                      {tab.url && (
                        <span class="safari-tabs-panel__item-url">{displayUrl(tab.url)}</span>
                      )}
                    </span>
                  </button>
                  <button
                    type="button"
                    class="safari-tabs-panel__item-close"
                    aria-label={`关闭 ${tab.title}`}
                    onClick={(event) => {
                      event.stopPropagation()
                      onCloseTab(tab.id)
                    }}
                  >
                    <CloseIcon />
                  </button>
                </li>
              )
            })}
          </ul>
        )}
      </aside>
    </div>
  )
}
