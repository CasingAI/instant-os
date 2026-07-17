/**
 * 外链应用独立运行时：通过 iframe 加载宿主 /bridge 与主站通信。
 *
 * 【实验性 · 未完成】外链应用平台（Bridge）仍是未完成的实验特性：协议、授权、跨站存储与
 * 生产安装路径均可能继续变动，请勿当作稳定对外 API 依赖。相关入口见 bridge-entry、
 * external-bridge-app、install-external-bridge-handler，以及设置中的外链调试 / 外链 AI 授权。
 */

export const EXTERNAL_BRIDGE_PATH = '/bridge' as const

export const EXTERNAL_BRIDGE_READY_MESSAGE_TYPE = 'instant-os-external-bridge-ready' as const
export const EXTERNAL_BRIDGE_HANDSHAKE_MESSAGE_TYPE = 'instant-os-external-bridge-handshake' as const
export const EXTERNAL_BRIDGE_STATUS_MESSAGE_TYPE = 'instant-os-external-bridge-status' as const

export type ExternalBridgePhase =
  | 'checking'
  | 'needs-storage-access'
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
