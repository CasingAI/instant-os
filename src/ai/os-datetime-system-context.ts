import { formatOsDateTimeContext } from '../os/os-clock.ts'

/** 幂等标记：已含此段则不再追加，避免重复注入 */
export const OS_DATETIME_SYSTEM_SECTION_MARKER = '【系统当前日期与时间】'

/** 仅段落正文（计量 / 去重检测用） */
export function buildOsDateTimeSystemSection(): string {
  return `${OS_DATETIME_SYSTEM_SECTION_MARKER}\n${formatOsDateTimeContext()}\n（来自 Instant OS 系统时钟；若用户手动设置了日期与时间，以该时刻为准。）`
}

/**
 * 在 system prompt 末尾追加当前 OS 日期时间。
 * 每轮请求调用一次即可拿到最新时刻；已含标记时不重复追加。
 */
export function appendOsDateTimeSystemSection(systemPrompt: string): string {
  const trimmed = systemPrompt.trimEnd()
  if (trimmed.includes(OS_DATETIME_SYSTEM_SECTION_MARKER)) {
    return systemPrompt
  }
  const section = buildOsDateTimeSystemSection()
  if (!trimmed) return section
  return `${trimmed}\n\n${section}`
}
