import type { GeneratedAppId } from '../../os/types.ts'

export const GENERATED_APP_HEARTBEAT_MESSAGE_TYPE = 'instant-os-generated-app-heartbeat' as const

export const GENERATED_APP_HEARTBEAT_INTERVAL_MS = 300
export const GENERATED_APP_HEARTBEAT_UNRESPONSIVE_MISSES = 3
export const GENERATED_APP_HEARTBEAT_FROZEN_MISSES = 6
/** 连续 10 秒未收到心跳（33 × 300ms ≈ 9.9s）— 提示可能无法恢复的死循环。 */
export const GENERATED_APP_HEARTBEAT_DEADLOCK_MISSES = Math.round(10_000 / GENERATED_APP_HEARTBEAT_INTERVAL_MS)
/** iframe 尚未挂上 contentWindow 时，超过此时长仍无心跳则开始计未响应。 */
export const GENERATED_APP_HEARTBEAT_STARTUP_GRACE_MS = 3_000

export type GeneratedAppHeartbeatMemory = {
  usedBytes: number
  totalBytes: number
  limitBytes: number
}

export type GeneratedAppHeartbeatMessage = {
  type: typeof GENERATED_APP_HEARTBEAT_MESSAGE_TYPE
  appId: GeneratedAppId
  windowId: string
  timestamp: number
  /** 子文档 JS 堆；隔离模式下与宿主不在同一堆。 */
  memory?: GeneratedAppHeartbeatMemory
}

export type GeneratedAppHeartbeatPhase = 'starting' | 'healthy' | 'unresponsive' | 'frozen' | 'deadlock'

function isHeartbeatMemory(value: unknown): value is GeneratedAppHeartbeatMemory {
  if (!value || typeof value !== 'object') {
    return false
  }
  const memory = value as Partial<GeneratedAppHeartbeatMemory>
  return (
    typeof memory.usedBytes === 'number' &&
    typeof memory.totalBytes === 'number' &&
    typeof memory.limitBytes === 'number'
  )
}

export function isGeneratedAppHeartbeatMessage(
  data: unknown,
): data is GeneratedAppHeartbeatMessage {
  if (!data || typeof data !== 'object') {
    return false
  }

  const message = data as Partial<GeneratedAppHeartbeatMessage>
  if (
    message.type !== GENERATED_APP_HEARTBEAT_MESSAGE_TYPE ||
    typeof message.appId !== 'string' ||
    !message.appId.startsWith('gen:') ||
    typeof message.windowId !== 'string' ||
    typeof message.timestamp !== 'number'
  ) {
    return false
  }

  if (message.memory !== undefined && !isHeartbeatMemory(message.memory)) {
    return false
  }

  return true
}
