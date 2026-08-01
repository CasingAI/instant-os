export type JsonlLineEntry = {
  /** 原始行号（1-based，含空行） */
  line: number
  ok: boolean
  /** 原始行文本 */
  raw: string
  /** 解析失败时的错误信息 */
  message?: string
}

/**
 * 全量校验一遍 JSONL 文本（跳过空行），但**不保留解析对象**：
 * 超大文件下内存只存每行小索引 + 原始文本，值在显示时按需解析。
 */
export function indexJsonlLines(text: string): JsonlLineEntry[] {
  const entries: JsonlLineEntry[] = []
  let line = 0
  for (const raw of text.split('\n')) {
    line += 1
    const trimmed = raw.trim()
    if (!trimmed) continue
    try {
      JSON.parse(trimmed)
      entries.push({ line, ok: true, raw })
    } catch (error) {
      entries.push({
        line,
        ok: false,
        raw,
        message: error instanceof Error ? error.message : String(error),
      })
    }
  }
  return entries
}

/** 显示时按需解析单行原始文本 */
export function parseJsonlLine(raw: string): unknown {
  return JSON.parse(raw.trim())
}
