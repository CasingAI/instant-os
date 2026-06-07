function extractJsonCandidate(text: string): string {
  const fenced = text.match(/```(?:json)?\s*([\s\S]*?)```/i)
  if (fenced?.[1]) {
    return fenced[1].trim()
  }

  const arrayStart = text.indexOf('[')
  const objectStart = text.indexOf('{')
  if (arrayStart === -1 && objectStart === -1) {
    return text.trim()
  }

  if (arrayStart === -1) {
    return text.slice(objectStart).trim()
  }
  if (objectStart === -1) {
    return text.slice(arrayStart).trim()
  }

  return text.slice(Math.min(arrayStart, objectStart)).trim()
}

export function parseJsonFromAiText<T>(text: string): T {
  const candidate = extractJsonCandidate(text)

  try {
    return JSON.parse(candidate) as T
  } catch {
    throw new Error('AI 返回的内容不是有效的 JSON')
  }
}

export function extractHtmlFromAiText(text: string): string {
  const fenced = text.match(/```(?:html)?\s*([\s\S]*?)```/i)
  if (fenced?.[1]) {
    return fenced[1].trim()
  }

  const trimmed = text.trim()
  if (trimmed.startsWith('<!DOCTYPE') || trimmed.startsWith('<html') || trimmed.startsWith('<')) {
    return trimmed
  }

  return trimmed
}
