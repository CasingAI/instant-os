/**
 * 重叠切块纯函数单测（node --experimental-strip-types 直接跑）。
 * 验证：
 *  1. 单块（≤ max）原样返回，无重叠；
 *  2. 多块保留区无缝覆盖 [0, len)：无空洞、无重叠；
 *  3. 首块 startSample=0 / outStart=0，末块 outEnd=len；
 *  4. 每块输入长度 ≤ maxSamples；
 *  5. 相邻块输入起点步进 = hop；
 *  6. 保留区始终落在输入区间内。
 */

import assert from 'node:assert/strict'
import { sliceAudioOverlapped } from './align-chunking.ts'

// —— 1. 单块（≤ max）原样返回 ——
{
  const audio = new Float32Array(100)
  const chunks = sliceAudioOverlapped(audio, 1000, 200)
  assert.equal(chunks.length, 1)
  assert.equal(chunks[0].startSample, 0)
  assert.equal(chunks[0].outStartSample, 0)
  assert.equal(chunks[0].outEndSample, 100)
  assert.equal(chunks[0].data, audio) // 同一引用，未拷贝
}

// —— 2. 多块保留区无缝覆盖 [0, len) ——
{
  const len = 10_000
  const chunks = sliceAudioOverlapped(new Float32Array(len), 3000, 500)
  assert.ok(chunks.length > 1)
  let cursor = 0
  for (const chunk of chunks) {
    assert.equal(chunk.outStartSample, cursor)
    cursor = chunk.outEndSample
  }
  assert.equal(cursor, len)
}

// —— 3. 首块 startSample=0 / outStart=0，末块 outEnd=len ——
{
  const len = 10_000
  const chunks = sliceAudioOverlapped(new Float32Array(len), 3000, 500)
  assert.equal(chunks[0].startSample, 0)
  assert.equal(chunks[0].outStartSample, 0)
  assert.equal(chunks[chunks.length - 1].outEndSample, len)
}

// —— 4. 每块输入长度 ≤ maxSamples；中间块恰好 = maxSamples ——
{
  const maxSamples = 3000
  const len = 10_000
  const chunks = sliceAudioOverlapped(new Float32Array(len), maxSamples, 500)
  for (const chunk of chunks) {
    assert.ok(chunk.data.length <= maxSamples)
  }
  // 非首非末块输入恰为 maxSamples
  for (let i = 1; i < chunks.length - 1; i++) {
    assert.equal(chunks[i].data.length, maxSamples)
  }
}

// —— 5. 输入起点：块 i = max(0, i*hop - overlap)，未被 clamp 时步进 = hop ——
{
  const maxSamples = 3000
  const overlap = 500
  const hop = maxSamples - overlap
  const len = 10_000
  const chunks = sliceAudioOverlapped(new Float32Array(len), maxSamples, overlap)
  for (let i = 0; i < chunks.length; i++) {
    const expected = Math.max(0, i * hop - overlap)
    assert.equal(chunks[i].startSample, expected)
  }
  // 块 1 起输入起点未被 clamp，步进恢复为 hop
  for (let i = 2; i < chunks.length; i++) {
    assert.equal(chunks[i].startSample, chunks[i - 1].startSample + hop)
  }
}

// —— 6. 保留区始终落在输入区间内 ——
{
  const len = 10_000
  const chunks = sliceAudioOverlapped(new Float32Array(len), 3000, 500)
  for (const chunk of chunks) {
    assert.ok(chunk.outStartSample >= chunk.startSample)
    assert.ok(chunk.outEndSample <= chunk.startSample + chunk.data.length)
  }
}

// —— 7. 边界：len 恰等于 maxSamples 时单块；重叠非法时抛错 ——
{
  const len = 3000
  const audio = new Float32Array(len)
  assert.equal(sliceAudioOverlapped(audio, 3000, 500).length, 1)
  assert.equal(sliceAudioOverlapped(audio, 3000, 0).length, 1)

  assert.throws(() => sliceAudioOverlapped(audio, 3000, 3000))
  assert.throws(() => sliceAudioOverlapped(audio, 3000, -1))
  assert.throws(() => sliceAudioOverlapped(audio, 0, 0))
}
