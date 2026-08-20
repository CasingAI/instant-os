import type { AgentCompressionDetail } from '../../ai/context-compression/index.ts'
import type { VscodeAiTimelineItem } from './vscode-ai-agent.ts'
import type { VscodeAiChatMessage, VscodeAiChatSession } from './vscode-ai-chat-storage.ts'
import { getRun } from './vscode-subagent-store.ts'

export const SUBAGENT_COMPRESSION_SESSION_PREFIX = 'subagent-'

export function subagentCompressionSessionId(runId: string): string {
  return `${SUBAGENT_COMPRESSION_SESSION_PREFIX}${runId}`
}

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

export function clearLiveCompressionCacheForSession(sessionId: string): void {
  const prefix = `${sessionId}::`
  for (const key of liveCompressionCache.keys()) {
    if (key.startsWith(prefix)) {
      liveCompressionCache.delete(key)
    }
  }
}

/** 工作区切换清空 Subagent store 时，丢弃对应临时缓存 */
export function clearLiveCompressionCacheForSubagentRuns(): void {
  for (const key of liveCompressionCache.keys()) {
    if (key.startsWith(SUBAGENT_COMPRESSION_SESSION_PREFIX)) {
      liveCompressionCache.delete(key)
    }
  }
}

function findCompressionDetailInMessages(
  messages: readonly VscodeAiChatMessage[] | undefined,
  compressionId: string,
): VscodeCompressionDetailRecord | undefined {
  if (!messages) return undefined
  for (const message of messages) {
    const timeline = message.investigation?.timeline
    if (!timeline) continue
    for (const item of timeline) {
      if (item.kind === 'compression' && item.id === compressionId) {
        return item
      }
    }
  }
  return undefined
}

function findCompressionDetailInSubagentRun(
  runId: string,
  compressionId: string,
): VscodeCompressionDetailRecord | undefined {
  const run = getRun(runId)
  if (!run) return undefined
  if (run.status === 'running' && run.liveProgress?.timeline) {
    for (const item of run.liveProgress.timeline) {
      if (item.kind === 'compression' && item.id === compressionId) {
        return item
      }
    }
  }
  const investigationTimeline = run.result?.investigation?.timeline
  if (investigationTimeline) {
    for (const item of investigationTimeline) {
      if (item.kind === 'compression' && item.id === compressionId) {
        return item
      }
    }
  }
  return undefined
}

/** 从会话消息的 investigation.timeline 查找压缩详情 */
export function findCompressionDetailInSession(
  session: VscodeAiChatSession | undefined,
  compressionId: string,
  sessionId?: string,
): VscodeCompressionDetailRecord | undefined {
  const resolvedSessionId = sessionId ?? session?.id
  if (resolvedSessionId?.startsWith(SUBAGENT_COMPRESSION_SESSION_PREFIX)) {
    const runId = resolvedSessionId.slice(SUBAGENT_COMPRESSION_SESSION_PREFIX.length)
    const fromRun = findCompressionDetailInSubagentRun(runId, compressionId)
    if (fromRun) return fromRun
  }
  if (session) {
    const fromMessages = findCompressionDetailInMessages(session.messages, compressionId)
    if (fromMessages) {
      if (session.id) {
        liveCompressionCache.delete(cacheKey(session.id, compressionId))
      }
      return fromMessages
    }
  }
  if (resolvedSessionId) {
    return liveCompressionCache.get(cacheKey(resolvedSessionId, compressionId))
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
