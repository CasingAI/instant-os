/** 从尚不完整的 tool arguments JSON 里尽量抽出某个 string 字段（流式写入预览用）。 */
export function extractPartialJsonStringField(
  raw: string,
  field: string,
): string | undefined {
  if (!raw || !field) return undefined
  const needle = `"${field}"`
  let searchFrom = 0
  while (searchFrom < raw.length) {
    const keyIndex = raw.indexOf(needle, searchFrom)
    if (keyIndex < 0) return undefined
    let i = keyIndex + needle.length
    while (i < raw.length && /\s/.test(raw[i] ?? '')) i += 1
    if (raw[i] !== ':') {
      searchFrom = keyIndex + 1
      continue
    }
    i += 1
    while (i < raw.length && /\s/.test(raw[i] ?? '')) i += 1
    if (raw[i] !== '"') {
      searchFrom = keyIndex + 1
      continue
    }
    i += 1
    let out = ''
    while (i < raw.length) {
      const ch = raw[i]
      if (ch === '"') return out
      if (ch === '\\') {
        const next = raw[i + 1]
        if (next === undefined) return out
        if (next === 'n') out += '\n'
        else if (next === 'r') out += '\r'
        else if (next === 't') out += '\t'
        else if (next === '"' || next === '\\' || next === '/') out += next
        else if (next === 'u' && i + 5 < raw.length) {
          const hex = raw.slice(i + 2, i + 6)
          if (/^[0-9a-fA-F]{4}$/.test(hex)) {
            out += String.fromCharCode(Number.parseInt(hex, 16))
            i += 6
            continue
          }
          out += next
        } else {
          out += next
        }
        i += 2
        continue
      }
      out += ch
      i += 1
    }
    return out
  }
  return undefined
}

export const VSCODE_AI_WRITE_TOOLS = new Set(['write_plan', 'update_plan'])

export function isVscodeAiWriteTool(toolName: string): boolean {
  return VSCODE_AI_WRITE_TOOLS.has(toolName)
}

export function writeToolPreviewField(toolName: string): string | undefined {
  if (toolName === 'write_plan' || toolName === 'update_plan') return 'markdown'
  return undefined
}

export function writeToolTitleField(toolName: string): string | undefined {
  if (toolName === 'write_plan') return 'name'
  if (toolName === 'update_plan') return 'path'
  return undefined
}
