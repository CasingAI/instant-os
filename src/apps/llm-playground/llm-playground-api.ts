import { useEffect, useMemo, useState } from 'preact/hooks'
import {
  listEnabledModelsForCapability,
  type FlatEnabledModel,
} from '../../ai/ai-providers.ts'
import { isAiReasoningEffort } from '../../ai/ai-thinking.ts'
import { subscribeOpenAiConfig } from '../../ai/openai-config-events.ts'
import { streamChatCompletion } from '../../ai/stream-chat.ts'
import {
  loadAccountSettings,
  openAiConfigForModelRef,
} from '../../os/account-settings-storage.ts'
import {
  buildPlaygroundMessages,
  parsePlaygroundStopSequence,
} from './llm-playground-messages.ts'
import type { LlmPlaygroundConfig, LlmPlaygroundMessage } from './llm-playground-types.ts'

/** 列出账户中所有已启用的文本模型，供 playground 选择 */
export function listPlaygroundTextModels(): FlatEnabledModel[] {
  const settings = loadAccountSettings()
  if (!settings || settings.providers.length === 0) return []
  return listEnabledModelsForCapability(settings.providers, 'text')
}

export function usePlaygroundTextModels(): FlatEnabledModel[] {
  const [revision, setRevision] = useState(0)
  useEffect(() => subscribeOpenAiConfig(() => setRevision((value) => value + 1)), [])
  return useMemo(() => {
    void revision
    return listPlaygroundTextModels()
  }, [revision])
}

/** 按消息列表构建 OpenAI 兼容的纯文本消息数组（跳过空内容） */
export { buildPlaygroundMessages, parsePlaygroundStopSequence } from './llm-playground-messages.ts'

/**
 * 把模型引用键解析为 OpenAI 配置覆盖（API Key / baseURL / model 等）。
 * 找不到或未配置时返回 undefined，由调用方回落到账户首选模型。
 */
function resolveModelConfigOverride(modelRefKey: string): Partial<import('../../ai/openai-config.ts').OpenAiConfig> | undefined {
  if (!modelRefKey) return undefined
  const separator = modelRefKey.indexOf(':')
  if (separator <= 0) return undefined
  const ref = {
    providerEntryId: modelRefKey.slice(0, separator),
    modelId: modelRefKey.slice(separator + 1),
  }
  const settings = loadAccountSettings()
  if (!settings) return undefined
  return openAiConfigForModelRef(settings, ref, 'text')
}

export type RunPlaygroundCompletionOptions = {
  messages: LlmPlaygroundMessage[]
  config: LlmPlaygroundConfig
  onChunk: (delta: string, accumulated: string) => void
  onReasoningChunk?: (delta: string, accumulated: string) => void
  signal?: AbortSignal
}

/** 发送 playground 请求：任意消息数组 + 采样参数，走统一用量统计与事件日志 */
export async function runPlaygroundCompletion(
  options: RunPlaygroundCompletionOptions,
): Promise<string> {
  const { messages, config } = options
  const modelOverride = resolveModelConfigOverride(config.modelRefKey)
  const thinkingEffort =
    config.thinkingEffort === 'default'
      ? undefined
      : isAiReasoningEffort(config.thinkingEffort)
        ? config.thinkingEffort
        : undefined

  return streamChatCompletion({
    system: '',
    user: '',
    messages: buildPlaygroundMessages(messages),
    config: {
      ...modelOverride,
      ...(thinkingEffort ? { thinkingEffort } : {}),
    },
    thinkingEnabled: config.thinkingEnabled,
    temperature: config.temperature ?? undefined,
    topP: config.topP ?? undefined,
    frequencyPenalty: config.frequencyPenalty ?? undefined,
    presencePenalty: config.presencePenalty ?? undefined,
    maxCompletionTokens: config.maxTokens ?? undefined,
    stop: parsePlaygroundStopSequence(config.stop),
    usageContext: {
      actor: 'llm-playground',
      behavior: 'playground-chat',
      behaviorLabel: 'Playground 对话',
    },
    onChunk: options.onChunk,
    onReasoningChunk: options.onReasoningChunk,
    signal: options.signal,
    allowTruncation: true,
  })
}
