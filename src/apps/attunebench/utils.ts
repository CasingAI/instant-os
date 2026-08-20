/** AttuneBench 工具函数（移植自官方 attunebench/utils.py） */

import {
  BINARY_VALUE_OPTIONS,
  FOUR_BRANCH_MAX,
  FOUR_BRANCH_MIN,
  MOOD_INTENSITY_MAX,
  MOOD_INTENSITY_MIN,
  PAIRWISE_WINNERS,
  PANAS_TOTAL_MAX,
  PANAS_TOTAL_MIN,
} from './constants.ts'

/** 从 LLM 输出文本中提取 JSON 对象（多策略） */
export function extractJson(text: string): Record<string, unknown> {
  const stripped = text.trim()

  // Strategy 1: direct parse
  try {
    const result = JSON.parse(stripped)
    if (isRecord(result)) return result
    if (Array.isArray(result) && result.length >= 1 && isRecord(result[0])) {
      return result[0]
    }
  } catch {
    // fall through
  }

  // Strategy 2: fenced code block
  const fenceMatch = stripped.match(/```(?:json)?\s*\n?([\s\S]*?)\n?\s*```/)
  if (fenceMatch) {
    try {
      const result = JSON.parse(fenceMatch[1].trim())
      if (isRecord(result)) return result
    } catch {
      // fall through
    }
  }

  // Strategy 3: first { ... } block (greedy)
  const braceStart = stripped.indexOf('{')
  if (braceStart >= 0) {
    const braceEnd = stripped.lastIndexOf('}')
    if (braceEnd > braceStart) {
      const candidate = stripped.slice(braceStart, braceEnd + 1)
      try {
        const result = JSON.parse(candidate)
        if (isRecord(result)) return result
      } catch {
        // Strategy 4: fix unescaped newlines
        try {
          const result = JSON.parse(fixUnescapedNewlines(candidate))
          if (isRecord(result)) return result
        } catch {
          // fall through
        }
      }
    }
  }

  throw new Error(`Could not extract JSON from text: ${stripped.slice(0, 200)}...`)
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

/** 修复 JSON 字符串值内的未转义换行 */
export function fixUnescapedNewlines(text: string): string {
  let inString = false
  let escapeNext = false
  let result = ''
  for (const ch of text) {
    if (escapeNext) {
      result += ch
      escapeNext = false
      continue
    }
    if (ch === '\\') {
      escapeNext = true
      result += ch
      continue
    }
    if (ch === '"') {
      inString = !inString
      result += ch
      continue
    }
    if (inString && ch === '\n') {
      result += '\\n'
      continue
    }
    result += ch
  }
  return result
}

/** 带指数退避的重试包装器 */
export async function retryAsync<T>(
  fn: () => Promise<T>,
  maxRetries = 3,
  delayMs = 1000,
  backoff = 2,
): Promise<T> {
  let lastError: unknown
  let currentDelay = delayMs
  for (let attempt = 0; attempt < maxRetries; attempt += 1) {
    try {
      return await fn()
    } catch (error) {
      lastError = error
      if (attempt < maxRetries - 1) {
        await sleep(currentDelay)
        currentDelay *= backoff
      }
    }
  }
  throw lastError
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

/** 将任意值归一化到 yes/no/na 标签空间 */
export function normalizeBinaryValue(value: unknown): 'yes' | 'no' | 'na' | null {
  if (value === null || value === undefined) return null
  if (typeof value === 'boolean') return value ? 'yes' : 'no'

  const text = String(value).trim().toLowerCase()
  if (['true', 'yes', 'y', '1'].includes(text)) return 'yes'
  if (['false', 'no', 'n', '0'].includes(text)) return 'no'
  if (['na', 'n/a', 'not_applicable'].includes(text)) return 'na'
  if (!text) return null
  if ((BINARY_VALUE_OPTIONS as readonly string[]).includes(text)) {
    return text as 'yes' | 'no' | 'na'
  }
  return null
}

/** 仅当值为可用的 yes/no 时返回 true */
export function isAnsweredBinary(value: unknown): boolean {
  const normalized = normalizeBinaryValue(value)
  return normalized === 'yes' || normalized === 'no'
}

/** 归一化两两比较胜者到 A/B */
export function normalizePairwiseWinner(value: unknown): 'A' | 'B' | null {
  if (value === null || value === undefined) return null

  const text = String(value).trim()
  if ((PAIRWISE_WINNERS as readonly string[]).includes(text)) {
    return text as 'A' | 'B'
  }

  const lowered = text.toLowerCase()
  if (['response_1', 'a'].includes(lowered)) return 'A'
  if (['response_2', 'b'].includes(lowered)) return 'B'
  if (!lowered) return null
  return null
}

/** 归一化情绪强度到 1-7 整数 */
export function normalizeMoodIntensity(value: unknown): number | null {
  if (value === null || value === undefined || value === '' || value === 'None') {
    return null
  }

  if (typeof value === 'string') {
    const lowered = value.trim().toLowerCase()
    if (lowered === 'mild') return 2
    if (lowered === 'moderate') return 4
    if (lowered === 'intense') return 6
    if (/^\d+$/.test(lowered)) {
      value = parseInt(lowered, 10)
    }
  }

  const intensity = Number(value)
  if (!Number.isFinite(intensity)) {
    throw new Error(`Unsupported mood intensity: ${String(value)}`)
  }
  return Math.max(MOOD_INTENSITY_MIN, Math.min(MOOD_INTENSITY_MAX, Math.round(intensity)))
}

/** 将 PANAS 聚合值 clamp 到 10-70，非法值返回 default */
export function clampPanasTotal(value: unknown, default_: number | null = null): number | null {
  if (value === null || value === undefined || value === '' || value === 'None') {
    return default_
  }
  const total = Number(value)
  if (!Number.isFinite(total)) {
    throw new Error(`Unsupported PANAS total: ${String(value)}`)
  }
  return Math.max(PANAS_TOTAL_MIN, Math.min(PANAS_TOTAL_MAX, Math.round(total)))
}

/** 将四分支分数 clamp 到 1-7，非法值返回 default */
export function clampFourBranchScore(
  value: unknown,
  default_: number | null = null,
): number | null {
  if (value === null || value === undefined || value === '' || value === 'None') {
    return default_
  }
  const score = Number(value)
  if (!Number.isFinite(score)) {
    throw new Error(`Unsupported four-branch score: ${String(value)}`)
  }
  return Math.max(FOUR_BRANCH_MIN, Math.min(FOUR_BRANCH_MAX, score))
}

/** 计算 token 级 Jaccard 相似度 */
export function tokenJaccard(a: string, b: string): number {
  const tokensA = new Set(a.toLowerCase().split(/\s+/).filter(Boolean))
  const tokensB = new Set(b.toLowerCase().split(/\s+/).filter(Boolean))
  if (tokensA.size === 0 && tokensB.size === 0) return 1.0
  if (tokensA.size === 0 || tokensB.size === 0) return 0.0
  let intersection = 0
  for (const token of tokensA) {
    if (tokensB.has(token)) intersection += 1
  }
  return intersection / (tokensA.size + tokensB.size - intersection)
}

/** 归一化情绪标签（小写、去空白） */
export function normalizeEmotion(tag: string): string {
  return tag.trim().toLowerCase()
}

/** 命中率：|predicted ∩ ground_truth| / |ground_truth| */
export function setHitRate(predicted: Set<string>, groundTruth: Set<string>): number {
  if (groundTruth.size === 0) {
    return predicted.size === 0 ? 1.0 : 0.0
  }
  let hit = 0
  for (const item of predicted) {
    if (groundTruth.has(item)) hit += 1
  }
  return hit / groundTruth.size
}
