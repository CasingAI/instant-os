import type { ExtAppId, GeneratedAppId } from '../../os/types.ts'
import type { WebViewUnitEvent } from '../webview/webview-registry.ts'
import { subscribeWebViewRegistry, getWebViewUnit } from '../webview/webview-registry.ts'
import { destroyWebViewUnitsForOwnerFully } from '../webview/webview-window-service.ts'
import { handleGeneratedAppWebViewRequest, type GeneratedAppWebViewHost } from './handle-generated-app-webview-request.ts'
import {
  GENERATED_APP_WEBVIEW_EVENT_MESSAGE_TYPE,
  isGeneratedAppWebViewRequestMessage,
} from './generated-app-webview-types.ts'

type InstallGeneratedAppWebViewHandlerOptions = {
  appId: GeneratedAppId | ExtAppId
  getContentWindow: () => Window | null | undefined
  isAllowed?: () => boolean
  host: GeneratedAppWebViewHost
}

type ReplyTarget = {
  postMessage: (message: unknown, targetOrigin: string) => void
}

function eventBelongsToOwner(event: WebViewUnitEvent, ownerId: string): boolean {
  if (event.type === 'unitDestroyed') {
    return event.ownerTerminalSessionId === ownerId
  }
  const unit = getWebViewUnit(event.unitId)
  return unit?.ownerTerminalSessionId === ownerId
}

export function installGeneratedAppWebViewHandler(
  options: InstallGeneratedAppWebViewHandlerOptions,
): () => void {
  const onMessage = (event: MessageEvent) => {
    if (!isGeneratedAppWebViewRequestMessage(event.data)) {
      return
    }

    if (event.data.appId !== options.appId) {
      return
    }

    const contentWindow = options.getContentWindow()
    if (event.source !== contentWindow) {
      return
    }

    const allowed = options.isAllowed?.() !== false
    void handleGeneratedAppWebViewRequest(event.data, event.source as ReplyTarget, options.host, {
      allowed,
    })
  }

  const unsubscribe = subscribeWebViewRegistry((event) => {
    if (!eventBelongsToOwner(event, options.host.ownerId)) {
      return
    }
    const contentWindow = options.getContentWindow()
    if (!contentWindow) {
      return
    }
    try {
      contentWindow.postMessage(
        {
          type: GENERATED_APP_WEBVIEW_EVENT_MESSAGE_TYPE,
          appId: options.appId,
          event,
        },
        '*',
      )
    } catch {
      // iframe 已卸载
    }
  })

  window.addEventListener('message', onMessage)
  return () => {
    window.removeEventListener('message', onMessage)
    unsubscribe()
    destroyWebViewUnitsForOwnerFully(
      {
        getWindows: options.host.getWindows,
        closeWindow: options.host.closeWindow,
      },
      options.host.ownerId,
    )
  }
}
