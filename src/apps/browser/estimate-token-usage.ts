import { DEFAULT_CHARS_PER_TOKEN, getCharsPerToken } from '../../ai/token-chars-ratio.ts'

/** 流式阶段用字符数粗估 token；有足够历史真实用量时按模型学习比例，否则回退约 3.5 字符 / token */
export function estimateTokensFromText(text: string, model?: string): number {
  if (!text) {
    return 0
  }
  const charsPerToken = getCharsPerToken(model) || DEFAULT_CHARS_PER_TOKEN
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

export function buildLiveTokenUsage(
  promptTokens: number,
  completionText: string,
  estimated = true,
  model?: string,
): LiveTokenUsage {
  const completionTokens = estimateTokensFromText(completionText, model)
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
