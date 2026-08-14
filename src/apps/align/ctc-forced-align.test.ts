/**
 * CTC 强制对齐 Viterbi 单测（node --experimental-strip-types 直接跑）。
 * 验证：
 *  1. 已知分布的 logits 下，token 段落在正确帧；
 *  2. 相邻相同 token 必须经 blank 隔开（标准 CTC）；
 *  3. 帧数不足时 ok=false；
 *  4. 全 blank 时 token 不激活（ok=true、start=-1）。
 */

import assert from 'node:assert/strict'
import { ctcForcedAlignLine } from './ctc-forced-align.ts'

const BLANK = 0
const VOCAB = 10

/** 构造帧×vocab logits：帧 t 上 targetToken 概率最高，其余 token 次之 */
function buildLogits(frames: { t: number; token: number }[], totalFrames: number): Float32Array {
  const out = new Float32Array(totalFrames * VOCAB)
  for (let f = 0; f < totalFrames; f++) {
    const base = f * VOCAB
    for (let v = 0; v < VOCAB; v++) out[base + v] = 0.0
    out[base + BLANK] = 1.0
  }
  for (const { t, token } of frames) {
    const base = t * VOCAB
    out[base + token] = 5.0
  }
  return out
}

// —— 1. 已知分布定位 ——
{
  // tokenIds [5, 3, 8]，各占一段，中间 blank
  const frames: { t: number; token: number }[] = []
  for (let t = 10; t < 20; t++) frames.push({ t, token: 5 })
  for (let t = 30; t < 40; t++) frames.push({ t, token: 3 })
  for (let t = 50; t < 60; t++) frames.push({ t, token: 8 })
  const logits = buildLogits(frames, 70)
  const r = ctcForcedAlignLine(logits, VOCAB, BLANK, 0, 70, [5, 3, 8])
  assert.equal(r.ok, true)
  assert.equal(r.tokenStartFrames[0], 10)
  assert.equal(r.tokenEndFrames[0], 19)
  assert.equal(r.tokenStartFrames[1], 30)
  assert.equal(r.tokenEndFrames[1], 39)
  assert.equal(r.tokenStartFrames[2], 50)
  assert.equal(r.tokenEndFrames[2], 59)
}

// —— 2. 相邻相同 token 必须经 blank 隔开 ——
{
  // tokenIds [5, 5]，token5 出现在两段（10-15、20-25），中间 blank
  const frames: { t: number; token: number }[] = []
  for (let t = 10; t < 16; t++) frames.push({ t, token: 5 })
  for (let t = 20; t < 26; t++) frames.push({ t, token: 5 })
  const logits = buildLogits(frames, 40)
  const r = ctcForcedAlignLine(logits, VOCAB, BLANK, 0, 40, [5, 5])
  assert.equal(r.ok, true)
  // 第一个 token 段在 10-15，第二个在 20-25
  assert.ok(r.tokenStartFrames[0] >= 10 && r.tokenStartFrames[0] <= 15)
  assert.ok(r.tokenEndFrames[1] >= 20 && r.tokenEndFrames[1] <= 25)
  // 两个 token 段不重叠
  assert.ok(r.tokenEndFrames[0] < r.tokenStartFrames[1], '重复 token 段应被 blank 隔开')
}

// —— 3. 帧数不足 ——
{
  const logits = buildLogits([], 5)
  const r = ctcForcedAlignLine(logits, VOCAB, BLANK, 0, 2, [5, 3, 8])
  assert.equal(r.ok, false)
  assert.equal(r.tokenStartFrames[0], -1)
}

// —— 4. 全 blank：token 不激活（ok=true、start=-1）——
{
  const logits = buildLogits([], 30)
  const r = ctcForcedAlignLine(logits, VOCAB, BLANK, 0, 30, [5, 3])
  assert.equal(r.ok, true)
  assert.equal(r.tokenStartFrames[0], -1, '全 blank 时 token 不应激活')
  assert.equal(r.tokenStartFrames[1], -1)
}

// —— 5. frameOffset 偏移 ——
{
  const frames: { t: number; token: number }[] = []
  for (let t = 10; t < 20; t++) frames.push({ t, token: 4 })
  // 行窗起点在全局帧 100：构造 110 帧，行窗 100..130
  const logits = buildLogits(
    frames.map((f) => ({ t: f.t + 100, token: f.token })),
    130,
  )
  const r = ctcForcedAlignLine(logits, VOCAB, BLANK, 100, 30, [4])
  assert.equal(r.ok, true)
  assert.equal(r.tokenStartFrames[0], 10, '应相对行窗首帧')
  assert.equal(r.tokenEndFrames[0], 19)
}

// —— 6. forceStartFromToken：行首后验弱时强制首词从帧 0 开始 ——
{
  // token [5]，行窗开头全 blank、帧 10 起 token5 后验高。
  // 不强制的 Viterbi 会把 token 推到帧 10；强制后 token 必须从帧 0 开始。
  const frames: { t: number; token: number }[] = [{ t: 10, token: 5 }]
  const logits = buildLogits(frames, 30)
  const r0 = ctcForcedAlignLine(logits, VOCAB, BLANK, 0, 30, [5])
  const r1 = ctcForcedAlignLine(logits, VOCAB, BLANK, 0, 30, [5], true)
  assert.ok(r0.ok && r1.ok)
  assert.ok(r0.tokenStartFrames[0] >= 10, `不强制的应推迟：${r0.tokenStartFrames[0]}`)
  assert.equal(r1.tokenStartFrames[0], 0, '强制的首词应从帧 0 开始')
}

console.log('ctc-forced-align: 全部通过')
