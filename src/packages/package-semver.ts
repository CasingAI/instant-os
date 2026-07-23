/** 极简 semver：精确版、^ ~ 比较符、空格 AND、`||` 并集、x/* 通配、缺段补零 */

function parseParts(version: string): number[] | undefined {
  const cleaned = version.trim().replace(/^v/, '')
  // 允许 18 / 18.0 / 18.0.0；后缀 -tag / +build 忽略
  const m = /^(\d+)(?:\.(\d+))?(?:\.(\d+))?(?:[-+].*)?$/.exec(cleaned)
  if (!m) return undefined
  return [Number(m[1]), Number(m[2] ?? 0), Number(m[3] ?? 0)]
}

function cmp(a: number[], b: number[]): number {
  for (let i = 0; i < 3; i += 1) {
    const d = (a[i] ?? 0) - (b[i] ?? 0)
    if (d !== 0) return d
  }
  return 0
}

function isX(part: string): boolean {
  return part === 'x' || part === 'X' || part === '*'
}

/** 将 `7.x` / `2.x.x` / `1.*.0` 展开为可比较的上下界；非通配则返回 undefined */
function expandXRange(token: string): { lower: number[]; upperExclusive?: number[] } | undefined {
  const cleaned = token.trim().replace(/^v/, '')
  const m = /^(\d+|x|\*)(?:\.(\d+|x|\*))?(?:\.(\d+|x|\*))?(?:[-+].*)?$/i.exec(cleaned)
  if (!m) return undefined
  const parts = [m[1]!]
  if (m[2] !== undefined) parts.push(m[2])
  if (m[3] !== undefined) parts.push(m[3])
  // 必须显式出现 x/*，避免把裸 `2` 当成 `2.x.x`
  if (!parts.some(isX)) return undefined
  while (parts.length < 3) parts.push('x')

  const xAt = parts.findIndex(isX)
  const lower = [0, 0, 0]
  for (let i = 0; i < xAt; i += 1) {
    lower[i] = Number(parts[i])
  }
  // 第一个 x 在 major：任意版本
  if (xAt === 0) return { lower: [0, 0, 0] }
  // `2.x` / `2.x.x` → >=2.0.0 <3.0.0；`2.3.x` → >=2.3.0 <2.4.0
  const upperExclusive = [...lower]
  upperExclusive[xAt - 1] = (upperExclusive[xAt - 1] ?? 0) + 1
  for (let j = xAt; j < 3; j += 1) upperExclusive[j] = 0
  return { lower, upperExclusive }
}

function satisfiesComparator(version: string, comparator: string): boolean {
  const v = parseParts(version)
  if (!v) return false
  const r = comparator.trim()
  if (r === '' || r === '*' || r === 'x' || r === 'X' || r === 'latest') return true

  if (r.startsWith('^')) {
    const base = parseParts(r.slice(1))
    if (!base) return false
    if (base[0] === 0) {
      if (base[1] === 0) {
        return v[0] === 0 && v[1] === 0 && v[2] === base[2]
      }
      return v[0] === 0 && v[1] === base[1] && cmp(v, base) >= 0
    }
    // ^18 → >=18.0.0 <19.0.0（缺段已按 0 补）
    const upper = [base[0]! + 1, 0, 0]
    return cmp(v, base) >= 0 && cmp(v, upper) < 0
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

  const xRange = expandXRange(r)
  if (xRange) {
    if (cmp(v, xRange.lower) < 0) return false
    if (xRange.upperExclusive && cmp(v, xRange.upperExclusive) >= 0) return false
    return true
  }

  const exact = parseParts(r)
  if (exact) return cmp(v, exact) === 0
  return false
}

/** 单个 range 段：空格分隔的比较符取 AND（如 `>=4.3.0 <5`） */
function satisfiesAndSet(version: string, andSet: string): boolean {
  const tokens = andSet.trim().split(/\s+/).filter(Boolean)
  if (tokens.length === 0) return true
  return tokens.every((token) => satisfiesComparator(version, token))
}

export function satisfiesSemver(version: string, range: string): boolean {
  const r = range.trim()
  if (r === '' || r === '*' || r === 'x' || r === 'X' || r === 'latest') return true

  // `||` 并集：任一分支满足即可
  const unions = r.split(/\|\|/).map((s) => s.trim()).filter(Boolean)
  if (unions.length === 0) return false
  return unions.some((branch) => satisfiesAndSet(version, branch))
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
