export type DevLogLevel = 'info' | 'success' | 'warn' | 'error'

export type DevLogCategory = 'lifecycle' | 'bridge-out' | 'bridge-in' | 'ai' | 'system'

export type DevLogEntry = {
  id: string
  timestamp: number
  level: DevLogLevel
  category: DevLogCategory
  message: string
  detail?: unknown
}

const DEV_LOG_CHANGED_EVENT = 'instant-os-dev-log-changed'

let sequence = 0
const entries: DevLogEntry[] = []
const MAX_ENTRIES = 200

function emitChanged(): void {
  window.dispatchEvent(new CustomEvent(DEV_LOG_CHANGED_EVENT))
}

export function appendDevLog(
  category: DevLogCategory,
  message: string,
  options?: {
    level?: DevLogLevel
    detail?: unknown
  },
): DevLogEntry | undefined {
  if (!import.meta.env.DEV && import.meta.env.VITE_INSTANT_OS_DEV_TOOLS !== 'true') {
    return undefined
  }

  sequence += 1
  const entry: DevLogEntry = {
    id: `dev-log-${sequence}`,
    timestamp: Date.now(),
    level: options?.level ?? 'info',
    category,
    message,
    detail: options?.detail,
  }

  entries.unshift(entry)
  if (entries.length > MAX_ENTRIES) {
    entries.length = MAX_ENTRIES
  }

  const consoleMethod =
    entry.level === 'error'
      ? console.error
      : entry.level === 'warn'
        ? console.warn
        : console.info

  consoleMethod(`[instant-os-dev:${category}]`, message, options?.detail ?? '')

  emitChanged()
  return entry
}

export function readDevLogs(): readonly DevLogEntry[] {
  return entries
}

export function clearDevLogs(): void {
  entries.length = 0
  emitChanged()
}

export function subscribeDevLogs(listener: () => void): () => void {
  const handler = () => listener()
  window.addEventListener(DEV_LOG_CHANGED_EVENT, handler)
  return () => window.removeEventListener(DEV_LOG_CHANGED_EVENT, handler)
}
