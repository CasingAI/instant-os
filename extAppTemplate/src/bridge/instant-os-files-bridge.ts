import {
  GENERATED_APP_FILES_REQUEST_MESSAGE_TYPE,
  GENERATED_APP_FILES_RESPONSE_MESSAGE_TYPE,
} from './instant-os-protocol.ts'
import { appendDevLog } from '../dev/instant-os-dev-log.ts'
import { postBridgeMessage } from './instant-os-bridge-transport.ts'

type FilesCallFields = {
  path?: string
  text?: string
  nextName?: string
}

type InstallInstantOsFilesBridgeOptions = {
  appId: string
}

export function installInstantOsFilesBridge(options: InstallInstantOsFilesBridgeOptions): () => void {
  const appId = options.appId
  const pending = new Map<
    string,
    {
      resolve: (result: unknown) => void
      reject: (error: Error) => void
    }
  >()
  let requestSeq = 0

  const onMessage = (event: MessageEvent) => {
    const data = event.data as Record<string, unknown> | undefined
    if (!data || data.appId !== appId || data.type !== GENERATED_APP_FILES_RESPONSE_MESSAGE_TYPE) {
      return
    }

    const requestId = String(data.requestId ?? '')
    const entry = pending.get(requestId)
    if (!entry) {
      return
    }
    pending.delete(requestId)

    appendDevLog('bridge-in', '收到 Files 响应', { detail: data })

    if (data.ok) {
      entry.resolve(data.result)
      return
    }
    entry.reject(new Error(typeof data.error === 'string' ? data.error : '文件操作失败'))
  }

  window.addEventListener('message', onMessage)

  const call = (op: string, fields?: FilesCallFields) =>
    new Promise<unknown>((resolve, reject) => {
      requestSeq += 1
      const requestId = `files-${requestSeq}`
      pending.set(requestId, { resolve, reject })
      const message: Record<string, unknown> = {
        type: GENERATED_APP_FILES_REQUEST_MESSAGE_TYPE,
        appId,
        requestId,
        op,
      }
      if (fields?.path !== undefined) message.path = fields.path
      if (fields?.text !== undefined) message.text = fields.text
      if (fields?.nextName !== undefined) message.nextName = fields.nextName

      appendDevLog('bridge-out', `Files ${op}`, { detail: message })
      postBridgeMessage(message)
    })

  const files = {
    listVolumes: () => call('listVolumes'),
    list: (path: string) => call('list', { path }),
    stat: (path: string) => call('stat', { path }),
    readText: (path: string) => call('readText', { path }),
    writeText: (path: string, text: string) => call('writeText', { path, text }),
    mkdir: (path: string) => call('mkdir', { path }),
    createText: (path: string, text = '') => call('createText', { path, text }),
    rename: (path: string, nextName: string) => call('rename', { path, nextName }),
    remove: (path: string) => call('remove', { path }),
  }

  const root =
    (window as Window & { InstantOS?: Record<string, unknown> }).InstantOS ??
    ((window as Window & { InstantOS?: Record<string, unknown> }).InstantOS = {})
  root.files = files
  ;(window as Window & { __INSTANT_FILES__?: typeof files }).__INSTANT_FILES__ = files

  return () => {
    window.removeEventListener('message', onMessage)
    pending.clear()
    if (root.files === files) {
      delete root.files
    }
  }
}
