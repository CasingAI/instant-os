import type { ChromoNetworkEntry } from './chromo-bridge.ts'

const HOT_CACHE_MAX_BYTES = 1024 * 1024

export type HotCacheHelpContext = {
  disableNetworkCache?: boolean
  /** All network entries in the current tab (for first-request detection). */
  entries?: ChromoNetworkEntry[]
}

export type HotCacheConditionStatus = 'pass' | 'fail' | 'pending' | 'skip'

export type HotCacheCondition = {
  id: string
  label: string
  status: HotCacheConditionStatus
  value?: string
}

export type HotCacheDiagnosis = {
  hit: boolean
  conditions: HotCacheCondition[]
  /** Condition ids with status === 'fail' (blocking hot-cache hit). */
  blockingIds: string[]
}

/** @deprecated Use HotCacheDiagnosis */
export type HotCacheHelpResult = HotCacheDiagnosis & { reasons: string[] }

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

function formatBytes(size: number): string {
  if (!size) {
    return '0 B'
  }
  if (size < 1024) {
    return `${size} B`
  }
  if (size < 1024 * 1024) {
    return `${(size / 1024).toFixed(1)} KB`
  }
  return `${(size / (1024 * 1024)).toFixed(1)} MB`
}

/**
 * Diagnose why a Network entry did or did not hit DevTools hot cache.
 * Served from only reflects hot cache / proxy path — not browser HTTP Cache-Control.
 */
export function diagnoseHotCache(
  entry: ChromoNetworkEntry,
  context: HotCacheHelpContext = {},
): HotCacheDiagnosis {
  const hit = Boolean(entry.fromCache || entry.source === 'cache')
  const method = (entry.method || 'GET').toUpperCase()
  const pending = Boolean(entry.pending)
  const bypass = Boolean(entry.bypass)
  const source = entry.source || (entry.fromCache ? 'cache' : bypass ? 'bypass' : '')
  const hadPrior = sameUrlCompletedBefore(entry, context.entries)

  const conditions: HotCacheCondition[] = []

  conditions.push({
    id: 'disable_cache_off',
    label: 'Disable cache 关闭',
    status: context.disableNetworkCache ? 'fail' : 'pass',
    value: context.disableNetworkCache ? '已开启' : '否',
  })

  conditions.push({
    id: 'method_get',
    label: '方法为 GET',
    status: method === 'GET' ? 'pass' : 'fail',
    value: method,
  })

  conditions.push({
    id: 'not_bypass',
    label: '非 Passthrough',
    status: bypass ? 'fail' : 'pass',
    value: bypass ? 'bypass' : '否',
  })

  if (bypass) {
    conditions.push({
      id: 'proxy_path',
      label: '经 proxy 通路（非 cdn/direct/native）',
      status: 'skip',
      value: '—',
    })
  } else {
    const proxyPathOk =
      !source || source === 'proxy' || source === 'cache'
    conditions.push({
      id: 'proxy_path',
      label: '经 proxy 通路（非 cdn/direct/native）',
      status: proxyPathOk ? 'pass' : 'fail',
      value: source || 'proxy',
    })
  }

  conditions.push({
    id: 'repeat_url',
    label: '同 tab 已有同 URL 完成请求',
    status: pending ? 'pending' : hadPrior ? 'pass' : 'fail',
    value: pending ? 'pending' : hadPrior ? '是' : '否（首次）',
  })

  if (bypass) {
    conditions.push({
      id: 'body_size_ok',
      label: '响应 ≤ 1MB',
      status: 'skip',
      value: '—',
    })
    conditions.push({
      id: 'body_stored',
      label: '响应正文已写入（hasBody）',
      status: 'skip',
      value: '—',
    })
  } else if (pending) {
    conditions.push({
      id: 'body_size_ok',
      label: '响应 ≤ 1MB',
      status: 'pending',
      value: 'pending',
    })
    conditions.push({
      id: 'body_stored',
      label: '响应正文已写入（hasBody）',
      status: 'pending',
      value: 'pending',
    })
  } else {
    const sizeOk = entry.size <= HOT_CACHE_MAX_BYTES
    conditions.push({
      id: 'body_size_ok',
      label: '响应 ≤ 1MB',
      status: sizeOk ? 'pass' : 'fail',
      value: formatBytes(entry.size),
    })
    conditions.push({
      id: 'body_stored',
      label: '响应正文已写入（hasBody）',
      status: entry.hasBody ? 'pass' : 'fail',
      value: entry.hasBody ? '是' : '否',
    })
  }

  conditions.push({
    id: 'hot_hit',
    label: '热缓存命中',
    status: pending ? 'pending' : hit ? 'pass' : 'fail',
    value: pending ? 'pending' : hit ? '是' : '否',
  })

  const blockingIds = conditions.filter((c) => c.status === 'fail').map((c) => c.id)
  return { hit, conditions, blockingIds }
}

/**
 * @deprecated Prefer diagnoseHotCache()
 */
export function explainHotCacheStatus(
  entry: ChromoNetworkEntry,
  context: HotCacheHelpContext = {},
): HotCacheHelpResult {
  const diagnosis = diagnoseHotCache(entry, context)
  const reasons = diagnosis.conditions
    .filter((c) => c.status === 'fail' || c.status === 'pending')
    .map((c) => `${c.label}: ${c.value ?? c.status}`)
  if (reasons.length === 0 && !diagnosis.hit) {
    reasons.push('未命中 DevTools 热缓存')
  }
  return { ...diagnosis, reasons }
}
