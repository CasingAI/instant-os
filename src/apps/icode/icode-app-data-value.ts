export type StorageValueKind = 'json' | 'number' | 'boolean' | 'text'

export type DecodedStorageValue = {
  kind: StorageValueKind
  display: string
}

export function appDataRecordsEqual(
  left: Record<string, string>,
  right: Record<string, string>,
): boolean {
  const leftKeys = Object.keys(left).sort()
  const rightKeys = Object.keys(right).sort()
  if (leftKeys.length !== rightKeys.length) {
    return false
  }

  return leftKeys.every((key, index) => key === rightKeys[index] && left[key] === right[key])
}

export function decodeStorageValue(raw: string): DecodedStorageValue {
  const trimmed = raw.trim()
  if (trimmed.startsWith('{') || trimmed.startsWith('[')) {
    try {
      const parsed: unknown = JSON.parse(raw)
      if (typeof parsed === 'object' && parsed !== null) {
        return {
          kind: 'json',
          display: JSON.stringify(parsed, undefined, 2),
        }
      }
    } catch {
      // fall through to plain text
    }
  }

  try {
    const parsed: unknown = JSON.parse(raw)
    if (typeof parsed === 'number') {
      return { kind: 'number', display: String(parsed) }
    }
    if (typeof parsed === 'boolean') {
      return { kind: 'boolean', display: parsed ? 'true' : 'false' }
    }
    if (typeof parsed === 'string' && raw !== parsed) {
      return { kind: 'text', display: parsed }
    }
  } catch {
    // plain text
  }

  return { kind: 'text', display: raw }
}

export function encodeStorageValue(kind: StorageValueKind, display: string): string | undefined {
  if (kind === 'json') {
    try {
      const parsed: unknown = JSON.parse(display)
      if (typeof parsed !== 'object' || parsed === undefined) {
        return undefined
      }
      return JSON.stringify(parsed)
    } catch {
      return undefined
    }
  }

  if (kind === 'number') {
    const trimmed = display.trim()
    if (!trimmed) {
      return undefined
    }
    const parsed = Number(trimmed)
    if (!Number.isFinite(parsed)) {
      return undefined
    }
    return String(parsed)
  }

  if (kind === 'boolean') {
    if (display === 'true') {
      return 'true'
    }
    if (display === 'false') {
      return 'false'
    }
    return undefined
  }

  return display
}

export function summarizeStorageValue(raw: string): string {
  const decoded = decodeStorageValue(raw)
  const compact =
    decoded.kind === 'json'
      ? decoded.display.replace(/\s+/g, ' ').trim()
      : decoded.display.replace(/\s+/g, ' ').trim()

  if (compact.length <= 56) {
    return compact
  }

  return `${compact.slice(0, 55)}…`
}

export function storageValueKindLabel(kind: StorageValueKind): string {
  if (kind === 'json') {
    return 'JSON'
  }
  if (kind === 'number') {
    return '数字'
  }
  if (kind === 'boolean') {
    return '布尔'
  }
  return '文本'
}
