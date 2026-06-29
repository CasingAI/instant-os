/** bridge 被第三方页面 iframe 嵌入时，浏览器会分区隔离 localStorage，须用 Storage Access API 读取主站账户。 */

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
    return true
  }

  try {
    return await document.hasStorageAccess()
  } catch {
    return false
  }
}

export async function requestBridgeStorageAccess(): Promise<boolean> {
  if (!supportsBridgeStorageAccess()) {
    return false
  }

  try {
    await document.requestStorageAccess()
    return await document.hasStorageAccess()
  } catch {
    return false
  }
}

export async function shouldPromptBridgeStorageAccess(): Promise<boolean> {
  if (!isCrossSiteEmbeddedBridge()) {
    return false
  }

  if (!supportsBridgeStorageAccess()) {
    return false
  }

  return !(await hasBridgeStorageAccess())
}
