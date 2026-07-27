import type { ChromoConsoleEntry } from './chromo-bridge.ts'

export type ChromoConsoleLevelFilter = 'all' | 'error' | 'warn' | 'info' | 'verbose'

export type ChromoConsoleReplInputEntry = {
  kind: 'input'
  id: string
  code: string
  ts: number
}

export type ChromoConsoleReplResultEntry = {
  kind: 'result'
  id: string
  code: string
  value?: unknown
  error?: string
  ts: number
}

export type ChromoConsolePageEntry = {
  kind: 'page'
  entry: ChromoConsoleEntry
}

export type ChromoConsoleDisplayEntry =
  | ChromoConsolePageEntry
  | ChromoConsoleReplInputEntry
  | ChromoConsoleReplResultEntry

export function pageEntryToDisplay(entry: ChromoConsoleEntry): ChromoConsolePageEntry {
  return { kind: 'page', entry }
}

export function matchesConsoleLevelFilter(
  level: string | undefined,
  filter: ChromoConsoleLevelFilter,
): boolean {
  if (filter === 'all') {
    return true
  }

  const normalized = (level || 'log').toLowerCase()
  switch (filter) {
    case 'error':
      return normalized === 'error'
    case 'warn':
      return normalized === 'warn' || normalized === 'warning'
    case 'info':
      return normalized === 'info'
    case 'verbose':
      return (
        normalized === 'log' ||
        normalized === 'debug' ||
        normalized === 'verbose' ||
        normalized === 'trace'
      )
    default:
      return true
  }
}

export function displayEntryTimestamp(entry: ChromoConsoleDisplayEntry): number {
  if (entry.kind === 'page') {
    return entry.entry.ts
  }
  return entry.ts
}

export function mergeConsoleDisplayEntries(
  pageEntries: ChromoConsoleEntry[],
  replEntries: ChromoConsoleDisplayEntry[],
): ChromoConsoleDisplayEntry[] {
  return [...pageEntries.map(pageEntryToDisplay), ...replEntries].sort(
    (left, right) => displayEntryTimestamp(left) - displayEntryTimestamp(right),
  )
}

export function displayEntryLevel(entry: ChromoConsoleDisplayEntry): string | undefined {
  if (entry.kind === 'page') {
    return entry.entry.level
  }
  if (entry.kind === 'result') {
    return entry.error ? 'error' : 'log'
  }
  return 'input'
}
