import type OpenAI from 'openai'
import {
  cloneMessages,
  contentToText,
  nextCompressionId,
  summaryPreviewFromText,
  type AgentCompressionEvent,
  type ChatMessage,
} from './types.ts'

type AssistantWithTools = OpenAI.Chat.ChatCompletionAssistantMessageParam & {
  tool_calls?: OpenAI.Chat.ChatCompletionMessageToolCall[]
  reasoning_content?: string
}

/**
 * 找到「最近 keepRecentTurns 个 user 消息」的起始下标。
 * 该下标之后的消息（含该 user）视为保护区，不做 L1/L3/L4 覆盖。
 */
export function findKeepRecentStartIndex(
  messages: ChatMessage[],
  keepRecentTurns: number,
): number {
  const userIndexes: number[] = []
  for (let i = 0; i < messages.length; i += 1) {
    if (messages[i]?.role === 'user') userIndexes.push(i)
  }
  if (userIndexes.length === 0) return messages.length
  const keep = Math.max(1, keepRecentTurns)
  if (userIndexes.length <= keep) return userIndexes[0]!
  return userIndexes[userIndexes.length - keep]!
}

function summarizeToolArgs(raw: string): string {
  try {
    const parsed = JSON.parse(raw) as Record<string, unknown>
    const keys = ['path', 'query', 'command', 'script', 'package', 'source', 'pattern']
    const parts: string[] = []
    for (const key of keys) {
      const value = parsed[key]
      if (typeof value === 'string' && value.trim()) {
        const clipped = value.trim().length > 120 ? `${value.trim().slice(0, 120)}…` : value.trim()
        parts.push(`${key}=${clipped}`)
      }
    }
    if (parts.length > 0) return parts.join(' ')
    return raw.length > 120 ? `${raw.slice(0, 120)}…` : raw
  } catch {
    return raw.length > 120 ? `${raw.slice(0, 120)}…` : raw
  }
}

function summarizeToolResult(content: string): string {
  const text = content.trim()
  if (!text) return 'ok (empty)'
  const spilled = text.match(/\[tool_output_spilled path=("(?:\\.|[^"])*"|'(?:\\.|[^'])*') chars=(\d+)\]/)
  if (spilled) {
    return `spilled ${spilled[1]} (${spilled[2]} chars)`
  }
  if (text.includes('[duplicate_of hash=')) {
    return 'duplicate'
  }
  const lower = text.toLowerCase()
  const isError =
    lower.includes('"error"') ||
    lower.startsWith('error') ||
    text.includes('Traceback') ||
    text.includes('FAILED')
  const preview = text.length > 200 ? `${text.slice(0, 200)}…` : text
  return isError ? `error: ${preview}` : `ok (${text.length} chars)`
}

/**
 * L1：将保护区之前已完成的 tool 轮次折叠为摘要 assistant 消息。
 */
export function foldCompletedToolRounds(
  wire: ChatMessage[],
  options: {
    keepRecentTurns: number
    step: number
    beforeTokens: number
  },
): { wire: ChatMessage[]; events: AgentCompressionEvent[] } {
  const keepStart = findKeepRecentStartIndex(wire, options.keepRecentTurns)
  if (keepStart <= 1) {
    return { wire, events: [] }
  }

  const head = wire.slice(0, keepStart)
  const tail = wire.slice(keepStart)
  const folded: ChatMessage[] = []
  const events: AgentCompressionEvent[] = []
  let i = 0
  let foldedAny = false
  let foldFrom = -1
  let foldTo = -1

  while (i < head.length) {
    const message = head[i]!
    if (message.role !== 'assistant') {
      // 保留 system / 既有 compaction / 普通 user（保护区外的 user 在 L3 处理）
      folded.push(message)
      i += 1
      continue
    }

    const assistant = message as AssistantWithTools
    const toolCalls = assistant.tool_calls
    if (!toolCalls?.length) {
      folded.push(message)
      i += 1
      continue
    }

    const toolResults: ChatMessage[] = []
    let j = i + 1
    while (j < head.length && head[j]?.role === 'tool') {
      toolResults.push(head[j]!)
      j += 1
    }

    // 工具结果不完整则保留原样（避免破坏协议）
    if (toolResults.length < toolCalls.length) {
      folded.push(message)
      i += 1
      continue
    }

    const lines: string[] = ['[folded_tools]']
    for (const call of toolCalls) {
      if (call.type !== 'function') continue
      const name = call.function.name
      const argsSummary = summarizeToolArgs(call.function.arguments ?? '')
      const matching = toolResults.find(
        (result) =>
          result.role === 'tool' &&
          'tool_call_id' in result &&
          result.tool_call_id === call.id,
      )
      const resultText =
        matching && matching.role === 'tool'
          ? summarizeToolResult(contentToText(matching.content))
          : 'missing'
      lines.push(`- ${name}${argsSummary ? ` ${argsSummary}` : ''} → ${resultText}`)
    }
    lines.push('[/folded_tools]')

    if (foldFrom < 0) foldFrom = i
    foldTo = j
    foldedAny = true
    folded.push({
      role: 'assistant',
      content: lines.join('\n'),
    })
    i = j
  }

  if (!foldedAny) {
    return { wire, events: [] }
  }

  const nextWire = [...folded, ...tail]
  const afterRough = Math.max(1, Math.ceil(JSON.stringify(nextWire).length / 2.5))
  events.push({
    id: nextCompressionId('fold'),
    kind: 'structure_fold',
    atStep: options.step,
    beforeTokens: options.beforeTokens,
    afterTokens: afterRough,
    coveredCanonicalFrom: foldFrom,
    coveredCanonicalTo: foldTo,
    summaryPreview: summaryPreviewFromText(
      contentToText((folded.find((m) => m.role === 'assistant') as { content?: unknown })?.content) ||
        '[folded_tools]',
    ),
  })

  return { wire: nextWire, events }
}

/**
 * L2：修剪历史 reasoning_content。
 * requireEcho 时仅保留 wire 中最后一条带 tool_calls 的 assistant 的 reasoning。
 */
export function pruneReasoningContent(
  wire: ChatMessage[],
  options: {
    requireEcho: boolean
    step: number
    beforeTokens: number
  },
): { wire: ChatMessage[]; events: AgentCompressionEvent[] } {
  let lastToolAssistantIndex = -1
  if (options.requireEcho) {
    for (let i = wire.length - 1; i >= 0; i -= 1) {
      const message = wire[i]
      if (message?.role !== 'assistant') continue
      const toolCalls = (message as AssistantWithTools).tool_calls
      if (toolCalls?.length) {
        lastToolAssistantIndex = i
        break
      }
    }
  }

  let changed = false
  const next = wire.map((message, index) => {
    if (message.role !== 'assistant') return message
    const assistant = message as AssistantWithTools
    if (typeof assistant.reasoning_content !== 'string' || !assistant.reasoning_content) {
      return message
    }
    if (options.requireEcho && index === lastToolAssistantIndex) {
      return message
    }
    changed = true
    const clone = structuredClone(assistant)
    if (options.requireEcho) {
      clone.reasoning_content = ''
    } else {
      delete clone.reasoning_content
    }
    return clone
  })

  if (!changed) return { wire, events: [] }

  return {
    wire: next,
    events: [
      {
        id: nextCompressionId('reason'),
        kind: 'reasoning_prune',
        atStep: options.step,
        beforeTokens: options.beforeTokens,
        afterTokens: Math.max(1, Math.ceil(JSON.stringify(next).length / 2.5)),
        coveredCanonicalFrom: 0,
        coveredCanonicalTo: wire.length,
      },
    ],
  }
}

/**
 * L3：保护区之前的 user/assistant 正文压成省略标记。
 * 返回 needLlmCompact=true 表示应紧接着跑 L4。
 */
export function omitEarlierTurns(
  wire: ChatMessage[],
  options: {
    keepRecentTurns: number
    step: number
    beforeTokens: number
  },
): {
  wire: ChatMessage[]
  events: AgentCompressionEvent[]
  needLlmCompact: boolean
  omitFrom: number
  omitTo: number
} {
  const keepStart = findKeepRecentStartIndex(wire, options.keepRecentTurns)
  if (keepStart <= 1) {
    return {
      wire,
      events: [],
      needLlmCompact: false,
      omitFrom: 0,
      omitTo: 0,
    }
  }

  // 保留开头 system（若有）
  let prefixEnd = 0
  if (wire[0]?.role === 'system') prefixEnd = 1

  if (keepStart <= prefixEnd) {
    return {
      wire,
      events: [],
      needLlmCompact: false,
      omitFrom: 0,
      omitTo: 0,
    }
  }

  const omitted = wire.slice(prefixEnd, keepStart)
  if (omitted.length === 0) {
    return {
      wire,
      events: [],
      needLlmCompact: false,
      omitFrom: 0,
      omitTo: 0,
    }
  }

  // 若已有 context-compaction 块且覆盖了该区间，不再重复省略
  const alreadyCompacted = omitted.some(
    (message) =>
      message.role === 'user' &&
      contentToText('content' in message ? message.content : '').includes('<context-compaction'),
  )
  if (alreadyCompacted && omitted.length <= 2) {
    return {
      wire,
      events: [],
      needLlmCompact: false,
      omitFrom: 0,
      omitTo: 0,
    }
  }

  const userCount = omitted.filter((m) => m.role === 'user').length
  const marker: ChatMessage = {
    role: 'user',
    content: [
      `[earlier_turns_omitted count=${userCount || omitted.length}]`,
      '（细节见下方 context-compaction 摘要；需要时可查阅会话记录）',
    ].join('\n'),
  }

  const nextWire = [...wire.slice(0, prefixEnd), marker, ...wire.slice(keepStart)]
  const event: AgentCompressionEvent = {
    id: nextCompressionId('tail'),
    kind: 'tail_window',
    atStep: options.step,
    beforeTokens: options.beforeTokens,
    afterTokens: Math.max(1, Math.ceil(JSON.stringify(nextWire).length / 2.5)),
    coveredCanonicalFrom: prefixEnd,
    coveredCanonicalTo: keepStart,
    summaryPreview: summaryPreviewFromText(contentToText(marker.content)),
  }

  return {
    wire: nextWire,
    events: [event],
    needLlmCompact: true,
    omitFrom: prefixEnd,
    omitTo: keepStart,
  }
}

export function buildCompactionUserMessage(params: {
  id: string
  summary: string
  coveredFrom: number
  coveredTo: number
  tokensBefore: number
  tokensAfter: number
}): ChatMessage {
  return {
    role: 'user',
    content: [
      `<context-compaction id="${params.id}" covered_from="${params.coveredFrom}" covered_to="${params.coveredTo}" tokens_before="${params.tokensBefore}" tokens_after="${params.tokensAfter}">`,
      params.summary.trim(),
      `</context-compaction>`,
    ].join('\n'),
  }
}

/** 从 canonical 切出保护区之前的区间，供 L4 摘要 */
export function sliceForCompaction(
  canonical: ChatMessage[],
  keepRecentTurns: number,
): { slice: ChatMessage[]; from: number; to: number; prefix: ChatMessage[]; recent: ChatMessage[] } {
  const keepStart = findKeepRecentStartIndex(canonical, keepRecentTurns)
  let prefixEnd = 0
  if (canonical[0]?.role === 'system') prefixEnd = 1
  return {
    slice: cloneMessages(canonical.slice(prefixEnd, keepStart)),
    from: prefixEnd,
    to: keepStart,
    prefix: cloneMessages(canonical.slice(0, prefixEnd)),
    recent: cloneMessages(canonical.slice(keepStart)),
  }
}
