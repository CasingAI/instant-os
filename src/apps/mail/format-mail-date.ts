function pad2(value: number): string {
  return value.toString().padStart(2, '0')
}

import { osNowDate } from '../../os/os-clock.ts'

/** 手动拼接日期，避免 Windows 下 Intl 输出 "6/9" 等斜杠格式或数字渲染异常。 */
export function formatMailListDate(timestamp: number): string {
  const date = new Date(timestamp)
  const now = osNowDate()
  const sameDay =
    date.getFullYear() === now.getFullYear() &&
    date.getMonth() === now.getMonth() &&
    date.getDate() === now.getDate()

  if (sameDay) {
    return `${pad2(date.getHours())}:${pad2(date.getMinutes())}`
  }

  const month = date.getMonth() + 1
  const day = date.getDate()
  const sameYear = date.getFullYear() === now.getFullYear()
  if (sameYear) {
    return `${month}月${day}日`
  }

  return `${date.getFullYear()}年${month}月${day}日`
}

export function formatMailDetailDate(timestamp: number): string {
  const date = new Date(timestamp)
  const month = date.getMonth() + 1
  const day = date.getDate()
  return `${date.getFullYear()}年${month}月${day}日 ${pad2(date.getHours())}:${pad2(date.getMinutes())}`
}
