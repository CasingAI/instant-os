/** 极简 semver：支持精确版本、^ ~ >= > <= < * x.x.x */

function parseParts(version: string): number[] | undefined {
  const cleaned = version.trim().replace(/^v/, '')
  const m = /^(\d+)\.(\d+)\.(\d+)(?:[-+].*)?$/.exec(cleaned)
  if (!m) return undefined
  return [Number(m[1]), Number(m[2]), Number(m[3])]
}

function cmp(a: number[], b: number[]): number {
  for (let i = 0; i < 3; i += 1) {
    const d = (a[i] ?? 0) - (b[i] ?? 0)
    if (d !== 0) return d
  }
  return 0
}

export function satisfiesSemver(version: string, range: string): boolean {
  const v = parseParts(version)
  if (!v) return false
  const r = range.trim()
  if (r === '' || r === '*' || r === 'x' || r === 'latest') return true

  if (r.startsWith('^')) {
    const base = parseParts(r.slice(1))
    if (!base) return false
    if (base[0] === 0) {
      if (base[1] === 0) {
        return v[0] === 0 && v[1] === 0 && v[2] === base[2]
      }
      return v[0] === 0 && v[1] === base[1] && cmp(v, base) >= 0
    }
    return v[0] === base[0] && cmp(v, base) >= 0
  }

  if (r.startsWith('~')) {
    const base = parseParts(r.slice(1))
    if (!base) return false
    return v[0] === base[0] && v[1] === base[1] && cmp(v, base) >= 0
  }

  const opMatch = /^(>=|>|<=|<|=)\s*(.+)$/.exec(r)
  if (opMatch) {
    const op = opMatch[1]!
    const base = parseParts(opMatch[2]!)
    if (!base) return false
    const c = cmp(v, base)
    if (op === '>=') return c >= 0
    if (op === '>') return c > 0
    if (op === '<=') return c <= 0
    if (op === '<') return c < 0
    return c === 0
  }

  const exact = parseParts(r)
  if (exact) return cmp(v, exact) === 0
  return false
}

/** 从版本列表中选最高且满足 range 的版本 */
export function maxSatisfying(versions: readonly string[], range: string): string | undefined {
  let best: string | undefined
  let bestParts: number[] | undefined
  for (const ver of versions) {
    if (!satisfiesSemver(ver, range)) continue
    const parts = parseParts(ver)
    if (!parts) continue
    if (!bestParts || cmp(parts, bestParts) > 0) {
      best = ver
      bestParts = parts
    }
  }
  return best
}
