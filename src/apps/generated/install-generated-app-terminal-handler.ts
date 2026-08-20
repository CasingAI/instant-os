import { destroyGeneratedAppTerminalSessions } from './generated-app-terminal-host.ts'
import { handleGeneratedAppTerminalRequest } from './handle-generated-app-terminal-request.ts'
import { isGeneratedAppTerminalRequestMessage } from './generated-app-terminal-types.ts'
import type { ExtAppId, GeneratedAppId } from '../../os/types.ts'

type InstallGeneratedAppTerminalHandlerOptions = {
  appId: GeneratedAppId | ExtAppId
  getContentWindow: () => Window | null | undefined
  isAllowed?: () => boolean
}

export function installGeneratedAppTerminalHandler(
  options: InstallGeneratedAppTerminalHandlerOptions,
): () => void {
  const onMessage = (event: MessageEvent) => {
    if (!isGeneratedAppTerminalRequestMessage(event.data)) {
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

    void handleGeneratedAppTerminalRequest(event.data, event.source as ReplyTarget, { allowed })
  }

  window.addEventListener('message', onMessage)
  return () => {
    window.removeEventListener('message', onMessage)
    destroyGeneratedAppTerminalSessions(options.appId)
  }
}

type ReplyTarget = {
  postMessage: (message: unknown, targetOrigin: string) => void
}
