export function formatTerminalReplValue(value: unknown): string {
  if (typeof value === 'string') {
    return JSON.stringify(value)
  }
  if (
    value === undefined ||
    value === null ||
    typeof value === 'number' ||
    typeof value === 'boolean' ||
    typeof value === 'bigint'
  ) {
    return String(value)
  }
  if (typeof value === 'object' && value !== null && 'default' in value) {
    const record = value as { default: unknown }
    if (Object.keys(value).length === 1 || record.default !== undefined) {
      try {
        return formatTerminalReplValue(record.default)
      } catch {
        // fall through
      }
    }
  }
  try {
    return JSON.stringify(value, undefined, 2)
  } catch {
    return Object.prototype.toString.call(value)
  }
}
