export function formatTokenCount(count: number): string {
  return count.toLocaleString('zh-CN')
}

/** 角标等紧凑展示：千用 K，百万起用 M，一律整数。 */
export function formatCompactTokenCount(count: number): string {
  if (count >= 1_000_000) {
    return `${Math.round(count / 1_000_000)}M`
  }
  if (count >= 1_000) {
    return `${Math.round(count / 1_000)}K`
  }
  return String(Math.round(count))
}
