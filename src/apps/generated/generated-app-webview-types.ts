import type { BridgeAppId } from '../../os/types.ts'
import { isBridgeAppId } from '../../os/types.ts'
import type { WebViewUnitEvent } from '../webview/webview-registry.ts'

export const GENERATED_APP_WEBVIEW_REQUEST_MESSAGE_TYPE =
  'instant-generated-app-webview-request' as const
export const GENERATED_APP_WEBVIEW_RESPONSE_MESSAGE_TYPE =
  'instant-generated-app-webview-response' as const
export const GENERATED_APP_WEBVIEW_EVENT_MESSAGE_TYPE =
  'instant-generated-app-webview-event' as const

export type GeneratedAppWebViewOp =
  | 'create'
  | 'destroy'
  | 'show'
  | 'hide'
  | 'listUnits'
  | 'listTabs'
  | 'wait'
  | 'openTab'
  | 'closeTab'
  | 'navigate'
  | 'eval'
  | 'screenshot'
  | 'snapshot'
  | 'markdown'
  | 'openDevTools'

export type GeneratedAppWebViewRequestMessage = {
  type: typeof GENERATED_APP_WEBVIEW_REQUEST_MESSAGE_TYPE
  appId: BridgeAppId
  requestId: string
  op: GeneratedAppWebViewOp
  unitId?: string
  tabId?: string
  url?: string
  code?: string
  timeoutMs?: number
  format?: 'jpeg' | 'png'
  quality?: number
  fullPage?: boolean
  scale?: number
  timeout?: number
  ref?: string
  mode?: 'embedded' | 'undocked'
}

export type GeneratedAppWebViewResponseMessage = {
  type: typeof GENERATED_APP_WEBVIEW_RESPONSE_MESSAGE_TYPE
  appId: BridgeAppId
  requestId: string
  ok: boolean
  result?: unknown
  error?: string
}

export type GeneratedAppWebViewEventMessage = {
  type: typeof GENERATED_APP_WEBVIEW_EVENT_MESSAGE_TYPE
  appId: BridgeAppId
  event: WebViewUnitEvent
}

const WEBVIEW_OPS = new Set<GeneratedAppWebViewOp>([
  'create',
  'destroy',
  'show',
  'hide',
  'listUnits',
  'listTabs',
  'wait',
  'openTab',
  'closeTab',
  'navigate',
  'eval',
  'screenshot',
  'snapshot',
  'markdown',
  'openDevTools',
])

export function isGeneratedAppWebViewRequestMessage(
  data: unknown,
): data is GeneratedAppWebViewRequestMessage {
  if (!data || typeof data !== 'object') {
    return false
  }

  const message = data as GeneratedAppWebViewRequestMessage
  return (
    message.type === GENERATED_APP_WEBVIEW_REQUEST_MESSAGE_TYPE &&
    typeof message.appId === 'string' &&
    isBridgeAppId(message.appId) &&
    typeof message.requestId === 'string' &&
    typeof message.op === 'string' &&
    WEBVIEW_OPS.has(message.op)
  )
}
