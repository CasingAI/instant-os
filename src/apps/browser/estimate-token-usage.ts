/** 流式阶段用字符数粗估 token（HTML 混合内容约 3~4 字符 / token） */
export function estimateTokensFromText(text: string): number {
  if (!text) {
    return 0
  }
  return Math.max(1, Math.ceil(text.length / 3.5))
}

export function estimatePromptTokens(systemPrompt: string, userPrompt: string): number {
  const content = estimateTokensFromText(systemPrompt) + estimateTokensFromText(userPrompt)
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
): LiveTokenUsage {
  const completionTokens = estimateTokensFromText(completionText)
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
