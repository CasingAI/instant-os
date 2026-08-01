import type { AgentCompressionDetail } from '../../ai/context-compression/index.ts'
import type { VscodeAiChatSession } from './vscode-ai-chat-storage.ts'
import type { VscodeAiTimelineItem } from './vscode-ai-agent.ts'

export type VscodeCompressionDetailRecord = Extract<
  VscodeAiTimelineItem,
  { kind: 'compression' }
>

/** 运行中尚未落盘到 messages 时的临时缓存（开 Tab 用） */
const liveCompressionCache = new Map<string, VscodeCompressionDetailRecord>()

function cacheKey(sessionId: string, compressionId: string): string {
  return `${sessionId}::${compressionId}`
}

export function rememberLiveCompressionDetail(
  sessionId: string,
  item: VscodeCompressionDetailRecord,
): void {
  liveCompressionCache.set(cacheKey(sessionId, item.id), item)
}

/** 从会话消息的 investigation.timeline 查找压缩详情 */
export function findCompressionDetailInSession(
  session: VscodeAiChatSession | undefined,
  compressionId: string,
  sessionId?: string,
): VscodeCompressionDetailRecord | undefined {
  if (session) {
    for (const message of session.messages) {
      const timeline = message.investigation?.timeline
      if (!timeline) continue
      for (const item of timeline) {
        if (item.kind === 'compression' && item.id === compressionId) {
          return item
        }
      }
    }
  }
  if (sessionId) {
    return liveCompressionCache.get(cacheKey(sessionId, compressionId))
  }
  if (session) {
    return liveCompressionCache.get(cacheKey(session.id, compressionId))
  }
  return undefined
}

export function compressionKindTabTitle(
  kind: VscodeCompressionDetailRecord['compressionKind'] | undefined,
): string {
  switch (kind) {
    case 'structure_fold':
      return '折叠工具'
    case 'reasoning_prune':
      return '修剪思维链'
    case 'tail_window':
      return '省略回合'
    case 'llm_compact':
      return '上下文摘要'
    case 'self_compact':
      return '主动压缩'
    case 'tool_budget':
      return '工具输出'
    default:
      return '压缩详情'
  }
}

export function compressionTriggerLabel(
  trigger: AgentCompressionDetail['trigger'] | undefined,
): string {
  switch (trigger) {
    case 'hard':
      return '超过硬阈值'
    case 'self_compact':
      return '模型请求'
    case 'soft':
      return '超过软阈值'
    default:
      return '未知'
  }
}

export function compressionKindLabel(
  kind: VscodeCompressionDetailRecord['compressionKind'],
): string {
  switch (kind) {
    case 'structure_fold':
      return '折叠工具轨迹'
    case 'reasoning_prune':
      return '修剪思维链'
    case 'tail_window':
      return '省略更早回合'
    case 'llm_compact':
      return '上下文摘要'
    case 'self_compact':
      return '模型请求压缩'
    case 'tool_budget':
      return '工具输出裁剪'
    default:
      return '上下文压缩'
  }
}
