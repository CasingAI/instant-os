/**
 * .lrc 行时间戳映射：把原始 .lrc 的每行时间戳 [mm:ss.xx] 对应到
 * 清洗后歌词文本的行序上。
 *
 * 背景：歌词导入时 stripLrcMarkup 会把 `[mm:ss.xx]` 行时间戳剥离丢弃，
 * 而 .lrc 的行时间戳是每行歌词最可靠的时间来源。这里在剥离前先用
 * parseLrc 解析出行级时间戳，再按「文本匹配」映射回清洗后行序，供
 * 对齐时做整行软锚（偏差小于阈值才采用）。
 *
 * 匹配策略：清洗后的每行在带时间戳的行里找「归一化文本相等」的第一条
 * 未消费行（重复句取最早未消费者，保持顺序对应）；找不到返回 undefined。
 *
 * 纯函数，可 node --experimental-strip-types 单测。
 */

import { parseLrc } from '../music/music-lyrics.ts'
import { normalizeForMatch } from './align-text-dtw.ts'

function normKey(text: string): string {
  return normalizeForMatch(text).replace(/\s+/g, '')
}

/**
 * @param raw 原始 .lrc 文本（含 [mm:ss.xx] 行时间戳）
 * @param cleanedLines 清洗后歌词行序（stripLrcMarkup 的输出按行切分）
 * @returns 与 cleanedLines 一一对应的行时间戳（毫秒），无对应为 undefined
 */
export function mapLrcLineTimes(
  raw: string,
  cleanedLines: string[],
): (number | undefined)[] {
  const parsed = parseLrc(raw)
  const timed = parsed.lines
    .filter((line) => line.timeMs !== undefined)
    .map((line) => ({ text: line.text, timeMs: line.timeMs as number }))
  const consumed = new Array(timed.length).fill(false)

  return cleanedLines.map((line) => {
    const key = normKey(line)
    if (!key) return undefined
    for (let i = 0; i < timed.length; i++) {
      if (consumed[i]) continue
      if (normKey(timed[i].text) === key) {
        consumed[i] = true
        return timed[i].timeMs
      }
    }
    return undefined
  })
}

/**
 * 补齐缺失的行时间戳：无值行用前后最近有值行按行序线性插值估算（毫秒）。
 * - 已有值保留;
 * - 中缺失行:前后最近有值行 t_a/a 与 t_b/b 线性插值;
 * - 首部缺失(无前值):用后值减估算行距(取全局平均行距,无则用后行距);
 * - 尾部缺失(无后值):用前值加估算行距;
 * - 整首全空:返回原样(调用方据此回退全局对齐)。
 */
export function estimateLineTimes(
  lineTimes: (number | undefined)[],
): (number | undefined)[] {
  const n = lineTimes.length
  if (n === 0) return lineTimes
  const known = lineTimes
    .map((t, i) => ({ t, i }))
    .filter((x): x is { t: number; i: number } => x.t !== undefined)
  if (known.length === 0) return lineTimes
  if (known.length === n) return lineTimes

  // 平均行距：已知相邻行(按行序)每行平均时间差的中位数，至少 0.5s
  const gaps: number[] = []
  for (let k = 1; k < known.length; k++) {
    const rowGap = known[k].i - known[k - 1].i
    gaps.push(rowGap > 0 ? (known[k].t - known[k - 1].t) / rowGap : 0)
  }
  gaps.sort((a, b) => a - b)
  const midGap = gaps.length > 0 ? gaps[Math.floor(gaps.length / 2)] : 0
  const avgGap = Math.max(500, midGap > 0 ? midGap : 500)

  const out: (number | undefined)[] = lineTimes.slice()
  // 首部缺失：从第一个已知值倒推
  for (let i = 0; i < n; i++) {
    if (out[i] !== undefined) break
    const nextKnown = known.find((x) => x.i > i)
    if (nextKnown) out[i] = nextKnown.t - (nextKnown.i - i) * avgGap
  }
  // 中/尾部缺失：前已知值 + 行距
  let lastKnown: { t: number; i: number } | undefined
  for (let i = 0; i < n; i++) {
    const cur = out[i]
    if (cur !== undefined) {
      lastKnown = { t: cur, i }
      continue
    }
    const nextKnown = known.find((x) => x.i > i)
    if (nextKnown) {
      // 中缺失：前后插值
      const a = lastKnown
      if (a) {
        const span = nextKnown.t - a.t
        const rows = nextKnown.i - a.i
        out[i] = a.t + ((i - a.i) / rows) * span
      } else {
        out[i] = nextKnown.t - (nextKnown.i - i) * avgGap
      }
    } else if (lastKnown) {
      // 尾部缺失
      out[i] = lastKnown.t + (i - lastKnown.i) * avgGap
    }
  }
  return out
}
