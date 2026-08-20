import type OpenAI from 'openai'

export type AgentCompressionKind =
  | 'tool_budget'
  | 'structure_fold'
  | 'reasoning_prune'
  | 'tail_window'
  | 'llm_compact'
  | 'self_compact'

export type AgentCompressionTrigger = 'soft' | 'hard' | 'self_compact'

export type AgentCompressionDetail =
  | {
      kind: 'structure_fold'
      trigger: AgentCompressionTrigger
      foldedToolsText: string
      toolCallCount: number
    }
  | {
      kind: 'reasoning_prune'
      trigger: AgentCompressionTrigger
      prunedAssistantCount: number
      prunedChars: number
    }
  | {
      kind: 'tail_window'
      trigger: AgentCompressionTrigger
      omittedUserCount: number
      keepRecentTurns: number
    }
  | {
      kind: 'llm_compact' | 'self_compact'
      trigger: AgentCompressionTrigger
      summary: string
      focus?: string
      note?: string
    }
  | {
      kind: 'tool_budget'
      trigger: AgentCompressionTrigger
      spilled?: boolean
      preview?: string
    }

export type AgentCompressionEvent = {
  id: string
  kind: AgentCompressionKind
  atStep: number
  beforeTokens: number
  afterTokens: number
  coveredCanonicalFrom: number
  coveredCanonicalTo: number
  summaryPreview?: string
  /** L0 spill 时为 true */
  spilled?: boolean
  /** L4 失败等说明 */
  note?: string
  /** 详情 Tab 用的结构化载荷 */
  detail?: AgentCompressionDetail
}

export type AgentCompressionSpill = {
  write: (text: string) => Promise<string>
  hint: (path: string) => string
}

export type AgentCompressionOptions = {
  enabled?: boolean
  contextWindow?: number
  softRatio?: number
  hardRatio?: number
  keepRecentTurns?: number
  /** 覆盖摘要模型；默认与主模型相同 */
  summaryModel?: string
  /** 默认 true：注入 compact_context 工具 */
  selfCompactTool?: boolean
  spill?: AgentCompressionSpill
}

export type ResolvedAgentCompressionOptions = {
  enabled: boolean
  contextWindow: number
  softRatio: number
  hardRatio: number
  keepRecentTurns: number
  summaryModel?: string
  selfCompactTool: boolean
  spill?: AgentCompressionSpill
}

export const DEFAULT_COMPRESSION_CONTEXT_WINDOW = 128_000
export const DEFAULT_SOFT_RATIO = 0.7
export const DEFAULT_HARD_RATIO = 0.85
export const DEFAULT_KEEP_RECENT_TURNS = 2

export function resolveCompressionOptions(
  options?: AgentCompressionOptions,
): ResolvedAgentCompressionOptions {
  return {
    enabled: options?.enabled !== false,
    contextWindow: Math.max(
      1_000,
      Math.floor(options?.contextWindow ?? DEFAULT_COMPRESSION_CONTEXT_WINDOW),
    ),
    softRatio: clampRatio(options?.softRatio ?? DEFAULT_SOFT_RATIO),
    hardRatio: clampRatio(options?.hardRatio ?? DEFAULT_HARD_RATIO),
    keepRecentTurns: Math.max(1, Math.floor(options?.keepRecentTurns ?? DEFAULT_KEEP_RECENT_TURNS)),
    summaryModel: options?.summaryModel?.trim() || undefined,
    selfCompactTool: options?.selfCompactTool !== false,
    spill: options?.spill,
  }
}

function clampRatio(value: number): number {
  if (!Number.isFinite(value)) return DEFAULT_SOFT_RATIO
  return Math.min(0.99, Math.max(0.1, value))
}

export type ChatMessage = OpenAI.Chat.ChatCompletionMessageParam

/** 避免 types 依赖 ai-usage-context（会拖入 app-registry） */
export type CompressionUsageContext = {
  actor: string
  behavior: string
  actorLabel?: string
  behaviorLabel?: string
}

export type CompressionPipelineInput = {
  canonical: ChatMessage[]
  wire: ChatMessage[]
  step: number
  estimatedTokens: number
  options: ResolvedAgentCompressionOptions
  requireReasoningEcho: boolean
  model?: string
  usageContext?: CompressionUsageContext
  client?: OpenAI
  focus?: string
  /** 强制跑 L4（self_compact / 显式） */
  forceLlmCompact?: boolean
  signal?: AbortSignal
}

export type CompressionPipelineResult = {
  wire: ChatMessage[]
  events: AgentCompressionEvent[]
  estimatedTokens: number
}

let compressionSeq = 0

export function nextCompressionId(prefix = 'cmp'): string {
  compressionSeq += 1
  return `${prefix}_${Date.now()}_${compressionSeq}`
}

export function cloneMessages(messages: ChatMessage[]): ChatMessage[] {
  return messages.map((message) => structuredClone(message))
}

export function messagePlainText(message: ChatMessage): string {
  if (message.role === 'tool') {
    return contentToText(message.content)
  }
  if (message.role === 'assistant') {
    const parts: string[] = []
    const text = contentToText(message.content)
    if (text) parts.push(text)
    if ('tool_calls' in message && message.tool_calls?.length) {
      parts.push(JSON.stringify(message.tool_calls))
    }
    const reasoning = (message as { reasoning_content?: unknown }).reasoning_content
    if (typeof reasoning === 'string' && reasoning) parts.push(reasoning)
    return parts.join('\n')
  }
  if ('content' in message) {
    return contentToText(message.content)
  }
  return ''
}

export function contentToText(content: unknown): string {
  if (typeof content === 'string') return content
  if (!Array.isArray(content)) return ''
  return content
    .map((part) => {
      if (typeof part === 'string') return part
      if (part && typeof part === 'object' && 'text' in part) {
        return String((part as { text?: unknown }).text ?? '')
      }
      return ''
    })
    .join('')
}

export function estimateMessagesChars(messages: ChatMessage[]): number {
  let total = 0
  for (const message of messages) {
    total += messagePlainText(message).length + 4
  }
  return total
}

/** 字符粗估：约 2.5 字符/token（中英混合保守） */
export function estimateMessagesTokensRough(messages: ChatMessage[]): number {
  return Math.max(1, Math.ceil(estimateMessagesChars(messages) / 2.5))
}

export function summaryPreviewFromText(text: string, limit = 200): string {
  const trimmed = text.trim().replace(/\s+/g, ' ')
  if (trimmed.length <= limit) return trimmed
  return `${trimmed.slice(0, limit)}…`
}
