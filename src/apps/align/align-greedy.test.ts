/**
 * CTC greedy 解码单测（node --experimental-strip-types 直接跑）。
 * 验证：
 *  1. 逐帧 argmax、非 blank 且不同于前一 token 才输出；
 *  2. 只解码 [startFrame, endFrame) 保留区；
 *  3. prev 跨块透传消除边界重复 token；
 *  4. lastBest 返回供下一块使用。
 */

import assert from 'node:assert/strict'
import { greedyDecode } from './align-greedy.ts'

// 构造 4 帧 × 3 类的 logits（blank=0）
function makeLogits(rows: number[][]): Float32Array {
  const flat = new Float32Array(rows.length * 3)
  rows.forEach((row, t) => {
    for (let v = 0; v < 3; v++) flat[t * 3 + v] = row[v]
  })
  return flat
}

// —— 1. 基本：blank 跳过；仅相邻帧（无 blank 间隔）的相同 token 才合并 ——
{
  // 帧0 → 类1；帧1 → blank(0)；帧2 → 类1（被 blank 间隔，仍输出）；帧3 → 类2
  const logits = makeLogits([
    [0.1, 0.9, 0.0],
    [0.9, 0.05, 0.05],
    [0.1, 0.9, 0.0],
    [0.1, 0.0, 0.9],
  ])
  const { tokens } = greedyDecode(logits, 3, 0, 0, 4, -1)
  assert.deepEqual(
    tokens.map((t) => ({ token: t.token, frame: t.frame })),
    [
      { token: 1, frame: 0 },
      { token: 1, frame: 2 },
      { token: 2, frame: 3 },
    ],
  )
}

// —— 2. 保留区：只解 [startFrame, endFrame) ——
{
  const logits = makeLogits([
    [0.1, 0.9, 0.0],
    [0.1, 0.0, 0.9],
    [0.1, 0.9, 0.0],
    [0.1, 0.0, 0.9],
  ])
  const { tokens } = greedyDecode(logits, 3, 0, 1, 3, -1)
  assert.deepEqual(
    tokens.map((t) => ({ token: t.token, frame: t.frame })),
    [
      { token: 2, frame: 1 },
      { token: 1, frame: 2 },
    ],
  )
}

// —— 3. prev 透传：帧边界与上一块末尾相同 token 不重复 ——
{
  // 块 A 末尾 best=1；块 B 首帧 best=1，与 prev=1 相同 → 跳过
  const logits = makeLogits([
    [0.1, 0.9, 0.0],
    [0.1, 0.9, 0.0],
  ])
  const { tokens, lastBest } = greedyDecode(logits, 3, 0, 0, 2, 1)
  assert.equal(tokens.length, 0)
  assert.equal(lastBest, 1)
}

// —— 4. 无 prev 时首帧输出 ——
{
  const logits = makeLogits([
    [0.1, 0.9, 0.0],
    [0.1, 0.9, 0.0],
  ])
  const { tokens } = greedyDecode(logits, 3, 0, 0, 2, -1)
  assert.equal(tokens.length, 1)
  assert.equal(tokens[0].token, 1)
  assert.equal(tokens[0].frame, 0)
}

// —— 5. 全部为 blank 时无输出 ——
{
  const logits = makeLogits([
    [0.9, 0.05, 0.05],
    [0.9, 0.05, 0.05],
  ])
  const { tokens } = greedyDecode(logits, 3, 0, 0, 2, -1)
  assert.equal(tokens.length, 0)
}
