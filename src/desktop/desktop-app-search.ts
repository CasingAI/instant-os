import { BUILTIN_APP_CATALOG_ORDER, BUILTIN_APP_DISPLAY_NAMES } from '../os/builtin-app-display-names.ts'
import type { AppId, BuiltinAppId, ExtAppId, GeneratedAppId } from '../os/types.ts'

export type DesktopAppSearchKind = 'builtin' | 'generated' | 'ext'

export type DesktopAppSearchEntry = {
  id: AppId
  name: string
  kind: DesktopAppSearchKind
}

export type DesktopAppSearchKeyEvent = {
  key: string
  metaKey: boolean
  ctrlKey: boolean
  altKey: boolean
  isComposing?: boolean
}

const EXCLUDED_BUILTIN_IDS = new Set<BuiltinAppId>([
  'simulated-terminal',
  'page-devtools',
  'webview',
])

export function isBuiltinAppSearchable(
  appId: BuiltinAppId,
  speechApp = false,
): boolean {
  if (EXCLUDED_BUILTIN_IDS.has(appId)) {
    return false
  }
  if (appId === 'speech') {
    return speechApp
  }
  return true
}

export function listSearchableBuiltinApps(speechApp = false): DesktopAppSearchEntry[] {
  const entries: DesktopAppSearchEntry[] = []
  for (const id of BUILTIN_APP_CATALOG_ORDER) {
    if (!isBuiltinAppSearchable(id, speechApp)) {
      continue
    }
    entries.push({
      id,
      name: BUILTIN_APP_DISPLAY_NAMES[id],
      kind: 'builtin',
    })
  }
  return entries
}

export function buildDesktopAppSearchCatalog(options: {
  speechApp?: boolean
  installedApps: ReadonlyArray<{ id: GeneratedAppId; name: string }>
  sessionExtApps: ReadonlyArray<{ id: ExtAppId; name: string }>
}): DesktopAppSearchEntry[] {
  const builtins = listSearchableBuiltinApps(options.speechApp === true)
  const generated: DesktopAppSearchEntry[] = options.installedApps.map((app) => ({
    id: app.id,
    name: app.name,
    kind: 'generated',
  }))
  const ext: DesktopAppSearchEntry[] = options.sessionExtApps.map((app) => ({
    id: app.id,
    name: app.name,
    kind: 'ext',
  }))
  return [...builtins, ...generated, ...ext]
}

function matchRank(haystack: string, needle: string): number | undefined {
  if (haystack.startsWith(needle)) {
    return 0
  }
  if (haystack.includes(needle)) {
    return 1
  }
  return undefined
}

export function filterDesktopAppSearchResults(
  entries: readonly DesktopAppSearchEntry[],
  query: string,
): DesktopAppSearchEntry[] {
  const needle = query.trim().toLowerCase()
  if (!needle) {
    return [...entries]
  }

  const ranked: { entry: DesktopAppSearchEntry; rank: number; index: number }[] = []
  for (let index = 0; index < entries.length; index += 1) {
    const entry = entries[index]
    const nameRank = matchRank(entry.name.toLowerCase(), needle)
    const idRank = matchRank(entry.id.toLowerCase(), needle)
    if (nameRank === undefined && idRank === undefined) {
      continue
    }
    const rank = nameRank ?? (2 + (idRank ?? 1))
    ranked.push({ entry, rank, index })
  }

  ranked.sort((left, right) => left.rank - right.rank || left.index - right.index)
  return ranked.map((item) => item.entry)
}

export function isDesktopAppSearchTriggerKey(event: DesktopAppSearchKeyEvent): boolean {
  if (event.metaKey || event.ctrlKey || event.altKey) {
    return false
  }
  if (event.isComposing || event.key === 'Process') {
    return true
  }
  if (event.key.length !== 1 || event.key === ' ') {
    return false
  }
  return event.key.charCodeAt(0) >= 32
}

export function desktopAppSearchSeedFromKey(event: DesktopAppSearchKeyEvent): string {
  if (event.isComposing) {
    return ''
  }
  if (event.key.length !== 1 || event.key === ' ') {
    return ''
  }
  return event.key
}

export function isDesktopAppSearchBlockedTarget(target: EventTarget | null): boolean {
  if (target === null || typeof target !== 'object') {
    return false
  }
  const element = target as {
    tagName?: string
    isContentEditable?: boolean
    closest?: (selector: string) => { tagName?: string } | null
  }
  const tag = element.tagName
  if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT' || element.isContentEditable === true) {
    return true
  }
  if (typeof element.closest !== 'function') {
    return false
  }
  try {
    return element.closest('[aria-modal="true"]') !== null
  } catch {
    return false
  }
}
