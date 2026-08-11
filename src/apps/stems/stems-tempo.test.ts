/**
 * 分段节拍检测单测（node --experimental-strip-types 直跑，无浏览器依赖）。
 *
 * 验证内容：
 *  1. 合成双速度点击轨（前段 120 BPM、后段 96 BPM）→ 输出两段，各段 BPM 在 ±2 内；
 *  2. 恒定速度轨（120 BPM）→ 单段 ≈120；
 *  3. 过短输入 → null。
 */

import assert from 'node:assert/strict'
import { detectTempo } from './stems-tempo.ts'
import { TEMPO_SAMPLE_RATE } from './stems-tempo.ts'

/** 合成节拍点击轨：每拍一个短促衰减爆音（正弦 + 噪声），双声道 interleaved。
 *  每段只在自己的 [startSec, endSec) 时间窗内发声。 */
function synthClickTrack(
  bpms: { startSec: number; endSec: number; bpm: number }[],
  durationSec: number,
): Float32Array {
  const frames = Math.round(durationSec * TEMPO_SAMPLE_RATE)
  const mono = new Float32Array(frames)
  for (const { startSec, endSec, bpm } of bpms) {
    const intervalSec = 60 / bpm
    // 从段落起点对齐到整拍
    let t = Math.ceil(startSec / intervalSec) * intervalSec
    while (t < endSec) {
      const center = Math.round(t * TEMPO_SAMPLE_RATE)
      const clickLen = Math.round(0.04 * TEMPO_SAMPLE_RATE)
      for (let i = -clickLen / 2; i < clickLen / 2; i++) {
        const idx = center + i
        if (idx < 0 || idx >= frames) continue
        const env = Math.exp(-Math.abs(i) / (clickLen / 6))
        // 约 800Hz 短音 + 少量噪声，保证包络能量突增
        mono[idx] += env * (0.8 * Math.sin((2 * Math.PI * 800 * idx) / TEMPO_SAMPLE_RATE) + 0.2 * Math.random())
      }
      t += intervalSec
    }
  }
  const interleaved = new Float32Array(frames * 2)
  for (let i = 0; i < frames; i++) {
    interleaved[i * 2] = mono[i]
    interleaved[i * 2 + 1] = mono[i]
  }
  return interleaved
}

// —— 1. 双速度分段 ——
{
  const audio = synthClickTrack(
    [
      { startSec: 0, endSec: 30, bpm: 120 },
      { startSec: 30, endSec: 60, bpm: 96 },
    ],
    60,
  )
  const tempo = detectTempo(audio, TEMPO_SAMPLE_RATE)
  assert.ok(tempo !== null, '应检测到节拍')
  assert.equal(tempo.segments.length, 2, `应为两段，实际 ${tempo.segments.length} 段: ${JSON.stringify(tempo.segments)}`)
  // 按起点排序断言：前半段 120，后半段 96
  const first = tempo.segments[0]
  const second = tempo.segments[1]
  assert.ok(Math.abs(first.bpm - 120) <= 2, `前段 BPM ${first.bpm} 应在 120±2`)
  assert.ok(Math.abs(second.bpm - 96) <= 2, `后段 BPM ${second.bpm} 应在 96±2`)
  // 分段边界应大致落在 30s 附近（允许 ±10s 的窗口量化误差）
  assert.ok(second.startSec >= 15 && second.startSec <= 45, `分段边界 ${second.startSec}s 应在 30s 附近`)
  assert.ok(Math.abs(tempo.bpm - 108) <= 14, `整体 BPM ${tempo.bpm} 应在 108±14（按时长加权）`)
}

// —— 2. 恒定速度 ——
{
  const audio = synthClickTrack([{ startSec: 0, endSec: 40, bpm: 120 }], 40)
  const tempo = detectTempo(audio, TEMPO_SAMPLE_RATE)
  assert.ok(tempo !== null)
  assert.equal(tempo.segments.length, 1, `应为单段，实际 ${tempo.segments.length} 段`)
  assert.ok(Math.abs(tempo.segments[0].bpm - 120) <= 2, `BPM ${tempo.segments[0].bpm} 应在 120±2`)
  assert.ok(Math.abs(tempo.bpm - 120) <= 2, `整体 BPM ${tempo.bpm} 应在 120±2`)
}

// —— 3. 过短输入 ——
{
  const short = new Float32Array(TEMPO_SAMPLE_RATE * 1 * 2) // 1 秒
  assert.equal(detectTempo(short, TEMPO_SAMPLE_RATE), null)
}

// —— 4. 静音/无节拍 ——
{
  const silence = new Float32Array(TEMPO_SAMPLE_RATE * 10 * 2)
  assert.equal(detectTempo(silence, TEMPO_SAMPLE_RATE), null, '静音应判定为无节拍')
}

console.log('stems-tempo tests OK')
