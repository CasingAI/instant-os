import { loadBrowserHistory, type HistoryVisitRecord } from './browser-history.ts'
import { displayUrl, hostnameFromUrl } from './normalize-browser-url.ts'

export type HistorySuggestion = HistoryVisitRecord

const MAX_SUGGESTIONS = 8

function scoreHistoryMatch(entry: HistoryVisitRecord, query: string): number {
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

  if (score === 0) {
    return 0
  }

  const ageDays = (Date.now() - entry.visitedAt) / 86_400_000
  const recencyBoost = Math.max(0, 20 - ageDays * 2)

  return score + recencyBoost
}

export function searchBrowserHistory(query: string): HistorySuggestion[] {
  const trimmed = query.trim().toLowerCase()
  if (!trimmed) {
    return []
  }

  const seen = new Set<string>()
  const ranked: { entry: HistoryVisitRecord; score: number }[] = []

  for (const entry of loadBrowserHistory()) {
    if (seen.has(entry.url)) {
      continue
    }

    const score = scoreHistoryMatch(entry, trimmed)
    if (score <= 0) {
      continue
    }

    seen.add(entry.url)
    ranked.push({ entry, score })
  }

  ranked.sort((a, b) => b.score - a.score)

  return ranked.slice(0, MAX_SUGGESTIONS).map(({ entry }) => entry)
}
