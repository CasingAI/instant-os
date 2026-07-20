import { DEFAULT_CHARS_PER_TOKEN, getCharsPerToken } from '../../ai/token-chars-ratio.ts'

export type EstimateTokenOptions = {
  /** 估算时字符/token 的下限（例如 HTML 流式输出用更高下限，避免角标虚高） */
  minCharsPerToken?: number
}

/** 流式阶段用字符数粗估 token；有足够历史真实用量时按模型学习比例，否则回退约 3.5 字符 / token */
export function estimateTokensFromText(
  text: string,
  model?: string,
  options?: EstimateTokenOptions,
): number {
  if (!text) {
    return 0
  }
  const charsPerToken = Math.max(
    getCharsPerToken(model) || DEFAULT_CHARS_PER_TOKEN,
    options?.minCharsPerToken ?? 0,
  )
  return Math.max(1, Math.ceil(text.length / charsPerToken))
}

export function estimatePromptTokens(
  systemPrompt: string,
  userPrompt: string,
  model?: string,
): number {
  const content =
    estimateTokensFromText(systemPrompt, model) + estimateTokensFromText(userPrompt, model)
  return content + 8
}

export type LiveTokenUsage = {
  promptTokens: number
  completionTokens: number
  totalTokens: number
  estimated: boolean
}

/** 网页 completion 多为 HTML，字符/token 通常高于中文对话默认；仅作无真实 usage 时的粗估下限 */
export const HTML_COMPLETION_MIN_CHARS_PER_TOKEN = 5.5

export function buildLiveTokenUsage(
  promptTokens: number,
  completionText: string,
  estimated = true,
  model?: string,
  options?: EstimateTokenOptions,
): LiveTokenUsage {
  const completionTokens = estimateTokensFromText(completionText, model, options)
  return {
    promptTokens,
    completionTokens,
    totalTokens: promptTokens + completionTokens,
    estimated,
  }
}

export function finalizeTokenUsage(
  live: LiveTokenUsage,
  actual: { promptTokens: number; completionTokens: number; totalTokens: number } | undefined,
): LiveTokenUsage {
  if (!actual || actual.totalTokens <= 0) {
    return live
  }

  return {
    promptTokens: actual.promptTokens,
    completionTokens: actual.completionTokens,
    totalTokens: actual.totalTokens,
    estimated: false,
  }
}
