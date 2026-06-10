function stripMarkdownFence(text: string): string {
  return text.replace(/^```(?:json|ndjson)?\s*/i, '').replace(/\s*```\s*$/, '')
}

export function createNdjsonLineFeed(onLine: (line: string) => void) {
  let buffer = ''

  const push = (chunk: string) => {
    buffer += chunk
    const lines = buffer.split('\n')
    buffer = lines.pop() ?? ''

    for (const line of lines) {
      const trimmed = line.trim()
      if (trimmed) {
        onLine(trimmed)
      }
    }
  }

  const flush = () => {
    const trimmed = buffer.trim()
    buffer = ''
    if (trimmed) {
      onLine(trimmed)
    }
  }

  const getBuffer = () => buffer

  return { push, flush, getBuffer }
}

export function parseNdjsonLine<T>(line: string): T {
  return JSON.parse(line) as T
}

export function extractPartialStringField(text: string, field: string): string | undefined {
  const cleaned = stripMarkdownFence(text)
  const key = `"${field}"`
  const keyIndex = cleaned.indexOf(key)
  if (keyIndex === -1) {
    return undefined
  }

  const colonIndex = cleaned.indexOf(':', keyIndex + key.length)
  if (colonIndex === -1) {
    return undefined
  }

  let index = colonIndex + 1
  while (index < cleaned.length && /\s/.test(cleaned[index])) {
    index += 1
  }

  if (cleaned[index] !== '"') {
    return undefined
  }

  index += 1
  let value = ''
  let escaped = false

  for (; index < cleaned.length; index += 1) {
    const char = cleaned[index]

    if (escaped) {
      if (char === 'n') {
        value += '\n'
      } else if (char === 't') {
        value += '\t'
      } else {
        value += char
      }
      escaped = false
      continue
    }

    if (char === '\\') {
      escaped = true
      continue
    }

    if (char === '"') {
      return value
    }

    value += char
  }

  return value.length > 0 ? value : undefined
}

export function extractPartialObjectFields<T extends Record<string, string>>(
  text: string,
  fields: readonly (keyof T & string)[],
): Partial<T> {
  const result: Partial<T> = {}

  for (const field of fields) {
    const value = extractPartialStringField(text, field)
    if (value !== undefined) {
      result[field] = value as T[typeof field]
    }
  }

  return result
}
