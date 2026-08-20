import type { ChromoScreenshotOptions } from '../../page-host/page-bridge.ts'
import { openDevTools } from '../../page-host/open-devtools.ts'
import { displayPageUrl, normalizePageUrl, pageTitleFromUrl } from '../../page-host/page-url.ts'
import type { PageViewerHandle } from '../../page-host/page-viewer-frame.tsx'
import {
  addWebViewTab,
  assertWebViewUnitOwner,
  closeWebViewTab,
  createWebViewUnit,
  evalWebViewTab,
  getWebViewUnit,
  listWebViewTabs,
  listWebViewUnits,
  markdownWebViewTab,
  requireLiveWebViewTab,
  resolveWebViewTabId,
  screenshotWebViewTab,
  snapshotWebViewTab,
  updateWebViewTab,
  waitWebViewTab,
} from '../webview/webview-registry.ts'
import {
  destroyWebViewUnitFully,
  hideWebViewWindow,
  showWebViewWindow,
} from '../webview/webview-window-service.ts'
import {
  GENERATED_APP_WEBVIEW_RESPONSE_MESSAGE_TYPE,
  type GeneratedAppWebViewRequestMessage,
  type GeneratedAppWebViewResponseMessage,
} from './generated-app-webview-types.ts'

export type GeneratedAppWebViewHost = {
  ownerId: string
  openApp: (appId: 'webview', options?: { documentId?: string }) => string | undefined
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
  openDevToolsApp: (documentId: string) => void
}

type ReplyTarget = {
  postMessage: (message: unknown, targetOrigin: string) => void
}

function reply(source: ReplyTarget, message: GeneratedAppWebViewResponseMessage): void {
  source.postMessage(message, '*')
}

function formatError(error: unknown): string {
  if (error instanceof Error && error.message) return error.message
  return 'WebView 操作失败'
}

function getViewer(unitId: string, tabId: string): PageViewerHandle | null | undefined {
  return getWebViewUnit(unitId)?.viewerRefs[tabId]?.current
}

function resolveOwnedTab(ownerId: string, unitId: string, tabId: string | undefined): {
  unitId: string
  tabId: string
} {
  assertWebViewUnitOwner(unitId, ownerId)
  return { unitId, tabId: resolveWebViewTabId(unitId, tabId ?? 'default') }
}

function requireUnitId(message: GeneratedAppWebViewRequestMessage): string {
  const unitId = message.unitId?.trim() ?? ''
  if (!unitId) throw new Error('unitId 不能为空')
  return unitId
}

function windowHost(host: GeneratedAppWebViewHost) {
  return {
    openApp: host.openApp,
    getWindows: host.getWindows,
    focusWindow: host.focusWindow,
    restoreWindow: host.restoreWindow,
    closeWindow: host.closeWindow,
  }
}

async function dispatch(
  message: GeneratedAppWebViewRequestMessage,
  host: GeneratedAppWebViewHost,
): Promise<unknown> {
  switch (message.op) {
    case 'create': {
      const url = message.url?.trim() ?? ''
      if (!url) throw new Error('url 不能为空')
      return createWebViewUnit(host.ownerId, url)
    }
    case 'destroy': {
      const unitId = requireUnitId(message)
      assertWebViewUnitOwner(unitId, host.ownerId)
      destroyWebViewUnitFully({ getWindows: host.getWindows, closeWindow: host.closeWindow }, unitId)
      return null
    }
    case 'show': {
      const unitId = requireUnitId(message)
      assertWebViewUnitOwner(unitId, host.ownerId)
      showWebViewWindow(windowHost(host), unitId)
      return null
    }
    case 'hide': {
      const unitId = requireUnitId(message)
      assertWebViewUnitOwner(unitId, host.ownerId)
      hideWebViewWindow(windowHost(host), unitId)
      return null
    }
    case 'listUnits':
      return listWebViewUnits()
        .filter((unit) => unit.ownerTerminalSessionId === host.ownerId)
        .map((unit) => ({
          unitId: unit.unitId,
          visible: unit.visible,
          tabCount: unit.tabs.length,
          uiDisplayedTabId: unit.uiDisplayedTabId,
        }))
    case 'listTabs': {
      const unitId = requireUnitId(message)
      assertWebViewUnitOwner(unitId, host.ownerId)
      return listWebViewTabs(unitId).map((tab) => ({
        tabId: tab.id,
        url: tab.url,
        title: tab.title,
        loading: tab.loading,
        pendingUrl: tab.pendingUrl,
        fault: tab.pageFault
          ? { code: tab.pageFault.code, message: tab.pageFault.message }
          : undefined,
      }))
    }
    case 'wait': {
      const unitId = requireUnitId(message)
      const resolved = resolveOwnedTab(host.ownerId, unitId, message.tabId)
      const timeoutMs =
        typeof message.timeoutMs === 'number' && Number.isFinite(message.timeoutMs)
          ? message.timeoutMs
          : undefined
      await waitWebViewTab(resolved.unitId, resolved.tabId, timeoutMs)
      return null
    }
    case 'openTab': {
      const unitId = requireUnitId(message)
      const url = message.url?.trim() ?? ''
      if (!url) throw new Error('unitId、url 均不能为空')
      assertWebViewUnitOwner(unitId, host.ownerId)
      const tabId = addWebViewTab(unitId, url)
      return { unitId, tabId }
    }
    case 'closeTab': {
      const unitId = requireUnitId(message)
      const resolved = resolveOwnedTab(host.ownerId, unitId, message.tabId)
      const unit = getWebViewUnit(resolved.unitId)
      if (unit && unit.tabs.length <= 1) {
        destroyWebViewUnitFully(
          { getWindows: host.getWindows, closeWindow: host.closeWindow },
          resolved.unitId,
        )
      } else {
        closeWebViewTab(resolved.unitId, resolved.tabId)
      }
      return null
    }
    case 'navigate': {
      const unitId = requireUnitId(message)
      const url = message.url?.trim() ?? ''
      if (!url) throw new Error('unitId、url 均不能为空')
      const resolved = resolveOwnedTab(host.ownerId, unitId, message.tabId)
      requireLiveWebViewTab(resolved.unitId, resolved.tabId)
      const viewer = getViewer(resolved.unitId, resolved.tabId)
      if (!viewer) {
        throw new Error('网页尚未就绪')
      }
      const normalized = normalizePageUrl(url)
      updateWebViewTab(resolved.unitId, resolved.tabId, (tab) => ({
        ...tab,
        url: normalized,
        pendingUrl: normalized,
        title: pageTitleFromUrl(normalized),
        inputUrl: displayPageUrl(normalized),
        loading: true,
        pageFault: undefined,
        bootstrapped: true,
      }))
      viewer.navigate(normalized)
      return null
    }
    case 'eval': {
      const unitId = requireUnitId(message)
      const resolved = resolveOwnedTab(host.ownerId, unitId, message.tabId)
      return evalWebViewTab(resolved.unitId, resolved.tabId, message.code ?? '', getViewer)
    }
    case 'screenshot': {
      const unitId = requireUnitId(message)
      const resolved = resolveOwnedTab(host.ownerId, unitId, message.tabId)
      const screenshotOptions: ChromoScreenshotOptions = {
        format: message.format,
        quality: message.quality,
        fullPage: message.fullPage,
        scale: message.scale,
        timeout: message.timeout,
      }
      const hasOptions =
        screenshotOptions.format !== undefined ||
        screenshotOptions.quality !== undefined ||
        screenshotOptions.fullPage !== undefined ||
        screenshotOptions.scale !== undefined ||
        screenshotOptions.timeout !== undefined
      return screenshotWebViewTab(
        resolved.unitId,
        resolved.tabId,
        hasOptions ? screenshotOptions : undefined,
        getViewer,
      )
    }
    case 'snapshot': {
      const unitId = requireUnitId(message)
      const resolved = resolveOwnedTab(host.ownerId, unitId, message.tabId)
      return snapshotWebViewTab(resolved.unitId, resolved.tabId, getViewer)
    }
    case 'markdown': {
      const unitId = requireUnitId(message)
      const resolved = resolveOwnedTab(host.ownerId, unitId, message.tabId)
      const ref = message.ref === undefined || message.ref === '' ? undefined : message.ref
      return markdownWebViewTab(resolved.unitId, resolved.tabId, ref, getViewer)
    }
    case 'openDevTools': {
      const unitId = requireUnitId(message)
      const resolved = resolveOwnedTab(host.ownerId, unitId, message.tabId)
      const mode = message.mode === 'embedded' ? 'embedded' : 'undocked'
      updateWebViewTab(resolved.unitId, resolved.tabId, (tab) =>
        mode === 'embedded'
          ? { ...tab, devtoolsOpen: true, devtoolsUndocked: false }
          : { ...tab, devtoolsUndocked: true, devtoolsOpen: false },
      )
      openDevTools(
        {
          openApp: (_appId, openOptions) => {
            if (openOptions?.documentId) {
              host.openDevToolsApp(openOptions.documentId)
            }
          },
        },
        {
          hostId: resolved.unitId,
          tabId: resolved.tabId,
          mode,
        },
      )
      return null
    }
    default: {
      const _exhaustive: never = message.op
      throw new Error(`未知操作：${String(_exhaustive)}`)
    }
  }
}

export async function handleGeneratedAppWebViewRequest(
  message: GeneratedAppWebViewRequestMessage,
  source: ReplyTarget,
  host: GeneratedAppWebViewHost,
  options?: { allowed?: boolean },
): Promise<void> {
  if (options?.allowed === false) {
    reply(source, {
      type: GENERATED_APP_WEBVIEW_RESPONSE_MESSAGE_TYPE,
      appId: message.appId,
      requestId: message.requestId,
      ok: false,
      error: '应用未获得 WebView 能力，请先授予 webview 能力',
    })
    return
  }

  try {
    const result = await dispatch(message, host)
    reply(source, {
      type: GENERATED_APP_WEBVIEW_RESPONSE_MESSAGE_TYPE,
      appId: message.appId,
      requestId: message.requestId,
      ok: true,
      result,
    })
  } catch (error) {
    reply(source, {
      type: GENERATED_APP_WEBVIEW_RESPONSE_MESSAGE_TYPE,
      appId: message.appId,
      requestId: message.requestId,
      ok: false,
      error: formatError(error),
    })
  }
}
