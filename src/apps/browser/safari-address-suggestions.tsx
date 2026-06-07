import { displayUrl, hostnameFromUrl } from './normalize-browser-url.ts'
import type { HistorySuggestion } from './search-browser-history.ts'

type SafariAddressSuggestionsProps = {
  suggestions: HistorySuggestion[]
  activeIndex: number
  onSelect: (url: string) => void
  onHover: (index: number) => void
}

function siteInitial(url: string): string {
  const host = hostnameFromUrl(url)
  return host.charAt(0).toUpperCase() || '?'
}

export function SafariAddressSuggestions({
  suggestions,
  activeIndex,
  onSelect,
  onHover,
}: SafariAddressSuggestionsProps) {
  if (suggestions.length === 0) {
    return undefined
  }

  return (
    <ul
      class="safari-address-suggestions"
      id="safari-address-suggestions"
      role="listbox"
      aria-label="历史记录建议"
    >
      {suggestions.map((entry, index) => (
        <li key={entry.url} role="presentation">
          <button
            type="button"
            id={`safari-address-suggestion-${index}`}
            class={`safari-address-suggestions__item ${index === activeIndex ? 'safari-address-suggestions__item--active' : ''}`}
            role="option"
            aria-selected={index === activeIndex}
            onMouseDown={(event) => event.preventDefault()}
            onMouseEnter={() => onHover(index)}
            onClick={() => onSelect(entry.url)}
          >
            <span class="safari-address-suggestions__favicon" aria-hidden="true">
              {siteInitial(entry.url)}
            </span>
            <span class="safari-address-suggestions__copy">
              <span class="safari-address-suggestions__title">{entry.title}</span>
              <span class="safari-address-suggestions__url">{displayUrl(entry.url)}</span>
            </span>
          </button>
        </li>
      ))}
    </ul>
  )
}
