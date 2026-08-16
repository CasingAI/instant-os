/**
 * 歌词行级备选引擎补救纯函数单测（node --experimental-strip-types 直接跑）。
 * 验证：scoreLineUnits（匹配度评分）、shouldRescueLine（补救触发）、
 * pickBestLine（选优）、rescueLine（方案1/方案2 编排与偏移）。
 */

import assert from 'node:assert/strict'
import type { HypSegment } from '../align/align-text-dtw.ts'
import type { LyricsLine } from '../music/music-lyrics.ts'
import type { LineStats } from './lyrics-analysis.ts'
import {
  pickBestLine,
  rescueLine,
  scoreLineUnits,
  shouldRescueLine,
} from './lyrics-line-rescue.ts'

/** 构造带逐字词的 LyricsLine */
function mkLine(words: { text: string; failed?: boolean }[], timeMs = 0): LyricsLine {
  return {
    timeMs,
    text: words.map((w) => w.text).join(''),
    words: words.map((w, i) => ({ text: w.text, timeMs: timeMs + i * 100, failed: w.failed })),
  }
}

/** 构造 LineStats（默认正常） */
function mkStats(overrides: Partial<LineStats>): LineStats {
  return {
    lineIndex: 0,
    timeSec: 10,
    text: '',
    wordCount: 0,
    failedCount: 0,
    spanSec: 2,
    squeezed: false,
    hasParen: false,
    ...overrides,
  }
}

// —— scoreLineUnits：非标点词非红词比例 ——
{
  assert.equal(scoreLineUnits(mkLine([{ text: '大' }, { text: '家' }])), 1, '全对上 → 1')
  assert.equal(scoreLineUnits(mkLine([{ text: '大' }, { text: '家', failed: true }])), 0.5, '一半红 → 0.5')
  assert.equal(
    scoreLineUnits(mkLine([{ text: '大' }, { text: '，' }, { text: '家', failed: true }])),
    0.5,
    '标点不进分母，红词仍在内容词中计',
  )
  assert.equal(scoreLineUnits(mkLine([{ text: '大' }, { text: '，', failed: true }])), 1, '标点失败不计入')
  assert.equal(scoreLineUnits(mkLine([])), 0, '无词 → 0')
}

// —— shouldRescueLine：挤压 / 红词比例阈值 ——
{
  const halfRed = mkLine([{ text: '大' }, { text: '家', failed: true }])
  assert.equal(shouldRescueLine(mkStats({}), halfRed), true, '红词比例 0.5 触发')
  assert.equal(shouldRescueLine(mkStats({ squeezed: true }), halfRed), true, '挤压触发')
  assert.equal(shouldRescueLine(mkStats({ squeezed: true }), mkLine([{ text: '大' }, { text: '家' }])), true, '挤压即使无红词也触发')
  assert.equal(shouldRescueLine(mkStats({}), mkLine([{ text: '大' }, { text: '家' }])), false, '全对上不触发')
  assert.equal(shouldRescueLine(mkStats({}), mkLine([{ text: '…' }, { text: '，' }])), false, '无内容词不触发')
}

// —— pickBestLine：匹配度选优 ——
{
  const worse = mkLine([{ text: '大' }, { text: '家', failed: true }])
  const better = mkLine([{ text: '大' }, { text: '家' }])
  assert.equal(
    pickBestLine([
      { line: worse, source: 'rescue-recognize' },
      { line: better, source: 'rescue-ctc' },
    ])?.line,
    better,
    '选评分最高',
  )
  assert.equal(
    pickBestLine([
      { line: better, source: 'rescue-recognize' },
      { line: worse, source: 'rescue-ctc' },
    ])?.line,
    better,
    '同分取先出现（方案 1 优先）',
  )
  assert.equal(pickBestLine([]), null, '空候选 → null')
  assert.equal(
    pickBestLine([
      { line: mkLine([]), source: 'rescue-recognize' },
      { line: worse, source: 'rescue-ctc' },
    ])?.line,
    worse,
    '无词候选被跳过',
  )
  assert.equal(
    pickBestLine([
      { line: worse, source: 'rescue-recognize' },
      { line: better, source: 'rescue-ctc' },
    ])?.source,
    'rescue-ctc',
    '来源随胜出候选带回',
  )
}

// —— pickBestLine：原行基线比较，候选不优于原行 → null ——
{
  const worse = mkLine([{ text: '大' }, { text: '家', failed: true }]) // 0.5 分
  const bad = mkLine([{ text: '大' }, { text: '家', failed: true }, { text: '好', failed: true }]) // 0.33 分
  assert.equal(
    pickBestLine([{ line: bad, source: 'rescue-recognize' }], 0.5),
    null,
    '候选 0.33 分不优于原行 0.5 分 → 不替换',
  )
  assert.equal(
    pickBestLine([{ line: worse, source: 'rescue-recognize' }], 0.5),
    null,
    '候选与基线同分 → 不替换（严格大于）',
  )
  assert.equal(
    pickBestLine([{ line: worse, source: 'rescue-recognize' }], 0.4)?.line,
    worse,
    '候选 0.5 分优于基线 0.4 分 → 替换',
  )
  assert.equal(
    pickBestLine([{ line: worse, source: 'rescue-recognize' }], 1)?.line,
    undefined,
    '基线已满分 → 不替换',
  )
}

// —— rescueLine：方案 1 全对上直接返回，跳过方案 2 ——
{
  let forcedCalled = false
  const result = await rescueLine({
    lineText: '大家',
    slice: new Float32Array(100),
    startSec: 10,
    hasLineTime: true,
    callbacks: {
      recognize: async () => ({ segments: [{ symbol: '大', start: 0, end: 0.2 }] }),
      forcedAlign: async () => {
        forcedCalled = true
        return null
      },
      alignBySegments: () => mkLine([{ text: '大' }, { text: '家' }]),
    },
  })
  assert.ok(result.line)
  assert.equal(scoreLineUnits(result.line!), 1, '方案 1 全对上')
  assert.equal(result.source, 'rescue-recognize', '满分时标记方案 1')
  assert.equal(forcedCalled, false, '方案 1 已满分则不再试方案 2')
}

// —— rescueLine：识别段偏移回全局时间轴 ——
{
  let seen: HypSegment[] | null = null
  const result = await rescueLine({
    lineText: '大',
    slice: new Float32Array(100),
    startSec: 30,
    hasLineTime: false,
    callbacks: {
      recognize: async () => ({ segments: [{ symbol: '大', start: 1, end: 1.5 }] }),
      forcedAlign: async () => {
        throw new Error('无行时间戳不应调用 CTC')
      },
      alignBySegments: (segs) => {
        seen = segs
        return mkLine([{ text: '大' }])
      },
    },
  })
  assert.ok(result.line)
  assert.equal(result.source, 'rescue-recognize', '识别路径标记方案 1')
  assert.equal(seen?.[0].start, 31, '识别段起点偏移回全局轴')
  assert.equal(seen?.[0].end, 31.5, '识别段终点偏移回全局轴')
}

// —— rescueLine：方案 2（CTC）匹配度更高时胜出，单元偏移回全局轴 ——
{
  const best = await rescueLine({
    lineText: '大家',
    slice: new Float32Array(100),
    startSec: 10,
    hasLineTime: true,
    callbacks: {
      // 方案 1 只对上半个词（0.5 分）
      recognize: async () => ({ segments: [{ symbol: '大', start: 0, end: 0.2 }] }),
      forcedAlign: async () => [
        { text: '大', start: 0.1, end: 0.2, confident: true },
        { text: '家', start: 0.2, end: 0.4, confident: true },
      ],
      alignBySegments: () => mkLine([{ text: '大' }, { text: '家', failed: true }]),
    },
  })
  assert.ok(best.line)
  assert.equal(scoreLineUnits(best.line!), 1, 'CTC 全对上胜出')
  assert.equal(best.source, 'rescue-ctc', 'CTC 更高分时标记方案 2')
  assert.equal(best.line!.words?.[0].timeMs, 10100, 'CTC 单元偏移回全局轴（10 + 0.1s）')
  assert.equal(best.line!.words?.[1].failed, undefined, 'confident=true → 非红词')
}

// —— rescueLine：CTC 单元 confident=false → 红词标记 ——
{
  const red = await rescueLine({
    lineText: '大家',
    slice: new Float32Array(100),
    startSec: 0,
    hasLineTime: true,
    callbacks: {
      recognize: async () => null,
      forcedAlign: async () => [
        { text: '大', start: 0, end: 0.2, confident: true },
        { text: '家', start: 0.2, end: 0.4, confident: false },
      ],
      alignBySegments: () => null,
    },
  })
  assert.ok(red.line)
  assert.equal(red.line!.words?.[1].failed, true, 'confident=false → 红词')
  assert.equal(red.source, 'rescue-ctc', '仅 CTC 成功时标记方案 2')
}

// —— rescueLine：hasLineTime=false 不跑 CTC ——
{
  let forced = 0
  const result = await rescueLine({
    lineText: '大',
    slice: new Float32Array(100),
    startSec: 0,
    hasLineTime: false,
    callbacks: {
      recognize: async () => null,
      forcedAlign: async () => {
        forced += 1
        return [{ text: '大', start: 0, end: 0.2, confident: true }]
      },
      alignBySegments: () => null,
    },
  })
  assert.equal(result.line, null, '识别失败且无 CTC 时整体失败')
  assert.equal(result.source, null, '全部失败来源为 null')
  assert.equal(forced, 0, '无行时间戳不调用 CTC 方案')
}

// —— rescueLine：两方案均失败 → null ——
{
  const result = await rescueLine({
    lineText: '大家',
    slice: new Float32Array(100),
    startSec: 0,
    hasLineTime: true,
    callbacks: {
      recognize: async () => null,
      forcedAlign: async () => null,
      alignBySegments: () => null,
    },
  })
  assert.equal(result.line, null, '全部失败返回 null（调用方保持原行）')
  assert.equal(result.source, null, '全部失败来源为 null')
}

// —— rescueLine：currentLine 基线——候选不优于原行 → null（保持原行） ——
{
  // 原行 0.5 分；方案 1 候选 0.33 分 → 不替换
  const result = await rescueLine({
    lineText: '大家好',
    slice: new Float32Array(100),
    startSec: 0,
    hasLineTime: true,
    currentLine: mkLine([{ text: '大' }, { text: '家', failed: true }]),
    callbacks: {
      recognize: async () => ({ segments: [{ symbol: '大', start: 0, end: 0.2 }] }),
      forcedAlign: async () => null,
      alignBySegments: () => mkLine([{ text: '大' }, { text: '家', failed: true }, { text: '好', failed: true }]),
    },
  })
  assert.equal(result.line, null, '候选不优于原行 → 保持原行')
  assert.equal(result.source, null, '来源为 null')
}

// —— rescueLine：currentLine 基线——原行全红 0 分，候选 0.5 分 → 替换 ——
{
  const result = await rescueLine({
    lineText: '大家',
    slice: new Float32Array(100),
    startSec: 0,
    hasLineTime: true,
    currentLine: mkLine([{ text: '大', failed: true }, { text: '家', failed: true }]),
    callbacks: {
      recognize: async () => ({ segments: [{ symbol: '大', start: 0, end: 0.2 }] }),
      forcedAlign: async () => null,
      alignBySegments: () => mkLine([{ text: '大' }, { text: '家', failed: true }]),
    },
  })
  assert.ok(result.line)
  assert.equal(scoreLineUnits(result.line!), 0.5, '候选 0.5 分')
  assert.equal(result.source, 'rescue-recognize', '优于原行 0 分 → 方案 1 胜出')
}

// —— rescueLine：currentLine 已满分 → 直接保持原行，不跑任何方案 ——
{
  let recognizeCalled = false
  const result = await rescueLine({
    lineText: '大家',
    slice: new Float32Array(100),
    startSec: 0,
    hasLineTime: true,
    currentLine: mkLine([{ text: '大' }, { text: '家' }]),
    callbacks: {
      recognize: async () => {
        recognizeCalled = true
        return { segments: [{ symbol: '大', start: 0, end: 0.2 }] }
      },
      forcedAlign: async () => null,
      alignBySegments: () => mkLine([{ text: '大' }, { text: '家' }]),
    },
  })
  assert.equal(result.line, null, '原行已满分 → 保持原行')
  assert.equal(recognizeCalled, false, '不再跑任何备选方案')
}

// —— pickBestLine：候选回填 score（复盘留痕；未选中的候选也带分） ——
{
  const worse = mkLine([{ text: '大' }, { text: '家', failed: true }]) // 0.5
  const better = mkLine([{ text: '大' }, { text: '家' }]) // 1.0
  const c1: Parameters<typeof pickBestLine>[0][number] = {
    line: worse,
    source: 'rescue-recognize',
  }
  const c2 = { line: better, source: 'rescue-ctc' }
  const picked = pickBestLine([c1, c2])
  assert.equal(picked?.line, better, '选评分最高')
  assert.equal(c1.score, 0.5, '未选中的候选也回填 score')
  assert.equal(c2.score, 1, '胜出候选 score 回填')
}

// —— rescueLine：结果带 segments / score / baselineScore（追踪图证据 + 复盘留痕） ——
{
  const result = await rescueLine({
    lineText: '大家',
    slice: new Float32Array(100),
    startSec: 10,
    hasLineTime: true,
    currentLine: mkLine([{ text: '大' }, { text: '家', failed: true }], 0), // 原行 0.5 分
    callbacks: {
      // 方案 1 全对上 → 提前返回，带识别段
      recognize: async () => ({ segments: [{ symbol: '大', start: 0, end: 0.2 }] }),
      forcedAlign: async () => null,
      alignBySegments: () => mkLine([{ text: '大' }, { text: '家' }]),
    },
  })
  assert.ok(result.line, '候选胜出')
  assert.equal(result.source, 'rescue-recognize')
  assert.ok(result.segments && result.segments.length === 1, '结果带方案 1 识别段')
  assert.equal(result.segments![0].start, 10, '识别段已偏移回全局轴')
  assert.equal(result.score, 1, '采用候选的匹配度')
  assert.equal(result.baselineScore, 0.5, '原行基线匹配度')
}

// —— rescueLine：候选不优于原行 → line null 但 baselineScore 保留 ——
{
  const result = await rescueLine({
    lineText: '大家好',
    slice: new Float32Array(100),
    startSec: 0,
    hasLineTime: true,
    currentLine: mkLine([{ text: '大' }, { text: '家', failed: true }]), // 原行 0.5 分
    callbacks: {
      recognize: async () => ({ segments: [{ symbol: '大', start: 0, end: 0.2 }] }),
      forcedAlign: async () => null,
      alignBySegments: () =>
        mkLine([{ text: '大' }, { text: '家', failed: true }, { text: '好', failed: true }]), // 0.33 分
    },
  })
  assert.equal(result.line, null, '候选不优于原行 → 保持原行')
  assert.equal(result.baselineScore, 0.5, '失败也保留原行基线分供复盘')
  assert.equal(result.score, undefined, '未采用时无候选分')
}

// —— rescueLine：未注入 autoStretchSearch 时行为不变（兼容回归） ——
{
  const result = await rescueLine({
    lineText: '大家',
    slice: new Float32Array(100),
    startSec: 0,
    hasLineTime: true,
    callbacks: {
      recognize: async () => ({ segments: [{ symbol: '大', start: 0, end: 0.2 }] }),
      forcedAlign: async () => [
        { text: '大', start: 0.1, end: 0.2, confident: true },
        { text: '家', start: 0.2, end: 0.4, confident: true },
      ],
      alignBySegments: () => mkLine([{ text: '大' }, { text: '家', failed: true }]),
    },
  })
  assert.ok(result.line)
  assert.equal(result.source, 'rescue-ctc', '无放慢搜索回调时走原方案 2（CTC）')
}

// —— rescueLine：放慢搜索 score=1 → 提前停，标记 rescue-slow（不跑 CTC） ——
{
  let forcedCalled = false
  const result = await rescueLine({
    lineText: '大家',
    slice: new Float32Array(100),
    startSec: 10,
    hasLineTime: true,
    currentLine: mkLine([{ text: '大' }, { text: '家', failed: true }]), // 原行 0.5 分
    callbacks: {
      // 方案 1 只对上半个词（0.5 分），继续
      recognize: async () => ({ segments: [{ symbol: '大', start: 0, end: 0.2 }] }),
      autoStretchSearch: async () => ({
        line: mkLine([{ text: '大' }, { text: '家' }]),
        segments: [{ symbol: '大', start: 10, end: 10.2 }],
        model: 'sense-voice',
        score: 1,
      }),
      forcedAlign: async () => {
        forcedCalled = true
        return null
      },
      alignBySegments: () => mkLine([{ text: '大' }, { text: '家', failed: true }]),
    },
  })
  assert.ok(result.line)
  assert.equal(result.source, 'rescue-slow', '放慢搜索满分 → 标记方案 2 放慢')
  assert.equal(result.model, 'sense-voice', '放慢搜索模型随结果带回')
  assert.equal(result.segments?.[0].start, 10, '放慢搜索段已是全局轴')
  assert.equal(forcedCalled, false, '放慢搜索已满分则不再试 CTC')
}

// —— rescueLine：放慢搜索 score<1 但高于原速候选 → 采用 rescue-slow（带模型） ——
{
  const result = await rescueLine({
    lineText: '大家好',
    slice: new Float32Array(100),
    startSec: 0,
    hasLineTime: true,
    currentLine: mkLine([{ text: '大' }, { text: '家', failed: true }, { text: '好', failed: true }]), // 0.33
    callbacks: {
      // 方案 1 0.5 分
      recognize: async () => ({ segments: [{ symbol: '大', start: 0, end: 0.2 }] }),
      autoStretchSearch: async () => ({
        line: mkLine([{ text: '大' }, { text: '家' }, { text: '好', failed: true }]), // 0.67 分
        segments: [{ symbol: '大', start: 0, end: 0.2 }],
        model: 'zipformer',
        score: 0.67,
      }),
      forcedAlign: async () => null,
      alignBySegments: () => mkLine([{ text: '大' }, { text: '家', failed: true }]),
    },
  })
  assert.ok(result.line)
  assert.equal(result.source, 'rescue-slow', '放慢搜索高分胜出')
  assert.equal(result.model, 'zipformer', '采用候选的模型带回')
}

// —— rescueLine：放慢搜索返回 null、原速/CTC 均失败 → 失败语义不变 ——
{
  const result = await rescueLine({
    lineText: '大家',
    slice: new Float32Array(100),
    startSec: 0,
    hasLineTime: true,
    callbacks: {
      recognize: async () => null,
      autoStretchSearch: async () => null,
      forcedAlign: async () => null,
      alignBySegments: () => null,
    },
  })
  assert.equal(result.line, null, '全部失败返回 null（保持原行）')
  assert.equal(result.source, null, '全部失败来源为 null')
}

// —— rescueLine：放慢搜索返回空词行（无 words）→ 视为无候选 ——
{
  const result = await rescueLine({
    lineText: '大家',
    slice: new Float32Array(100),
    startSec: 0,
    hasLineTime: true,
    currentLine: mkLine([{ text: '大' }, { text: '家', failed: true }]), // 0.5 分
    callbacks: {
      recognize: async () => null,
      autoStretchSearch: async () => ({
        line: mkLine([]),
        segments: [],
        model: 'sense-voice',
        score: 0,
      }),
      forcedAlign: async () => null,
      alignBySegments: () => null,
    },
  })
  assert.equal(result.line, null, '放慢搜索空行不作为候选')
}

// —— rescueLine：放慢搜索候选不优于原行 → 保持原行 ——
{
  const result = await rescueLine({
    lineText: '大家好',
    slice: new Float32Array(100),
    startSec: 0,
    hasLineTime: true,
    currentLine: mkLine([{ text: '大' }, { text: '家', failed: true }]), // 0.5 分
    callbacks: {
      recognize: async () => null,
      autoStretchSearch: async () => ({
        line: mkLine([{ text: '大' }, { text: '家', failed: true }, { text: '好', failed: true }]), // 0.33
        segments: [],
        model: 'zipformer',
        score: 0.33,
      }),
      forcedAlign: async () => null,
      alignBySegments: () => null,
    },
  })
  assert.equal(result.line, null, '放慢搜索候选不优于原行 → 保持原行')
}
