/**
 * 行时间戳映射单测（node --experimental-strip-types 直接跑）。
 * 验证：
 *  1. 基本映射：清洗后每行拿到对应行时间戳；
 *  2. 重复行：取最早未消费时间戳（顺序对应）；
 *  3. 无时间戳/未匹配 → undefined；
 *  4. offset 元数据已应用；
 *  5. 增强 LRC 逐字行也能匹配；
 *  6. 大小写/撇号差异不影响匹配。
 */

import assert from 'node:assert/strict'
import { mapLrcLineTimes, estimateLineTimes, expandStarvedLineTimes, MIN_LINE_WORD_MS } from './align-line-times.ts'

// —— 1. 基本映射 ——
{
  const raw =
    '[00:11.20]Hello world\n' +
    '[00:15.80]This is a song\n' +
    '[00:20.10]La la la'
  const times = mapLrcLineTimes(raw, ['Hello world', 'This is a song', 'La la la'])
  assert.deepEqual(times, [11200, 15800, 20100])
}

// —— 2. 重复行：取最早未消费时间戳 ——
{
  const raw =
    '[00:11.20]Never gonna give\n' +
    '[00:15.80]Never gonna give\n' +
    '[00:20.10]You up'
  const times = mapLrcLineTimes(raw, ['Never gonna give', 'You up', 'Never gonna give'])
  assert.deepEqual(times, [11200, 20100, 15800])
}

// —— 3. 无时间戳/未匹配 → undefined ——
{
  const raw = '[00:11.20]Hello world'
  const times = mapLrcLineTimes(raw, ['Hello world', 'Missing line', ''])
  assert.deepEqual(times, [11200, undefined, undefined])
}

// —— 4. offset 已应用 ——
{
  const raw = '[offset:+500]\n[00:11.20]Hello world'
  const times = mapLrcLineTimes(raw, ['Hello world'])
  assert.deepEqual(times, [11700])
}

// —— 5. 增强 LRC 逐字行 ——
{
  const raw = '[00:11.20]<00:11.20>He<00:11.50>llo world'
  const times = mapLrcLineTimes(raw, ['Hello world'])
  assert.deepEqual(times, [11200])
}

// —— 6. 大小写/撇号差异不影响匹配 ——
{
  const raw = "[00:11.20]Don't stop"
  const times = mapLrcLineTimes(raw, ["DON'T stop"])
  assert.deepEqual(times, [11200])
}

// —— 7. estimateLineTimes：中间缺失行线性插值 ——
{
  const times = estimateLineTimes([10000, undefined, undefined, 16000])
  assert.deepEqual(times, [10000, 12000, 14000, 16000])
}

// —— 8. estimateLineTimes：首部缺失用后值倒推 ——
{
  const times = estimateLineTimes([undefined, undefined, 15000, 19000])
  // 已知相邻行 i=2→i=3 差 4000ms（每行 4000ms），倒推 i=1=11000、i=0=7000
  assert.deepEqual(times, [7000, 11000, 15000, 19000])
}

// —— 9. estimateLineTimes：尾部缺失用前值续推 ——
{
  const times = estimateLineTimes([10000, 14000, undefined, undefined])
  assert.equal(times[2], 18000)
  assert.equal(times[3], 22000)
}

// —— 10. estimateLineTimes：全空/全满/空数组保持原样 ——
{
  assert.deepEqual(estimateLineTimes([undefined, undefined]), [undefined, undefined])
  assert.deepEqual(estimateLineTimes([10000, 20000]), [10000, 20000])
  assert.deepEqual(estimateLineTimes([]), [])
}

// —— 11. expandStarvedLineTimes：挤在一起的行被撑开 ——
{
  // 6 词行只有 50ms 间隔 → 下一行推迟到 180ms×6
  const times = [123860, 123910, 127760]
  const out = expandStarvedLineTimes(times, [6, 4, 4], 140000)
  assert.equal(out[0], 123860)
  assert.equal(out[1], 123860 + 6 * MIN_LINE_WORD_MS)
  assert.ok(out[1] - out[0] >= 6 * MIN_LINE_WORD_MS)
  // 第二行到第三行原有约 3.8s，够用，第三行保持
  assert.equal(out[2], 127760)
}

// —— 12. expandStarvedLineTimes：连续挤在一起的多行级联推迟 ——
{
  const t0 = 127760
  const times = [t0, t0 + 10, t0 + 70, t0 + 210, 134240]
  const counts = [5, 7, 4, 8, 3]
  const out = expandStarvedLineTimes(times, counts, 150000)
  assert.equal(out[0], t0)
  assert.equal(out[1], t0 + 5 * MIN_LINE_WORD_MS)
  assert.equal(out[2], out[1] + 7 * MIN_LINE_WORD_MS)
  assert.equal(out[3], out[2] + 4 * MIN_LINE_WORD_MS)
  // 最后一行原时间仍晚于撑开后的前一行，保持
  assert.equal(out[4], 134240)
  for (let i = 0; i < counts.length - 1; i++) {
    assert.ok(
      out[i + 1] - out[i] >= counts[i] * MIN_LINE_WORD_MS,
      `行 ${i} 间隔应 >= ${counts[i] * MIN_LINE_WORD_MS}，实际 ${out[i + 1] - out[i]}`,
    )
  }
}

// —— 13. expandStarvedLineTimes：间隔充足时不改 ——
{
  const times = [10000, 14000, 18000]
  assert.deepEqual(expandStarvedLineTimes(times, [3, 3, 3], 22000), times)
}

// —— 14. expandStarvedLineTimes：空输入 ——
{
  assert.deepEqual(expandStarvedLineTimes([], [], 0), [])
}
