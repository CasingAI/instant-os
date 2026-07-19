import {
  GENERATED_APP_TERMINAL_EVENT_MESSAGE_TYPE,
  GENERATED_APP_TERMINAL_REQUEST_MESSAGE_TYPE,
  GENERATED_APP_TERMINAL_RESPONSE_MESSAGE_TYPE,
} from './instant-os-protocol.ts'
import { appendDevLog } from '../dev/instant-os-dev-log.ts'
import { postBridgeMessage } from './instant-os-bridge-transport.ts'

type TerminalCallFields = {
  sessionId?: string
  line?: string
  text?: string
  path?: string
  initialCwd?: string
  thinkingEnabled?: boolean
}

type InstallInstantOsTerminalBridgeOptions = {
  appId: string
}

export function installInstantOsTerminalBridge(
  options: InstallInstantOsTerminalBridgeOptions,
): () => void {
  const appId = options.appId
  const pending = new Map<
    string,
    {
      resolve: (result: unknown) => void
      reject: (error: Error) => void
    }
  >()
  const listeners = new Map<string, Array<(event: unknown) => void>>()
  let requestSeq = 0

  const onMessage = (event: MessageEvent) => {
    const data = event.data as Record<string, unknown> | undefined
    if (!data || data.appId !== appId) {
      return
    }

    if (data.type === GENERATED_APP_TERMINAL_EVENT_MESSAGE_TYPE) {
      const sessionId = String(data.sessionId ?? '')
      const list = listeners.get(sessionId)
      if (!list?.length) return
      for (const listener of list) {
        try {
          listener(data.event)
        } catch {
          // ignore listener errors
        }
      }
      return
    }

    if (data.type !== GENERATED_APP_TERMINAL_RESPONSE_MESSAGE_TYPE) {
      return
    }

    const requestId = String(data.requestId ?? '')
    const entry = pending.get(requestId)
    if (!entry) {
      return
    }
    pending.delete(requestId)

    appendDevLog('bridge-in', '收到 Terminal 响应', { detail: data })

    if (data.ok) {
      entry.resolve(data.result)
      return
    }
    entry.reject(new Error(typeof data.error === 'string' ? data.error : '终端操作失败'))
  }

  window.addEventListener('message', onMessage)

  const call = (op: string, fields?: TerminalCallFields) =>
    new Promise<unknown>((resolve, reject) => {
      requestSeq += 1
      const requestId = `terminal-${requestSeq}`
      pending.set(requestId, { resolve, reject })
      const message: Record<string, unknown> = {
        type: GENERATED_APP_TERMINAL_REQUEST_MESSAGE_TYPE,
        appId,
        requestId,
        op,
      }
      if (fields?.sessionId !== undefined) message.sessionId = fields.sessionId
      if (fields?.line !== undefined) message.line = fields.line
      if (fields?.text !== undefined) message.text = fields.text
      if (fields?.path !== undefined) message.path = fields.path
      if (fields?.initialCwd !== undefined) message.initialCwd = fields.initialCwd
      if (fields?.thinkingEnabled !== undefined) message.thinkingEnabled = fields.thinkingEnabled

      appendDevLog('bridge-out', `Terminal ${op}`, { detail: message })
      postBridgeMessage(message)
    })

  const terminal = {
    createSession: (createOptions?: { initialCwd?: string; thinkingEnabled?: boolean }) =>
      call('createSession', {
        initialCwd: createOptions?.initialCwd,
        thinkingEnabled: createOptions?.thinkingEnabled,
      }).then((result) => {
        const record = result as { sessionId?: string } | undefined
        return record?.sessionId
      }),
    destroySession: (sessionId: string) => call('destroySession', { sessionId }),
    exec: (sessionId: string, line: string) => call('exec', { sessionId, line }),
    write: (sessionId: string, text: string) => call('write', { sessionId, text }),
    abort: (sessionId: string) => call('abort', { sessionId }),
    clear: (sessionId: string) => call('clear', { sessionId }),
    getCwd: (sessionId: string) =>
      call('getCwd', { sessionId }).then((result) => {
        const record = result as { cwd?: string } | undefined
        return record?.cwd
      }),
    cd: (sessionId: string, path: string) =>
      call('cd', { sessionId, path }).then((result) => {
        const record = result as { cwd?: string } | undefined
        return record?.cwd
      }),
    subscribe: (sessionId: string, listener: (event: unknown) => void) => {
      const list = listeners.get(sessionId) ?? []
      list.push(listener)
      listeners.set(sessionId, list)
      return () => {
        const current = listeners.get(sessionId)
        if (!current) return
        const next = current.filter((item) => item !== listener)
        if (next.length > 0) {
          listeners.set(sessionId, next)
        } else {
          listeners.delete(sessionId)
        }
      }
    },
  }

  const root =
    (window as Window & { InstantOS?: Record<string, unknown> }).InstantOS ??
    ((window as Window & { InstantOS?: Record<string, unknown> }).InstantOS = {})
  root.terminal = terminal
  ;(window as Window & { __INSTANT_TERMINAL__?: typeof terminal }).__INSTANT_TERMINAL__ = terminal

  return () => {
    window.removeEventListener('message', onMessage)
    pending.clear()
    listeners.clear()
    if (root.terminal === terminal) {
      delete root.terminal
    }
  }
}
