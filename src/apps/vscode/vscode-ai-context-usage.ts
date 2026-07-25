import type OpenAI from 'openai'
import { toChatCompletionTool, type AgentTool } from '../../ai/agent-tool.ts'
import type { TokenizerFamily } from '../../ai/model-tokenizer.ts'
import {
  estimateTokensFromText,
  prepareTokenEstimation,
  resolveUsageEstimated,
} from '../browser/estimate-token-usage.ts'
import {
  buildVscodeAiContextSection,
  buildVscodeAiSystemPrompt,
  type VscodeAiContextInput,
} from './vscode-ai-context.ts'
import { createVscodeAiTools, type VscodeAiToolsHost } from './vscode-ai-tools.ts'
import type { VscodeAiMode } from './vscode-ai-mode.ts'

export type VscodeAiContextUsageCategoryId =
  | 'system'
  | 'workspace'
  | 'tools'
  | 'conversation'
  | 'toolMessages'
  | 'reasoning'

export type VscodeAiContextUsageCategory = {
  id: VscodeAiContextUsageCategoryId
  label: string
  color: string
  tokens: number
}

export type VscodeAiContextUsage = {
  totalTokens: number
  contextWindow: number
  /** true = 字符粗估或未校准；本地 tokenizer / API 校准后为 false */
  estimated: boolean
  breakdown: VscodeAiContextUsageCategory[]
}

const CATEGORY_META: Record<
  VscodeAiContextUsageCategoryId,
  { label: string; color: string }
> = {
  system: { label: '系统提示词', color: '#8b8b95' },
  workspace: { label: '工作区快照', color: '#5b9f6a' },
  tools: { label: '工具定义', color: '#a78bfa' },
  conversation: { label: '对话内容', color: '#f0a050' },
  toolMessages: { label: '工具消息', color: '#e879a8' },
  reasoning: { label: '思维链', color: '#6cb6ff' },
}

/** 常见模型上下文窗口；未知模型回退 128K，仅用于占用百分比展示 */
const MODEL_CONTEXT_WINDOWS: Record<string, number> = {
  'deepseek-v4-flash': 128_000,
  'deepseek-v4-pro': 128_000,
  'gpt-5.5': 256_000,
  'gpt-5.4': 256_000,
  'gpt-5.4-mini': 256_000,
  'gpt-5.4-nano': 256_000,
  'gpt-4.1': 1_047_576,
  'gpt-4.1-mini': 1_047_576,
  'gpt-4o': 128_000,
  'gpt-4o-mini': 128_000,
  'mimo-v2.5-pro': 256_000,
  'mimo-v2.5-pro-ultraspeed': 256_000,
  'mimo-v2-pro': 256_000,
  'mimo-v2.5': 256_000,
  'mimo-v2-flash': 128_000,
  'mimo-v2-omni': 128_000,
}

const DEFAULT_CONTEXT_WINDOW = 128_000

export function resolveModelContextWindow(modelId: string | undefined): number {
  const id = modelId?.trim().toLowerCase()
  if (!id) return DEFAULT_CONTEXT_WINDOW
  const exact = MODEL_CONTEXT_WINDOWS[id]
  if (exact) return exact
  if (id.startsWith('deepseek')) return 128_000
  if (id.startsWith('gpt-4.1')) return 1_047_576
  if (id.startsWith('gpt-5')) return 256_000
  if (id.startsWith('gpt-4o')) return 128_000
  if (id.startsWith('mimo-v2.5') || id.startsWith('mimo-v2-5')) return 256_000
  if (id.startsWith('mimo')) return 128_000
  return DEFAULT_CONTEXT_WINDOW
}

function estimate(
  text: string,
  model: string | undefined,
  tokenizerFamily?: TokenizerFamily,
): number {
  if (!text) return 0
  return estimateTokensFromText(text, model, { tokenizerFamily })
}

function contentToText(content: unknown): string {
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

function messagePlainText(message: OpenAI.Chat.ChatCompletionMessageParam): string {
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
    return parts.join('\n')
  }
  if ('content' in message) {
    return contentToText(message.content)
  }
  return ''
}

function assistantReasoningText(message: OpenAI.Chat.ChatCompletionMessageParam): string {
  if (message.role !== 'assistant') return ''
  const reasoning = (message as { reasoning_content?: unknown }).reasoning_content
  return typeof reasoning === 'string' ? reasoning : ''
}

function categorizeHistoryMessage(
  message: OpenAI.Chat.ChatCompletionMessageParam,
): VscodeAiContextUsageCategoryId {
  if (message.role === 'tool') return 'toolMessages'
  if (message.role === 'assistant') {
    const hasToolCalls =
      'tool_calls' in message && Array.isArray(message.tool_calls) && message.tool_calls.length > 0
    if (hasToolCalls) return 'toolMessages'
    return 'conversation'
  }
  return 'conversation'
}

function emptyBuckets(): Record<VscodeAiContextUsageCategoryId, number> {
  return {
    system: 0,
    workspace: 0,
    tools: 0,
    conversation: 0,
    toolMessages: 0,
    reasoning: 0,
  }
}

function toBreakdown(
  buckets: Record<VscodeAiContextUsageCategoryId, number>,
): VscodeAiContextUsageCategory[] {
  const order: VscodeAiContextUsageCategoryId[] = [
    'system',
    'workspace',
    'tools',
    'conversation',
    'toolMessages',
    'reasoning',
  ]
  return order
    .filter((id) => buckets[id] > 0)
    .map((id) => ({
      id,
      label: CATEGORY_META[id].label,
      color: CATEGORY_META[id].color,
      tokens: buckets[id],
    }))
}

export function measureVscodeAiContextUsage(options: {
  mode: VscodeAiMode
  context: VscodeAiContextInput
  history?: OpenAI.Chat.ChatCompletionMessageParam[]
  userMessage?: string
  model?: string
  tokenizerFamily?: TokenizerFamily
  /** 传入则跳过 createVscodeAiTools（避免无 host 时无法计量） */
  tools?: AgentTool[]
  toolsHost?: VscodeAiToolsHost
}): VscodeAiContextUsage {
  const model = options.model
  const tokenizerFamily = options.tokenizerFamily
  const buckets = emptyBuckets()

  const systemPrompt = buildVscodeAiSystemPrompt(options.mode)
  const workspaceSection = buildVscodeAiContextSection(options.context)
  buckets.system = estimate(systemPrompt, model, tokenizerFamily) + 4
  buckets.workspace = estimate(workspaceSection, model, tokenizerFamily) + 8

  const tools =
    options.tools ??
    (options.toolsHost
      ? createVscodeAiTools(options.mode, options.toolsHost)
      : undefined)
  if (tools && tools.length > 0) {
    const toolsJson = JSON.stringify(tools.map(toChatCompletionTool))
    buckets.tools = estimate(toolsJson, model, tokenizerFamily) + tools.length * 4
  }

  for (const message of options.history ?? []) {
    const reasoning = assistantReasoningText(message)
    if (reasoning) {
      buckets.reasoning += estimate(reasoning, model, tokenizerFamily)
    }
    const text = messagePlainText(message)
    if (!text) continue
    // 历史里可能夹带旧 system；归入 conversation，避免与本次 system 重复归类
    const category =
      message.role === 'system' ? 'conversation' : categorizeHistoryMessage(message)
    buckets[category] += estimate(text, model, tokenizerFamily) + 4
  }

  const userMessage = options.userMessage?.trim()
  if (userMessage) {
    buckets.conversation += estimate(userMessage, model, tokenizerFamily) + 4
  }

  const breakdown = toBreakdown(buckets)
  const totalTokens = breakdown.reduce((sum, item) => sum + item.tokens, 0)

  return {
    totalTokens,
    contextWindow: resolveModelContextWindow(model),
    estimated: resolveUsageEstimated(false, model, tokenizerFamily),
    breakdown,
  }
}

/** 用 API 返回的 prompt_tokens 校准总量，并按比例缩放分项 */
export function calibrateVscodeAiContextUsage(
  usage: VscodeAiContextUsage,
  actualPromptTokens: number,
): VscodeAiContextUsage {
  if (actualPromptTokens <= 0) {
    return usage
  }
  if (usage.totalTokens <= 0 || usage.breakdown.length === 0) {
    return {
      ...usage,
      totalTokens: actualPromptTokens,
      estimated: false,
      breakdown:
        usage.breakdown.length > 0
          ? usage.breakdown
          : [
              {
                id: 'conversation',
                label: CATEGORY_META.conversation.label,
                color: CATEGORY_META.conversation.color,
                tokens: actualPromptTokens,
              },
            ],
    }
  }

  const scale = actualPromptTokens / usage.totalTokens
  const breakdown = usage.breakdown.map((item) => ({
    ...item,
    tokens: Math.max(0, Math.round(item.tokens * scale)),
  }))
  const sum = breakdown.reduce((acc, item) => acc + item.tokens, 0)
  const drift = actualPromptTokens - sum
  if (drift !== 0 && breakdown.length > 0) {
    let largest = breakdown[0]
    for (const item of breakdown) {
      if (item.tokens >= largest.tokens) largest = item
    }
    largest.tokens += drift
  }

  return {
    ...usage,
    totalTokens: actualPromptTokens,
    estimated: false,
    breakdown,
  }
}

/**
 * 多步 Agent：首轮用比例校准；后续 prompt 增长记入 Tool messages
 *（工具结果进入下一轮上下文，最符合实际膨胀来源）。
 */
export function applyVscodeAiPromptTokenUpdate(
  usage: VscodeAiContextUsage,
  actualPromptTokens: number,
  alreadyCalibrated: boolean,
): { usage: VscodeAiContextUsage; calibrated: boolean } {
  if (actualPromptTokens <= 0) {
    return { usage, calibrated: alreadyCalibrated }
  }
  if (!alreadyCalibrated) {
    return {
      usage: calibrateVscodeAiContextUsage(usage, actualPromptTokens),
      calibrated: true,
    }
  }

  const growth = actualPromptTokens - usage.totalTokens
  if (growth === 0) {
    return {
      usage: { ...usage, estimated: false },
      calibrated: true,
    }
  }

  if (growth < 0) {
    return {
      usage: calibrateVscodeAiContextUsage(usage, actualPromptTokens),
      calibrated: true,
    }
  }

  const breakdown = usage.breakdown.map((item) => ({ ...item }))
  const toolIndex = breakdown.findIndex((item) => item.id === 'toolMessages')
  if (toolIndex >= 0) {
    breakdown[toolIndex] = {
      ...breakdown[toolIndex],
      tokens: breakdown[toolIndex].tokens + growth,
    }
  } else {
    breakdown.push({
      id: 'toolMessages',
      label: CATEGORY_META.toolMessages.label,
      color: CATEGORY_META.toolMessages.color,
      tokens: growth,
    })
  }

  return {
    usage: {
      ...usage,
      totalTokens: actualPromptTokens,
      estimated: false,
      breakdown,
    },
    calibrated: true,
  }
}

export async function prepareVscodeAiContextUsage(
  model?: string,
  tokenizerFamily?: TokenizerFamily,
): Promise<void> {
  await prepareTokenEstimation(model, tokenizerFamily)
}
