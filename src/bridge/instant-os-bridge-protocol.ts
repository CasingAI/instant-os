/** 外链应用独立运行时，通过 iframe 加载宿主 /bridge.html 与主站通信。 */

export const EXTERNAL_BRIDGE_PATH = '/bridge.html' as const

export const EXTERNAL_BRIDGE_READY_MESSAGE_TYPE = 'instant-os-external-bridge-ready' as const
export const EXTERNAL_BRIDGE_HANDSHAKE_MESSAGE_TYPE = 'instant-os-external-bridge-handshake' as const
export const EXTERNAL_BRIDGE_STATUS_MESSAGE_TYPE = 'instant-os-external-bridge-status' as const

export type ExternalBridgePhase =
  | 'checking'
  | 'no-api-key'
  | 'awaiting-consent'
  | 'authorized'
  | 'denied'
  | 'error'

export type ExternalBridgeReadyMessage = {
  type: typeof EXTERNAL_BRIDGE_READY_MESSAGE_TYPE
  appId: string
}

export type ExternalBridgeHandshakeMessage = {
  type: typeof EXTERNAL_BRIDGE_HANDSHAKE_MESSAGE_TYPE
  appId: string
  appName?: string
}

export type ExternalBridgeStatusMessage = {
  type: typeof EXTERNAL_BRIDGE_STATUS_MESSAGE_TYPE
  appId: string
  phase: ExternalBridgePhase
  appName?: string
  /** 当前默认模型友好名称；不包含 API Key 或 baseURL。 */
  modelName?: string
  error?: string
}

export function isValidExternalBridgeAppId(appId: string): boolean {
  return appId.startsWith('ext:') && appId.length > 4
}

export function isExternalBridgeHandshakeMessage(
  data: unknown,
): data is ExternalBridgeHandshakeMessage {
  if (!data || typeof data !== 'object') {
    return false
  }

  const message = data as ExternalBridgeHandshakeMessage
  return (
    message.type === EXTERNAL_BRIDGE_HANDSHAKE_MESSAGE_TYPE &&
    typeof message.appId === 'string' &&
    isValidExternalBridgeAppId(message.appId)
  )
}

export function buildExternalBridgeStatus(
  partial: Omit<ExternalBridgeStatusMessage, 'type'>,
): ExternalBridgeStatusMessage {
  return {
    type: EXTERNAL_BRIDGE_STATUS_MESSAGE_TYPE,
    ...partial,
  }
}

export function buildExternalBridgeReady(appId: string): ExternalBridgeReadyMessage {
  return {
    type: EXTERNAL_BRIDGE_READY_MESSAGE_TYPE,
    appId,
  }
}
