import { displayUrl, hostnameFromUrl } from '../browser/normalize-browser-url.ts'
import type { ChromoOmniboxSuggestion } from './chromo-omnibox-suggestions.ts'

type ChromoOmniboxSuggestionsListProps = {
  suggestions: ChromoOmniboxSuggestion[]
  activeIndex: number
  onSelect: (url: string) => void
  onHover: (index: number) => void
}

function siteInitial(url: string): string {
  const host = hostnameFromUrl(url)
  return host.charAt(0).toUpperCase() || '?'
}

export function ChromoOmniboxSuggestionsList({
  suggestions,
  activeIndex,
  onSelect,
  onHover,
}: ChromoOmniboxSuggestionsListProps) {
  if (suggestions.length === 0) {
    return undefined
  }

  return (
    <ul id="chromo-omnibox-suggestions" class="chromo-omnibox-suggest" role="listbox" aria-label="地址栏建议">
      {suggestions.map((entry, index) => (
        <li key={entry.url} role="presentation">
          <button
            type="button"
            id={`chromo-omnibox-suggestion-${index}`}
            class={[
              'chromo-omnibox-suggest__item',
              index === activeIndex ? 'chromo-omnibox-suggest__item--active' : '',
            ]
              .filter(Boolean)
              .join(' ')}
            role="option"
            aria-selected={index === activeIndex}
            onMouseDown={(event) => event.preventDefault()}
            onMouseEnter={() => onHover(index)}
            onClick={() => onSelect(entry.url)}
          >
            <span class="chromo-omnibox-suggest__glyph" aria-hidden="true">
              {siteInitial(entry.url)}
            </span>
            <span class="chromo-omnibox-suggest__copy">
              <span class="chromo-omnibox-suggest__title">{entry.title}</span>
              <span class="chromo-omnibox-suggest__url">{displayUrl(entry.url)}</span>
            </span>
            {entry.source === 'bookmark' ? (
              <span class="chromo-omnibox-suggest__kind">书签</span>
            ) : null}
          </button>
        </li>
      ))}
    </ul>
  )
}
