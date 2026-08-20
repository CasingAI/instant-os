/** AttuneBench LLM 客户端（封装 streamChatCompletion，接入用量统计） */

import { streamChatCompletion } from '../../ai/stream-chat.ts'
import { loadAccountSettings, openAiConfigForModelRef } from '../../os/account-settings-storage.ts'
import type { Emessage } from './prompts.ts'
import { extractJson } from './utils.ts'
import type OpenAI from 'openai'

/** 将 modelRefKey（providerEntryId:modelId）解析为 OpenAI 配置覆盖 */
export function resolveModelConfigOverride(
  modelRefKey: string,
): Partial<import('../../ai/openai-config.ts').OpenAiConfig> | undefined {
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

export type ChatEmOptions = {
  messages: Emessage[]
  modelRefKey: string
  maxTokens?: number
  signal?: AbortSignal
}

/** 单次 LLM 调用：返回解析出的 JSON 对象 */
export async function callEmAndExtractJson(options: ChatEmOptions): Promise<Record<string, unknown>> {
  const modelOverride = resolveModelConfigOverride(options.modelRefKey)
  const raw = await streamChatCompletion({
    system: '',
    user: '',
    messages: options.messages as unknown as OpenAI.Chat.ChatCompletionMessageParam[],
    config: modelOverride,
    maxCompletionTokens: options.maxTokens,
    signal: options.signal,
    usageContext: {
      actor: 'attunebench',
      behavior: 'eval',
      behaviorLabel: 'AI 评测',
    },
    onChunk: () => undefined,
    allowEmpty: true,
  })
  return extractJson(raw)
}

/** 带验证器与重试的 LLM 调用（验证器返回 false 则重试；已中断则不再重试） */
export async function callEm(
  options: ChatEmOptions,
  maxRetries = 3,
  validator?: (data: Record<string, unknown>) => boolean,
): Promise<Record<string, unknown>> {
  let lastError: unknown
  for (let attempt = 0; attempt < maxRetries; attempt += 1) {
    if (options.signal?.aborted) {
      throw new DOMException('已中断', 'AbortError')
    }
    try {
      const result = await callEmAndExtractJson(options)
      if (validator && !validator(result)) {
        throw new Error('Validator rejected extracted JSON')
      }
      return result
    } catch (error) {
      if (options.signal?.aborted) {
        throw new DOMException('已中断', 'AbortError')
      }
      lastError = error
      if (attempt < maxRetries - 1) {
        await new Promise((resolve) => setTimeout(resolve, 1000 * attempt + 1000))
      }
    }
  }
  throw lastError
}

/** 待评测模型的显示名（modelRefKey） */
export function modelDisplayName(modelRefKey: string): string {
  const separator = modelRefKey.indexOf(':')
  return separator > 0 ? modelRefKey.slice(separator + 1) : modelRefKey
}
