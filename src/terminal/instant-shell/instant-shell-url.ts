const BLOCKED_SCHEMES = new Set([
  'javascript',
  'data',
  'file',
  'blob',
  'vbscript',
  'about',
])

/**
 * 规范化并校验 `instant.openUrl` 入参。
 * 仅允许 http/https；无 scheme 时补 `https://`。
 */
export function normalizeInstantShellUrl(input: string): string {
  const trimmed = input.trim()
  if (!trimmed) {
    throw new Error('URL 不能为空')
  }

  let candidate = trimmed
  const schemeMatch = /^([a-z][a-z0-9+.-]*):/i.exec(trimmed)
  if (schemeMatch) {
    const scheme = schemeMatch[1]!.toLowerCase()
    if (BLOCKED_SCHEMES.has(scheme)) {
      throw new Error(`不允许的 URL 协议: ${scheme}:`)
    }
    if (scheme !== 'http' && scheme !== 'https') {
      throw new Error(`仅支持 http/https，收到: ${scheme}:`)
    }
  } else {
    candidate = `https://${trimmed}`
  }

  let parsed: URL
  try {
    parsed = new URL(candidate)
  } catch {
    throw new Error(`无效的 URL: ${input}`)
  }

  if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
    throw new Error(`仅支持 http/https，收到: ${parsed.protocol}`)
  }
  if (!parsed.hostname) {
    throw new Error(`无效的 URL: ${input}`)
  }

  return parsed.href
}
