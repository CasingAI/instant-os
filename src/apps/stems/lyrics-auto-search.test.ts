/**
 * 自动放慢重识别搜索单测（node --experimental-strip-types 直接跑）。
 * 验证：组合排序（推荐算法 × 用户模型优先）、score=1 提前停、
 * rate=1 组合收敛为仅模型维度、选优严格优于原行、全失败返回 null。
 */

import assert from 'node:assert/strict'
import type { HypSegment } from '../align/align-text-dtw.ts'
import type { LyricsLine } from '../music/music-lyrics.ts'
import type { AlignModel } from './lyrics-analysis.ts'
import type { StretchPlan } from './lyrics-time-stretch.ts'
import { autoSearchLine, type AutoSearchResult } from './lyrics-auto-search.ts'

/** 构造歌词行：wordsCount 个词，前 failedCount 个标记 failed（匹配度 = (n-f)/n） */
function makeLine(wordsCount: number, failedCount: number): LyricsLine {
  return {
    timeMs: 0,
    text: 'x'.repeat(wordsCount),
    words: Array.from({ length: wordsCount }, (_, i) => ({
      text: 'x',
      timeMs: i * 100,
      failed: i < failedCount,
    })),
  }
}

/** 构造识别段（mock recognize 返回值；字段对齐 HypSegment） */
function makeSegs(n: number): HypSegment[] {
  return Array.from({ length: n }, (_, i) => ({ symbol: 'x', start: i, end: i + 1 }))
}

const plan: StretchPlan = { rate: 0.5, methods: ['wsola', 'phase-vocoder'] }
const planNoStretch: StretchPlan = { rate: 1, methods: ['wsola', 'phase-vocoder'] }

/**
 * 测试夹具：按识别调用序号依次取 lines[i] 作为该组合的对齐结果
 * （undefined = 识别失败返回 null）；记录每次识别的 (rate, method, model)。
 */
function makeHarness(lines: (LyricsLine | undefined)[], userModel: AlignModel = 'sense-voice') {
  const calls: { rate: number; method: string; model: AlignModel }[] = []
  let pending: { rate: number; method: string } | null = null
  let callIdx = 0
  const run = async (
    p: StretchPlan,
    currentLine?: LyricsLine | null,
  ): Promise<AutoSearchResult> => {
    callIdx = 0
    calls.length = 0
    return autoSearchLine({
      lineText: 'xxxx',
      plan: p,
      userModel,
      offsetSec: 1.0,
      currentLine: currentLine ?? null,
      callbacks: {
        stretch: (rate, method) => {
          pending = { rate, method }
          return new Float32Array(1024)
        },
        recognize: async (audio, model) => {
          calls.push({ rate: pending!.rate, method: pending!.method, model })
          const line = lines[callIdx++]
          return line === undefined ? null : makeSegs(2)
        },
        alignBySegments: () => lines[callIdx - 1] ?? null,
      },
    })
  }
  return { calls, run }
}

// score=1 提前停：第一个组合（推荐算法 × 用户模型）即满分，只试 1 次
{
  const h = makeHarness([makeLine(4, 0)])
  const result = await h.run(plan)
  assert.ok(result.best)
  assert.equal(result.attempted, 1)
  assert.deepEqual(h.calls, [{ rate: 0.5, method: 'wsola', model: 'sense-voice' }])
  assert.equal(result.bestScore, 1)
}

// 组合顺序：首组合失败，第二个组合（同算法 × 另一模型）满分
{
  const h = makeHarness([undefined, makeLine(4, 0)])
  const result = await h.run(plan)
  assert.equal(result.attempted, 2)
  assert.deepEqual(
    h.calls.map((c) => [c.method, c.model]),
    [
      ['wsola', 'sense-voice'],
      ['wsola', 'zipformer'],
    ],
  )
}

// rate=1 组合收敛：算法维度冗余，只按模型试 2 次
{
  const h = makeHarness([undefined, undefined, undefined, undefined])
  const result = await h.run(planNoStretch)
  assert.equal(result.attempted, 2)
  assert.equal(h.calls.length, 2)
  assert.equal(h.calls[0].method, 'wsola')
  assert.equal(result.best, null)
}

// 全失败（识别均无结果）→ best null，4 次全留痕
{
  const h = makeHarness([undefined, undefined, undefined, undefined])
  const result = await h.run(plan)
  assert.equal(result.best, null)
  assert.equal(result.attempted, 4)
  assert.equal(result.attempts.filter((a) => a.score === -1).length, 4)
}

// 候选不优于原行基线 → best null（保持原行）
{
  const h = makeHarness([makeLine(4, 2), makeLine(4, 2), makeLine(4, 2), makeLine(4, 2)])
  const result = await h.run(plan, makeLine(4, 1))
  assert.equal(result.best, null)
  assert.equal(result.attempted, 4)
  assert.equal(result.baselineScore, 0.75)
}

// 候选优于原行 → 采用；满分提前停
{
  const h = makeHarness([makeLine(4, 0)])
  const result = await h.run(plan, makeLine(4, 2))
  assert.ok(result.best)
  assert.equal(result.bestScore, 1)
  assert.equal(result.baselineScore, 0.5)
}

// 无满分时选最高分候选（第 2 组合 wsola×zipformer 0.75 胜出）
{
  const h = makeHarness([makeLine(4, 2), makeLine(4, 1), makeLine(4, 3), makeLine(4, 2)])
  const result = await h.run(plan, makeLine(4, 4))
  assert.ok(result.best)
  assert.equal(result.bestScore, 0.75)
  assert.equal(result.bestCombo?.method, 'wsola')
  assert.equal(result.bestCombo?.model, 'zipformer')
  assert.equal(result.attempted, 4)
}

// 原行已满分：不搜索直接返回
{
  const h = makeHarness([])
  const result = await h.run(plan, makeLine(4, 0))
  assert.equal(result.best, null)
  assert.equal(result.attempted, 0)
}

console.log('ok: lyrics-auto-search')
