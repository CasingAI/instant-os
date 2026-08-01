import type OpenAI from 'openai'
import type { AiUsageContext } from '../ai-usage-context.ts'
import { recordAiTokenUsage } from '../ai-token-usage.ts'
import { buildThinkingRequestExtras } from '../ai-thinking.ts'
import { mergeOpenAiConfig, type OpenAiConfig } from '../openai-config.ts'
import { snapshotFromOpenAiUsage } from '../openai-usage.ts'
import {
  contentToText,
  nextCompressionId,
  summaryPreviewFromText,
  type AgentCompressionEvent,
  type AgentCompressionTrigger,
  type ChatMessage,
  type CompressionUsageContext,
} from './types.ts'
import { buildCompactionUserMessage } from './structure-fold.ts'
import { headTailSerializeCap } from './serialize-trajectory.ts'

export const LLM_COMPACTOR_SYSTEM_PROMPT = `你是 Agent 上下文压缩器。你的唯一任务：把「将被丢弃的对话与工具轨迹」压成一份可供同一 Agent 在未来窗口中无损续作的结构化摘要。

硬性要求：
1. 只输出摘要正文，不要前言后语，不要 Markdown 标题装饰性废话。
2. 必须覆盖下方「保留清单」的每一个小节；某节无信息则写「无」。
3. 保留具体标识符：绝对/工作区相对路径、符号名、命令、错误码、测试名、URL、session/tmpdir、决策结论。
4. 丢弃：重复的文件全文、大段日志、已失败且已放弃的探索过程细节、寒暄。
5. 不要发明未在原文出现的事实；不确定则写「原文未说明」。
6. 使用中文；专有名词与代码标识保持原文。
7. 控制在约 1500–2500 汉字等价信息量；过长时优先砍「过程」保留「结论与未决项」。`

export function buildLlmCompactorUserPrompt(params: {
  focus?: string
  serializedTrajectory: string
}): string {
  const focus = params.focus?.trim() || '（无额外焦点）'
  return [
    '## 压缩焦点（来自调用方或 compact_context.focus；可空）',
    focus,
    '',
    '## 保留清单（逐节输出）',
    '### 目标与约束',
    '用户要达成什么；明确禁止/范围外事项。',
    '',
    '### 已确认事实',
    '与任务相关、已验证的事实（文件现状、复现步骤、环境假设）。',
    '',
    '### 关键决策',
    '架构/实现取舍及简短理由（只保留最终采纳的）。',
    '',
    '### 已修改或触及的路径',
    '路径列表 + 每项一句话（改了什么 / 只读过）。',
    '',
    '### 工具与命令要点',
    '重要命令、关键输出结论（不要贴全文）；若有 spilled 路径一并列出。',
    '',
    '### 未解决问题 / 阻塞',
    '当前错误、假设、下一步建议。',
    '',
    '### 进行中计划',
    '若有分步计划，保留未完成步骤。',
    '',
    '### 续作提示',
    '未来窗口应优先读取或执行的 3–7 条具体动作。',
    '',
    '## 原始轨迹（将被替换；可能已做结构折叠）',
    params.serializedTrajectory,
    '',
    '请按「保留清单」各小节输出纯文本摘要。',
  ].join('\n')
}

export type RunLlmCompactParams = {
  slice: ChatMessage[]
  from: number
  to: number
  prefix: ChatMessage[]
  recent: ChatMessage[]
  step: number
  beforeTokens: number
  contextWindow: number
  focus?: string
  client: OpenAI
  model: string
  config?: Partial<OpenAiConfig>
  usageContext?: CompressionUsageContext | AiUsageContext
  signal?: AbortSignal
  kind?: 'llm_compact' | 'self_compact'
  trigger?: AgentCompressionTrigger
}

export type RunLlmCompactResult = {
  wire: ChatMessage[]
  event: AgentCompressionEvent
  summary: string
}

export async function runLlmCompact(
  params: RunLlmCompactParams,
): Promise<RunLlmCompactResult | undefined> {
  if (params.slice.length === 0) return undefined

  const id = nextCompressionId('cmp')
  const config = mergeOpenAiConfig(params.config)
  const serialized = serializeTrajectoryForCompact(params.slice, params.contextWindow)
  const userPrompt = buildLlmCompactorUserPrompt({
    focus: params.focus,
    serializedTrajectory: serialized,
  })

  try {
    const completion = await params.client.chat.completions.create(
      {
        model: params.model,
        messages: [
          { role: 'system', content: LLM_COMPACTOR_SYSTEM_PROMPT },
          { role: 'user', content: userPrompt },
        ],
        max_tokens: 4096,
        stream: false,
        ...buildThinkingRequestExtras(config.providerId, false, params.model),
      },
      params.signal ? { signal: params.signal } : undefined,
    )

    const summary =
      completion.choices[0]?.message?.content?.trim() ||
      '（压缩器未返回有效摘要；已省略更早轨迹。）'

    const usage = snapshotFromOpenAiUsage(completion.usage)
    if (params.usageContext && usage && usage.totalTokens > 0) {
      recordAiTokenUsage(
        {
          ...params.usageContext,
          behavior: 'context-compact',
          behaviorLabel: params.usageContext.behaviorLabel
            ? `${params.usageContext.behaviorLabel} · 上下文压缩`
            : '上下文压缩',
        },
        {
          promptTokens: usage.promptTokens,
          completionTokens: usage.completionTokens,
          totalTokens: usage.totalTokens,
        },
      )
    }

    const afterTokens = Math.max(
      1,
      Math.ceil(
        (params.prefix.reduce((n, m) => n + contentToText('content' in m ? m.content : '').length, 0) +
          summary.length +
          params.recent.reduce((n, m) => n + JSON.stringify(m).length, 0)) /
          2.5,
      ),
    )

    const compactionMessage = buildCompactionUserMessage({
      id,
      summary,
      coveredFrom: params.from,
      coveredTo: params.to,
      tokensBefore: params.beforeTokens,
      tokensAfter: afterTokens,
    })

    const wire: ChatMessage[] = [...params.prefix, compactionMessage, ...params.recent]
    const kind = params.kind ?? 'llm_compact'
    const trigger = params.trigger ?? (kind === 'self_compact' ? 'self_compact' : 'hard')

    return {
      wire,
      summary,
      event: {
        id,
        kind,
        atStep: params.step,
        beforeTokens: params.beforeTokens,
        afterTokens,
        coveredCanonicalFrom: params.from,
        coveredCanonicalTo: params.to,
        summaryPreview: summaryPreviewFromText(summary),
        detail: {
          kind,
          trigger,
          summary,
          focus: params.focus?.trim() || undefined,
        },
      },
    }
  } catch (error) {
    const note = error instanceof Error ? error.message : String(error)
    const fallbackSummary = [
      '### 目标与约束',
      '原文压缩失败，仅保留省略标记。',
      '',
      '### 未解决问题 / 阻塞',
      `压缩器错误：${note}`,
      '',
      '### 续作提示',
      '请根据会话 UI 记录与近期消息继续；必要时重新读取关键文件。',
    ].join('\n')

    const afterTokens = Math.max(1, Math.ceil(fallbackSummary.length / 2.5))
    const compactionMessage = buildCompactionUserMessage({
      id,
      summary: fallbackSummary,
      coveredFrom: params.from,
      coveredTo: params.to,
      tokensBefore: params.beforeTokens,
      tokensAfter: afterTokens,
    })

    const kind = params.kind ?? 'llm_compact'
    const trigger = params.trigger ?? (kind === 'self_compact' ? 'self_compact' : 'hard')
    const failNote = `llm_compact_failed: ${note}`

    return {
      wire: [...params.prefix, compactionMessage, ...params.recent],
      summary: fallbackSummary,
      event: {
        id,
        kind,
        atStep: params.step,
        beforeTokens: params.beforeTokens,
        afterTokens,
        coveredCanonicalFrom: params.from,
        coveredCanonicalTo: params.to,
        summaryPreview: summaryPreviewFromText(fallbackSummary),
        note: failNote,
        detail: {
          kind,
          trigger,
          summary: fallbackSummary,
          focus: params.focus?.trim() || undefined,
          note: failNote,
        },
      },
    }
  }
}

function serializeTrajectoryForCompact(slice: ChatMessage[], contextWindow: number): string {
  return headTailSerializeCap(slice, Math.min(100_000, Math.floor(contextWindow * 0.4)))
}

// re-export helper used by tests
export { serializeTrajectoryForCompact }
