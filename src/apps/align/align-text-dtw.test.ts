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
import { alignTextToUnits, expandHypSegments, normalizeForMatch, phoneticMatch } from './align-text-dtw.ts'
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

// —— 6. 模糊匹配：大小写/缩写差异不再计为替换 ——
{
  const segments: HypSegment[] = [
    { symbol: "don't", start: 0.0, end: 0.3 },
    { symbol: 'stop', start: 0.3, end: 0.6 },
    { symbol: 'now', start: 0.6, end: 0.9 },
  ]
  // 歌词是词级单元（大小写 + 撇号与识别不同），归一化后应全部匹配
  const refWords = ["DON'T", 'stop', 'now'].map((text) => ({ text, phones: [] as string[] }))
  const r = alignTextToUnits(segments, refWords)
  assert.equal(r[0].start, 0.0)
  assert.equal(r[1].start, 0.3)
  assert.equal(r[2].start, 0.6)
}

// —— 7. normalizeForMatch 纯函数 ——
{
  assert.equal(normalizeForMatch("Don't"), 'dont')
  assert.equal(normalizeForMatch("I'm"), 'im')
  assert.equal(normalizeForMatch('The'), 'the')
  assert.equal(normalizeForMatch('你'), '你')
  assert.equal(normalizeForMatch('あ'), 'あ')
}

// —— 8. 发音匹配：同音 / 英文口误 / 跨文种拼音，中英硬连被拒 ——
{
  // 归一化相同仍算（大小写/缩写/同一字）
  assert.equal(phoneticMatch("Don't", 'dont'), true)
  assert.equal(phoneticMatch('大', '大'), true)
  // 汉字同音（不同字）按发音匹配；不同音不算
  assert.equal(phoneticMatch('里', '李'), true, '同音字应按发音匹配')
  assert.equal(phoneticMatch('来', '恋'), false)
  // 跨文种：识别打出该字拼音就算（lai↔来、ai↔爱）
  assert.equal(phoneticMatch('lai', '来'), true)
  assert.equal(phoneticMatch('ai', '爱'), true)
  assert.equal(phoneticMatch('JUST', '来'), false, 'JUST 不是「来」的拼音')
  assert.equal(phoneticMatch('SAY', '爱'), false, 'SAY 不是「爱」的拼音')
  // 英文识别口误：多打/漏打/插字/截断词尾
  assert.equal(phoneticMatch('YOUE', 'you'), true, '多打一个字母')
  assert.equal(phoneticMatch('JRUST', 'just'), true, '插了一个字母')
  assert.equal(phoneticMatch('HY', 'why'), true, '漏一个字母')
  assert.equal(phoneticMatch('talki', 'talking'), true, '截断词尾')
  assert.equal(phoneticMatch('love', 'live'), false, '换一个字母的不同词不算')
}

// —— 9. 对齐拿时间戳：英文口误 / 汉字拼音 / 中英硬连 ——
{
  // YOUE 识别应能对上歌词 you
  const typo = alignTextToUnits([{ symbol: 'YOUE', start: 0, end: 0.3 }], [
    { text: 'you', phones: [] },
  ])
  assert.equal(typo[0].start, 0, '英文口误应拿到识别时间')

  // 识别打出拼音 lai 应能对上「来」
  const pinyinHyp = alignTextToUnits([{ symbol: 'lai', start: 0.2, end: 0.5 }], [
    { text: '来', phones: [] },
  ])
  assert.equal(pinyinHyp[0].start, 0.2, '跨文种拼音应拿到识别时间')

  // JUST 对「来」、SAY 对「爱」：中英硬连必须被拒 → NaN
  const hard = alignTextToUnits(
    [
      { symbol: 'JUST', start: 0, end: 0.3 },
      { symbol: 'SAY', start: 0.4, end: 0.7 },
    ],
    [
      { text: '来', phones: [] },
      { text: '爱', phones: [] },
    ],
  )
  assert.ok(Number.isNaN(hard[0].start), 'JUST 不应连到「来」')
  assert.ok(Number.isNaN(hard[1].start), 'SAY 不应连到「爱」')
}
