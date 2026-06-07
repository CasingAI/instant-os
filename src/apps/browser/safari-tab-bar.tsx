import { CloseIcon, PlusIcon } from '../../icons/app-icons.tsx'

export type SafariTabSummary = {
  id: string
  title: string
  loading: boolean
  isStartPage: boolean
  siteInitial: string | undefined
}

type SafariTabBarProps = {
  tabs: SafariTabSummary[]
  activeTabId: string
  onSelectTab: (tabId: string) => void
  onCloseTab: (tabId: string) => void
  onNewTab: () => void
}

export function SafariTabBar({
  tabs,
  activeTabId,
  onSelectTab,
  onCloseTab,
  onNewTab,
}: SafariTabBarProps) {
  return (
    <div class="safari__tabs-row">
      <div class="safari__tabs" role="tablist" aria-label="标签页">
        {tabs.map((tab) => {
          const active = tab.id === activeTabId
          return (
            <div
              key={tab.id}
              class={`safari__tab ${active ? 'safari__tab--active' : ''}`}
              role="presentation"
            >
              <button
                type="button"
                class="safari__tab-main"
                role="tab"
                aria-selected={active}
                onClick={() => onSelectTab(tab.id)}
              >
                {tab.loading ? (
                  <span class="safari__tab-spinner" aria-hidden="true" />
                ) : tab.isStartPage ? (
                  <span class="safari__tab-favicon safari__tab-favicon--start" aria-hidden="true">
                    ⌘
                  </span>
                ) : (
                  <span class="safari__tab-favicon" aria-hidden="true">
                    {tab.siteInitial}
                  </span>
                )}
                <span class="safari__tab-title">{tab.title}</span>
              </button>
              {tabs.length > 1 && (
                <button
                  type="button"
                  class="safari__tab-close"
                  aria-label={`关闭 ${tab.title}`}
                  onClick={(event) => {
                    event.stopPropagation()
                    onCloseTab(tab.id)
                  }}
                >
                  <CloseIcon />
                </button>
              )}
            </div>
          )
        })}
      </div>
      <button type="button" class="safari__tab-new" onClick={onNewTab} aria-label="新建标签页">
        <PlusIcon />
      </button>
    </div>
  )
}
