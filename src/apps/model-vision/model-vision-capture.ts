import { injectScene3dBridge } from '../../assets/3d/inject-scene3d-bridge.ts'
import { ensureIframeBlankDocument, writeHtmlToIframe } from '../../assets/3d/write-html-to-iframe.ts'
import { buildModelVisionCaptureRuntimeHtml } from './model-vision-capture-html.ts'
import type {
  ModelVisionCaptureResult,
  ModelVisionCapturedView,
  ModelVisionViewId,
} from './model-vision-types.ts'

const MESSAGE_TYPE = 'instant-model-vision-capture'
const CAPTURE_TIMEOUT_MS = 45_000
const READY_TIMEOUT_MS = 20_000
const BLANK_HTML = '<!DOCTYPE html><html><head></head><body></body></html>'

type CaptureMessage = {
  type?: string
  ok?: boolean
  action?: string
  requestId?: string
  error?: string
  views?: ModelVisionCapturedView[]
  thumbnailDataUrl?: string
}

type RuntimeState = {
  host: HTMLIFrameElement
  ready: boolean
  bootPromise?: Promise<void>
}

let runtime: RuntimeState | undefined
let requestSeq = 0

function isViewId(value: unknown): value is ModelVisionViewId {
  return value === 'iso' || value === 'top' || value === 'front' || value === 'side'
}

function normalizeViews(views: ModelVisionCapturedView[] | undefined): ModelVisionCapturedView[] {
  if (!Array.isArray(views)) {
    return []
  }
  return views.filter(
    (view) =>
      isViewId(view.id) &&
      typeof view.label === 'string' &&
      typeof view.dataUrl === 'string' &&
      view.dataUrl.startsWith('data:image/'),
  )
}

function nextRequestId(): string {
  requestSeq += 1
  return `mv-cap-${requestSeq}`
}

function waitForMessage(
  host: HTMLIFrameElement,
  match: (data: CaptureMessage) => boolean,
  timeoutMs: number,
  timeoutMessage: string,
): Promise<CaptureMessage> {
  return new Promise((resolve, reject) => {
    let settled = false

    const cleanup = () => {
      window.removeEventListener('message', onMessage)
      window.clearTimeout(timeoutId)
    }

    const onMessage = (event: MessageEvent) => {
      if (event.source !== host.contentWindow) return
      const data = event.data as CaptureMessage
      if (!data || data.type !== MESSAGE_TYPE) return
      if (!match(data)) return
      if (settled) return
      settled = true
      cleanup()
      resolve(data)
    }

    const timeoutId = window.setTimeout(() => {
      if (settled) return
      settled = true
      cleanup()
      reject(new Error(timeoutMessage))
    }, timeoutMs)

    window.addEventListener('message', onMessage)
  })
}

async function bootRuntime(host: HTMLIFrameElement): Promise<void> {
  ensureIframeBlankDocument(host)
  writeHtmlToIframe(host, BLANK_HTML)
  const html = injectScene3dBridge(buildModelVisionCaptureRuntimeHtml())
  const readyWait = waitForMessage(
    host,
    (data) => data.action === 'ready' && data.ok === true,
    READY_TIMEOUT_MS,
    '截图运行时启动超时',
  )
  const wrote = writeHtmlToIframe(host, html)
  if (!wrote) {
    throw new Error('无法写入截图 iframe')
  }
  await readyWait
}

/** 确保截图 iframe 已启动且只建一次 WebGL。 */
export async function ensureModelVisionCaptureRuntime(
  host: HTMLIFrameElement,
): Promise<void> {
  if (runtime?.host === host && runtime.ready) {
    return
  }
  if (runtime?.host === host && runtime.bootPromise) {
    await runtime.bootPromise
    return
  }

  const state: RuntimeState = {
    host,
    ready: false,
  }
  runtime = state
  state.bootPromise = bootRuntime(host)
    .then(() => {
      if (runtime === state) {
        state.ready = true
        state.bootPromise = undefined
      }
    })
    .catch((error) => {
      if (runtime === state) {
        runtime = undefined
      }
      throw error
    })
  await state.bootPromise
}

/** 批量结束 / 关应用时卸掉唯一 WebGL。 */
export function releaseModelVisionCaptureRuntime(host?: HTMLIFrameElement): void {
  const active = runtime
  if (!active) {
    if (host) {
      try {
        writeHtmlToIframe(host, BLANK_HTML)
      } catch {
        // ignore
      }
    }
    return
  }
  if (host && active.host !== host) {
    return
  }
  try {
    active.host.contentWindow?.postMessage(
      { type: MESSAGE_TYPE, action: 'shutdown' },
      '*',
    )
  } catch {
    // ignore
  }
  try {
    writeHtmlToIframe(active.host, BLANK_HTML)
  } catch {
    // ignore
  }
  runtime = undefined
}

export async function captureModelVisionViews(
  modelUrl: string,
  host: HTMLIFrameElement,
): Promise<ModelVisionCaptureResult> {
  await ensureModelVisionCaptureRuntime(host)

  const requestId = nextRequestId()
  const responseWait = waitForMessage(
    host,
    (data) => data.requestId === requestId && data.action !== 'ready',
    CAPTURE_TIMEOUT_MS,
    '模型截图超时',
  )

  host.contentWindow?.postMessage(
    {
      type: MESSAGE_TYPE,
      action: 'capture',
      modelUrl,
      requestId,
    },
    '*',
  )

  const data = await responseWait
  if (data.ok !== true) {
    throw new Error(data.error?.trim() || '模型截图失败')
  }

  const views = normalizeViews(data.views)
  if (views.length === 0) {
    throw new Error('未获得有效截图')
  }

  const thumbnailDataUrl =
    typeof data.thumbnailDataUrl === 'string' &&
    data.thumbnailDataUrl.startsWith('data:image/')
      ? data.thumbnailDataUrl
      : views[0]?.dataUrl

  if (!thumbnailDataUrl) {
    throw new Error('未获得缩略图')
  }

  return { views, thumbnailDataUrl }
}

/** 让出主线程，给 GC 一点机会回收上一轮字符串/解码图。 */
export function yieldForModelVisionGc(): Promise<void> {
  return new Promise((resolve) => {
    window.setTimeout(resolve, 40)
  })
}
