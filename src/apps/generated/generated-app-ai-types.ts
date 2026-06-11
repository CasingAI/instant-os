import type { GeneratedAppId } from '../../os/types.ts'

export const GENERATED_APP_AI_REQUEST_MESSAGE_TYPE = 'instant-generated-app-ai-request' as const
export const GENERATED_APP_AI_RESPONSE_MESSAGE_TYPE = 'instant-generated-app-ai-response' as const
export const GENERATED_APP_AI_STREAM_MESSAGE_TYPE = 'instant-generated-app-ai-stream' as const
export const GENERATED_APP_AI_STREAM_END_MESSAGE_TYPE = 'instant-generated-app-ai-stream-end' as const

export const GENERATED_APP_AI_BASE_URL = 'https://instant-os.local/v1'

export type GeneratedAppAiRequestMessage = {
  type: typeof GENERATED_APP_AI_REQUEST_MESSAGE_TYPE
  appId: GeneratedAppId
  requestId: string
  path: string
  method: string
  body?: string
  /** 仅 iCode 预览注入桥接时为 true，用于开启调试日志 */
  debug?: boolean
}

export type GeneratedAppAiResponseMessage = {
  type: typeof GENERATED_APP_AI_RESPONSE_MESSAGE_TYPE
  appId: GeneratedAppId
  requestId: string
  status: number
  body: string
}

export type GeneratedAppAiStreamMessage = {
  type: typeof GENERATED_APP_AI_STREAM_MESSAGE_TYPE
  appId: GeneratedAppId
  requestId: string
  chunk: string
}

export type GeneratedAppAiStreamEndMessage = {
  type: typeof GENERATED_APP_AI_STREAM_END_MESSAGE_TYPE
  appId: GeneratedAppId
  requestId: string
  status: number
  error?: string
}

export function isGeneratedAppAiRequestMessage(data: unknown): data is GeneratedAppAiRequestMessage {
  if (!data || typeof data !== 'object') {
    return false
  }

  const message = data as GeneratedAppAiRequestMessage
  return (
    message.type === GENERATED_APP_AI_REQUEST_MESSAGE_TYPE &&
    typeof message.appId === 'string' &&
    typeof message.requestId === 'string' &&
    typeof message.path === 'string' &&
    typeof message.method === 'string'
  )
}
