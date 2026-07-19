import type { BuiltinAppId } from './types.ts'

export type FileOpenHandler = {
  appId: BuiltinAppId
  extensions: readonly string[]
  /** 数字越小越优先；缺省为 100 */
  rank?: number
}

type NormalizedHandler = {
  appId: BuiltinAppId
  extensions: Set<string>
  rank: number
}

const PREFS_STORAGE_KEY = 'instant-os-file-open-prefs-v2'

/** 用户更改「始终用此程序打开」后派发，供文件图标等刷新 */
export const FILE_OPEN_PREFS_CHANGED_EVENT = 'instant-os-file-open-prefs-changed'

const handlers: NormalizedHandler[] = []

export function normalizeFileExtension(extension: string): string {
  return extension.trim().replace(/^\./, '').toLowerCase()
}

export function fileNameExtension(fileName: string): string | undefined {
  const base = fileName.trim()
  const dot = base.lastIndexOf('.')
  if (dot <= 0 || dot === base.length - 1) {
    return undefined
  }
  return normalizeFileExtension(base.slice(dot + 1))
}

export function registerFileOpenHandler(handler: FileOpenHandler): void {
  const extensions = new Set(
    handler.extensions.map(normalizeFileExtension).filter((ext) => ext.length > 0),
  )
  if (extensions.size === 0) {
    return
  }

  const existing = handlers.find((item) => item.appId === handler.appId)
  if (existing) {
    for (const ext of extensions) {
      existing.extensions.add(ext)
    }
    if (handler.rank !== undefined) {
      existing.rank = handler.rank
    }
    return
  }

  handlers.push({
    appId: handler.appId,
    extensions,
    rank: handler.rank ?? 100,
  })
}

export function listFileOpenHandlers(fileName: string): BuiltinAppId[] {
  const extension = fileNameExtension(fileName)
  if (!extension) {
    return []
  }

  return handlers
    .filter((handler) => handler.extensions.has(extension))
    .sort((a, b) => a.rank - b.rank || a.appId.localeCompare(b.appId))
    .map((handler) => handler.appId)
}

/** 所有已注册「可打开文件」能力的 App（不限后缀） */
export function listRegisteredFileOpenApps(): BuiltinAppId[] {
  return [...handlers]
    .sort((a, b) => a.rank - b.rank || a.appId.localeCompare(b.appId))
    .map((handler) => handler.appId)
}

function isRegisteredOpenApp(appId: BuiltinAppId): boolean {
  return handlers.some((handler) => handler.appId === appId)
}

function readPreferredOpenApps(): Record<string, BuiltinAppId> {
  try {
    const raw = localStorage.getItem(PREFS_STORAGE_KEY)
    if (!raw) return {}
    const parsed = JSON.parse(raw) as unknown
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return {}
    const result: Record<string, BuiltinAppId> = {}
    for (const [key, value] of Object.entries(parsed as Record<string, unknown>)) {
      if (typeof value === 'string' && value.length > 0) {
        result[normalizeFileExtension(key)] = value as BuiltinAppId
      }
    }
    return result
  } catch {
    return {}
  }
}

function writePreferredOpenApps(prefs: Record<string, BuiltinAppId>): void {
  localStorage.setItem(PREFS_STORAGE_KEY, JSON.stringify(prefs))
}

export function getPreferredFileOpenApp(fileName: string): BuiltinAppId | undefined {
  const extension = fileNameExtension(fileName)
  if (!extension) return undefined
  const preferred = readPreferredOpenApps()[extension]
  if (!preferred || !isRegisteredOpenApp(preferred)) return undefined
  return preferred
}

export function setPreferredFileOpenApp(fileName: string, appId: BuiltinAppId): void {
  const extension = fileNameExtension(fileName)
  if (!extension || !isRegisteredOpenApp(appId)) return
  const prefs = readPreferredOpenApps()
  prefs[extension] = appId
  writePreferredOpenApps(prefs)
  window.dispatchEvent(new CustomEvent(FILE_OPEN_PREFS_CHANGED_EVENT, { detail: { extension } }))
}

export function getDefaultFileOpenApp(fileName: string): BuiltinAppId | undefined {
  return getPreferredFileOpenApp(fileName) ?? listFileOpenHandlers(fileName)[0]
}
