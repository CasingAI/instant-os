/**
 * CTC 强制对齐纯函数单测（node --experimental-strip-types 直接跑）。
 * 用确定性合成的 logits 验证：
 *  1. 两段不同音素在连续帧上的边界；
 *  2. 音素之间的静音（blank 高概率）不被占用；
 *  3. 候选符号组（等价类）取组内最大分数；
 *  4. 目标不可达 / 空目标时的兜底。
 */

import assert from 'node:assert/strict'
import { ctcViterbiAlign } from './align-ctc.ts'
import type { CtcTarget } from './align-ctc.ts'

const V = 5
const BLANK = 0
const FRAME = 0.02

/** 构造 T 帧 logits：默认所有帧 blank 高分；可通过 set 覆写指定帧/类 */
function makeLogits(T: number): Float32Array {
  const logits = new Float32Array(T * V)
  for (let t = 0; t < T; t++) {
    for (let id = 0; id < V; id++) {
      logits[t * V + id] = id === BLANK ? 1.0 : -2.0
    }
  }
  return logits
}

function setFrame(logits: Float32Array, t: number, id: number, v: number): void {
  logits[t * V + id] = v
}

// —— 1. 两段不同音素，边界应落在切换帧 ——
{
  const T = 20
  const logits = makeLogits(T)
  for (let t = 0; t < 10; t++) setFrame(logits, t, 1, 2.0)
  for (let t = 10; t < 20; t++) setFrame(logits, t, 2, 2.0)

  const targets: CtcTarget[] = [
    { unitIndex: 0, ids: [1] },
    { unitIndex: 1, ids: [2] },
  ]
  const result = ctcViterbiAlign(logits, T, V, targets, BLANK, FRAME)

  assert.ok(result.phoneSpans[0].start >= 0)
  assert.equal(result.phoneSpans[0].start, 0)
  assert.equal(result.phoneSpans[0].end, 0.2) // 帧 0-9
  assert.equal(result.phoneSpans[1].start, 0.2) // 帧 10
  assert.equal(result.phoneSpans[1].end, 0.4) // 帧 20

  assert.equal(result.unitSpans[0].start, 0)
  assert.equal(result.unitSpans[0].end, 0.2)
  assert.equal(result.unitSpans[1].start, 0.2)
  assert.equal(result.unitSpans[1].end, 0.4)
}

// —— 2. 音素之间的静音段（blank 高）不被占用 ——
{
  const T = 16
  const logits = makeLogits(T)
  for (let t = 0; t < 5; t++) setFrame(logits, t, 1, 2.0)
  // 帧 5-9 保持 blank 高分
  for (let t = 10; t < 16; t++) setFrame(logits, t, 2, 2.0)

  const targets: CtcTarget[] = [
    { unitIndex: 0, ids: [1] },
    { unitIndex: 1, ids: [2] },
  ]
  const result = ctcViterbiAlign(logits, T, V, targets, BLANK, FRAME)

  assert.equal(result.phoneSpans[0].start, 0)
  assert.equal(result.phoneSpans[0].end, 0.1) // 帧 0-4
  assert.equal(result.phoneSpans[1].start, 0.2) // 帧 10
  assert.equal(result.phoneSpans[1].end, 0.32) // 帧 10-15
}

// —— 3. 候选组：模型输出组内另一个符号也能对齐 ——
{
  const T = 12
  const logits = makeLogits(T)
  // 目标组 [1,3]，但模型在帧 0-5 输出 id=3，帧 6-11 输出 id=2
  for (let t = 0; t < 6; t++) setFrame(logits, t, 3, 2.0)
  for (let t = 6; t < 12; t++) setFrame(logits, t, 2, 2.0)

  const targets: CtcTarget[] = [
    { unitIndex: 0, ids: [1, 3] },
    { unitIndex: 0, ids: [2] },
  ]
  const result = ctcViterbiAlign(logits, T, V, targets, BLANK, FRAME)

  assert.ok(result.phoneSpans[0].start >= 0)
  assert.equal(result.phoneSpans[0].start, 0)
  assert.equal(result.phoneSpans[0].end, 0.12) // 帧 0-5
  assert.equal(result.phoneSpans[1].start, 0.12)
}

// —— 4. 空目标 / 不可达 ——
{
  const logits = makeLogits(8)
  const empty = ctcViterbiAlign(logits, 8, V, [], BLANK, FRAME)
  assert.deepEqual(empty.phoneSpans, [])
  assert.deepEqual(empty.unitSpans, [])

  // 目标 id 在所有帧都是 -Infinity（发射不可达）→ 返回全部未覆盖
  const logits2 = new Float32Array(8 * V).fill(-10)
  for (let t = 0; t < 8; t++) {
    logits2[t * V + BLANK] = 1.0
    logits2[t * V + 1] = Number.NEGATIVE_INFINITY
  }
  const targets: CtcTarget[] = [{ unitIndex: 0, ids: [1] }]
  const unreachable = ctcViterbiAlign(logits2, 8, V, targets, BLANK, FRAME)
  assert.equal(unreachable.phoneSpans[0].start, -1)
  assert.equal(unreachable.unitSpans[0].start, -1)
}
