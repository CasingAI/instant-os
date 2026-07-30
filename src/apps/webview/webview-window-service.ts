import {
  bindWebViewWindow,
  destroyWebViewUnit,
  findWebViewWindowId,
  getWebViewUnit,
  listWebViewUnits,
  setWebViewViewportTarget,
  updateWebViewTab,
} from './webview-registry.ts'

const APP_ID = 'webview' as const

export type WebViewWindowHost = {
  openApp: (appId: typeof APP_ID, options?: { documentId?: string }) => string | undefined
  getWindows: () => {
    id: string
    appId: string
    documentId?: string
    closing?: boolean
    minimized?: boolean
  }[]
  focusWindow: (windowId: string) => void
  restoreWindow: (windowId: string) => void
  closeWindow: (windowId: string) => void
}

/** 查找 unit 当前仍存活的 OS Window（未 closing）。 */
export function findLiveWebViewWindow(
  host: Pick<WebViewWindowHost, 'getWindows'>,
  unitId: string,
): { id: string; minimized?: boolean } | undefined {
  const windows = host.getWindows()
  const windowId = findWebViewWindowId(unitId, windows)
  if (!windowId) return undefined
  return windows.find((window) => window.id === windowId && !window.closing)
}

/**
 * 显示 WebView 窗口壳。
 * - 已有 live Window → focus / restore（不新开）
 * - 否则 openApp 新开普通窗（Shell mount effect 负责 bind）
 */
export function showWebViewWindow(host: WebViewWindowHost, unitId: string): void {
  if (!getWebViewUnit(unitId)) {
    throw new Error(`浏览单元不存在: ${unitId}`)
  }

  const existing = findLiveWebViewWindow(host, unitId)
  if (existing) {
    if (existing.minimized) {
      host.restoreWindow(existing.id)
    }
    host.focusWindow(existing.id)
    return
  }

  const windowId = host.openApp(APP_ID, { documentId: unitId })
  if (!windowId) {
    throw new Error(`无法打开 WebView 窗口: ${unitId}`)
  }
  host.focusWindow(windowId)
}

/**
 * 收起 WebView 窗口壳回离屏（不销毁 unit）。
 * 未 show 时为 no-op。
 */
export function hideWebViewWindow(host: WebViewWindowHost, unitId: string): void {
  if (!getWebViewUnit(unitId)) {
    throw new Error(`浏览单元不存在: ${unitId}`)
  }
  const existing = findLiveWebViewWindow(host, unitId)
  if (!existing && !getWebViewUnit(unitId)?.windowId) {
    return
  }
  detachWebViewWindow(host, unitId, { closeOsWindow: true })
}

/**
 * 关壳：清 window 绑定与 viewportTarget，关关联 page-devtools 窗，收起内嵌 DevTools。
 * 不 destroy unit。调用方负责 closeWindow（Close Guard 路径里 OS 已在关窗）。
 */
export function detachWebViewWindow(
  host: Pick<WebViewWindowHost, 'getWindows' | 'closeWindow'>,
  unitId: string,
  options?: { closeOsWindow?: boolean },
): void {
  const unit = getWebViewUnit(unitId)
  const windowId = unit?.windowId

  setWebViewViewportTarget(unitId, null)
  bindWebViewWindow(unitId, undefined)

  if (unit) {
    for (const tab of unit.tabs) {
      if (tab.devtoolsOpen || tab.devtoolsUndocked) {
        updateWebViewTab(unitId, tab.id, (entry) => ({
          ...entry,
          devtoolsOpen: false,
          devtoolsUndocked: false,
        }))
      }
    }
  }

  // 关独立 DevTools 窗
  for (const window of host.getWindows()) {
    if (
      window.appId === 'page-devtools' &&
      !window.closing &&
      window.documentId?.startsWith(`${unitId}:`)
    ) {
      host.closeWindow(window.id)
    }
  }

  if (options?.closeOsWindow && windowId) {
    const stillOpen = host.getWindows().find((window) => window.id === windowId && !window.closing)
    if (stillOpen) {
      host.closeWindow(windowId)
    }
  }
}

/**
 * 完整销毁 WebView unit：先 detach 清理窗口/DevTools/viewport 绑定，再删除 unit。
 * 顺序固定（先 detach 再 destroy）避免 guard 对已删 unit no-op 时 devtools 泄漏。
 */
export function destroyWebViewUnitFully(
  host: Pick<WebViewWindowHost, 'getWindows' | 'closeWindow'>,
  unitId: string,
): void {
  detachWebViewWindow(host, unitId, { closeOsWindow: true })
  destroyWebViewUnit(unitId)
}

/**
 * 销毁指定 owner 的所有 WebView unit（完整 teardown）。
 */
export function destroyWebViewUnitsForOwnerFully(
  host: Pick<WebViewWindowHost, 'getWindows' | 'closeWindow'>,
  ownerTerminalSessionId: string,
): void {
  const ownedIds = listWebViewUnits()
    .filter((unit) => unit.ownerTerminalSessionId === ownerTerminalSessionId)
    .map((unit) => unit.unitId)
  for (const unitId of ownedIds) {
    destroyWebViewUnitFully(host, unitId)
  }
}
