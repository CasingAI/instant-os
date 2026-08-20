import type OpenAI from 'openai'
import { estimateTokensFromTextsAsync } from '../../apps/browser/estimate-token-usage.ts'
import { runLlmCompact } from './llm-compactor.ts'
import {
  foldCompletedToolRounds,
  omitEarlierTurns,
  pruneReasoningContent,
  sliceForCompaction,
} from './structure-fold.ts'
import {
  cloneMessages,
  estimateMessagesTokensRough,
  messagePlainText,
  type AgentCompressionEvent,
  type AgentCompressionTrigger,
  type ChatMessage,
  type CompressionPipelineInput,
  type CompressionPipelineResult,
} from './types.ts'

async function estimateWireTokens(
  wire: ChatMessage[],
  model?: string,
): Promise<number> {
  const texts = wire.map((message) => messagePlainText(message))
  try {
    const counts = await estimateTokensFromTextsAsync(texts, model)
    return counts.reduce((sum, n) => sum + n, 0) + wire.length * 4
  } catch {
    return estimateMessagesTokensRough(wire)
  }
}

/**
 * 对 wire 历史跑 L1–L4（及强制 L4）。
 * 不修改 canonical；调用方负责维护双缓冲。
 */
export async function runCompressionPipeline(
  input: CompressionPipelineInput,
): Promise<CompressionPipelineResult> {
  const { options } = input
  if (!options.enabled) {
    return {
      wire: input.wire,
      events: [],
      estimatedTokens: input.estimatedTokens,
    }
  }

  const softLimit = Math.floor(options.contextWindow * options.softRatio)
  const hardLimit = Math.floor(options.contextWindow * options.hardRatio)
  let wire = cloneMessages(input.wire)
  let estimatedTokens =
    input.estimatedTokens > 0
      ? input.estimatedTokens
      : await estimateWireTokens(wire, input.model)
  const events: AgentCompressionEvent[] = []

  const overSoft = estimatedTokens >= softLimit
  const overHard = estimatedTokens >= hardLimit
  const forceLlm = Boolean(input.forceLlmCompact)

  if (!overSoft && !forceLlm) {
    return { wire, events, estimatedTokens }
  }

  const trigger: AgentCompressionTrigger = forceLlm
    ? 'self_compact'
    : overHard
      ? 'hard'
      : 'soft'

  // L1 structure fold
  {
    const folded = foldCompletedToolRounds(wire, {
      keepRecentTurns: options.keepRecentTurns,
      step: input.step,
      beforeTokens: estimatedTokens,
      trigger,
    })
    if (folded.events.length > 0) {
      wire = folded.wire
      events.push(...folded.events)
      estimatedTokens = await estimateWireTokens(wire, input.model)
      for (const event of folded.events) event.afterTokens = estimatedTokens
    }
  }

  // L2 reasoning prune
  {
    const pruned = pruneReasoningContent(wire, {
      requireEcho: input.requireReasoningEcho,
      step: input.step,
      beforeTokens: estimatedTokens,
      trigger,
    })
    if (pruned.events.length > 0) {
      wire = pruned.wire
      events.push(...pruned.events)
      estimatedTokens = await estimateWireTokens(wire, input.model)
      for (const event of pruned.events) event.afterTokens = estimatedTokens
    }
  }

  let needLlm = forceLlm || overHard || estimatedTokens >= softLimit
  let omitFrom = 0
  let omitTo = 0

  // L3 tail window（仅 soft 仍超且尚未强制摘要时）
  if (!forceLlm && estimatedTokens >= softLimit) {
    const omitted = omitEarlierTurns(wire, {
      keepRecentTurns: options.keepRecentTurns,
      step: input.step,
      beforeTokens: estimatedTokens,
      trigger,
    })
    if (omitted.events.length > 0) {
      wire = omitted.wire
      events.push(...omitted.events)
      estimatedTokens = await estimateWireTokens(wire, input.model)
      for (const event of omitted.events) event.afterTokens = estimatedTokens
      needLlm = omitted.needLlmCompact || estimatedTokens >= hardLimit
      omitFrom = omitted.omitFrom
      omitTo = omitted.omitTo
    }
  }

  // L4 LLM compact
  if (needLlm && (forceLlm || estimatedTokens >= hardLimit || omitTo > omitFrom)) {
    if (!input.client) {
      return { wire, events, estimatedTokens }
    }

    const sliced = sliceForCompaction(input.canonical, options.keepRecentTurns)
    if (sliced.slice.length > 0 && sliced.to > sliced.from) {
      const summaryModel = options.summaryModel ?? input.model
      if (!summaryModel) {
        return { wire, events, estimatedTokens }
      }

      const l4Trigger: AgentCompressionTrigger = forceLlm
        ? 'self_compact'
        : estimatedTokens >= hardLimit || overHard
          ? 'hard'
          : trigger

      const compact = await runLlmCompact({
        slice: sliced.slice,
        from: sliced.from,
        to: sliced.to,
        prefix: sliced.prefix,
        recent: sliced.recent,
        step: input.step,
        beforeTokens: estimatedTokens,
        contextWindow: options.contextWindow,
        focus: input.focus,
        client: input.client,
        model: summaryModel,
        usageContext: input.usageContext,
        signal: input.signal,
        kind: forceLlm ? 'self_compact' : 'llm_compact',
        trigger: l4Trigger,
      })

      if (compact) {
        wire = compact.wire
        events.push(compact.event)
        estimatedTokens = await estimateWireTokens(wire, input.model)
        compact.event.afterTokens = estimatedTokens
      }
    }
  }

  return { wire, events, estimatedTokens }
}

/** 同步估算（测试 / 热路径兜底） */
export function estimateWireTokensSync(wire: ChatMessage[]): number {
  return estimateMessagesTokensRough(wire)
}

export type { OpenAI }
