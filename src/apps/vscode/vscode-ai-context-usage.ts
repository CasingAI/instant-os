import type OpenAI from 'openai'
import { toChatCompletionTool, type AgentTool } from '../../ai/agent-tool.ts'
import {
  DEFAULT_MODEL_CONTEXT_WINDOW,
  findAiModelPreset,
  resolveModelEntryContextWindow,
  type AiProviderId,
} from '../../ai/ai-providers.ts'
import type { TokenizerFamily } from '../../ai/model-tokenizer.ts'
import { loadAccountSettings } from '../../os/account-settings-storage.ts'
import {
  loadVscodePrefs,
  VSCODE_AI_CONTEXT_WINDOW_PRESETS,
  type VscodeAiContextWindowPref,
} from './vscode-prefs.ts'
import {
  estimateTokensFromTextsAsync,
  prepareTokenEstimation,
  resolveUsageEstimated,
} from '../browser/estimate-token-usage.ts'
import {
  buildVscodeAiContextSection,
  buildVscodeAiSystemPrompt,
  type VscodeAiContextInput,
} from './vscode-ai-context.ts'
import { createVscodeAiTools, type VscodeAiToolsHost } from './vscode-ai-tools.ts'
import { wrapVscodeAiUserMessage } from './vscode-ai-system-reminder.ts'
import { buildOsDateTimeSystemSection } from '../../ai/os-datetime-system-context.ts'
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

/**
 * 解析上下文窗口：VS Code 本地覆盖 → 账户条目自动/手动配置 → 128K。
 */
export function resolveModelContextWindow(
  modelId: string | undefined,
  options?: {
    providerEntryId?: string
    providerId?: AiProviderId
    /** providerEntryId:modelId；用于读取 VS Code aiModelOptions.contextWindow */
    modelKey?: string
    aiModelOptions?: Record<string, { contextWindow?: VscodeAiContextWindowPref }>
  },
): number {
  const modelKey = options?.modelKey?.trim()
  if (modelKey) {
    const override =
      options?.aiModelOptions?.[modelKey]?.contextWindow ??
      loadVscodePrefs().aiModelOptions[modelKey]?.contextWindow
    if (
      typeof override === 'number' &&
      (VSCODE_AI_CONTEXT_WINDOW_PRESETS as readonly number[]).includes(override)
    ) {
      return override
    }
  }

  const id = modelId?.trim()
  if (!id) return DEFAULT_MODEL_CONTEXT_WINDOW

  const settings = loadAccountSettings()
  if (settings) {
    for (const provider of settings.providers) {
      if (
        options?.providerEntryId &&
        provider.id !== options.providerEntryId
      ) {
        continue
      }
      if (options?.providerId && provider.providerId !== options.providerId) {
        continue
      }
      const entry = provider.enabledModels.find((model) => model.modelId === id)
      if (entry) {
        return resolveModelEntryContextWindow(provider.providerId, entry)
      }
    }
  }

  if (options?.providerId) {
    const presetWindow = findAiModelPreset(options.providerId, id)?.contextWindow
    if (
      typeof presetWindow === 'number' &&
      Number.isFinite(presetWindow) &&
      Math.floor(presetWindow) >= 1
    ) {
      return Math.floor(presetWindow)
    }
  }

  return DEFAULT_MODEL_CONTEXT_WINDOW
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

type MeasureJob = {
  category: VscodeAiContextUsageCategoryId
  text: string
  overhead: number
}

export async function measureVscodeAiContextUsage(options: {
  mode: VscodeAiMode
  context: VscodeAiContextInput
  history?: OpenAI.Chat.ChatCompletionMessageParam[]
  userMessage?: string
  /** 与 askVscodeAiAgent 一致：本轮 system-reminder 正文（可为空） */
  reminderText?: string
  /** 若 userMessage 已是 wrap 后的内容，则不再二次 wrap */
  userMessageAlreadyWrapped?: boolean
  model?: string
  providerEntryId?: string
  providerId?: AiProviderId
  /** providerEntryId:modelId；用于 VS Code 本地上下文覆盖 */
  modelKey?: string
  tokenizerFamily?: TokenizerFamily
  /** 传入则跳过 createVscodeAiTools（避免无 host 时无法计量） */
  tools?: AgentTool[]
  toolsHost?: VscodeAiToolsHost
}): Promise<VscodeAiContextUsage> {
  const model = options.model
  const tokenizerFamily = options.tokenizerFamily
  const buckets = emptyBuckets()
  const jobs: MeasureJob[] = []

  const systemPrompt = buildVscodeAiSystemPrompt(options.mode)
  const workspaceSection = buildVscodeAiContextSection(options.context)
  jobs.push({ category: 'system', text: systemPrompt, overhead: 4 })
  jobs.push({ category: 'workspace', text: workspaceSection, overhead: 8 })
  // 与 runAgent 入口注入的 OS 时间段对齐，避免占用环少计
  jobs.push({ category: 'system', text: buildOsDateTimeSystemSection(), overhead: 4 })

  const tools =
    options.tools ??
    (options.toolsHost
      ? createVscodeAiTools(options.mode, options.toolsHost)
      : undefined)
  if (tools && tools.length > 0) {
    const toolsJson = JSON.stringify(tools.map(toChatCompletionTool))
    jobs.push({
      category: 'tools',
      text: toolsJson,
      overhead: tools.length * 4,
    })
  }

  for (const message of options.history ?? []) {
    const reasoning = assistantReasoningText(message)
    if (reasoning) {
      jobs.push({ category: 'reasoning', text: reasoning, overhead: 0 })
    }
    const text = messagePlainText(message)
    if (!text) continue
    // 历史里可能夹带旧 system；归入 conversation，避免与本次 system 重复归类
    const category =
      message.role === 'system' ? 'conversation' : categorizeHistoryMessage(message)
    jobs.push({ category, text, overhead: 4 })
  }

  const rawUser = options.userMessage?.trim()
  if (rawUser) {
    const userMessage = options.userMessageAlreadyWrapped
      ? rawUser
      : wrapVscodeAiUserMessage(rawUser, options.reminderText ?? '')
    jobs.push({ category: 'conversation', text: userMessage, overhead: 4 })
  }

  const counts = await estimateTokensFromTextsAsync(
    jobs.map((job) => job.text),
    model,
    { tokenizerFamily },
  )
  for (let index = 0; index < jobs.length; index += 1) {
    const job = jobs[index]!
    const tokens = job.text ? counts[index]! : 0
    buckets[job.category] += tokens + job.overhead
  }

  const breakdown = toBreakdown(buckets)
  const totalTokens = breakdown.reduce((sum, item) => sum + item.tokens, 0)

  return {
    totalTokens,
    contextWindow: resolveModelContextWindow(model, {
      providerEntryId: options.providerEntryId,
      providerId: options.providerId,
      modelKey: options.modelKey,
    }),
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
