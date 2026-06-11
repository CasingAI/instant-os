import { handleGeneratedAppAiRequest } from './handle-generated-app-ai-request.ts'
import { isGeneratedAppAiRequestMessage } from './generated-app-ai-types.ts'
import type { GeneratedAppId } from '../../os/types.ts'

type InstallGeneratedAppAiHandlerOptions = {
  appId: GeneratedAppId
  appName?: string
  getContentWindow: () => Window | null | undefined
}

export function installGeneratedAppAiHandler(
  options: InstallGeneratedAppAiHandlerOptions,
): () => void {
  const onMessage = (event: MessageEvent) => {
    if (!isGeneratedAppAiRequestMessage(event.data)) {
      return
    }

    if (event.data.appId !== options.appId) {
      return
    }

    const contentWindow = options.getContentWindow()
    if (event.source !== contentWindow) {
      return
    }

    void handleGeneratedAppAiRequest(event.data, event.source as ReplyTarget, options.appName)
  }

  window.addEventListener('message', onMessage)
  return () => window.removeEventListener('message', onMessage)
}

type ReplyTarget = {
  postMessage: (message: unknown) => void
}
