import { CHROMO_DEFAULT_RPC_TIMEOUT } from './chromo-config.ts'

export type ChromoNavigatedPayload = {
  url: string
  title: string
  canGoBack: boolean
  canGoForward: boolean
}

export type ChromoErrorPayload = {
  message: string
  code?: string
}

export type ChromoLoadFailedPayload = {
  url: string
  message?: string
  code?: string
}

export type ChromoConsoleEntry = {
  id: string
  level: string
  args: unknown[]
  ts: number
  url?: string
}

export type ChromoConsoleReadResult = {
  entries: ChromoConsoleEntry[]
  latestId?: string
}

export type ChromoRpcOptions = {
  timeout?: number
}

export type ChromoBridgeHandlers = {
  onReady?: (payload: { version?: string }) => void
  onNavigated?: (payload: ChromoNavigatedPayload) => void
  onNavigating?: (payload: { url: string }) => void
  onLoading?: (payload: { loading: boolean; url?: string }) => void
  onLoadFailed?: (payload: ChromoLoadFailedPayload) => void
  onConsoleUpdated?: (payload: { latestId?: string; count?: number }) => void
  onError?: (payload: ChromoErrorPayload) => void
}

export type ChromoBridge = {
  navigate: (url: string) => void
  back: () => void
  forward: () => void
  reload: () => void
  ping: () => void
  evalInPage: (code: string, options?: ChromoRpcOptions) => Promise<unknown>
  readConsole: (
    options?: { after?: string; limit?: number } & ChromoRpcOptions,
  ) => Promise<ChromoConsoleReadResult>
  isReady: () => boolean
  destroy: () => void
}

type RpcResultPayload = {
  id?: string
  ok?: boolean
  value?: unknown
  error?: { message?: string; code?: string; stack?: string }
}

type PendingRpc = {
  resultCmd: string
  resolve: (value: unknown) => void
  reject: (error: Error) => void
  timer: ReturnType<typeof setTimeout>
}

function postCommand(
  iframe: HTMLIFrameElement,
  command: string,
  payload?: unknown,
  targetOrigin = '*',
) {
  const win = iframe.contentWindow
  if (!win) {
    return
  }

  win.postMessage(payload === undefined ? [command] : [command, payload], targetOrigin)
}

function rejectRpc(waiter: PendingRpc, error: Error) {
  clearTimeout(waiter.timer)
  waiter.reject(error)
}

export function createChromoBridge(
  iframe: HTMLIFrameElement,
  handlers: ChromoBridgeHandlers,
  targetOrigin = '*',
): ChromoBridge {
  let ready = false
  const pendingNavigations: string[] = []
  const pendingRpcs = new Map<string, PendingRpc>()

  const flushPending = () => {
    while (pendingNavigations.length > 0) {
      const url = pendingNavigations.shift()
      if (url) {
        postCommand(iframe, 'VC_NAVIGATE', { url }, targetOrigin)
      }
    }
  }

  const settleRpc = (resultCmd: string, payload: RpcResultPayload) => {
    if (!payload.id) {
      return
    }

    const waiter = pendingRpcs.get(payload.id)
    if (!waiter || waiter.resultCmd !== resultCmd) {
      return
    }

    pendingRpcs.delete(payload.id)
    clearTimeout(waiter.timer)

    if (payload.ok) {
      waiter.resolve(payload.value)
      return
    }

    const message = payload.error?.message ?? `${resultCmd} failed`
    const error = Object.assign(new Error(message), payload.error ?? {})
    waiter.reject(error)
  }

  const rpc = (
    resultCmd: string,
    command: string,
    payload: Record<string, unknown>,
    options?: ChromoRpcOptions,
  ) => {
    const timeout = options?.timeout ?? CHROMO_DEFAULT_RPC_TIMEOUT

    return new Promise<unknown>((resolve, reject) => {
      const id = crypto.randomUUID()
      const timer = setTimeout(() => {
        const waiter = pendingRpcs.get(id)
        if (!waiter) {
          return
        }
        pendingRpcs.delete(id)
        reject(
          Object.assign(new Error(`${command} timed out`), {
            code: 'RPC_TIMEOUT',
            id,
            timeout,
          }),
        )
      }, timeout)

      pendingRpcs.set(id, {
        resultCmd,
        resolve,
        reject,
        timer,
      })

      postCommand(iframe, command, { id, ...payload }, targetOrigin)
    })
  }

  const onMessage = (event: MessageEvent) => {
    if (event.source !== iframe.contentWindow) {
      return
    }

    if (!Array.isArray(event.data)) {
      return
    }

    const [cmd, payload] = event.data as [string, unknown]

    switch (cmd) {
      case 'VC_READY':
        ready = true
        flushPending()
        handlers.onReady?.((payload as { version?: string } | undefined) ?? {})
        break
      case 'VC_NAVIGATED':
        handlers.onNavigated?.(payload as ChromoNavigatedPayload)
        break
      case 'VC_NAVIGATING':
        handlers.onNavigating?.(payload as { url: string })
        break
      case 'VC_LOADING':
        handlers.onLoading?.(payload as { loading: boolean; url?: string })
        break
      case 'VC_LOAD_FAILED':
        handlers.onLoadFailed?.(payload as ChromoLoadFailedPayload)
        break
      case 'VC_CONSOLE_UPDATED':
        handlers.onConsoleUpdated?.(
          (payload as { latestId?: string; count?: number } | undefined) ?? {},
        )
        break
      case 'VC_ERROR':
        handlers.onError?.(payload as ChromoErrorPayload)
        break
      case 'VC_PONG':
        break
      case 'VC_EVAL_RESULT':
        settleRpc('VC_EVAL_RESULT', payload as RpcResultPayload)
        break
      case 'VC_CONSOLE_READ_RESULT':
        settleRpc('VC_CONSOLE_READ_RESULT', payload as RpcResultPayload)
        break
      default:
        break
    }
  }

  window.addEventListener('message', onMessage)

  return {
    navigate(url) {
      if (ready) {
        postCommand(iframe, 'VC_NAVIGATE', { url }, targetOrigin)
        return
      }
      pendingNavigations.push(url)
    },
    back() {
      postCommand(iframe, 'VC_BACK', undefined, targetOrigin)
    },
    forward() {
      postCommand(iframe, 'VC_FORWARD', undefined, targetOrigin)
    },
    reload() {
      postCommand(iframe, 'VC_RELOAD', undefined, targetOrigin)
    },
    ping() {
      postCommand(iframe, 'VC_PING', undefined, targetOrigin)
    },
    evalInPage(code, options) {
      return rpc('VC_EVAL_RESULT', 'VC_EVAL', { code }, options)
    },
    readConsole(options) {
      const { after, limit, timeout } = options ?? {}
      const payload: Record<string, unknown> = {}
      if (after) {
        payload.after = after
      }
      if (limit !== undefined) {
        payload.limit = limit
      }
      return rpc('VC_CONSOLE_READ_RESULT', 'VC_CONSOLE_READ', payload, { timeout }).then(
        (value) => (value ?? { entries: [] }) as ChromoConsoleReadResult,
      )
    },
    isReady: () => ready,
    destroy() {
      window.removeEventListener('message', onMessage)
      ready = false
      pendingNavigations.length = 0
      for (const waiter of pendingRpcs.values()) {
        rejectRpc(waiter, new Error('Chromo bridge destroyed'))
      }
      pendingRpcs.clear()
    },
  }
}
