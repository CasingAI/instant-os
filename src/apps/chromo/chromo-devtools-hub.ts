import type {
  ChromoConsoleEntry,
  ChromoNetworkBodyReadResult,
  ChromoNetworkEntry,
  ChromoNetworkOptions,
} from './chromo-bridge.ts'
import type { ChromoConsoleDisplayEntry } from './chromo-console-types.ts'
import type { ChromoPageFault } from './chromo-page-fault.ts'

export type ChromoDevToolsPanelTab = 'console' | 'network' | 'extensions'
export type ChromoDevToolsDockSide = 'bottom' | 'left' | 'right'

export type ChromoDevToolsSessionKey = string

export type ChromoDevToolsSnapshot = {
  parentWindowId: string
  tabId: string
  pageTitle: string
  pageUrl: string
  pageReady: boolean
  pageLoading: boolean
  pageError?: string
  pageFault?: ChromoPageFault
  panelTab: ChromoDevToolsPanelTab
  dockSide: ChromoDevToolsDockSide
  preserveLog: boolean
  consoleEntries: ChromoConsoleEntry[]
  replEntries: ChromoConsoleDisplayEntry[]
  replHistory: string[]
  networkEntries: ChromoNetworkEntry[]
  selectedNetworkId: string
  disableNetworkCache: boolean
  vConsoleEnabled: boolean
  vConsoleBusy: boolean
  vConsoleError?: string
  debugPanelEnabled: boolean
}

export type ChromoDevToolsHandlers = {
  evalInPage: (code: string) => Promise<unknown>
  readNetworkBody: (entryId: string) => Promise<ChromoNetworkBodyReadResult>
  probeNetworkHot: (method: string, url: string) => Promise<{ exists: boolean }>
  setNetworkOptions: (options: ChromoNetworkOptions) => void
  onPanelTabChange: (tab: ChromoDevToolsPanelTab) => void
  onPreserveLogChange: (preserve: boolean) => void
  onClear: () => void
  onAppendEntries: (entries: ChromoConsoleDisplayEntry[]) => void
  onReplHistoryChange: (history: string[]) => void
  onSelectNetwork: (entry: ChromoNetworkEntry) => void
  onCloseNetworkDetail: () => void
  onDisableNetworkCacheChange: (disable: boolean) => void
  onVConsoleEnabledChange: (enabled: boolean) => void
  onDebugPanelEnabledChange: (enabled: boolean) => void
  onRedock: (side: ChromoDevToolsDockSide) => void
  onDetachedClosed: () => void
}

type SessionRecord = {
  snapshot: ChromoDevToolsSnapshot
  handlers: ChromoDevToolsHandlers
  listeners: Set<() => void>
}

const sessions = new Map<ChromoDevToolsSessionKey, SessionRecord>()
const pendingListeners = new Map<ChromoDevToolsSessionKey, Set<() => void>>()

export function makeChromoDevToolsSessionKey(parentWindowId: string, tabId: string): string {
  return `${parentWindowId}:${tabId}`
}

export function parseChromoDevToolsSessionKey(
  documentId: string | undefined,
): { parentWindowId: string; tabId: string } | undefined {
  if (!documentId) {
    return undefined
  }
  const sep = documentId.indexOf(':')
  if (sep <= 0 || sep >= documentId.length - 1) {
    return undefined
  }
  return {
    parentWindowId: documentId.slice(0, sep),
    tabId: documentId.slice(sep + 1),
  }
}

export function registerChromoDevToolsSession(
  key: ChromoDevToolsSessionKey,
  snapshot: ChromoDevToolsSnapshot,
  handlers: ChromoDevToolsHandlers,
): void {
  const existing = sessions.get(key)
  if (existing) {
    existing.snapshot = snapshot
    existing.handlers = handlers
    notify(key, existing)
    return
  }

  const pending = pendingListeners.get(key)
  const listeners = pending ?? new Set<() => void>()
  pendingListeners.delete(key)

  const record: SessionRecord = { snapshot, handlers, listeners }
  sessions.set(key, record)
  notify(key, record)
}

export function updateChromoDevToolsSnapshot(
  key: ChromoDevToolsSessionKey,
  snapshot: ChromoDevToolsSnapshot,
): void {
  const existing = sessions.get(key)
  if (!existing) {
    return
  }
  existing.snapshot = snapshot
  notify(key, existing)
}

export function updateChromoDevToolsHandlers(
  key: ChromoDevToolsSessionKey,
  handlers: ChromoDevToolsHandlers,
): void {
  const existing = sessions.get(key)
  if (!existing) {
    return
  }
  existing.handlers = handlers
}

export function unregisterChromoDevToolsSession(key: ChromoDevToolsSessionKey): void {
  const existing = sessions.get(key)
  if (!existing) {
    return
  }
  sessions.delete(key)
  notify(key, existing)
}

export function getChromoDevToolsSession(
  key: ChromoDevToolsSessionKey,
): { snapshot: ChromoDevToolsSnapshot; handlers: ChromoDevToolsHandlers } | undefined {
  const existing = sessions.get(key)
  if (!existing) {
    return undefined
  }
  return { snapshot: existing.snapshot, handlers: existing.handlers }
}

export function subscribeChromoDevToolsSession(
  key: ChromoDevToolsSessionKey,
  listener: () => void,
): () => void {
  const existing = sessions.get(key)
  if (existing) {
    existing.listeners.add(listener)
    return () => {
      existing.listeners.delete(listener)
    }
  }

  let pending = pendingListeners.get(key)
  if (!pending) {
    pending = new Set()
    pendingListeners.set(key, pending)
  }
  pending.add(listener)
  return () => {
    pending?.delete(listener)
    if (pending && pending.size === 0) {
      pendingListeners.delete(key)
    }
    sessions.get(key)?.listeners.delete(listener)
  }
}

function notify(_key: ChromoDevToolsSessionKey, session: SessionRecord): void {
  for (const listener of [...session.listeners]) {
    listener()
  }
}
