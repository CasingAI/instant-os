import type { ChromoNetworkEntry, ChromoNetworkHotProbeResult } from './chromo-bridge.ts'

export type HotCacheHelpContext = {
  disableNetworkCache?: boolean
  /** All network entries in the current tab (panel history only; not SW cache state). */
  entries?: ChromoNetworkEntry[]
  /**
   * Result of VC_NETWORK_HOT_PROBE (undefined = not probed yet; null = probe failed).
   * Hot cache is global method+URL+TTL — not session-scoped.
   */
  swProbe?: ChromoNetworkHotProbeResult | null
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

function formatExpiresAt(expiresAt: number | undefined): string {
  if (typeof expiresAt !== 'number' || !Number.isFinite(expiresAt)) {
    return ''
  }
  try {
    return new Date(expiresAt).toLocaleString()
  } catch {
    return String(expiresAt)
  }
}

/**
 * Diagnose why a Network entry did or did not hit DevTools hot cache.
 * Hot cache is global (SW Cache Storage, method+URL+TTL); panel URL history is informational only.
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
    label: '禁用缓存已关闭',
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
      id: 'body_stored',
      label: '响应正文已写入（hasBody）',
      status: 'skip',
      value: '—',
    })
  } else if (pending) {
    conditions.push({
      id: 'body_stored',
      label: '响应正文已写入（hasBody）',
      status: 'pending',
      value: '进行中',
    })
  } else {
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
    value: writePending ? '进行中' : writeEligible ? '是' : '否',
  })

  // Panel list history only — not SW Cache Storage state; never blocks.
  conditions.push({
    id: 'panel_repeat',
    label: '列表内重复 URL（仅供参考）',
    status: pending ? 'pending' : hadPrior ? 'pass' : 'skip',
    value: pending ? '进行中' : hadPrior ? '是' : '否（列表首次）',
  })

  if ('swProbe' in context) {
    if (context.swProbe === undefined) {
      conditions.push({
        id: 'sw_has_entry',
        label: 'SW 中已有该 URL 条目',
        status: 'pending',
        value: '探测中…',
      })
    } else if (context.swProbe === null) {
      conditions.push({
        id: 'sw_has_entry',
        label: 'SW 中已有该 URL 条目',
        status: 'skip',
        value: '探测失败',
      })
    } else {
      const { exists, fresh, expiresAt } = context.swProbe
      conditions.push({
        id: 'sw_has_entry',
        label: 'SW 中已有该 URL 条目',
        status: exists ? 'pass' : 'skip',
        value: exists ? '是' : '否',
      })
      if (exists) {
        const expiresLabel = formatExpiresAt(expiresAt)
        conditions.push({
          id: 'sw_entry_fresh',
          label: '条目未过期（fresh）',
          status: fresh ? 'pass' : 'skip',
          value: fresh
            ? expiresLabel
              ? `是（至 ${expiresLabel}）`
              : '是'
            : expiresLabel
              ? `否（已过期于 ${expiresLabel}）`
              : '否',
        })
      }
    }
  }

  const wroteHot = entry.hotStored === true
  const writeReportedFail =
    writeEligible && !hit && entry.hotStored === false && !pending
  const probeFresh = context.swProbe && typeof context.swProbe === 'object'
    ? context.swProbe.fresh
    : undefined

  if (pending) {
    conditions.push({
      id: 'hot_hit',
      label: '热缓存命中（本次）',
      status: 'pending',
      value: '进行中',
    })
  } else if (hit) {
    conditions.push({
      id: 'hot_hit',
      label: '热缓存命中（本次）',
      status: 'pass',
      value: '是',
    })
  } else if (writeReportedFail) {
    conditions.push({
      id: 'hot_hit',
      label: '热缓存命中（本次）',
      status: 'fail',
      value: '否',
    })
    conditions.push({
      id: 'hot_store_fail',
      label: '热缓存写入',
      status: 'fail',
      value: '失败（满足条件但未写入）',
    })
  } else if (writeEligible || wroteHot) {
    conditions.push({
      id: 'hot_hit',
      label: '热缓存命中（本次）',
      status: 'skip',
      value: '否',
    })
    if (wroteHot && probeFresh === false) {
      conditions.push({
        id: 'miss_note',
        label: '说明',
        status: 'skip',
        value: '已写入但条目已过期，或本次未命中',
      })
    } else if (wroteHot && probeFresh === true) {
      conditions.push({
        id: 'miss_note',
        label: '说明',
        status: 'skip',
        value: '条目仍 fresh，本次未走 cache（可能随机 URL / 条件变化）',
      })
    } else if (wroteHot) {
      conditions.push({
        id: 'miss_note',
        label: '说明',
        status: 'skip',
        value: '本次已写入全局热缓存；有未过期条目时再次请求可命中',
      })
    }
  } else {
    conditions.push({
      id: 'hot_hit',
      label: '热缓存命中（本次）',
      status: 'fail',
      value: '否',
    })
  }

  const nonBlocking = new Set([
    'panel_repeat',
    'miss_note',
    'sw_has_entry',
    'sw_entry_fresh',
  ])
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
      reasons.push('已写入全局热缓存；有未过期条目时再次请求可命中')
    } else {
      reasons.push('未命中开发者工具热缓存')
    }
  }
  return { ...diagnosis, reasons }
}
