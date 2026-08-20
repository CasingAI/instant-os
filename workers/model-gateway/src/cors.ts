/** 与来源域白名单比较前的归一化：trim + 小写 + 去尾斜杠 */
export function normalizeOrigin(origin: string): string {
  return origin.trim().toLowerCase().replace(/\/+$/, '')
}

function hostMatchesApex(hostname: string, apex: string): boolean {
  return hostname === apex || hostname.endsWith(`.${apex}`)
}

/**
 * 白名单：
 * - http://localhost（任意端口）
 * - casing-ai.com 及其所有子域
 * - instant-os.pages.dev 及其所有子域
 */
export function isOriginAllowed(origin: string): boolean {
  if (!origin) return false
  let parsed: URL
  try {
    parsed = new URL(normalizeOrigin(origin))
  } catch {
    return false
  }
  if (parsed.username || parsed.password) return false
  if (parsed.protocol === 'http:' && parsed.hostname === 'localhost') {
    return true
  }
  if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
    return false
  }
  return (
    hostMatchesApex(parsed.hostname, 'casing-ai.com') ||
    hostMatchesApex(parsed.hostname, 'instant-os.pages.dev')
  )
}
