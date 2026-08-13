/**
 * 识别文本 ↔ 歌词字级对齐单测（node --experimental-strip-types 直接跑）。
 * 验证：
 *  1. 完全一致：逐字取识别时间戳
 *  2. 漏识别：歌词多出的字返回 NaN
 *  3. 多识别：识别多出的字被跳过，其余字时间戳正确
 *  4. 多字 token 展开：一个 token 内多个字均分时长
 *  5. 空输入兜底
 */

import assert from 'node:assert/strict'
import { alignTextToUnits, expandHypSegments } from './align-text-dtw.ts'
import type { G2pUnit, HypSegment } from './align-text-dtw.ts'

const ref = (text: string): G2pUnit[] =>
  Array.from(text).map((t) => ({ text: t, phones: [] }))

// —— 1. 完全一致 ——
{
  const segments: HypSegment[] = [
    { symbol: '你', start: 0.0, end: 0.2 },
    { symbol: '好', start: 0.2, end: 0.4 },
    { symbol: '世', start: 0.4, end: 0.6 },
    { symbol: '界', start: 0.6, end: 0.8 },
  ]
  const r = alignTextToUnits(segments, ref('你好世界'))
  assert.deepEqual(r, [
    { start: 0.0, end: 0.2 },
    { start: 0.2, end: 0.4 },
    { start: 0.4, end: 0.6 },
    { start: 0.6, end: 0.8 },
  ])
}

// —— 2. 漏识别（歌词比识别多） ——
{
  const segments: HypSegment[] = [
    { symbol: '你', start: 0.0, end: 0.2 },
    { symbol: '好', start: 0.2, end: 0.4 },
  ]
  const r = alignTextToUnits(segments, ref('你好世界'))
  assert.equal(r[0].start, 0.0)
  assert.equal(r[1].start, 0.2)
  assert.ok(Number.isNaN(r[2].start), '世 应未匹配')
  assert.ok(Number.isNaN(r[3].start), '界 应未匹配')
}

// —— 3. 多识别（识别比歌词多，被跳过） ——
{
  const segments: HypSegment[] = [
    { symbol: '你', start: 0.0, end: 0.2 },
    { symbol: '很', start: 0.2, end: 0.35 },
    { symbol: '美', start: 0.35, end: 0.5 },
    { symbol: '好', start: 0.5, end: 0.7 },
  ]
  const r = alignTextToUnits(segments, ref('你好'))
  assert.equal(r[0].start, 0.0)
  assert.equal(r[1].start, 0.5)
}

// —— 4. 多字 token 展开 ——
{
  const segments: HypSegment[] = [
    { symbol: '你好', start: 0.0, end: 0.4 }, // 一个 token 含两字
    { symbol: '世界', start: 0.4, end: 0.8 },
  ]
  const hyp = expandHypSegments(segments)
  assert.deepEqual(
    hyp.map((h) => h.text),
    ['你', '好', '世', '界'],
  )
  assert.equal(hyp[0].start, 0.0)
  assert.equal(hyp[0].end, 0.2)
  assert.equal(hyp[1].start, 0.2)
  assert.equal(hyp[3].end, 0.8)

  const r = alignTextToUnits(segments, ref('你好世界'))
  assert.equal(r[2].start, 0.4)
  assert.equal(r[3].end, 0.8)
}

// —— 5. 空输入兜底 ——
{
  assert.deepEqual(alignTextToUnits([], ref('你好')), [
    { start: Number.NaN, end: Number.NaN },
    { start: Number.NaN, end: Number.NaN },
  ])
  assert.deepEqual(alignTextToUnits([{ symbol: '你', start: 0, end: 0.1 }], []), [])
}
