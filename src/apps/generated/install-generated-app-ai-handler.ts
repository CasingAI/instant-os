import { handleGeneratedAppAiRequest } from './handle-generated-app-ai-request.ts'
import { isGeneratedAppAiRequestMessage } from './generated-app-ai-types.ts'
import type { GeneratedAppId } from '../../os/types.ts'

type InstallGeneratedAppAiHandlerOptions = {
  appId: GeneratedAppId
  appName?: string
  getContentWindow: () => Window | null | undefined
  /** 为 true 时在宿主 DevTools 输出 AI 桥调试日志（iCode 预览） */
  debug?: boolean
}

const LOG_PREFIX = '[generated-app-ai-handler]'

function aiDebugInfo(debug: boolean | undefined, ...args: unknown[]): void {
  if (!debug) {
    return
  }
  console.info(...args)
}

function aiDebugWarn(debug: boolean | undefined, ...args: unknown[]): void {
  if (!debug) {
    return
  }
  console.warn(...args)
}

export function installGeneratedAppAiHandler(
  options: InstallGeneratedAppAiHandlerOptions,
): () => void {
  const onMessage = (event: MessageEvent) => {
    if (!isGeneratedAppAiRequestMessage(event.data)) {
      return
    }

    const debug = options.debug === true || event.data.debug === true

    if (event.data.appId !== options.appId) {
      aiDebugWarn(debug, `${LOG_PREFIX} appId mismatch`, {
        expected: options.appId,
        received: event.data.appId,
        requestId: event.data.requestId,
      })
      return
    }

    const contentWindow = options.getContentWindow()
    if (event.source !== contentWindow) {
      aiDebugWarn(debug, `${LOG_PREFIX} source mismatch`, {
        appId: options.appId,
        requestId: event.data.requestId,
        hasContentWindow: contentWindow != null,
        sourceMatches: event.source === contentWindow,
      })
      return
    }

    aiDebugInfo(debug, `${LOG_PREFIX} dispatch`, {
      appId: options.appId,
      requestId: event.data.requestId,
      path: event.data.path,
    })

    void handleGeneratedAppAiRequest(event.data, event.source as ReplyTarget, options.appName)
  }

  window.addEventListener('message', onMessage)
  return () => window.removeEventListener('message', onMessage)
}

type ReplyTarget = {
  postMessage: (message: unknown, targetOrigin: string) => void
}
