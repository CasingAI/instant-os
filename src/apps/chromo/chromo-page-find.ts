export type ChromoFindResult = {
  count: number
  index: number
  error?: string
}

export function parseChromoFindResult(value: unknown): ChromoFindResult {
  if (!value || typeof value !== 'object') {
    return { count: 0, index: -1, error: '查找失败' }
  }
  const record = value as Record<string, unknown>
  if (typeof record.error === 'string' && record.error) {
    return { count: 0, index: -1, error: record.error }
  }
  const count = typeof record.count === 'number' ? record.count : 0
  const index = typeof record.index === 'number' ? record.index : -1
  return { count, index }
}

/** 与页内 wrapMatches 相同的大小写不敏感计数（含 maxMarks 上限）。 */
export function countChromoFindMatches(text: string, query: string, maxMarks = 500): number {
  const q = String(query || '')
  if (!q) {
    return 0
  }
  const lowerQ = q.toLowerCase()
  const lower = text.toLowerCase()
  let count = 0
  let idx = 0
  let pos = lower.indexOf(lowerQ, idx)
  while (pos !== -1) {
    if (count >= maxMarks) {
      break
    }
    count += 1
    idx = pos + q.length
    if (!q.length) {
      break
    }
    pos = lower.indexOf(lowerQ, idx)
  }
  return count
}

export function buildChromoFindSearchEval(query: string): string {
  return `(function () {
    var api = window.__chromoPageChrome;
    if (!api || typeof api.findSearch !== 'function') {
      return { error: '页面查找尚未就绪' };
    }
    return api.findSearch(${JSON.stringify(query)});
  })()`
}

export function buildChromoFindStepEval(direction: 'next' | 'prev'): string {
  return `(function () {
    var api = window.__chromoPageChrome;
    if (!api || typeof api.findStep !== 'function') {
      return { error: '页面查找尚未就绪' };
    }
    return api.findStep(${JSON.stringify(direction)});
  })()`
}

export const CHROMO_FIND_CLEAR_SCRIPT = `(function () {
  var api = window.__chromoPageChrome;
  if (!api || typeof api.findClear !== 'function') {
    return { count: 0, index: -1 };
  }
  return api.findClear();
})()`
