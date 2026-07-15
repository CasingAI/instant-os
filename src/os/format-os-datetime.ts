export type OsDateTimeParts = {
  calendar: string
  weekday: string
  time: string
  timeWithSeconds: string
}

export type OsClockHmParts = {
  /** 纯时分数字，如 `15:45` / `3:45` */
  digits: string
  /** 12 小时制时的「上午」或「下午」；24 小时制为 undefined */
  period?: string
}

function pad2(value: number): string {
  return String(value).padStart(2, '0')
}

export function formatOsClockParts(
  hour: number,
  minute: number,
  use24HourTime: boolean,
): OsClockHmParts {
  if (use24HourTime) {
    return { digits: `${pad2(hour)}:${pad2(minute)}` }
  }
  const period = hour < 12 ? '上午' : '下午'
  const hour12 = hour % 12 === 0 ? 12 : hour % 12
  return {
    digits: `${hour12}:${pad2(minute)}`,
    period,
  }
}

/** 紧凑单行：24 小时为 `15:45`，12 小时为 `下午3:45`。 */
export function formatOsClockHm(
  hour: number,
  minute: number,
  use24HourTime: boolean,
): string {
  const { digits, period } = formatOsClockParts(hour, minute, use24HourTime)
  return period ? `${period}${digits}` : digits
}

export function formatOsDateTime(now: Date, use24HourTime = true): OsDateTimeParts {
  const month = now.getMonth() + 1
  const day = now.getDate()
  const weekday = now.toLocaleDateString('zh-CN', { weekday: 'long' })
  const time = formatOsClockHm(now.getHours(), now.getMinutes(), use24HourTime)
  const timeWithSeconds = `${formatOsClockHm(now.getHours(), now.getMinutes(), use24HourTime)}:${pad2(now.getSeconds())}`

  return {
    calendar: `${month}月${day}日`,
    weekday,
    time,
    timeWithSeconds,
  }
}
