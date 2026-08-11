/**
 * 分轨纯逻辑单测（切块 / 重叠相加 / 波形峰值）。
 * 运行：node --experimental-strip-types src/apps/stems/stems-separator.test.ts
 */
import assert from 'node:assert/strict'
import {
  buildWaveformPyramid,
  computeWaveformPeaks,
  computeWaveformPeaksFromPyramid,
  encodeWav,
  resampleInterleaved,
  sliceStemChunks,
  STEM_CHANNELS,
  STEM_OVERLAP,
  STEM_WINDOW,
  stemStep,
  stitchStemOutputs,
} from './stems-separator.ts'
import { HTDEMUCS_STEM_IDS } from './stems-types.ts'

function testChunkSlicing(): void {
  // 一个窗口以内的音频 → 恰好一块
  const short = new Float32Array(1000 * STEM_CHANNELS).fill(0.5)
  const one = sliceStemChunks(short)
  assert.equal(one.length, 1)
  assert.equal(one[0].startFrame, 0)
  assert.equal(one[0].input.length, STEM_WINDOW * STEM_CHANNELS)

  // 超过一个窗口 → 多块，步长为 step
  const step = stemStep()
  // totalFrames 保证 3*step < totalFrames ≤ 4*step → 恰好 4 块
  const frames = 3 * step + STEM_WINDOW - step / 2
  const long = new Float32Array(frames * STEM_CHANNELS).fill(0.25)
  const chunks = sliceStemChunks(long)
  assert.equal(chunks.length, 4)
  assert.equal(chunks[0].startFrame, 0)
  assert.equal(chunks[1].startFrame, step)
  assert.equal(chunks[2].startFrame, step * 2)
  assert.equal(chunks[3].startFrame, step * 3)

  // 末尾不足窗口的部分被零填充（能量应集中在开头）
  const last = chunks[chunks.length - 1]
  assert.ok(last.input[0] !== 0, '开头应有数据')
  assert.ok(last.input[last.input.length - 1] === 0, '末尾应是零填充')

  // 空音频 → 0 块
  assert.deepEqual(sliceStemChunks(new Float32Array(0)), [])
  console.log('ok: sliceStemChunks')
}

function testOverlapAddEnergy(): void {
  // 构造两块的简单输出：每块单轨（stem 0 = vocals）为全 1 常数
  const step = stemStep()
  const totalFrames = STEM_WINDOW + step // 两块恰好覆盖
  const chunkStartFrames = [0, step]

  const chunkOutputs = chunkStartFrames.map(() => {
    const out = new Float32Array(HTDEMUCS_STEM_IDS.length * STEM_WINDOW * STEM_CHANNELS)
    // 仅 vocals（index 3）有内容，全部为 1
    for (let i = 0; i < STEM_WINDOW * STEM_CHANNELS; i++) {
      out[3 * STEM_WINDOW * STEM_CHANNELS + i] = 1
    }
    return out
  })

  const stems = stitchStemOutputs(chunkOutputs, chunkStartFrames, totalFrames)
  assert.equal(stems.length, HTDEMUCS_STEM_IDS.length)

  // 只有 vocals 有能量
  const vocals = stems.find((s) => s.stemId === 'vocals')!
  for (const other of stems.filter((s) => s.stemId !== 'vocals')) {
    assert.ok(other.data.every((v) => v === 0), '其它轨应为 0')
  }

  // 重叠区与单块覆盖的中段应为 1（窗函数归一化还原常数）
  const half = STEM_WINDOW / 2
  for (let i = half; i < totalFrames - half; i++) {
    assert.ok(Math.abs(vocals.data[i * 2] - 1) < 1e-3, `重叠相加应还原常数 1，位置 ${i}`)
    assert.ok(Math.abs(vocals.data[i * 2 + 1] - 1) < 1e-3, `右声道同，位置 ${i}`)
  }
  // 边缘（窗函数衰减处）不应超过 1
  for (let i = 0; i < totalFrames; i++) {
    assert.ok(vocals.data[i * 2] <= 1 + 1e-3, `不应放大，位置 ${i}`)
  }
  console.log('ok: stitchStemOutputs 重叠相加还原')
}

function testWaveformPeaks(): void {
  // 全零 → 全零峰值
  const zeros = new Float32Array(100 * STEM_CHANNELS)
  const zeroPeaks = computeWaveformPeaks(zeros, 10)
  assert.equal(zeroPeaks.length, 10)
  assert.ok(zeroPeaks.every((p) => p.min === 0 && p.max === 0))

  // 单一大幅值 → 对应桶的峰值
  const data = new Float32Array(200 * STEM_CHANNELS)
  data[50 * STEM_CHANNELS] = 0.8
  data[50 * STEM_CHANNELS + 1] = -0.6
  const peaks = computeWaveformPeaks(data, 10)
  assert.ok(Math.abs(peaks[2].max - 0.8) < 1e-6, '桶 2 应捕捉到左声道峰值')
  assert.ok(Math.abs(peaks[2].min + 0.8) < 1e-6, '桶 2 的 min 应取两声道最大幅度')

  // 桶数多于帧数 → 不崩
  assert.equal(computeWaveformPeaks(new Float32Array(4 * STEM_CHANNELS), 100).length, 100)
  console.log('ok: computeWaveformPeaks')
}

function testConstants(): void {
  assert.equal(STEM_WINDOW, 343980, '模型输入窗口长度')
  assert.ok(STEM_OVERLAP > 0 && STEM_OVERLAP < 1, '重叠比例合法')
  assert.equal(STEM_CHANNELS, 2, '立体声')
  console.log('ok: constants')
}

function testResample(): void {
  // 同采样率 → 原样返回
  const src = new Float32Array([0.1, -0.2, 0.3, -0.4])
  assert.equal(resampleInterleaved(src, 44100, 44100), src)

  // 44100 → 22050 长度减半；常数信号保持
  const constant = new Float32Array(4410 * 2).fill(0.5)
  const half = resampleInterleaved(constant, 44100, 22050)
  assert.equal(half.length, 2205 * 2)
  for (const v of half) assert.ok(Math.abs(v - 0.5) < 1e-6, '常数信号重采样后仍为常数')

  // 线性插值：从 0 到 1 的斜坡，中间点应约为 0.5
  const ramp = new Float32Array(100 * 2)
  for (let i = 0; i < 100; i++) {
    ramp[i * 2] = i / 99
    ramp[i * 2 + 1] = i / 99
  }
  const resampled = resampleInterleaved(ramp, 100, 50)
  assert.equal(resampled.length, 50 * 2)
  assert.ok(Math.abs(resampled[25 * 2] - 0.5) < 0.05, '中点应接近 0.5')
  console.log('ok: resampleInterleaved')
}

function testEncodeWav(): void {
  // 2 帧立体声静音
  const silent = new Float32Array(2 * STEM_CHANNELS)
  const wav = encodeWav(silent, 44100)
  const view = new DataView(wav)
  // RIFF/WAVE 头
  assert.equal(String.fromCharCode(view.getUint8(0), view.getUint8(1), view.getUint8(2), view.getUint8(3)), 'RIFF')
  assert.equal(String.fromCharCode(view.getUint8(8), view.getUint8(9), view.getUint8(10), view.getUint8(11)), 'WAVE')
  assert.equal(view.getUint16(22, true), STEM_CHANNELS, '声道数')
  assert.equal(view.getUint32(24, true), 44100, '采样率')
  assert.equal(view.getUint16(34, true), 16, '位深')
  // data 区：静音 → 0
  assert.equal(view.getInt16(44, true), 0)
  assert.equal(wav.byteLength, 44 + 2 * STEM_CHANNELS * 2)

  // 满幅 → 32767 / -32768
  const full = new Float32Array(STEM_CHANNELS).fill(1)
  const fullWav = encodeWav(full, 44100)
  assert.equal(new DataView(fullWav).getInt16(44, true), 32767)
  const neg = new Float32Array(STEM_CHANNELS).fill(-1)
  assert.equal(new DataView(encodeWav(neg, 44100)).getInt16(44, true), -32768)
  console.log('ok: encodeWav')
}

function testWaveformPeaksRange(): void {
  const data = new Float32Array(400 * STEM_CHANNELS)
  data[50 * STEM_CHANNELS] = 0.8
  data[150 * STEM_CHANNELS] = 0.9
  data[151 * STEM_CHANNELS] = -0.6

  // 窗口 [100,300)：桶 2 = [140,160)，应只捕捉到 frame 150 的峰值
  const peaks = computeWaveformPeaks(data, 10, 100, 300)
  assert.ok(Math.abs(peaks[2].max - 0.9) < 1e-6, '窗口内峰值应被捕捉')
  // min 是最大幅度的镜像（对称渲染用），负采样不会超过它
  assert.ok(Math.abs(peaks[2].min + 0.9) < 1e-6, '窗口内 min 应为最大幅度的镜像')
  // 窗口外的 frame 50 不应出现
  assert.ok(peaks.every((p, i) => i === 2 || (p.min === 0 && p.max === 0)), '窗口外不应有能量')

  // 空窗口 / 越界窗口 → 全零，不崩
  const empty = computeWaveformPeaks(data, 10, 300, 100)
  assert.ok(empty.every((p) => p.min === 0 && p.max === 0))
  assert.equal(computeWaveformPeaks(data, 10, -50, 999).length, 10)
  console.log('ok: computeWaveformPeaks 窗口范围')
}

function testWaveformPyramid(): void {
  const rate = 44100
  const frames = 50000
  const data = new Float32Array(frames * STEM_CHANNELS)
  // 伪随机幅度，让各桶有真实差异
  let seed = 42
  for (let i = 0; i < frames; i++) {
    seed = (seed * 1103515245 + 12345) & 0x7fffffff
    const v = ((seed / 0x7fffffff) - 0.5) * 2
    data[i * STEM_CHANNELS] = v
    data[i * STEM_CHANNELS + 1] = -v * 0.5
  }
  const pyramid = buildWaveformPyramid(data, rate)
  assert.equal(pyramid.bucketSamples, 44, '44.1kHz 下 ~1ms/桶')
  assert.equal(pyramid.bucketCount, Math.ceil(frames / 44))

  // 全曲窗口：金字塔聚合是「保守覆盖」（含窗口边缘的整桶），误差 ≤ 1 个基础桶
  const exact = computeWaveformPeaks(data, 40)
  const approx = computeWaveformPeaksFromPyramid(pyramid, 40, 0, frames)
  assert.equal(approx.length, 40)
  for (let b = 0; b < 40; b++) {
    assert.ok(approx[b].max >= exact[b].max - 1e-6, `桶 ${b} max 不应小于精确值`)
    assert.ok(approx[b].min <= exact[b].min + 1e-6, `桶 ${b} min 不应大于精确值`)
    assert.ok(Math.abs(approx[b].max - exact[b].max) < 0.1, `桶 ${b} max 误差应在 1 桶覆盖内`)
  }

  // 子窗口（放大视图）同样只有 1 桶级误差
  const subExact = computeWaveformPeaks(data, 20, 1000, 5000)
  const subApprox = computeWaveformPeaksFromPyramid(pyramid, 20, 1000, 5000)
  assert.equal(subApprox.length, 20)
  for (let b = 0; b < 20; b++) {
    assert.ok(Math.abs(subApprox[b].max - subExact[b].max) < 0.1, `子窗口桶 ${b} max 误差过大`)
    assert.ok(Math.abs(subApprox[b].min - subExact[b].min) < 0.1, `子窗口桶 ${b} min 误差过大`)
  }

  // bucketSamples=1（sampleRate=1000）时逐帧精确：与直接计算完全一致
  const fine = buildWaveformPyramid(data, 1000)
  assert.equal(fine.bucketSamples, 1)
  assert.deepEqual(
    computeWaveformPeaksFromPyramid(fine, 10, 100, 300),
    computeWaveformPeaks(data, 10, 100, 300),
  )

  // 空窗口 → 全零，不崩
  const empty = computeWaveformPeaksFromPyramid(pyramid, 10, 5000, 1000)
  assert.ok(empty.every((p) => p.min === 0 && p.max === 0))
  console.log('ok: computeWaveformPeaksFromPyramid')
}

testChunkSlicing()
testOverlapAddEnergy()
testWaveformPeaks()
testWaveformPeaksRange()
testWaveformPyramid()
testConstants()
testResample()
testEncodeWav()
