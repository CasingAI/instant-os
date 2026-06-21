import {
  GENERATED_APP_AI_BASE_URL,
  GENERATED_APP_AI_REQUEST_MESSAGE_TYPE,
  GENERATED_APP_AI_RESPONSE_MESSAGE_TYPE,
  GENERATED_APP_AI_STREAM_END_MESSAGE_TYPE,
  GENERATED_APP_AI_STREAM_MESSAGE_TYPE,
} from './instant-os-protocol.ts'
import { appendDevLog } from '../dev/instant-os-dev-log.ts'
import { postBridgeMessage } from './instant-os-bridge-transport.ts'
import { resolveInstantOsRuntimeMode } from '../dev/instant-os-runtime.ts'

type InstallInstantOsAiBridgeOptions = {
  appId: string
  debug?: boolean
}

export function installInstantOsAiBridge(options: InstallInstantOsAiBridgeOptions): () => void {
  const appId = options.appId
  const debug = options.debug === true
  const pending = new Map<
    string,
    {
      resolve: (response: Response) => void
      reject: (error: Error) => void
      controller?: ReadableStreamDefaultController<Uint8Array>
    }
  >()
  let requestSeq = 0

  const onMessage = (event: MessageEvent) => {
    const data = event.data as Record<string, unknown> | undefined
    if (!data || data.appId !== appId) {
      return
    }

    if (data.type === GENERATED_APP_AI_RESPONSE_MESSAGE_TYPE) {
      appendDevLog('bridge-in', '收到 AI JSON 响应', { detail: data })
      settleJson(
        pending,
        String(data.requestId),
        Number(data.status),
        String(data.body ?? ''),
      )
      return
    }

    if (data.type === GENERATED_APP_AI_STREAM_MESSAGE_TYPE) {
      const entry = pending.get(String(data.requestId))
      if (!entry?.controller) {
        return
      }

      try {
        entry.controller.enqueue(new TextEncoder().encode(String(data.chunk ?? '')))
      } catch {
        // stream already closed
      }
      return
    }

    if (data.type === GENERATED_APP_AI_STREAM_END_MESSAGE_TYPE) {
      appendDevLog('bridge-in', 'AI 流式响应结束', { detail: data })
      settleStreamEnd(
        pending,
        String(data.requestId),
        Number(data.status),
        typeof data.error === 'string' ? data.error : undefined,
      )
    }
  }

  window.addEventListener('message', onMessage)

  const nativeFetch = window.fetch.bind(window)
  window.fetch = (input, init) => {
    const url = typeof input === 'string' ? input : input instanceof Request ? input.url : String(input)
    if (isAiUrl(url)) {
      return proxyFetch(pending, appId, debug, () => {
        requestSeq += 1
        return `ai-${requestSeq}`
      }, url, init)
    }

    return nativeFetch(input, init)
  }

  appendDevLog('system', 'AI 桥接已安装', {
    detail: { appId, mode: resolveInstantOsRuntimeMode() },
  })

  return () => {
    window.removeEventListener('message', onMessage)
    window.fetch = nativeFetch
  }
}

function isAiUrl(url: string): boolean {
  try {
    const parsed = new URL(url, GENERATED_APP_AI_BASE_URL)
    return parsed.origin === new URL(GENERATED_APP_AI_BASE_URL).origin && parsed.pathname.startsWith('/v1/')
  } catch {
    return false
  }
}

function sanitizeCompletionBodyText(bodyText: string | undefined): string | undefined {
  if (!bodyText) {
    return bodyText
  }

  try {
    const parsed = JSON.parse(bodyText) as Record<string, unknown>
    delete parsed.model
    delete parsed.thinking
    delete parsed.stream_options
    return JSON.stringify(parsed)
  } catch {
    return bodyText
  }
}

function settleJson(
  pending: Map<
    string,
    {
      resolve: (response: Response) => void
      reject: (error: Error) => void
      controller?: ReadableStreamDefaultController<Uint8Array>
    }
  >,
  requestId: string,
  status: number,
  bodyText: string,
): void {
  const entry = pending.get(requestId)
  if (!entry) {
    return
  }

  pending.delete(requestId)

  if (status < 200 || status >= 300) {
    entry.reject(new Error(parseErrorMessage(bodyText) || `HTTP ${status}`))
    return
  }

  entry.resolve(
    new Response(bodyText, {
      status,
      headers: { 'Content-Type': 'application/json' },
    }),
  )
}

function settleStreamEnd(
  pending: Map<
    string,
    {
      resolve: (response: Response) => void
      reject: (error: Error) => void
      controller?: ReadableStreamDefaultController<Uint8Array>
    }
  >,
  requestId: string,
  status: number,
  errorMessage?: string,
): void {
  const entry = pending.get(requestId)
  if (!entry) {
    return
  }

  pending.delete(requestId)

  if (errorMessage) {
    try {
      entry.controller?.error(new Error(errorMessage))
    } catch {
      // ignore
    }
    return
  }

  if (status < 200 || status >= 300) {
    try {
      entry.controller?.error(new Error(`HTTP ${status}`))
    } catch {
      // ignore
    }
    return
  }

  try {
    entry.controller?.close()
  } catch {
    // ignore
  }
}

function parseErrorMessage(bodyText: string): string | undefined {
  try {
    const parsed = JSON.parse(bodyText) as { error?: { message?: string } }
    return parsed.error?.message
  } catch {
    return bodyText || undefined
  }
}

function proxyFetch(
  pending: Map<
    string,
    {
      resolve: (response: Response) => void
      reject: (error: Error) => void
      controller?: ReadableStreamDefaultController<Uint8Array>
    }
  >,
  appId: string,
  debug: boolean,
  nextRequestId: () => string,
  url: string,
  init?: RequestInit,
): Promise<Response> {
  const mode = resolveInstantOsRuntimeMode()

  if (mode === 'standalone') {
    appendDevLog('ai', '独立运行模式下无法调用 AI，需要 Instant OS 宿主或开发工具', {
      level: 'error',
    })
    return Promise.reject(
      new Error('当前不在 Instant OS 宿主中。请使用 pnpm dev 开启开发模拟，或在 Instant OS 内运行。'),
    )
  }

  return new Promise((resolve, reject) => {
    const requestId = nextRequestId()
    const method = init?.method ? String(init.method).toUpperCase() : 'GET'
    const bodyText =
      init?.body != null ? sanitizeCompletionBodyText(String(init.body)) : undefined
    let streaming = false

    if (bodyText) {
      try {
        streaming = Boolean(JSON.parse(bodyText).stream)
      } catch {
        streaming = false
      }
    }

    if (streaming) {
      const stream = new ReadableStream<Uint8Array>({
        start(controller) {
          pending.set(requestId, { resolve, reject, controller })
        },
      })

      resolve(
        new Response(stream, {
          status: 200,
          headers: { 'Content-Type': 'text/event-stream' },
        }),
      )
    } else {
      pending.set(requestId, { resolve, reject })
    }

    try {
      const path = new URL(url, GENERATED_APP_AI_BASE_URL).pathname
      const payload = {
        type: GENERATED_APP_AI_REQUEST_MESSAGE_TYPE,
        appId,
        requestId,
        path,
        method,
        body: bodyText,
        debug: debug ? true : undefined,
      }

      appendDevLog('bridge-out', '发起 AI 桥接请求', { detail: payload })
      postBridgeMessage(payload)
    } catch (error) {
      pending.delete(requestId)
      reject(error instanceof Error ? error : new Error('AI 桥接请求失败'))
    }
  })
}
