import type { ChromoNetworkEntry } from './chromo-bridge.ts'

const HOT_CACHE_MAX_BYTES = 1024 * 1024

export type HotCacheHelpContext = {
  disableNetworkCache?: boolean
  /** All network entries in the current tab (for first-request detection). */
  entries?: ChromoNetworkEntry[]
}

export type HotCacheHelpResult = {
  hit: boolean
  reasons: string[]
}

function sameUrlCompletedBefore(
  entry: ChromoNetworkEntry,
  entries: ChromoNetworkEntry[] | undefined,
): boolean {
  if (!entries || entries.length === 0) {
    return false
  }
  return entries.some(
    (other) =>
      other.id !== entry.id &&
      other.url === entry.url &&
      (other.method || 'GET').toUpperCase() === (entry.method || 'GET').toUpperCase() &&
      !other.pending,
  )
}

/**
 * Explain why a Network entry did or did not hit DevTools hot cache.
 * Served from only reflects hot cache / proxy path — not browser HTTP Cache-Control.
 */
export function explainHotCacheStatus(
  entry: ChromoNetworkEntry,
  context: HotCacheHelpContext = {},
): HotCacheHelpResult {
  const reasons: string[] = []
  const hit = Boolean(entry.fromCache || entry.source === 'cache')

  if (hit) {
    reasons.push('已命中 DevTools 热缓存（同 tab、同 URL 的重复 GET）。')
    reasons.push(
      '注意：响应头 Cache-Control 管的是浏览器 HTTP 缓存；Served from 不反映 disk/memory cache。',
    )
    return { hit: true, reasons }
  }

  if (context.disableNetworkCache) {
    reasons.push('Network 面板已勾选 Disable cache：跳过热缓存读写，上游 fetch 使用 no-store。')
  }

  const method = (entry.method || 'GET').toUpperCase()
  if (method !== 'GET') {
    reasons.push(`仅 GET 请求可写入热缓存；当前方法为 ${method}。`)
  }

  if (entry.bypass) {
    reasons.push('Passthrough（厂商直连）路径不走 DevTools 热缓存。')
  }

  if (entry.source === 'cdn') {
    reasons.push('本次走 Static CDN（jsDelivr），不是热缓存。')
  } else if (entry.source === 'direct') {
    reasons.push('本次走 Direct fetch（CORS 白名单主机），不是热缓存。')
  } else if (entry.source === 'native') {
    reasons.push('本次走 Native / 非 HTTP 协议，不是热缓存。')
  }

  if (entry.pending) {
    reasons.push('请求仍在进行中，尚未完成热缓存写入或命中判定。')
  }

  if (!entry.pending && entry.size > HOT_CACHE_MAX_BYTES) {
    reasons.push(
      `响应体积 ${entry.size} B 超过热缓存上限 1MB，不会写入。`,
    )
  } else if (!entry.pending && !entry.hasBody && method === 'GET' && !entry.bypass) {
    reasons.push('本次未缓存响应正文（hasBody=false），热缓存无法命中。')
  }

  const hadPrior = sameUrlCompletedBefore(entry, context.entries)
  if (!entry.pending && method === 'GET' && !entry.bypass && !hadPrior) {
    reasons.push(
      '同标签页历史上尚无同一 URL 的已完成请求：这是首次拉取，热缓存只对重复请求生效。刷新后同 URL 的第二次请求才可能显示 DevTools memory cache。',
    )
  } else if (
    !entry.pending &&
    method === 'GET' &&
    !entry.bypass &&
    hadPrior &&
    (entry.source === 'proxy' || !entry.source)
  ) {
    reasons.push(
      '同 URL 此前已请求过，但仍走 Proxy：可能上次响应未完整写入热缓存，或 URL/devtoolsId 不一致。',
    )
  }

  reasons.push(
    '响应头 Cache-Control 管的是浏览器 HTTP 缓存；Served from 只反映 DevTools 热缓存与代理通路，不会显示 Chrome 的 (from disk cache)。',
  )

  if (reasons.length === 1) {
    reasons.unshift('未命中 DevTools 热缓存，本次经代理或其它通路拉取。')
  }

  return { hit: false, reasons }
}
