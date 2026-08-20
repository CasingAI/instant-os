import type { BuiltinAppId } from './types.ts'

export type UrlOpenHandler = {
  appId: BuiltinAppId
  /** 数字越小越优先；缺省为 100 */
  rank?: number
}

type NormalizedHandler = {
  appId: BuiltinAppId
  rank: number
}

const PREF_STORAGE_KEY = 'instant-os-url-open-pref-v1'

/** 用户更改默认 URL 打开程序后派发 */
export const URL_OPEN_PREF_CHANGED_EVENT = 'instant-os-url-open-pref-changed'

const handlers: NormalizedHandler[] = []

export function registerUrlOpenHandler(handler: UrlOpenHandler): void {
  const existing = handlers.find((item) => item.appId === handler.appId)
  if (existing) {
    if (handler.rank !== undefined) {
      existing.rank = handler.rank
    }
    return
  }

  handlers.push({
    appId: handler.appId,
    rank: handler.rank ?? 100,
  })
}

export function listUrlOpenHandlers(): BuiltinAppId[] {
  return [...handlers]
    .sort((a, b) => a.rank - b.rank || a.appId.localeCompare(b.appId))
    .map((handler) => handler.appId)
}

function isRegisteredUrlOpenApp(appId: BuiltinAppId): boolean {
  return handlers.some((handler) => handler.appId === appId)
}

function readPreferredUrlOpenApp(): BuiltinAppId | undefined {
  try {
    const raw = localStorage.getItem(PREF_STORAGE_KEY)
    if (!raw) return undefined
    const preferred = raw.trim()
    if (!preferred || !isRegisteredUrlOpenApp(preferred as BuiltinAppId)) {
      return undefined
    }
    return preferred as BuiltinAppId
  } catch {
    return undefined
  }
}

export function getPreferredUrlOpenApp(): BuiltinAppId | undefined {
  return readPreferredUrlOpenApp()
}

export function setPreferredUrlOpenApp(appId: BuiltinAppId): void {
  if (!isRegisteredUrlOpenApp(appId)) return
  localStorage.setItem(PREF_STORAGE_KEY, appId)
  window.dispatchEvent(new CustomEvent(URL_OPEN_PREF_CHANGED_EVENT, { detail: { appId } }))
}

export function getDefaultUrlOpenApp(): BuiltinAppId {
  return getPreferredUrlOpenApp() ?? listUrlOpenHandlers()[0] ?? 'chromo'
}
