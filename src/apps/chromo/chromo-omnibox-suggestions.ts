import { osNowMs } from '../../os/os-clock.ts'
import { displayUrl, hostnameFromUrl } from '../browser/normalize-browser-url.ts'
import { loadChromoBookmarks, type ChromoBookmark } from './chromo-bookmarks.ts'
import { loadChromoHistory, type ChromoHistoryVisit } from './chromo-history.ts'

export type ChromoOmniboxSuggestion = {
  url: string
  title: string
  source: 'history' | 'bookmark'
}

const MAX_SUGGESTIONS = 8

function scoreTextMatch(entry: { url: string; title: string }, query: string): number {
  const title = entry.title.toLowerCase()
  const urlDisplay = displayUrl(entry.url).toLowerCase()
  const hostname = hostnameFromUrl(entry.url).toLowerCase()

  let score = 0

  if (hostname.startsWith(query)) {
    score += 100
  } else if (hostname.includes(query)) {
    score += 50
  }

  if (urlDisplay.startsWith(query)) {
    score += 80
  } else if (urlDisplay.includes(query)) {
    score += 40
  }

  if (title.startsWith(query)) {
    score += 60
  } else if (title.includes(query)) {
    score += 30
  }

  return score
}

function scoreHistoryMatch(entry: ChromoHistoryVisit, query: string, now: number): number {
  const score = scoreTextMatch(entry, query)
  if (score <= 0) {
    return 0
  }
  const ageDays = (now - entry.visitedAt) / 86_400_000
  return score + Math.max(0, 20 - ageDays * 2)
}

function scoreBookmarkMatch(entry: ChromoBookmark, query: string): number {
  const score = scoreTextMatch(entry, query)
  if (score <= 0) {
    return 0
  }
  return score + 15
}

export function rankChromoOmniboxSuggestions(
  query: string,
  sources: {
    history: ChromoHistoryVisit[]
    bookmarks: ChromoBookmark[]
  },
): ChromoOmniboxSuggestion[] {
  const trimmed = query.trim().toLowerCase()
  if (!trimmed) {
    return []
  }

  const now = osNowMs()
  const ranked = new Map<string, { suggestion: ChromoOmniboxSuggestion; score: number }>()

  const consider = (suggestion: ChromoOmniboxSuggestion, score: number) => {
    if (score <= 0) {
      return
    }
    const existing = ranked.get(suggestion.url)
    if (!existing || score > existing.score) {
      ranked.set(suggestion.url, { suggestion, score })
    }
  }

  for (const entry of sources.bookmarks) {
    consider(
      { url: entry.url, title: entry.title, source: 'bookmark' },
      scoreBookmarkMatch(entry, trimmed),
    )
  }

  for (const entry of sources.history) {
    consider(
      { url: entry.url, title: entry.title, source: 'history' },
      scoreHistoryMatch(entry, trimmed, now),
    )
  }

  return [...ranked.values()]
    .sort((left, right) => right.score - left.score)
    .slice(0, MAX_SUGGESTIONS)
    .map(({ suggestion }) => suggestion)
}

export function searchChromoOmniboxSuggestions(query: string): ChromoOmniboxSuggestion[] {
  return rankChromoOmniboxSuggestions(query, {
    history: loadChromoHistory(),
    bookmarks: loadChromoBookmarks(),
  })
}
