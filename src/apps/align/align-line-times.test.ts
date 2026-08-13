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
import { mapLrcLineTimes, estimateLineTimes } from './align-line-times.ts'

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
