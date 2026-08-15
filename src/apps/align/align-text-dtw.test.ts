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
import {
  alignTextToUnits,
  expandHypSegments,
  normalizeForMatch,
  phoneticMatch,
  weightedEditDistance,
} from './align-text-dtw.ts'
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

// —— 10. 加权编辑距离：清浊/塞音近似（pot→BOK），元音保守 ——
{
  // 浊清 + 塞音互串（p→b、t→k 各 0.5）：加权距离 1
  assert.equal(weightedEditDistance('bok', 'pot'), 1)
  assert.ok(phoneticMatch('BOK', 'pot'), 'BOK 应发音匹配 pot（清浊/塞音近似）')
  // 元音替换重罚：love/live 仍拒绝（保守）
  assert.equal(weightedEditDistance('love', 'live'), 2, '元音替换代价 2')
  assert.equal(phoneticMatch('love', 'live'), false, 'love/live 元音差异拒绝')
  // 2 字母词允许 1 处差异（HY↔why 保持）
  assert.equal(phoneticMatch('HY', 'why'), true)
  // 单字母无法近似长词
  assert.equal(phoneticMatch('BOK', 'x'), false)
}

// —— 11. 一对多段分裂：一个识别段覆盖连续两个歌词词 ——
{
  const segments: HypSegment[] = [{ symbol: 'WERL', start: 22.0, end: 22.6 }]
  const refWords = ['where', 'we'].map((text) => ({ text, phones: [] as string[] }))
  const r = alignTextToUnits(segments, refWords)
  assert.ok(Number.isFinite(r[0].start), 'where 应命中识别段')
  assert.ok(Number.isFinite(r[1].start), 'we 应命中（块分裂）')
  assert.ok(Math.abs(r[0].start - 22.0) < 1e-9, 'where 起点 = 段起点')
  assert.ok(Math.abs(r[1].end - 22.6) < 1e-9, 'we 终点 = 段终点')
  assert.ok(r[0].end <= r[1].start + 1e-9, '块内时间单调不重叠')
  // 段时长按字符比例切分：where(5)/we(2) → where 占 5/7
  const split = 22.0 + (0.6 * 5) / 7
  assert.ok(Math.abs(r[0].end - split) < 1e-9, 'where 结束按字符比例切分')
}

// —— 12. 识别段标点展开剔除（pot, → pot） ——
{
  const segments: HypSegment[] = [{ symbol: 'pot,', start: 22.0, end: 22.4 }]
  const hyp = expandHypSegments(segments)
  assert.deepEqual(hyp.map((h) => h.text), ['pot'], '段内逗号不展开为匹配单元')
  const r = alignTextToUnits(segments, [{ text: 'pot', phones: [] }])
  assert.ok(Math.abs(r[0].start - 22.0) < 1e-9, 'pot 命中（标点不干扰）')
}

// —— 13. 歌词侧标点剔出匹配序列（标点不占 DP 位、不消耗识别块） ——
{
  const segments: HypSegment[] = [{ symbol: 'BOK', start: 22.0, end: 22.3 }]
  // 歌词 "pot, that" 拆成 pot / , / that：逗号不参与 DP，BOK 仍命中 pot
  const refUnits: G2pUnit[] = ['pot', ',', 'that'].map((text) => ({ text, phones: [] }))
  const r = alignTextToUnits(segments, refUnits)
  assert.ok(Math.abs(r[0].start - 22.0) < 1e-9, 'pot 命中')
  assert.ok(Number.isNaN(r[1].start), '逗号不参与匹配（-1）')
  assert.ok(Number.isNaN(r[2].start), 'that 未匹配')
}

// —— 14. 词形变化后缀（ASR 弱读把词形读成原形） ——
{
  assert.equal(phoneticMatch('put', 'putting'), true, 'putting = put + t(双写) + ing')
  assert.equal(phoneticMatch('run', 'running'), true, 'running = run + n + ing')
  assert.equal(phoneticMatch('stop', 'stopped'), true, 'stopped = stop + p + ed')
  assert.equal(phoneticMatch('talk', 'talking'), true, 'talking = talk + ing')
  assert.equal(phoneticMatch('big', 'bigger'), true, 'bigger = big + g + er')
  assert.equal(phoneticMatch('boy', 'boys'), true, 'boys = boy + s')
  // 防误配：welcome 不以已知词形后缀结尾，单独对 wel/come 仍应拒绝（靠合并块才能对上）
  assert.equal(phoneticMatch('wel', 'welcome'), false, 'wel 不是 welcome 的词形')
  assert.equal(phoneticMatch('come', 'welcome'), false, 'come 不是 welcome 的词形')
}

// —— 15. 前缀规则优先于 2 字母分支（缩写多音节 we↔we've） ——
{
  assert.equal(phoneticMatch('we', "we've"), true, 'weve 以 we 为前缀，差 2 在前缀阈值内')
  assert.equal(phoneticMatch('love', 'live'), false, 'love/live 元音差异仍拒绝')
  assert.equal(phoneticMatch('HY', 'why'), true, '2 字母词距离分支保持')
}

// —— 16. 合并块：两个识别单元拼一个歌词词（wel+come→welcome） ——
{
  const segments: HypSegment[] = [
    { symbol: 'wel', start: 22.0, end: 22.3 },
    { symbol: 'come', start: 22.35, end: 22.9 },
  ]
  const r = alignTextToUnits(segments, [{ text: 'welcome', phones: [] }])
  assert.ok(Number.isFinite(r[0].start), 'wel+come 合并应命中 welcome')
  assert.ok(Math.abs(r[0].start - 22.0) < 1e-9, 'welcome 起点 = 第一段起点')
  assert.ok(Math.abs(r[0].end - 22.9) < 1e-9, 'welcome 终点 = 第二段终点')
}

// —— 17. 合并间隙约束：两段间隔过大不拼接 ——
{
  const segments: HypSegment[] = [
    { symbol: 'wel', start: 22.0, end: 22.3 },
    { symbol: 'come', start: 23.0, end: 23.5 }, // 间隔 0.7s > BLOCK_MAX_GAP_SEC
  ]
  const r = alignTextToUnits(segments, [{ text: 'welcome', phones: [] }])
  assert.ok(Number.isNaN(r[0].start), '间隔过大的两段不应合并成 welcome')
}

// —— 18. 合并块行区间约束：第二段起始于行尾之后不拼接 ——
// 真实数据暴露：行尾词 + 下一行行首词间隙常在 0.3s 内（more+TON、died+WE），
// 若不约束第二段行区间会跨行吞并，把下行首词的识别段拼进本行末词。
{
  const segments: HypSegment[] = [
    { symbol: 'wel', start: 22.0, end: 22.3 },
    { symbol: 'come', start: 22.5, end: 23.0 },
  ]
  // 第二段 come 起始于行尾 22.4 之后 → 拒绝合并；wel 单独也不匹配 welcome → NaN
  const r = alignTextToUnits(segments, [{ text: 'welcome', phones: [] }], {
    startSec: 21.5,
    endSec: 22.4,
  })
  assert.ok(Number.isNaN(r[0].start), '第二段超出本行演唱末尾不应合并成 welcome')
  // 对照：第二段仍在行区间内 → 合并生效，区间 = 两段拼接
  const r2 = alignTextToUnits(segments, [{ text: 'welcome', phones: [] }], {
    startSec: 21.5,
    endSec: 23.2,
  })
  assert.ok(Number.isFinite(r2[0].start), '第二段落在行区间内应正常合并')
  assert.ok(Math.abs(r2[0].start - 22.0) < 1e-9, '合并块起点 = 第一段起点')
  assert.ok(Math.abs(r2[0].end - 23.0) < 1e-9, '合并块终点 = 第二段终点')
}

// —— 19. 融合段块分裂放宽：段独立匹配前词且拼接也匹配时，允许分裂覆盖两个词 ——
// 真实数据：LIKET→like+it（行20）、CHILDRENELL→children+tell（行22）、
// YOUROM→your+mom（行25）。段本身能被前一个词的前缀规则独立匹配（liket↔like），
// 旧逻辑因此拦截块分裂，导致第二个词无识别段。拼接后也能匹配 → 应允许分裂。
{
  const likeIt: HypSegment[] = [{ symbol: 'LIKET', start: 72.3, end: 72.66 }]
  const r = alignTextToUnits(likeIt, [
    { text: 'like', phones: [] },
    { text: 'it', phones: [] },
  ])
  assert.ok(Number.isFinite(r[0].start), 'like 应从 LIKET 分到前半段时间')
  assert.ok(Number.isFinite(r[1].start), 'it 应从 LIKET 分到后半段时间（放宽后命中）')
  assert.ok(r[0].start < r[1].start, 'like 早于 it')

  const yourMom: HypSegment[] = [{ symbol: 'YOUROM', start: 87.4, end: 87.76 }]
  const r2 = alignTextToUnits(yourMom, [
    { text: 'your', phones: [] },
    { text: 'mom', phones: [] },
  ])
  assert.ok(Number.isFinite(r2[0].start), 'your 应从 YOUROM 分到前半段时间')
  assert.ok(Number.isFinite(r2[1].start), 'mom 应从 YOUROM 分到后半段时间（放宽后命中）')

  const childrenTell: HypSegment[] = [{ symbol: 'CHILDRENELL', start: 77.16, end: 77.94 }]
  const r3 = alignTextToUnits(childrenTell, [
    { text: 'children', phones: [] },
    { text: 'tell', phones: [] },
  ])
  assert.ok(Number.isFinite(r3[0].start), 'children 应从 CHILDRENELL 分到前半段时间')
  assert.ok(Number.isFinite(r3[1].start), 'tell 应从 CHILDRENELL 分到后半段时间（放宽后命中）')
}

// —— 20. 融合段块分裂护栏：段独立匹配前词但拼接不匹配时仍拦截 ——
// talking↔talki 后跟 that：talki+that 拼接与 TALKING 距离超阈值 → 仍独立匹配 talki，
// 不得分裂给 that（align-pipeline 的 testSparseAnchorsKeepRecogTime 依赖此行为）。
{
  const talking: HypSegment[] = [{ symbol: 'TALKING', start: 0.0, end: 0.4 }]
  const r = alignTextToUnits(talking, [
    { text: 'talki', phones: [] },
    { text: 'that', phones: [] },
  ])
  assert.ok(Number.isFinite(r[0].start), 'talki 应独立匹配 TALKING')
  assert.ok(Number.isNaN(r[1].start), 'that 不应被 TALKING 分裂覆盖（拼接不匹配）')
}
