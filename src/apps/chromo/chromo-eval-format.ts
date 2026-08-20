export function formatChromoEvalValue(value: unknown): string {
  if (value === undefined) {
    return 'undefined'
  }

  if (value && typeof value === 'object' && '__vc' in value) {
    const wrapped = value as Record<string, unknown>
    switch (wrapped.__vc) {
      case 'undefined':
        return 'undefined'
      case 'function':
        return `[Function: ${String(wrapped.name ?? 'anonymous')}]`
      case 'symbol':
        return String(wrapped.value ?? 'Symbol()')
      case 'error':
        return `${String(wrapped.name ?? 'Error')}: ${String(wrapped.message ?? '')}`
      case 'bigint':
        return `${wrapped.value}n`
      case 'unserializable':
        return `[Unserializable: ${String(wrapped.type ?? 'unknown')}]`
      default:
        break
    }
  }

  if (typeof value === 'string') {
    return value
  }

  try {
    return JSON.stringify(value, null, 2) ?? String(value)
  } catch {
    return String(value)
  }
}
