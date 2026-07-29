/**
 * Resolves VC_CLICK / VC_LOCATION into parent actions so frame-bust
 * (e.g. bilibili open(_, '_top')) does not spawn infinite App tabs.
 */

export type NavEventKind = 'CLICK' | 'LOCATION'

export type NavEvent = {
  kind: NavEventKind
  ts?: number
  method?: string
  url?: string
  href?: string
  target?: string
  httpMethod?: string
}

export type NavIntent =
  | { action: 'ignore'; reason: string }
  | { action: 'sameTab'; url: string; reason: string }
  | { action: 'newTab'; url: string; reason: string }

export type NavPolicyOptions = {
  /** Milliseconds to suppress duplicate same-tab navigations. */
  dedupMs?: number
  /** Current tab URL (for same-url frame-bust detection). */
  currentUrl?: string
}

const DEFAULT_DEDUP_MS = 2000

const lastSeen = new Map<string, number>()

function canonicalUrl(url: string): string {
  const raw = String(url || '').trim()
  if (!raw) return ''
  try {
    const u = new URL(raw)
    let path = u.pathname
    if (path.length > 1 && path.endsWith('/')) {
      path = path.slice(0, -1)
    }
    return u.origin + path + u.search + u.hash
  } catch {
    return raw
  }
}

function urlsEquivalent(a: string, b: string): boolean {
  const ca = canonicalUrl(a)
  const cb = canonicalUrl(b)
  return Boolean(ca && cb && ca === cb)
}

function isSameTabOpenTarget(target: string | undefined): boolean {
  const t = String(target || '').toLowerCase()
  return t === '_top' || t === '_self' || t === '_parent'
}

function isNewTabOpenTarget(target: string | undefined): boolean {
  const t = String(target || '').toLowerCase()
  return t === '_blank' || t === ''
}

function eventUrl(event: NavEvent): string {
  return String(event.url || event.href || '').trim()
}

function dedupKey(event: NavEvent): string {
  return [
    event.kind,
    event.method || '',
    event.target || '',
    canonicalUrl(eventUrl(event)),
  ].join('|')
}

function shouldDedup(event: NavEvent, dedupMs: number): boolean {
  const key = dedupKey(event)
  const now = Date.now()
  const prev = lastSeen.get(key)
  if (prev !== undefined && now - prev < dedupMs) {
    return true
  }
  lastSeen.set(key, now)
  return false
}

/** Map a VC_CLICK / VC_LOCATION payload to a parent action. */
export function resolveNavIntent(
  event: NavEvent,
  options: NavPolicyOptions = {},
): NavIntent {
  const dedupMs = options.dedupMs ?? DEFAULT_DEDUP_MS
  const currentUrl = options.currentUrl || ''
  const url = eventUrl(event)
  const method = String(event.method || '').toLowerCase()
  const target = event.target

  if (!url && method !== 'reload') {
    return { action: 'ignore', reason: 'no url' }
  }

  if (shouldDedup(event, dedupMs)) {
    return { action: 'ignore', reason: 'duplicate within window' }
  }

  if (event.kind === 'LOCATION' && method === 'open') {
    if (isSameTabOpenTarget(target)) {
      if (currentUrl && urlsEquivalent(url, currentUrl)) {
        return { action: 'ignore', reason: 'frame-bust same url' }
      }
      return { action: 'sameTab', url, reason: 'open same-tab target' }
    }
    if (isNewTabOpenTarget(target)) {
      return { action: 'newTab', url, reason: 'open new tab target' }
    }
    return { action: 'sameTab', url, reason: 'open named window → same tab' }
  }

  if (event.kind === 'CLICK') {
    if (!url) {
      return { action: 'ignore', reason: 'click without href' }
    }
    if (isNewTabOpenTarget(target)) {
      return { action: 'newTab', url, reason: 'click target blank' }
    }
    return { action: 'ignore', reason: 'click — wait for VC_HISTORY or VC_LOCATION' }
  }

  if (method === 'reload') {
    return { action: 'sameTab', url: currentUrl || url, reason: 'reload' }
  }

  return { action: 'sameTab', url, reason: 'location change' }
}

export function shouldCreateTab(intent: NavIntent): boolean {
  return intent.action === 'newTab'
}

export function shouldNavigateSameTab(intent: NavIntent): boolean {
  return intent.action === 'sameTab'
}

/** Test helper: clear dedup window state. */
export function resetNavDedupState(): void {
  lastSeen.clear()
}
