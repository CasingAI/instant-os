/** 面向用户的中文时长文案（秒 / 分 / 小时）。 */
export function formatHumanDurationMs(durationMs: number): string {
  if (durationMs < 1000) {
    return '不到 1 秒'
  }
  const totalSeconds = Math.round(durationMs / 1000)
  if (totalSeconds < 60) {
    const seconds = durationMs / 1000
    if (seconds < 10) {
      return `${seconds.toFixed(1)} 秒`
    }
    return `${totalSeconds} 秒`
  }
  const hours = Math.floor(totalSeconds / 3600)
  const minutes = Math.floor((totalSeconds % 3600) / 60)
  const seconds = totalSeconds % 60
  if (hours > 0) {
    const parts = [`${hours} 小时`]
    if (minutes > 0) {
      parts.push(`${minutes} 分`)
    }
    if (seconds > 0) {
      parts.push(`${seconds} 秒`)
    }
    return parts.join(' ')
  }
  if (seconds > 0) {
    return `${minutes} 分 ${seconds} 秒`
  }
  return `${minutes} 分`
}

export function formatThinkingDurationMs(durationMs: number): string {
  const duration = formatHumanDurationMs(durationMs)
  if (duration === '不到 1 秒') {
    return '思考了不到 1 秒'
  }
  return `思考了 ${duration}`
}
