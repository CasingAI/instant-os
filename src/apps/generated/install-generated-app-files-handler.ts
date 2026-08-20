import { handleGeneratedAppFilesRequest } from './handle-generated-app-files-request.ts'
import { isGeneratedAppFilesRequestMessage } from './generated-app-files-types.ts'
import type { ExtAppId, GeneratedAppId } from '../../os/types.ts'

type InstallGeneratedAppFilesHandlerOptions = {
  appId: GeneratedAppId | ExtAppId
  getContentWindow: () => Window | null | undefined
  /** 未授予 files 能力时拒绝请求 */
  isAllowed?: () => boolean
}

export function installGeneratedAppFilesHandler(
  options: InstallGeneratedAppFilesHandlerOptions,
): () => void {
  const onMessage = (event: MessageEvent) => {
    if (!isGeneratedAppFilesRequestMessage(event.data)) {
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

    void handleGeneratedAppFilesRequest(event.data, event.source as ReplyTarget, { allowed })
  }

  window.addEventListener('message', onMessage)
  return () => window.removeEventListener('message', onMessage)
}

type ReplyTarget = {
  postMessage: (message: unknown, targetOrigin: string) => void
}
