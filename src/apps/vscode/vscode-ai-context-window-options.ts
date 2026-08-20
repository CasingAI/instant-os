import { formatCompactTokenCount } from '../browser/format-token-count.ts'

/** 相对间距低于此比值视为过近（保留更有意义的一档） */
export const CONTEXT_WINDOW_NEAR_RATIO = 1.3

/** 上下文选项专用标签：≥1M 非整百万用一位小数，避免 1M / 1.05M 撞车 */
export function formatContextWindowTokenLabel(tokens: number): string {
  if (tokens >= 1_000_000) {
    const millions = tokens / 1_000_000
    if (Number.isInteger(millions)) return `${millions}M`
    return `${(Math.round(millions * 10) / 10).toFixed(1)}M`
  }
  return formatCompactTokenCount(tokens)
}

function preferCloserContextWindow(
  a: number,
  b: number,
  systemTokens: number,
  presetTokens: number | undefined,
): number {
  const score = (value: number) => {
    if (value === systemTokens) return 2
    if (presetTokens !== undefined && value === presetTokens) return 1
    return 0
  }
  const scoreA = score(a)
  const scoreB = score(b)
  if (scoreA !== scoreB) return scoreA > scoreB ? a : b
  return Math.max(a, b)
}

/**
 * 升序合并过近档位（next/prev < 1.3）与同 label 项。
 * 优先保留：等于系统值 > 等于内置预设 > 较大值。
 */
export function mergeNearContextWindowPresets(
  values: readonly number[],
  systemTokens: number,
  presetTokens?: number,
): number[] {
  const sorted = [...new Set(values.filter((v) => v >= 1))].sort((a, b) => a - b)
  const merged: number[] = []
  for (const value of sorted) {
    const prev = merged[merged.length - 1]
    if (prev === undefined) {
      merged.push(value)
      continue
    }
    const near = value / prev < CONTEXT_WINDOW_NEAR_RATIO
    const sameLabel =
      formatContextWindowTokenLabel(value) === formatContextWindowTokenLabel(prev)
    if (near || sameLabel) {
      merged[merged.length - 1] = preferCloserContextWindow(
        prev,
        value,
        systemTokens,
        presetTokens,
      )
      continue
    }
    merged.push(value)
  }
  return merged
}

/**
 * 按系统上限与过近规则生成手动档位列表（不含 system）。
 * catalog 一般为 VSCODE_AI_CONTEXT_WINDOW_PRESETS。
 */
export function buildVscodeAiContextWindowManualPresets(params: {
  systemTokens: number
  catalog: readonly number[]
  presetTokens?: number
  currentOverride?: number
}): number[] {
  const { systemTokens, catalog, presetTokens, currentOverride } = params
  const candidates = catalog.filter((value) => value <= systemTokens)
  if (
    typeof currentOverride === 'number' &&
    currentOverride >= 1 &&
    !candidates.includes(currentOverride)
  ) {
    candidates.push(currentOverride)
  }
  return mergeNearContextWindowPresets(candidates, systemTokens, presetTokens)
}
