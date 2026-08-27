import { BUILTIN_APP_CATALOG_ORDER, BUILTIN_APP_DISPLAY_NAMES } from '../os/builtin-app-display-names.ts'
import type { AppId, BuiltinAppId, ExtAppId, GeneratedAppId } from '../os/types.ts'
import { rankDesktopAppSearchEntry, type AppSearchMatch } from './app-search-ranking.ts'

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

export function filterDesktopAppSearchResults(
  entries: readonly DesktopAppSearchEntry[],
  query: string,
): DesktopAppSearchEntry[] {
  if (!query.trim()) {
    return [...entries]
  }
  return rankDesktopAppSearchResults(entries, query).map((item) => item.entry)
}

export type DesktopAppSearchResult = {
  entry: DesktopAppSearchEntry
  /** 空查询直接罗列目录时缺省（无匹配/高亮信息） */
  match?: AppSearchMatch
}

/** 过滤 + 分层排序（拼音/简拼/模糊，详见 app-search-ranking.ts），附高亮区间 */
export function rankDesktopAppSearchResults(
  entries: readonly DesktopAppSearchEntry[],
  query: string,
): DesktopAppSearchResult[] {
  const needle = query.trim().toLowerCase()
  if (!needle) {
    return []
  }
  const ranked: DesktopAppSearchResult[] = []
  for (let index = 0; index < entries.length; index += 1) {
    const entry = entries[index]
    const match = rankDesktopAppSearchEntry(entry, needle)
    if (match) {
      ranked.push({ entry, match })
    }
  }
  const catalogIndex = new Map(entries.map((entry, index) => [entry.id, index]))
  ranked.sort(
    (left, right) =>
      (left.match?.tier ?? 0) - (right.match?.tier ?? 0) ||
      (left.match?.tie ?? 0) - (right.match?.tie ?? 0) ||
      (catalogIndex.get(left.entry.id) ?? 0) - (catalogIndex.get(right.entry.id) ?? 0),
  )
  return ranked
}

/**
 * 桌面搜索「让帮助 AI 代办」预设项的自动发送提示词。
 * 与帮助助手的能力对齐：给最短操作路径，必要时发起可确认的特权操作。
 */
export function buildDesktopHelpPresetPrompt(query: string): string {
  const text = query.trim()
  if (!text) {
    return ''
  }
  return `我想完成这件事，请帮我办成：${text}。请给最短完成路径；需要动手或确认的操作请尽量直接发起（必要时打开终端让我确认）。`
}

export function isDesktopAppSearchTriggerKey(event: DesktopAppSearchKeyEvent): boolean {  if (event.metaKey || event.ctrlKey || event.altKey) {
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
