/**
 * Virtual Studio Code 内部运行日志（内存环形缓冲 + 订阅）。
 * 用于底部「日志」面板观察 Worker / 模块解析等内部行为。
 */

export type VscodeInternalLogLevel = 'info' | 'warn' | 'error'

export type VscodeInternalLogEntry = {
  id: number
  at: number
  level: VscodeInternalLogLevel
  scope: string
  message: string
}

const MAX_ENTRIES = 400

let nextId = 1
const entries: VscodeInternalLogEntry[] = []
const listeners = new Set<() => void>()

function emit(): void {
  for (const listener of listeners) {
    try {
      listener()
    } catch {
      // ignore subscriber errors
    }
  }
}

export function appendVscodeInternalLog(
  scope: string,
  message: string,
  level: VscodeInternalLogLevel = 'info',
): void {
  entries.push({
    id: nextId,
    at: Date.now(),
    level,
    scope,
    message,
  })
  nextId += 1
  while (entries.length > MAX_ENTRIES) entries.shift()
  emit()
}

export function getVscodeInternalLogs(): readonly VscodeInternalLogEntry[] {
  return entries
}

export function clearVscodeInternalLogs(): void {
  entries.length = 0
  emit()
}

export function subscribeVscodeInternalLogs(listener: () => void): () => void {
  listeners.add(listener)
  return () => {
    listeners.delete(listener)
  }
}

export function formatVscodeInternalLogTime(at: number): string {
  const date = new Date(at)
  const hh = String(date.getHours()).padStart(2, '0')
  const mm = String(date.getMinutes()).padStart(2, '0')
  const ss = String(date.getSeconds()).padStart(2, '0')
  const ms = String(date.getMilliseconds()).padStart(3, '0')
  return `${hh}:${mm}:${ss}.${ms}`
}
