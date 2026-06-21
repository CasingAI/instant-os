import {
  GENERATED_APP_AI_REQUEST_MESSAGE_TYPE,
  GENERATED_APP_STORAGE_MESSAGE_TYPE,
  isExtAppEnterMessage,
} from '../bridge/instant-os-protocol.ts'
import { appendDevLog } from './instant-os-dev-log.ts'
import { handleDevAiRequest } from './instant-os-dev-ai.ts'
import { isDevToolsEnabled } from './instant-os-runtime.ts'

type InstallDevHostMockOptions = {
  appId: string
}

export function installDevHostMock(options: InstallDevHostMockOptions): () => void {
  if (!isDevToolsEnabled()) {
    return () => {}
  }

  appendDevLog('system', '开发宿主模拟器已启动', {
    level: 'success',
    detail: { appId: options.appId },
  })

  const onMessage = (event: MessageEvent) => {
    if (event.source !== window) {
      return
    }

    const data = event.data as Record<string, unknown> | undefined
    if (!data || typeof data.type !== 'string') {
      return
    }

    if (isExtAppEnterMessage(data)) {
      appendDevLog('bridge-in', '宿主收到 enter 消息', {
        level: 'success',
        detail: data,
      })
      return
    }

    if (data.type === GENERATED_APP_AI_REQUEST_MESSAGE_TYPE) {
      if (data.appId !== options.appId) {
        return
      }

      appendDevLog('bridge-in', '宿主收到 AI 桥接请求', {
        detail: data,
      })

      void handleDevAiRequest(
        window,
        String(data.appId),
        String(data.requestId),
        String(data.method ?? 'GET'),
        String(data.path ?? ''),
        typeof data.body === 'string' ? data.body : undefined,
      )
      return
    }

    if (data.type === GENERATED_APP_STORAGE_MESSAGE_TYPE) {
      appendDevLog('bridge-in', '宿主收到存储同步', {
        detail: data,
      })
    }
  }

  window.addEventListener('message', onMessage)
  return () => window.removeEventListener('message', onMessage)
}
