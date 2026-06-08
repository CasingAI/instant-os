export type OsDateTimeParts = {
  calendar: string
  weekday: string
  time: string
  timeWithSeconds: string
}

export function formatOsDateTime(now: Date): OsDateTimeParts {
  const month = now.getMonth() + 1
  const day = now.getDate()
  const weekday = now.toLocaleDateString('zh-CN', { weekday: 'long' })
  const time = now.toLocaleTimeString('zh-CN', {
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  })
  const timeWithSeconds = now.toLocaleTimeString('zh-CN', {
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hour12: false,
  })

  return {
    calendar: `${month}月${day}日`,
    weekday,
    time,
    timeWithSeconds,
  }
}
