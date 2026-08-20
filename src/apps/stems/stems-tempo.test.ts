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

/** 合成节拍鼓点轨：每拍一个短促的「短攻击 + 指数衰减」鼓点（低频正弦 + 噪声），
 *  双声道 interleaved。攻击约 2ms、衰减约 120ms，onset 峰值接近真实鼓点。
 *  每段只在自己的 [startSec, endSec) 时间窗内发声；鼓点落在
 *  startSec + phaseOffsetSec + k*interval（phaseOffsetSec 默认 0 = 段起点即整拍）。 */
function synthClickTrack(
  bpms: { startSec: number; endSec: number; bpm: number; phaseOffsetSec?: number }[],
  durationSec: number,
): Float32Array {
  const frames = Math.round(durationSec * TEMPO_SAMPLE_RATE)
  const mono = new Float32Array(frames)
  const attackSamples = Math.round(0.002 * TEMPO_SAMPLE_RATE)
  const decaySamples = Math.round(0.12 * TEMPO_SAMPLE_RATE)
  for (const { startSec, endSec, bpm, phaseOffsetSec = 0 } of bpms) {
    const intervalSec = 60 / bpm
    let t = startSec + phaseOffsetSec
    while (t < endSec) {
      const center = Math.round(t * TEMPO_SAMPLE_RATE)
      for (let i = 0; i < decaySamples; i++) {
        const idx = center + i
        if (idx < 0 || idx >= frames) continue
        const attack = i < attackSamples ? i / attackSamples : 1
        const env = attack * Math.exp(-i / (decaySamples / 6))
        // 约 90Hz 底鼓 + 200Hz 泛音 + 少量噪声，保证包络能量突增
        mono[idx] +=
          env *
          (0.85 * Math.sin((2 * Math.PI * 90 * idx) / TEMPO_SAMPLE_RATE) +
            0.35 * Math.sin((2 * Math.PI * 200 * idx) / TEMPO_SAMPLE_RATE) +
            0.15 * Math.random())
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

// —— 5. 倍频消歧：138 BPM 快鼓不被锁成 69 ——
// 自相关对滞后 P 与 2P 同分（无短周期偏好），旧实现常把 138 锁成 69；
// 联合精化应对候选 {69, 138} 选出「每拍都踩中 onset」的 138。
{
  const audio = synthClickTrack([{ startSec: 0, endSec: 30, bpm: 138 }], 30)
  const tempo = detectTempo(audio, TEMPO_SAMPLE_RATE)
  assert.ok(tempo !== null)
  assert.equal(tempo.segments.length, 1, `应为单段，实际 ${tempo.segments.length} 段`)
  assert.ok(
    Math.abs(tempo.segments[0].bpm - 138) <= 2,
    `BPM ${tempo.segments[0].bpm} 应为 138±2（倍频消歧失败会锁 69）`,
  )
}

// —— 6. 相位对齐：鼓点落在 0.13s 相位 → phaseSec 与真实相位差 < 10ms ——
// 旧实现拍点从段起点硬数（相位恒 0），真实鼓点偏 0.13s 时会整段错位一拍内；
// 联合精化（2ms 相位网格 + 亚帧抛物线插值）把相位对齐到真实鼓点位置。
{
  const audio = synthClickTrack([{ startSec: 0, endSec: 30, bpm: 96, phaseOffsetSec: 0.13 }], 30)
  const tempo = detectTempo(audio, TEMPO_SAMPLE_RATE)
  assert.ok(tempo !== null)
  assert.equal(tempo.segments.length, 1, `应为单段，实际 ${tempo.segments.length} 段`)
  assert.ok(Math.abs(tempo.segments[0].bpm - 96) <= 2, `BPM ${tempo.segments[0].bpm} 应为 96±2`)
  assert.ok(
    Math.abs(tempo.segments[0].phaseSec - 0.13) < 0.01,
    `phaseSec ${tempo.segments[0].phaseSec} 应与真实相位 0.13s 差 <10ms`,
  )
}

// —— 7. 相位对齐在段尾相位（0.31s）也成立：段起点非拍点时的相位估计 ——
{
  const audio = synthClickTrack([{ startSec: 0, endSec: 30, bpm: 96, phaseOffsetSec: 0.31 }], 30)
  const tempo = detectTempo(audio, TEMPO_SAMPLE_RATE)
  assert.ok(tempo !== null)
  assert.equal(tempo.segments.length, 1, `应为单段，实际 ${tempo.segments.length} 段`)
  assert.ok(Math.abs(tempo.segments[0].bpm - 96) <= 2, `BPM ${tempo.segments[0].bpm} 应为 96±2`)
  assert.ok(
    Math.abs(tempo.segments[0].phaseSec - 0.31) < 0.01,
    `phaseSec ${tempo.segments[0].phaseSec} 应与真实相位 0.31s 差 <10ms`,
  )
}

console.log('stems-tempo tests OK')
