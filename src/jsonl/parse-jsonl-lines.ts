import { JSONL_NAV_PREVIEW_MAX } from './jsonl-perf.ts'

export type JsonlLineEntry = {
  /** 原始行号（1-based，含空行） */
  line: number
  /** 在原文中的起止偏移（不含换行符） */
  start: number
  end: number
  ok: boolean
  /** 解析失败时的错误信息 */
  message?: string
  /** 该行对象上值为 string 的属性名（有序）；非对象行省略 */
  stringKeys?: string[]
}

export type JsonlIndexResult = {
  entries: JsonlLineEntry[]
  availableKeys: string[]
  errorIndices: number[]
  defaultPreviewKey: string | undefined
}

export const EMPTY_JSONL_INDEX: JsonlIndexResult = {
  entries: [],
  availableKeys: [],
  errorIndices: [],
  defaultPreviewKey: undefined,
}

/** 从解析值中收集值为 string 的属性名（保持对象键顺序） */
export function stringKeysFromValue(value: unknown): string[] | undefined {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return undefined
  const keys: string[] = []
  for (const [key, field] of Object.entries(value as Record<string, unknown>)) {
    if (typeof field === 'string') keys.push(key)
  }
  return keys.length > 0 ? keys : undefined
}

/** 按偏移从原文取行文本（不额外长期持有 raw 副本） */
export function entryRaw(text: string, entry: Pick<JsonlLineEntry, 'start' | 'end'>): string {
  return text.slice(entry.start, entry.end)
}

function isAsciiSpace(ch: string): boolean {
  return ch === ' ' || ch === '\t' || ch === '\r'
}

/**
 * 全量校验一遍 JSONL 文本（跳过空行），只存行偏移 + string 键名：
 * 不保留解析对象，也不复制每行 raw（由 entryRaw 按需 slice）。
 */
export function indexJsonlLines(text: string): JsonlIndexResult {
  const entries: JsonlLineEntry[] = []
  const errorIndices: number[] = []
  const seenKeys = new Set<string>()
  const availableKeys: string[] = []
  let defaultPreviewKey: string | undefined

  let line = 0
  let offset = 0
  const len = text.length

  while (offset <= len) {
    // 文件以换行结尾时，最后一段为空，跳过即可
    if (offset === len) break

    line += 1
    let lineEnd = text.indexOf('\n', offset)
    if (lineEnd < 0) lineEnd = len
    const start = offset
    const end = lineEnd
    offset = lineEnd < len ? lineEnd + 1 : len

    let trimStart = start
    let trimEnd = end
    while (trimStart < trimEnd && isAsciiSpace(text[trimStart]!)) trimStart += 1
    while (trimEnd > trimStart && isAsciiSpace(text[trimEnd - 1]!)) trimEnd -= 1
    if (trimStart >= trimEnd) continue

    const trimmed = text.slice(trimStart, trimEnd)
    try {
      const value = JSON.parse(trimmed) as unknown
      const stringKeys = stringKeysFromValue(value)
      entries.push({ line, start, end, ok: true, stringKeys })
      if (stringKeys) {
        for (const key of stringKeys) {
          if (seenKeys.has(key)) continue
          seenKeys.add(key)
          availableKeys.push(key)
        }
        if (defaultPreviewKey === undefined) defaultPreviewKey = stringKeys[0]
      }
    } catch (error) {
      errorIndices.push(entries.length)
      entries.push({
        line,
        start,
        end,
        ok: false,
        message: error instanceof Error ? error.message : String(error),
      })
    }
  }

  return { entries, availableKeys, errorIndices, defaultPreviewKey }
}

/**
 * 分块索引：每处理约 progressChars 字符调用 onProgress，并检查 shouldAbort。
 * Worker / 可取消场景用；同步路径直接用 indexJsonlLines。
 */
export function indexJsonlLinesChunked(
  text: string,
  options: {
    progressChars: number
    shouldAbort?: () => boolean
    onProgress?: (processedLines: number, offset: number) => void
  },
): JsonlIndexResult | undefined {
  const entries: JsonlLineEntry[] = []
  const errorIndices: number[] = []
  const seenKeys = new Set<string>()
  const availableKeys: string[] = []
  let defaultPreviewKey: string | undefined

  let line = 0
  let offset = 0
  let lastProgressOffset = 0
  const len = text.length
  const progressChars = Math.max(1, options.progressChars)

  while (offset <= len) {
    if (options.shouldAbort?.()) return undefined
    if (offset === len) break

    line += 1
    let lineEnd = text.indexOf('\n', offset)
    if (lineEnd < 0) lineEnd = len
    const start = offset
    const end = lineEnd
    offset = lineEnd < len ? lineEnd + 1 : len

    let trimStart = start
    let trimEnd = end
    while (trimStart < trimEnd && isAsciiSpace(text[trimStart]!)) trimStart += 1
    while (trimEnd > trimStart && isAsciiSpace(text[trimEnd - 1]!)) trimEnd -= 1
    if (trimStart >= trimEnd) {
      if (offset - lastProgressOffset >= progressChars) {
        lastProgressOffset = offset
        options.onProgress?.(entries.length, offset)
      }
      continue
    }

    const trimmed = text.slice(trimStart, trimEnd)
    try {
      const value = JSON.parse(trimmed) as unknown
      const stringKeys = stringKeysFromValue(value)
      entries.push({ line, start, end, ok: true, stringKeys })
      if (stringKeys) {
        for (const key of stringKeys) {
          if (seenKeys.has(key)) continue
          seenKeys.add(key)
          availableKeys.push(key)
        }
        if (defaultPreviewKey === undefined) defaultPreviewKey = stringKeys[0]
      }
    } catch (error) {
      errorIndices.push(entries.length)
      entries.push({
        line,
        start,
        end,
        ok: false,
        message: error instanceof Error ? error.message : String(error),
      })
    }

    if (offset - lastProgressOffset >= progressChars) {
      lastProgressOffset = offset
      options.onProgress?.(entries.length, offset)
    }
  }

  if (options.shouldAbort?.()) return undefined
  return { entries, availableKeys, errorIndices, defaultPreviewKey }
}

/** 显示时按需解析单行原始文本 */
export function parseJsonlLine(raw: string): unknown {
  return JSON.parse(raw.trim())
}

/** 压成单行并截断，末尾加省略号 */
export function truncateJsonlPreview(text: string, max = JSONL_NAV_PREVIEW_MAX): string {
  const flat = text.replace(/\s+/g, ' ').trim()
  if (flat.length <= max) return flat
  return `${flat.slice(0, max)}…`
}

/**
 * 从原始行取指定 string 字段；缺失或非 string 返回 undefined。
 * 传入 maxLength 时压成单行并截断（导航预览用）。
 */
export function stringFieldValue(
  raw: string,
  key: string,
  options?: { maxLength?: number },
): string | undefined {
  try {
    const value = parseJsonlLine(raw)
    if (!value || typeof value !== 'object' || Array.isArray(value)) return undefined
    const field = (value as Record<string, unknown>)[key]
    if (typeof field !== 'string') return undefined
    if (options?.maxLength === undefined) return field
    return truncateJsonlPreview(field, options.maxLength)
  } catch {
    return undefined
  }
}

/**
 * 从已解析对象取 string 字段（与 stringFieldValue 语义一致，避免重复 parse）。
 */
export function stringFieldFromValue(
  value: unknown,
  key: string,
  options?: { maxLength?: number },
): string | undefined {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return undefined
  const field = (value as Record<string, unknown>)[key]
  if (typeof field !== 'string') return undefined
  if (options?.maxLength === undefined) return field
  return truncateJsonlPreview(field, options.maxLength)
}
