import {
  CHROMO_DEFAULT_RPC_TIMEOUT,
  CHROMO_DEFAULT_SCREENSHOT_TIMEOUT,
} from './page-host-config.ts'

export type ChromoReadyPayload = {
  version?: string
  build?: string
}

export type ChromoClickPayload = {
  ts: number
  tagName?: string
  href?: string
  target?: string
  text?: string
}

export type ChromoContextMenuPayload = {
  x: number
  y: number
  linkUrl?: string
  imageUrl?: string
  selection?: string
}

export function parseChromoContextMenuPayload(value: unknown): ChromoContextMenuPayload | undefined {
  if (!value || typeof value !== 'object') {
    return undefined
  }
  const record = value as Record<string, unknown>
  const x = typeof record.x === 'number' ? record.x : Number(record.x)
  const y = typeof record.y === 'number' ? record.y : Number(record.y)
  if (!Number.isFinite(x) || !Number.isFinite(y)) {
    return undefined
  }
  const linkUrl = typeof record.linkUrl === 'string' && record.linkUrl.trim() ? record.linkUrl.trim() : undefined
  const imageUrl =
    typeof record.imageUrl === 'string' && record.imageUrl.trim() ? record.imageUrl.trim() : undefined
  const selection =
    typeof record.selection === 'string' && record.selection.trim() ? record.selection : undefined
  return { x, y, linkUrl, imageUrl, selection }
}

export type ChromoLocationPayload = {
  ts: number
  method: string
  /** Form HTTP method when method === 'submit' */
  httpMethod?: 'get' | 'post'
  url: string
  target?: string
  /** urlencoded POST body when method === 'submit' && httpMethod === 'post' */
  formBody?: string
  formEnctype?: string
  /** true when the form includes file inputs with selected files */
  formFiles?: boolean
}

export type ChromoHistoryPayload = {
  ts: number
  method: 'pushState' | 'replaceState' | 'popstate' | 'hash' | 'href' | 'assign' | 'replace'
  url: string
  title?: string
  state?: unknown
}

export type ChromoNavigateOptions = {
  method?: 'POST'
  body?: string
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
  /** Bridge networkBuffer size at failure time (diagnostic). */
  networkCount?: number
  /** Newest network entry id in bridge buffer, if any. */
  latestNetworkId?: string | null
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
  /** Whether this response was written into the global hot cache. */
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

/** VC_NETWORK_BODY_READ_LINES — 文本按行按需读取（0-based，toLine exclusive） */
export type ChromoNetworkBodyReadLinesOptions = {
  fromLine?: number
  toLine?: number
  /** true 时只返回元信息，lines 为 [] */
  metaOnly?: boolean
} & ChromoRpcOptions

export type ChromoNetworkBodyReadLinesResult = {
  headers: Record<string, string>
  status: number
  totalLines: number
  fromLine: number
  toLine: number
  lines: string[]
  contentType?: string
  charset?: string
  rangeClamped?: boolean
}

export type ChromoNetworkOptions = {
  devtoolsId?: string
  disableCache?: boolean
}

/** VC_NETWORK_HOT_PROBE result — global method+URL+TTL hot cache. */
export type ChromoNetworkHotProbeResult = {
  exists: boolean
  fresh?: boolean
  expiresAt?: number
}

export type ChromoCookie = {
  id: string
  name: string
  value: string
  domain: string
  path: string
  expires: number | null
  secure: boolean
  httpOnly: boolean
  sameSite: string
  hostOnly?: boolean
}

export type ChromoStorageEntry = { key: string; value: string }

export type ChromoStorageListResult = {
  type: 'local' | 'session'
  origin: string
  entries: ChromoStorageEntry[]
}

export type ChromoSwInfo = {
  scriptURL: string
  state: string
  build: string
  version: string
  controlled: boolean
  siteServiceWorkerBlocked: boolean
}

export type ChromoNetworkCacheStats = {
  hot: { entries: number; bytes: number }
  archive: { entries: number; bytes: number }
}

export type ChromoIdbDatabase = { name: string; version: number }
export type ChromoIdbStore = { name: string; count: number }
export type ChromoIdbValuePreview = {
  type: string
  preview: string
  truncated?: boolean
}
export type ChromoIdbEntry = { key: unknown; value: ChromoIdbValuePreview }

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
  onContextMenu?: (payload: ChromoContextMenuPayload) => void
  onLocation?: (payload: ChromoLocationPayload) => void
  onHistory?: (payload: ChromoHistoryPayload) => void
}

export type ChromoBridge = {
  navigate: (url: string, options?: ChromoNavigateOptions) => void
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
  readNetworkBodyLines: (
    entryId: string,
    options?: ChromoNetworkBodyReadLinesOptions,
  ) => Promise<ChromoNetworkBodyReadLinesResult>
  probeNetworkHot: (
    method: string,
    url: string,
    options?: ChromoRpcOptions,
  ) => Promise<ChromoNetworkHotProbeResult>
  setNetworkOptions: (options: ChromoNetworkOptions) => void
  setDebugPanelEnabled: (enabled: boolean) => void
  devtoolsId: string
  screenshot: (
    options?: ChromoScreenshotOptions,
  ) => Promise<ChromoScreenshotResult>
  clearState: (options?: ChromoRpcOptions) => Promise<void>
  listCookies: (options?: ChromoRpcOptions) => Promise<{ cookies: ChromoCookie[] }>
  deleteCookie: (cookieId: string, options?: ChromoRpcOptions) => Promise<{ deleted: boolean }>
  clearCookies: (
    domain: string,
    options?: ChromoRpcOptions,
  ) => Promise<{ cleared: number }>
  clearAllCookies: (options?: ChromoRpcOptions) => Promise<{ cleared: number }>
  listStorage: (
    type: 'local' | 'session',
    options?: ChromoRpcOptions,
  ) => Promise<ChromoStorageListResult>
  setStorageItem: (
    type: 'local' | 'session',
    key: string,
    value: string,
    options?: ChromoRpcOptions,
  ) => Promise<unknown>
  removeStorageItem: (
    type: 'local' | 'session',
    key: string,
    options?: ChromoRpcOptions,
  ) => Promise<unknown>
  clearStorage: (
    type: 'local' | 'session',
    options?: ChromoRpcOptions,
  ) => Promise<unknown>
  getSwInfo: (options?: ChromoRpcOptions) => Promise<ChromoSwInfo>
  getNetworkCacheStats: (options?: ChromoRpcOptions) => Promise<ChromoNetworkCacheStats>
  listNetworkCache: (
    layer: 'hot' | 'archive',
    options?: { limit?: number } & ChromoRpcOptions,
  ) => Promise<{ layer: string; entries: unknown[] }>
  /** Clear hot cache for one origin. Origin is required. */
  clearNetworkCache: (
    origin: string,
    options?: ChromoRpcOptions,
  ) => Promise<{ layer: string; origin: string }>
  /** Clear entire hot/archive layer or both. */
  clearAllNetworkCache: (
    layer: 'hot' | 'archive' | 'all',
    options?: ChromoRpcOptions,
  ) => Promise<{ layer: string }>
  listIdb: (options?: ChromoRpcOptions) => Promise<{ databases: ChromoIdbDatabase[] }>
  deleteIdb: (name: string, options?: ChromoRpcOptions) => Promise<unknown>
  listIdbStores: (
    name: string,
    options?: ChromoRpcOptions,
  ) => Promise<{ name: string; version: number; stores: ChromoIdbStore[] }>
  getIdbAll: (
    name: string,
    store: string,
    options?: { limit?: number } & ChromoRpcOptions,
  ) => Promise<{
    name: string
    store: string
    keyPath: unknown
    entries: ChromoIdbEntry[]
    truncated?: boolean
  }>
  listSiteCaches: (options?: ChromoRpcOptions) => Promise<{ caches: string[] }>
  listSiteCacheKeys: (
    cache: string,
    options?: { limit?: number } & ChromoRpcOptions,
  ) => Promise<{ cache: string; urls: string[]; truncated?: boolean }>
  deleteSiteCache: (
    cache: string,
    url?: string,
    options?: ChromoRpcOptions,
  ) => Promise<unknown>
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

function isWindowSource(source: MessageEventSource | null): source is Window {
  return source !== null && typeof source === 'object' && 'frames' in source
}

function isDescendantWindow(source: Window, root: Window): boolean {
  if (source === root) {
    return true
  }
  try {
    const frames = root.frames
    for (let i = 0; i < frames.length; i++) {
      const child = frames[i]
      if (child && isDescendantWindow(source, child)) {
        return true
      }
    }
  } catch {
    return false
  }
  return false
}

function isMessageFromViewer(event: MessageEvent, iframe: HTMLIFrameElement): boolean {
  const root = iframe.contentWindow
  if (!root || !isWindowSource(event.source)) {
    return false
  }
  if (event.source === root) {
    return true
  }
  try {
    return isDescendantWindow(event.source, root)
  } catch {
    return false
  }
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
  let debugPanelEnabled = false
  const pendingNavigations: Array<{ url: string; method?: 'POST'; body?: string }> = []
  const pendingRpcs = new Map<string, PendingRpc>()
  let pendingClearState: {
    resolve: () => void
    reject: (error: Error) => void
    timer: ReturnType<typeof setTimeout>
  } | null = null

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

  const applyDebugPanelOptions = () => {
    postCommand(iframe, 'VC_DEBUG_PANEL', { enabled: debugPanelEnabled }, targetOrigin)
  }

  const flushPending = () => {
    applyNetworkOptions()
    applyDebugPanelOptions()
    while (pendingNavigations.length > 0) {
      const req = pendingNavigations.shift()
      if (req) {
        const payload: Record<string, unknown> = { url: req.url }
        if (req.method === 'POST' && req.body !== undefined) {
          payload.method = 'POST'
          payload.body = req.body
        }
        postCommand(iframe, 'VC_NAVIGATE', payload, targetOrigin)
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
    if (!isMessageFromViewer(event, iframe)) {
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
      case 'VC_NETWORK_BODY_READ_LINES_RESULT':
        settleRpc('VC_NETWORK_BODY_READ_LINES_RESULT', payload as RpcResultPayload)
        break
      case 'VC_SCREENSHOT_RESULT':
        settleRpc('VC_SCREENSHOT_RESULT', payload as RpcResultPayload)
        break
      case 'VC_COOKIE_LIST_RESULT':
        settleRpc('VC_COOKIE_LIST_RESULT', payload as RpcResultPayload)
        break
      case 'VC_COOKIE_DELETE_RESULT':
        settleRpc('VC_COOKIE_DELETE_RESULT', payload as RpcResultPayload)
        break
      case 'VC_COOKIE_CLEAR_RESULT':
        settleRpc('VC_COOKIE_CLEAR_RESULT', payload as RpcResultPayload)
        break
      case 'VC_COOKIE_CLEAR_ALL_RESULT':
        settleRpc('VC_COOKIE_CLEAR_ALL_RESULT', payload as RpcResultPayload)
        break
      case 'VC_STORAGE_LIST_RESULT':
        settleRpc('VC_STORAGE_LIST_RESULT', payload as RpcResultPayload)
        break
      case 'VC_STORAGE_SET_RESULT':
        settleRpc('VC_STORAGE_SET_RESULT', payload as RpcResultPayload)
        break
      case 'VC_STORAGE_REMOVE_RESULT':
        settleRpc('VC_STORAGE_REMOVE_RESULT', payload as RpcResultPayload)
        break
      case 'VC_STORAGE_CLEAR_RESULT':
        settleRpc('VC_STORAGE_CLEAR_RESULT', payload as RpcResultPayload)
        break
      case 'VC_SW_INFO_RESULT':
        settleRpc('VC_SW_INFO_RESULT', payload as RpcResultPayload)
        break
      case 'VC_NETWORK_CACHE_STATS_RESULT':
        settleRpc('VC_NETWORK_CACHE_STATS_RESULT', payload as RpcResultPayload)
        break
      case 'VC_NETWORK_CACHE_LIST_RESULT':
        settleRpc('VC_NETWORK_CACHE_LIST_RESULT', payload as RpcResultPayload)
        break
      case 'VC_NETWORK_CACHE_CLEAR_RESULT':
        settleRpc('VC_NETWORK_CACHE_CLEAR_RESULT', payload as RpcResultPayload)
        break
      case 'VC_NETWORK_CACHE_CLEAR_ALL_RESULT':
        settleRpc('VC_NETWORK_CACHE_CLEAR_ALL_RESULT', payload as RpcResultPayload)
        break
      case 'VC_IDB_LIST_RESULT':
        settleRpc('VC_IDB_LIST_RESULT', payload as RpcResultPayload)
        break
      case 'VC_IDB_DELETE_RESULT':
        settleRpc('VC_IDB_DELETE_RESULT', payload as RpcResultPayload)
        break
      case 'VC_IDB_STORES_RESULT':
        settleRpc('VC_IDB_STORES_RESULT', payload as RpcResultPayload)
        break
      case 'VC_IDB_GET_ALL_RESULT':
        settleRpc('VC_IDB_GET_ALL_RESULT', payload as RpcResultPayload)
        break
      case 'VC_SITE_CACHE_LIST_RESULT':
        settleRpc('VC_SITE_CACHE_LIST_RESULT', payload as RpcResultPayload)
        break
      case 'VC_SITE_CACHE_KEYS_RESULT':
        settleRpc('VC_SITE_CACHE_KEYS_RESULT', payload as RpcResultPayload)
        break
      case 'VC_SITE_CACHE_DELETE_RESULT':
        settleRpc('VC_SITE_CACHE_DELETE_RESULT', payload as RpcResultPayload)
        break
      case 'VC_CLICK':
        handlers.onClick?.(payload as ChromoClickPayload)
        break
      case 'VC_CONTEXTMENU': {
        const parsed = parseChromoContextMenuPayload(payload)
        if (parsed) {
          handlers.onContextMenu?.(parsed)
        }
        break
      }
      case 'VC_LOCATION':
        handlers.onLocation?.(payload as ChromoLocationPayload)
        break
      case 'VC_HISTORY':
        handlers.onHistory?.(payload as ChromoHistoryPayload)
        break
      case 'VC_CLEAR_STATE_DONE': {
        if (pendingClearState) {
          clearTimeout(pendingClearState.timer)
          const done = payload as { ok?: boolean; error?: { message?: string } } | undefined
          if (done && done.ok === false) {
            pendingClearState.reject(
              Object.assign(new Error(done.error?.message ?? 'VC_CLEAR_STATE failed'), done.error ?? {}),
            )
          } else {
            pendingClearState.resolve()
          }
          pendingClearState = null
        }
        break
      }
      default:
        break
    }
  }

  window.addEventListener('message', onMessage)

  return {
    navigate(url, options) {
      const payload: Record<string, unknown> = { url }
      if (options?.method === 'POST' && options.body !== undefined) {
        payload.method = 'POST'
        payload.body = options.body
      }
      if (ready) {
        postCommand(iframe, 'VC_NAVIGATE', payload, targetOrigin)
        return
      }
      pendingNavigations.push({
        url,
        method: options?.method,
        body: options?.body,
      })
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
    readNetworkBodyLines(entryId, options) {
      const { fromLine, toLine, metaOnly, timeout } = options ?? {}
      const payload: Record<string, unknown> = { entryId }
      if (fromLine !== undefined) {
        payload.fromLine = fromLine
      }
      if (toLine !== undefined) {
        payload.toLine = toLine
      }
      if (metaOnly !== undefined) {
        payload.metaOnly = metaOnly
      }
      return rpc('VC_NETWORK_BODY_READ_LINES_RESULT', 'VC_NETWORK_BODY_READ_LINES', payload, {
        timeout,
      }).then((value) => value as ChromoNetworkBodyReadLinesResult)
    },
    probeNetworkHot(method, url, options) {
      return rpc('VC_NETWORK_HOT_PROBE_RESULT', 'VC_NETWORK_HOT_PROBE', { method, url }, {
        timeout: options?.timeout ?? 10_000,
      }).then(
        (value) => (value ?? { exists: false }) as ChromoNetworkHotProbeResult,
      )
    },
    setNetworkOptions(opts) {
      if (opts.disableCache !== undefined) {
        disableCache = opts.disableCache
      }
      applyNetworkOptions()
    },
    setDebugPanelEnabled(enabled) {
      debugPanelEnabled = !!enabled
      applyDebugPanelOptions()
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
    clearState(options) {
      const timeout = options?.timeout ?? 15_000
      return new Promise<void>((resolve, reject) => {
        if (pendingClearState) {
          clearTimeout(pendingClearState.timer)
          pendingClearState.reject(new Error('VC_CLEAR_STATE superseded'))
          pendingClearState = null
        }
        const timer = setTimeout(() => {
          if (!pendingClearState) {
            return
          }
          pendingClearState = null
          reject(
            Object.assign(new Error('VC_CLEAR_STATE timed out'), {
              code: 'RPC_TIMEOUT',
              timeout,
            }),
          )
        }, timeout)
        pendingClearState = { resolve, reject, timer }
        postCommand(iframe, 'VC_CLEAR_STATE', { id: crypto.randomUUID() }, targetOrigin)
      })
    },
    listCookies(options) {
      return rpc('VC_COOKIE_LIST_RESULT', 'VC_COOKIE_LIST', {}, options).then(
        (value) => (value ?? { cookies: [] }) as { cookies: ChromoCookie[] },
      )
    },
    deleteCookie(cookieId, options) {
      return rpc('VC_COOKIE_DELETE_RESULT', 'VC_COOKIE_DELETE', { cookieId }, options).then(
        (value) => (value ?? { deleted: false }) as { deleted: boolean },
      )
    },
    clearCookies(domain, options) {
      const trimmed = typeof domain === 'string' ? domain.trim() : ''
      if (!trimmed) {
        return Promise.reject(
          Object.assign(new Error('domain required'), { code: 'DOMAIN_REQUIRED' }),
        )
      }
      return rpc('VC_COOKIE_CLEAR_RESULT', 'VC_COOKIE_CLEAR', { domain: trimmed }, options).then(
        (value) => (value ?? { cleared: 0 }) as { cleared: number },
      )
    },
    clearAllCookies(options) {
      return rpc('VC_COOKIE_CLEAR_ALL_RESULT', 'VC_COOKIE_CLEAR_ALL', {}, options).then(
        (value) => (value ?? { cleared: -1 }) as { cleared: number },
      )
    },
    listStorage(type, options) {
      return rpc('VC_STORAGE_LIST_RESULT', 'VC_STORAGE_LIST', { type }, options).then(
        (value) =>
          (value ?? { type, origin: '', entries: [] }) as ChromoStorageListResult,
      )
    },
    setStorageItem(type, key, value, options) {
      return rpc('VC_STORAGE_SET_RESULT', 'VC_STORAGE_SET', { type, key, value }, options)
    },
    removeStorageItem(type, key, options) {
      return rpc('VC_STORAGE_REMOVE_RESULT', 'VC_STORAGE_REMOVE', { type, key }, options)
    },
    clearStorage(type, options) {
      return rpc('VC_STORAGE_CLEAR_RESULT', 'VC_STORAGE_CLEAR', { type }, options)
    },
    getSwInfo(options) {
      return rpc('VC_SW_INFO_RESULT', 'VC_SW_INFO', {}, options).then(
        (value) => value as ChromoSwInfo,
      )
    },
    getNetworkCacheStats(options) {
      return rpc('VC_NETWORK_CACHE_STATS_RESULT', 'VC_NETWORK_CACHE_STATS', {}, options).then(
        (value) => value as ChromoNetworkCacheStats,
      )
    },
    listNetworkCache(layer, options) {
      const { limit, timeout } = options ?? {}
      const payload: Record<string, unknown> = { layer }
      if (limit !== undefined) {
        payload.limit = limit
      }
      return rpc('VC_NETWORK_CACHE_LIST_RESULT', 'VC_NETWORK_CACHE_LIST', payload, {
        timeout,
      }).then((value) => (value ?? { layer, entries: [] }) as { layer: string; entries: unknown[] })
    },
    clearNetworkCache(origin, options) {
      const trimmed = typeof origin === 'string' ? origin.trim() : ''
      if (!trimmed) {
        return Promise.reject(
          Object.assign(new Error('origin required'), { code: 'ORIGIN_REQUIRED' }),
        )
      }
      return rpc(
        'VC_NETWORK_CACHE_CLEAR_RESULT',
        'VC_NETWORK_CACHE_CLEAR',
        { origin: trimmed },
        options,
      ).then(
        (value) =>
          (value ?? { layer: 'hot', origin: trimmed }) as { layer: string; origin: string },
      )
    },
    clearAllNetworkCache(layer, options) {
      return rpc(
        'VC_NETWORK_CACHE_CLEAR_ALL_RESULT',
        'VC_NETWORK_CACHE_CLEAR_ALL',
        { layer },
        options,
      ).then((value) => (value ?? { layer }) as { layer: string })
    },
    listIdb(options) {
      return rpc('VC_IDB_LIST_RESULT', 'VC_IDB_LIST', {}, options).then(
        (value) => (value ?? { databases: [] }) as { databases: ChromoIdbDatabase[] },
      )
    },
    deleteIdb(name, options) {
      return rpc('VC_IDB_DELETE_RESULT', 'VC_IDB_DELETE', { name }, options)
    },
    listIdbStores(name, options) {
      return rpc('VC_IDB_STORES_RESULT', 'VC_IDB_STORES', { name }, options).then(
        (value) =>
          (value ?? { name, version: 0, stores: [] }) as {
            name: string
            version: number
            stores: ChromoIdbStore[]
          },
      )
    },
    getIdbAll(name, store, options) {
      const { limit, timeout } = options ?? {}
      const payload: Record<string, unknown> = { name, store }
      if (limit !== undefined) {
        payload.limit = limit
      }
      return rpc('VC_IDB_GET_ALL_RESULT', 'VC_IDB_GET_ALL', payload, { timeout }).then(
        (value) =>
          (value ?? { name, store, keyPath: null, entries: [] }) as {
            name: string
            store: string
            keyPath: unknown
            entries: ChromoIdbEntry[]
            truncated?: boolean
          },
      )
    },
    listSiteCaches(options) {
      return rpc('VC_SITE_CACHE_LIST_RESULT', 'VC_SITE_CACHE_LIST', {}, options).then(
        (value) => (value ?? { caches: [] }) as { caches: string[] },
      )
    },
    listSiteCacheKeys(cache, options) {
      const { limit, timeout } = options ?? {}
      const payload: Record<string, unknown> = { cache }
      if (limit !== undefined) {
        payload.limit = limit
      }
      return rpc('VC_SITE_CACHE_KEYS_RESULT', 'VC_SITE_CACHE_KEYS', payload, { timeout }).then(
        (value) =>
          (value ?? { cache, urls: [] }) as {
            cache: string
            urls: string[]
            truncated?: boolean
          },
      )
    },
    deleteSiteCache(cache, url, options) {
      const payload: Record<string, unknown> = { cache }
      if (url) {
        payload.url = url
      }
      return rpc('VC_SITE_CACHE_DELETE_RESULT', 'VC_SITE_CACHE_DELETE', payload, options)
    },
    isReady: () => ready,
    destroy() {
      window.removeEventListener('message', onMessage)
      ready = false
      pendingNavigations.length = 0
      if (pendingClearState) {
        clearTimeout(pendingClearState.timer)
        pendingClearState.reject(new Error('Chromo bridge destroyed'))
        pendingClearState = null
      }
      for (const waiter of pendingRpcs.values()) {
        rejectRpc(waiter, new Error('Chromo bridge destroyed'))
      }
      pendingRpcs.clear()
    },
  }
}
