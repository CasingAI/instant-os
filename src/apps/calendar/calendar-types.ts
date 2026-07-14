export type CalendarMajorEvent = {
  id: string
  title: string
  summary: string
  category: string
}

export type CalendarDayDigest = {
  dayKey: string
  generatedAt: number
  events: CalendarMajorEvent[]
}

export type CalendarStore = {
  /** 按日缓存的 AI 重大事件 */
  digestsByDay: Record<string, CalendarDayDigest>
}
