/**
 * 分轨纯逻辑单测（切块 / 重叠相加 / 波形峰值）。
 * 运行：node --experimental-strip-types src/apps/stems/stems-separator.test.ts
 */
import assert from 'node:assert/strict'
import {
  buildWaveformPyramid,
  computeWaveformPeaks,
  computeWaveformPeaksFromPyramid,
  deinterleaveStereo,
  encodeWav,
  mixStems,
  resampleInterleaved,
  silenceRatio,
  sliceStemChunks,
  STEM_CHANNELS,
  STEM_OVERLAP,
  STEM_WINDOW,
  stemStep,
  stitchStemOutputs,
} from './stems-separator.ts'
import { HTDEMUCS_STEM_IDS, stemDisplayLabel } from './stems-types.ts'

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

  // 模型输出 ch-major [6, 2, W]：L 全段在前、R 全段在后
  const chunkOutputs = chunkStartFrames.map(() => {
    const out = new Float32Array(HTDEMUCS_STEM_IDS.length * STEM_WINDOW * STEM_CHANNELS)
    const base = 3 * STEM_WINDOW * STEM_CHANNELS // vocals 轨（index 3）
    for (let i = 0; i < STEM_WINDOW; i++) {
      out[base + i] = 1 // L 全段
      out[base + STEM_WINDOW + i] = 1 // R 全段
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

function testDeinterleave(): void {
  // interleaved [L0,R0,L1,R1,...] → ch-major [L0,L1,...,R0,R1,...]
  const frames = 4
  const interleaved = new Float32Array(frames * STEM_CHANNELS)
  for (let i = 0; i < frames; i++) {
    interleaved[i * 2] = 100 + i // L
    interleaved[i * 2 + 1] = 200 + i // R
  }
  const out = deinterleaveStereo(interleaved)
  assert.equal(out.length, interleaved.length, '长度不变')
  assert.deepEqual(Array.from(out), [100, 101, 102, 103, 200, 201, 202, 203], 'L 全段在前、R 全段在后')
  // 输入不应被原地修改
  assert.deepEqual(
    Array.from(interleaved),
    [100, 200, 101, 201, 102, 202, 103, 203],
    '输入 interleaved 保持原样',
  )
  console.log('ok: deinterleaveStereo')
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
  assert.ok(Math.abs(peaks[2].ampL! - 0.8) < 1e-6, '桶 2 左声道峰值应 0.8')
  assert.ok(Math.abs(peaks[2].ampR! - 0.6) < 1e-6, '桶 2 右声道峰值应 0.6')
  // 桶 2 共 20 帧仅一帧非零：rms = 幅度 / sqrt(20)
  const rmsExpected = 1 / Math.sqrt(20)
  assert.ok(Math.abs(peaks[2].rmsL! - 0.8 * rmsExpected) < 1e-6, '桶 2 左声道 RMS')
  assert.ok(Math.abs(peaks[2].rmsR! - 0.6 * rmsExpected) < 1e-6, '桶 2 右声道 RMS')

  // 桶数多于帧数 → 不崩
  assert.equal(computeWaveformPeaks(new Float32Array(4 * STEM_CHANNELS), 100).length, 100)

  // 桶数不能整除帧数时，能量应按比例铺满所有桶（旧 ceil 分桶会在右侧留下假静音）
  const dense = new Float32Array(1000 * STEM_CHANNELS).fill(0.5)
  const densePeaks = computeWaveformPeaks(dense, 300)
  assert.ok(
    densePeaks.every((p) => p.max > 0.4),
    '每个桶都应覆盖到真实采样',
  )
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

function testSilenceRatio(): void {
  // 空数据 → 全静音
  assert.equal(silenceRatio(new Float32Array(0)), 1)
  // 全零 → 全静音
  assert.equal(silenceRatio(new Float32Array(1000 * STEM_CHANNELS)), 1)
  // 恒定满幅 → 无静音
  assert.equal(silenceRatio(new Float32Array(1000 * STEM_CHANNELS).fill(0.5)), 0)
  // 微弱信号（约 -60dBFS）低于 -50dB 阈值 → 视为静音
  assert.equal(silenceRatio(new Float32Array(1000 * STEM_CHANNELS).fill(0.001)), 1)

  // 精确分块：100 块中前 50 块有内容、后 50 块全零 → 0.5
  const half = new Float32Array(100 * 100 * STEM_CHANNELS)
  for (let b = 0; b < 50; b++) {
    for (let i = 0; i < 100; i++) {
      half[(b * 100 + i) * STEM_CHANNELS] = 0.3
      half[(b * 100 + i) * STEM_CHANNELS + 1] = 0.3
    }
  }
  assert.equal(silenceRatio(half, 100), 0.5)

  // 模拟 other2 特征：全曲静音 + 每隔 ~5.8s（256000 帧@44.1k）一个短脉冲 → 高静音占比
  const sparse = new Float32Array(2560000 * STEM_CHANNELS) // ~58 秒
  for (let f = 1000; f < sparse.length / STEM_CHANNELS; f += 256000) {
    sparse[f * STEM_CHANNELS] = 0.9
    sparse[f * STEM_CHANNELS + 1] = 0.9
  }
  const sparseRatio = silenceRatio(sparse, 2048)
  assert.ok(sparseRatio >= 0.9, `稀疏脉冲轨静音占比应 ≥0.9，实际 ${sparseRatio}`)
  console.log('ok: silenceRatio')
}

function testMixStems(): void {
  const a = new Float32Array(8)
  const b = new Float32Array(8)
  a.set([0.1, 0.2, 0.3, 0.4, 0.5, 0.6, 0.7, 0.8])
  b.set([0.9, 0.8, 0.7, 0.6, 0.5, 0.4, 0.3, 0.2])
  const mixed = mixStems(a, b)
  for (let i = 0; i < 8; i++) {
    assert.ok(Math.abs(mixed[i] - 1.0) < 1e-6, `逐样本相加，位置 ${i}`)
  }
  // 不修改入参（float32 存储精度，用容差）
  assert.ok(Math.abs(a[0] - 0.1) < 1e-7, 'a 不应被修改')
  assert.ok(Math.abs(b[0] - 0.9) < 1e-7, 'b 不应被修改')
  // 与全零相加 → 原样（float32 容差）
  const copy = mixStems(a, new Float32Array(a.length))
  for (let i = 0; i < a.length; i++) {
    assert.ok(Math.abs(copy[i] - a[i]) < 1e-7, `与零相加应原样，位置 ${i}`)
  }
  console.log('ok: mixStems')
}

function testDisplayLabel(): void {
  // 7 轨（other2 单列）：other 仍为「其他一」，other2 为「其他二」
  assert.equal(stemDisplayLabel('other', true), '其他一')
  assert.equal(stemDisplayLabel('other2', true), '其他二')
  // 6 轨（other2 已合并）：other 显示「其他」
  assert.equal(stemDisplayLabel('other', false), '其他')
  // 其余轨不受影响
  assert.equal(stemDisplayLabel('vocals', false), '人声')
  assert.equal(stemDisplayLabel('drums', true), '鼓')
  assert.equal(stemDisplayLabel('guitar', false), '吉他')
  console.log('ok: stemDisplayLabel')
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

function testWaveformRms(): void {
  // 恒定幅度：rms 应等于该幅度（均方根）
  const constData = new Float32Array(100 * STEM_CHANNELS).fill(0.5)
  const constPeaks = computeWaveformPeaks(constData, 4)
  assert.ok(
    constPeaks.every((p) => p.rms !== undefined && Math.abs(p.rms - 0.5) < 1e-6),
    '恒定幅度桶的 rms 应等于幅度',
  )

  // 稀疏瞬时峰值：max 高但 rms 低 —— rms 是长窗口包络不顶满的关键
  const sparse = new Float32Array(100 * STEM_CHANNELS)
  sparse[0] = 1.0 // 桶 0（帧 0..24）仅首帧大幅
  const sparsePeaks = computeWaveformPeaks(sparse, 4)
  assert.ok(Math.abs(sparsePeaks[0].max - 1.0) < 1e-6, '稀疏峰值 max=1')
  assert.ok(
    sparsePeaks[0].rms !== undefined && Math.abs(sparsePeaks[0].rms - 0.2) < 1e-6,
    '稀疏峰值 rms = sqrt(1/25) = 0.2，远低于 max',
  )
  // 纯静音桶 rms 为 0
  assert.equal(sparsePeaks[3].rms, 0)

  // 金字塔带 rms；全曲聚合 rms 与直接计算一致（恒定幅度下无聚合误差）
  const pyramid = buildWaveformPyramid(constData, 44100)
  assert.ok(pyramid.rms, '金字塔应带 rms')
  const fromPyramid = computeWaveformPeaksFromPyramid(pyramid, 4, 0, 50)
  const exact = computeWaveformPeaks(constData, 4, 0, 50)
  for (let b = 0; b < 4; b++) {
    assert.ok(
      Math.abs((fromPyramid[b].rms ?? 0) - (exact[b].rms ?? 0)) < 0.05,
      `桶 ${b} 金字塔 rms 聚合应接近精确值`,
    )
  }
  console.log('ok: computeWaveformPeaks RMS')
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
    // L/R 声道峰值同样为保守覆盖聚合
    assert.ok(approx[b].ampL! >= exact[b].ampL! - 1e-6, `桶 ${b} ampL 不应小于精确值`)
    assert.ok(approx[b].ampR! >= exact[b].ampR! - 1e-6, `桶 ${b} ampR 不应小于精确值`)
    assert.ok(Math.abs(approx[b].ampL! - exact[b].ampL!) < 0.1, `桶 ${b} ampL 误差应在 1 桶覆盖内`)
    assert.ok(Math.abs(approx[b].ampR! - exact[b].ampR!) < 0.1, `桶 ${b} ampR 误差应在 1 桶覆盖内`)
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
testDeinterleave()
testWaveformPeaks()
testWaveformPeaksRange()
testWaveformRms()
testWaveformPyramid()
testConstants()
testResample()
testEncodeWav()
testSilenceRatio()
testMixStems()
testDisplayLabel()
