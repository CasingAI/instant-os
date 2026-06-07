const VERSION_PATTERN = /^V(\d+)$/i

export const DEFAULT_APP_VERSION = 'V1'

export function normalizeAppVersion(version: string | undefined): string {
  const trimmed = version?.trim()
  if (!trimmed) {
    return DEFAULT_APP_VERSION
  }
  const match = VERSION_PATTERN.exec(trimmed)
  if (!match) {
    return DEFAULT_APP_VERSION
  }
  return `V${match[1]}`
}

export function nextAppVersion(current: string | undefined): string {
  const normalized = normalizeAppVersion(current)
  const match = VERSION_PATTERN.exec(normalized)
  if (!match) {
    return 'V2'
  }
  return `V${Number(match[1]) + 1}`
}
