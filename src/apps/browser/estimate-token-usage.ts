import {
  countTokensWithModelTokenizer,
  isModelTokenizerReady,
  prepareTokenEstimation,
  type TokenizerFamily,
} from '../../ai/model-tokenizer.ts'
import { DEFAULT_CHARS_PER_TOKEN, getCharsPerToken } from '../../ai/token-chars-ratio.ts'

export { prepareTokenEstimation }

export type EstimateTokenOptions = {
  /** 估算时字符/token 的下限（例如 HTML 流式输出用更高下限，避免角标虚高） */
  minCharsPerToken?: number
  /** 词表族覆盖（自定义模型手动指定时） */
  tokenizerFamily?: TokenizerFamily
}

function estimateTokensFromChars(
  text: string,
  model: string | undefined,
  options: EstimateTokenOptions | undefined,
): number {
  const charsPerToken = Math.max(
    getCharsPerToken(model) || DEFAULT_CHARS_PER_TOKEN,
    options?.minCharsPerToken ?? 0,
  )
  return Math.max(1, Math.ceil(text.length / charsPerToken))
}

/** 有本地词表且已 hydrate 时精确计数；否则用字符粗估（可带 minCharsPerToken） */
export function estimateTokensFromText(
  text: string,
  model?: string,
  options?: EstimateTokenOptions,
): number {
  if (!text) {
    return 0
  }
  const precise = countTokensWithModelTokenizer(
    text,
    model,
    options?.tokenizerFamily,
  )
  if (precise !== undefined) {
    return Math.max(1, precise)
  }
  return estimateTokensFromChars(text, model, options)
}

export function estimatePromptTokens(
  systemPrompt: string,
  userPrompt: string,
  model?: string,
  options?: EstimateTokenOptions,
): number {
  const content =
    estimateTokensFromText(systemPrompt, model, options) +
    estimateTokensFromText(userPrompt, model, options)
  return content + 8
}

/**
 * 是否应在 UI 上标「约 / ~」：
 * - 已有 API usage → 否
 * - 本地 tokenizer 已就绪 → 否（精确分词）
 * - 否则字符粗估 → 是
 */
export function resolveUsageEstimated(
  hasApiUsage: boolean,
  model?: string,
  tokenizerFamily?: TokenizerFamily,
): boolean {
  if (hasApiUsage) {
    return false
  }
  return !isModelTokenizerReady(model, tokenizerFamily)
}

export type LiveTokenUsage = {
  promptTokens: number
  completionTokens: number
  totalTokens: number
  /** true = 字符等粗估（UI 可显示 ~）；tokenizer / API 为 false */
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
    estimated: estimated && resolveUsageEstimated(false, model),
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
