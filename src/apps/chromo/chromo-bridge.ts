import {
  CHROMO_DEFAULT_RPC_TIMEOUT,
  CHROMO_DEFAULT_SCREENSHOT_TIMEOUT,
} from './chromo-config.ts'

export type ChromoReadyPayload = {
  version?: string
  build?: string
  sessionId?: string
}

export type ChromoClickPayload = {
  ts: number
  tagName?: string
  href?: string
  target?: string
  text?: string
}

export type ChromoLocationPayload = {
  ts: number
  method: string
  url: string
  target?: string
}

export type ChromoHistoryPayload = {
  ts: number
  method: 'pushState' | 'replaceState' | 'popstate'
  url: string
  title?: string
  state?: unknown
}

export type ChromoSessionPayload = {
  sessionId: string
}

export type ChromoNavigatedPayload = {
  url: string
  title: string
  canGoBack: boolean
  canGoForward: boolean
}

export type ChromoErrorPayload = {
  message: string
  code?: string
  bridgeBuild?: string
  swBuild?: string
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

export type ChromoNetworkTiming = {
  queuedAt?: number
  startedAt?: number
  responseAt?: number
  finishedAt?: number
  queueing?: number
  waiting?: number
  download?: number
}

export type ChromoNetworkSource =
  | 'cache'
  | 'bypass'
  | 'direct'
  | 'cdn'
  | 'proxy'
  | 'native'
  | string

export type ChromoNetworkEntry = {
  id: string
  ts: number
  method: string
  url: string
  status: number
  type: string
  size: number
  duration: number
  failed: boolean
  bypass: boolean
  pending?: boolean
  hasBody?: boolean
  /** Whether this response was written into session hot cache. */
  hotStored?: boolean
  fromCache?: boolean
  devtoolsId?: string
  requestHeaders?: Record<string, string>
  requestHeadersTruncated?: boolean
  referrer?: string
  referrerPolicy?: string
  timing?: ChromoNetworkTiming
  /** Where the response was served from (cache / bypass / direct / cdn / proxy / native). */
  source?: ChromoNetworkSource
  /** Proxy gateway hostname when source === 'proxy'. */
  sourceHost?: string
  /** Machine-readable failure code (e.g. ERR_PROXY_FETCH_FAILED, HTTP_404). */
  errorCode?: string
  /** Human-readable failure reason. */
  errorText?: string
  /** How the request was initiated (fetch / xhr / import / parser / other). */
  initiatorKind?: string
  /** URL chain from document root to this resource. */
  initiatorChain?: string[]
  /** Sanitized JS call stack frames (empty for parser). */
  initiatorStack?: string[]
  /** Calling script URL when known. */
  initiatorScriptUrl?: string
}

export type ChromoNetworkReadResult = {
  entries: ChromoNetworkEntry[]
  latestId?: string
}

export type ChromoNetworkBodyReadResult = {
  headers: Record<string, string>
  body: string
  encoding: 'base64' | 'text'
  status: number
  truncated?: boolean
}

export type ChromoNetworkOptions = {
  devtoolsId?: string
  disableCache?: boolean
}

export type ChromoScreenshotOptions = {
  format?: 'jpeg' | 'png'
  quality?: number
  fullPage?: boolean
  scale?: number
  timeout?: number
}

export type ChromoScreenshotResult = {
  mime: string
  encoding: 'base64'
  data: string
  dataUrl: string
  width: number
  height: number
}

export type ChromoRpcOptions = {
  timeout?: number
}

export type ChromoBridgeHandlers = {
  onReady?: (payload: ChromoReadyPayload) => void
  onNavigated?: (payload: ChromoNavigatedPayload) => void
  onNavigating?: (payload: { url: string }) => void
  onLoading?: (payload: { loading: boolean; url?: string }) => void
  onLoadFailed?: (payload: ChromoLoadFailedPayload) => void
  onConsoleUpdated?: (payload: { latestId?: string; count?: number }) => void
  onNetworkUpdated?: (payload: {
    latestId?: string
    count?: number
    entry?: ChromoNetworkEntry
  }) => void
  onError?: (payload: ChromoErrorPayload) => void
  onClick?: (payload: ChromoClickPayload) => void
  onLocation?: (payload: ChromoLocationPayload) => void
  onHistory?: (payload: ChromoHistoryPayload) => void
  onSessionCreated?: (payload: ChromoSessionPayload) => void
  onSessionDestroyed?: (payload: ChromoSessionPayload) => void
  onSessionGone?: (payload: ChromoSessionPayload) => void
}

export type ChromoBridge = {
  navigate: (url: string) => void
  back: () => void
  forward: () => void
  reload: () => void
  stop: () => void
  ping: () => void
  evalInPage: (code: string, options?: ChromoRpcOptions) => Promise<unknown>
  readConsole: (
    options?: { after?: string; limit?: number } & ChromoRpcOptions,
  ) => Promise<ChromoConsoleReadResult>
  readNetwork: (
    options?: { after?: string; limit?: number } & ChromoRpcOptions,
  ) => Promise<ChromoNetworkReadResult>
  readNetworkBody: (
    entryId: string,
    options?: ChromoRpcOptions,
  ) => Promise<ChromoNetworkBodyReadResult>
  probeNetworkHot: (
    method: string,
    url: string,
    options?: ChromoRpcOptions,
  ) => Promise<{ exists: boolean }>
  setNetworkOptions: (options: ChromoNetworkOptions) => void
  devtoolsId: string
  screenshot: (
    options?: ChromoScreenshotOptions,
  ) => Promise<ChromoScreenshotResult>
  destroySession: (sessionId?: string) => void
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
  options: ChromoNetworkOptions = {},
): ChromoBridge {
  let ready = false
  const devtoolsId = options.devtoolsId ?? crypto.randomUUID()
  let disableCache = Boolean(options.disableCache)
  const pendingNavigations: string[] = []
  const pendingRpcs = new Map<string, PendingRpc>()

  const applyNetworkOptions = () => {
    postCommand(
      iframe,
      'VC_NETWORK_OPTIONS',
      {
        devtoolsId,
        disableCache,
      },
      targetOrigin,
    )
  }

  const flushPending = () => {
    applyNetworkOptions()
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
        handlers.onReady?.((payload as ChromoReadyPayload | undefined) ?? {})
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
      case 'VC_NETWORK_UPDATED':
        handlers.onNetworkUpdated?.(
          (payload as
            | { latestId?: string; count?: number; entry?: ChromoNetworkEntry }
            | undefined) ?? {},
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
      case 'VC_NETWORK_READ_RESULT':
        settleRpc('VC_NETWORK_READ_RESULT', payload as RpcResultPayload)
        break
      case 'VC_NETWORK_BODY_READ_RESULT':
        settleRpc('VC_NETWORK_BODY_READ_RESULT', payload as RpcResultPayload)
        break
      case 'VC_SCREENSHOT_RESULT':
        settleRpc('VC_SCREENSHOT_RESULT', payload as RpcResultPayload)
        break
      case 'VC_CLICK':
        handlers.onClick?.(payload as ChromoClickPayload)
        break
      case 'VC_LOCATION':
        handlers.onLocation?.(payload as ChromoLocationPayload)
        break
      case 'VC_HISTORY':
        handlers.onHistory?.(payload as ChromoHistoryPayload)
        break
      case 'VC_SESSION_CREATED':
        handlers.onSessionCreated?.(payload as ChromoSessionPayload)
        break
      case 'VC_SESSION_DESTROYED':
        handlers.onSessionDestroyed?.(payload as ChromoSessionPayload)
        break
      case 'VC_SESSION_GONE':
        handlers.onSessionGone?.(payload as ChromoSessionPayload)
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
    stop() {
      postCommand(iframe, 'VC_STOP', undefined, targetOrigin)
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
    readNetwork(options) {
      const { after, limit, timeout } = options ?? {}
      const payload: Record<string, unknown> = {}
      if (after) {
        payload.after = after
      }
      if (limit !== undefined) {
        payload.limit = limit
      }
      return rpc('VC_NETWORK_READ_RESULT', 'VC_NETWORK_READ', payload, { timeout }).then(
        (value) => (value ?? { entries: [] }) as ChromoNetworkReadResult,
      )
    },
    readNetworkBody(entryId, options) {
      return rpc('VC_NETWORK_BODY_READ_RESULT', 'VC_NETWORK_BODY_READ', { entryId }, options).then(
        (value) => value as ChromoNetworkBodyReadResult,
      )
    },
    probeNetworkHot(method, url, options) {
      return rpc('VC_NETWORK_HOT_PROBE_RESULT', 'VC_NETWORK_HOT_PROBE', { method, url }, {
        timeout: options?.timeout ?? 10_000,
      }).then((value) => (value ?? { exists: false }) as { exists: boolean })
    },
    setNetworkOptions(opts) {
      if (opts.disableCache !== undefined) {
        disableCache = opts.disableCache
      }
      applyNetworkOptions()
    },
    devtoolsId,
    screenshot(options) {
      const { format, quality, fullPage, scale, timeout } = options ?? {}
      const payload: Record<string, unknown> = {}
      if (format !== undefined) {
        payload.format = format
      }
      if (quality !== undefined) {
        payload.quality = quality
      }
      if (fullPage !== undefined) {
        payload.fullPage = fullPage
      }
      if (scale !== undefined) {
        payload.scale = scale
      }
      return rpc('VC_SCREENSHOT_RESULT', 'VC_SCREENSHOT', payload, {
        timeout: timeout ?? CHROMO_DEFAULT_SCREENSHOT_TIMEOUT,
      }).then((value) => value as ChromoScreenshotResult)
    },
    destroySession(sessionId) {
      postCommand(
        iframe,
        'VC_SESSION_DESTROY',
        sessionId ? { sessionId } : undefined,
        targetOrigin,
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
