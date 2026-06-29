/** bridge 被第三方页面 iframe 嵌入时，浏览器会分区隔离 localStorage，须用 Storage Access API 读取主站账户。 */

import { setBridgeStorageOverride } from './bridge-storage-context.ts'

type StorageAccessRequestOptions = {
  localStorage?: boolean
}

type StorageAccessHandle = {
  localStorage: Storage
}

export function isCrossSiteEmbeddedBridge(): boolean {
  if (window.parent === window) {
    return false
  }

  try {
    void window.parent.location.href
    return false
  } catch {
    return true
  }
}

export function supportsBridgeStorageAccess(): boolean {
  return (
    typeof document.requestStorageAccess === 'function' &&
    typeof document.hasStorageAccess === 'function'
  )
}

export async function hasBridgeStorageAccess(): Promise<boolean> {
  if (!supportsBridgeStorageAccess()) {
    return false
  }

  try {
    return await document.hasStorageAccess()
  } catch {
    return false
  }
}

async function requestBridgeLocalStorageHandle(): Promise<Storage | undefined> {
  if (!supportsBridgeStorageAccess()) {
    return undefined
  }

  try {
    const result = await document.requestStorageAccess({ localStorage: true } as StorageAccessRequestOptions)
    if (result && typeof result === 'object' && 'localStorage' in result) {
      return (result as StorageAccessHandle).localStorage
    }

    if (await document.hasStorageAccess()) {
      return localStorage
    }
  } catch {
    return undefined
  }

  return undefined
}

/** 已有授权时静默绑定非分区 localStorage（无需用户手势）。 */
export async function tryBindBridgeStorageSilently(): Promise<boolean> {
  if (!isCrossSiteEmbeddedBridge() || !supportsBridgeStorageAccess()) {
    return false
  }

  const hasAccess = await hasBridgeStorageAccess()
  if (!hasAccess) {
    return false
  }

  const storage = await requestBridgeLocalStorageHandle()
  if (!storage) {
    return false
  }

  setBridgeStorageOverride(storage)
  return true
}

export async function requestBridgeStorageAccess(): Promise<boolean> {
  if (!supportsBridgeStorageAccess()) {
    return false
  }

  const storage = await requestBridgeLocalStorageHandle()
  if (!storage) {
    setBridgeStorageOverride(undefined)
    return false
  }

  setBridgeStorageOverride(storage)
  return true
}

/** 跨站嵌入且当前读不到 Key 时，应先让用户同步主站账户。 */
export function shouldPromptBridgeStorageAccess(): boolean {
  if (!isCrossSiteEmbeddedBridge()) {
    return false
  }

  return supportsBridgeStorageAccess()
}
