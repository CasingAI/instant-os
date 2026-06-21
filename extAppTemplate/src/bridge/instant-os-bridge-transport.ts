import { appendDevLog } from '../dev/instant-os-dev-log.ts'
import { isDevToolsEnabled } from '../dev/instant-os-runtime.ts'

export function postBridgeMessage(message: unknown): void {
  if (isDevToolsEnabled()) {
    appendDevLog('bridge-out', '应用发出 postMessage', {
      detail: message,
    })
  }

  window.parent.postMessage(message, '*')
}
