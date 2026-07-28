import type { ChromoNetworkEntry } from './chromo-bridge.ts'

const HOT_CACHE_MAX_BYTES = 1024 * 1024

export type HotCacheHelpContext = {
  disableNetworkCache?: boolean
  /** All network entries in the current tab (panel history only; not SW cache state). */
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
  /** True when all write prerequisites pass (or pending). */
  writeEligible: boolean
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
 * Hot cache is session-scoped (SW Cache Storage); panel URL history is informational only.
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

  const writePrereqIds = [
    'disable_cache_off',
    'method_get',
    'not_bypass',
    'proxy_path',
    'body_size_ok',
    'body_stored',
  ]
  const writeFailed = writePrereqIds.some((id) => {
    const c = conditions.find((row) => row.id === id)
    return c?.status === 'fail'
  })
  const writePending = writePrereqIds.some((id) => {
    const c = conditions.find((row) => row.id === id)
    return c?.status === 'pending'
  })
  const writeEligible = !writeFailed && !writePending && !bypass

  conditions.push({
    id: 'write_eligible',
    label: '满足写入条件',
    status: writePending ? 'pending' : writeEligible ? 'pass' : 'fail',
    value: writePending ? 'pending' : writeEligible ? '是' : '否',
  })

  // Panel list history only — not SW Cache Storage state; never blocks.
  conditions.push({
    id: 'panel_repeat',
    label: '列表内重复 URL（仅供参考）',
    status: pending ? 'pending' : hadPrior ? 'pass' : 'skip',
    value: pending ? 'pending' : hadPrior ? '是' : '否（列表首次）',
  })

  if (pending) {
    conditions.push({
      id: 'hot_hit',
      label: '热缓存命中（本次）',
      status: 'pending',
      value: 'pending',
    })
  } else if (hit) {
    conditions.push({
      id: 'hot_hit',
      label: '热缓存命中（本次）',
      status: 'pass',
      value: '是',
    })
  } else if (writeEligible) {
    // First GET that wrote hot cache: miss is expected, not a blocker.
    conditions.push({
      id: 'hot_hit',
      label: '热缓存命中（本次）',
      status: 'skip',
      value: '否（本次写入，后续可命中）',
    })
    conditions.push({
      id: 'first_write_note',
      label: '说明',
      status: 'skip',
      value: '首次 GET 只写入热缓存，不命中；同 session 再次请求才会命中',
    })
  } else {
    conditions.push({
      id: 'hot_hit',
      label: '热缓存命中（本次）',
      status: 'fail',
      value: '否',
    })
  }

  const nonBlocking = new Set(['panel_repeat', 'first_write_note'])
  const blockingIds = conditions
    .filter((c) => c.status === 'fail' && !nonBlocking.has(c.id))
    .map((c) => c.id)
  return { hit, writeEligible, conditions, blockingIds }
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
    if (diagnosis.writeEligible) {
      reasons.push('首次 GET：已写入热缓存，下次同 URL 可命中')
    } else {
      reasons.push('未命中 DevTools 热缓存')
    }
  }
  return { ...diagnosis, reasons }
}
