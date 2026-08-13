/**
 * 可视化纯函数单测。
 * 运行：node --experimental-strip-types src/apps/music/music-visualizer-math.test.ts
 */
import assert from 'node:assert/strict'
import {
  accentTriadRgb,
  bandEnergy,
  computeActiveRange,
  computeActiveWordIndex,
  computeBarHeights,
  computeIdleLevels,
  computeIdleWave,
  computePeaks,
  computeWavePoints,
  hexToHsl,
  hexToRgb,
  hslToRgb,
  lineFill,
  smoothLevels,
  withAlpha,
  wordFill,
} from './music-visualizer-math.ts'

function testBarHeights(): void {
  const zeros = new Uint8Array(32)
  assert.deepEqual(computeBarHeights(zeros, 8), Array(8).fill(0))

  const max = new Uint8Array(32).fill(255)
  const full = computeBarHeights(max, 8)
  assert.equal(full.length, 8)
  for (const h of full) {
    assert.ok(h >= 0.99 && h <= 1, '全 255 应接近 1')
  }

  // 空数组 / 0 桶
  assert.deepEqual(computeBarHeights(new Uint8Array(0), 8), [])
  assert.deepEqual(computeBarHeights(zeros, 0), [])

  // 对数分桶：前半段能量集中在低频
  const lowFreq = new Uint8Array(64)
  for (let i = 0; i < 8; i += 1) lowFreq[i] = 255
  const lows = computeBarHeights(lowFreq, 8)
  assert.ok(lows[0] > 0, '低频桶应有能量')
  assert.ok(lows[7] === 0, '高频桶应无能量')

  // 0.8 次幂提升：中等能量被抬高（0.25^0.8 ≈ 0.33 > 0.25）
  const mid = new Uint8Array(32).fill(64)
  const lifted = computeBarHeights(mid, 4)
  assert.ok(lifted[0] > 64 / 255, '中能量应被幂次抬高')
  assert.ok(lifted[0] < 1, '中能量不应顶满')
  console.log('ok: computeBarHeights')
}

function testBarHeightsWithRange(): void {
  // 水平裁剪：区间外能量不影响柱高
  const band = new Uint8Array(64)
  for (let i = 16; i < 48; i += 1) band[i] = 255
  // 未裁剪（对数分桶）：低频桶覆盖全零 bin，应整体为 0
  const uncut = computeBarHeights(band, 4)
  assert.equal(uncut[0], 0, '未裁剪时低频桶应为 0')
  assert.equal(uncut[1], 0, '未裁剪时次低频桶应为 0')
  assert.ok(uncut[2] > 0.99, '能量所在桶应顶满')
  // 裁剪到 [16,47]：整个区间能量均匀，所有桶应接近满
  const cut = computeBarHeights(band, 4, { lowBin: 16, highBin: 47 })
  for (const h of cut) {
    assert.ok(h > 0.99, '裁剪后区间内各桶能量应接近满')
  }
  // 裁剪到无能量区间 → 全 0（空白区域不显示）
  const quiet = new Uint8Array(64)
  quiet[40] = 255
  for (const h of computeBarHeights(quiet, 8, { lowBin: 0, highBin: 10 })) {
    assert.equal(h, 0, '区间外能量不应显示')
  }

  // 垂直归一化：peak 代替 255
  const mid = new Uint8Array(32).fill(64)
  // 64/255≈0.251，0.251^0.8≈0.331
  const base = computeBarHeights(mid, 1)
  const boosted = computeBarHeights(mid, 1, { peak: 64 })
  assert.ok(Math.abs(base[0] - Math.pow(64 / 255, 0.8)) < 1e-9)
  assert.ok(Math.abs(boosted[0] - 1) < 1e-9, 'peak=64 时 64 能量应顶满')
  // 非正 peak 回退 255
  assert.deepEqual(computeBarHeights(mid, 1, { peak: 0 }), base)
  // 区间越界回退到合法范围
  assert.deepEqual(computeBarHeights(band, 4, { lowBin: -5, highBin: 999 }), uncut)
  console.log('ok: computeBarHeights 裁剪/归一化')
}

function testActiveRange(): void {
  const quiet = new Uint8Array(16)
  assert.equal(computeActiveRange(quiet), undefined, '全静音返回 undefined')

  const active = new Uint8Array(16)
  active[3] = 100
  active[9] = 50
  assert.deepEqual(computeActiveRange(active), { low: 3, high: 9 })

  // 阈值过滤：低于阈值的频段视为无效
  const sparse = new Uint8Array(16)
  sparse[0] = 1
  sparse[5] = 5
  assert.deepEqual(computeActiveRange(sparse, 2), { low: 5, high: 5 })
  assert.deepEqual(computeActiveRange(sparse, 1), { low: 0, high: 5 })

  // 空数组
  assert.equal(computeActiveRange(new Uint8Array(0)), undefined)
  console.log('ok: computeActiveRange')
}

function testWavePoints(): void {
  const center = new Uint8Array(16).fill(128)
  assert.deepEqual(computeWavePoints(center, 8), Array(8).fill(0))

  const low = new Uint8Array(16).fill(0)
  assert.deepEqual(computeWavePoints(low, 8), Array(8).fill(-1))

  const high = new Uint8Array(16).fill(255)
  // (255 - 128) / 128 = 0.9921875
  assert.deepEqual(computeWavePoints(high, 8), Array(8).fill(127 / 128))

  assert.deepEqual(computeWavePoints(new Uint8Array(0), 8), [])
  assert.deepEqual(computeWavePoints(center, 0), [])
  console.log('ok: computeWavePoints')
}

function testActiveWordIndex(): void {
  const words = [
    { timeMs: 100, text: 'a' },
    { timeMs: 200, text: 'b' },
    { timeMs: 300, text: 'c' },
  ]
  assert.equal(computeActiveWordIndex(words, 50), -1)
  assert.equal(computeActiveWordIndex(words, 100), 0)
  assert.equal(computeActiveWordIndex(words, 199), 0)
  assert.equal(computeActiveWordIndex(words, 200), 1)
  assert.equal(computeActiveWordIndex(words, 999), 2)
  assert.equal(computeActiveWordIndex([], 100), -1)
  console.log('ok: computeActiveWordIndex')
}

function testSmoothLevels(): void {
  // 上升快：attack=0.6 → 一步走 60% 差距
  const risen = smoothLevels([0], [1], 0.6, 0.86)
  assert.ok(Math.abs(risen[0] - 0.6) < 1e-9)
  // 回落慢：decay=0.86 → 保留 86%
  const fallen = smoothLevels([1], [0], 0.6, 0.86)
  assert.ok(Math.abs(fallen[0] - 0.86) < 1e-9)
  // prev 长度不足按 0 起步；输出与 next 等长
  const grown = smoothLevels([], [0.5, 0.5], 0.6, 0.86)
  assert.equal(grown.length, 2)
  assert.ok(Math.abs(grown[0] - 0.3) < 1e-9)
  console.log('ok: smoothLevels')
}

function testPeaks(): void {
  // 峰值跟随更高的新值
  assert.deepEqual(computePeaks([0.5], [0.8], 0.1), [0.8])
  // 旧峰值按 fallPerFrame 下落，但不低于当前值
  assert.ok(Math.abs(computePeaks([0.9], [0.1], 0.1)[0] - 0.8) < 1e-9)
  assert.deepEqual(computePeaks([], [0.3], 0.1), [0.3])
  console.log('ok: computePeaks')
}

function testBandEnergy(): void {
  const freq = new Uint8Array(100)
  for (let i = 0; i < 10; i += 1) freq[i] = 255
  assert.equal(bandEnergy(freq, 0, 0.1), 1)
  assert.equal(bandEnergy(freq, 0.5, 0.9), 0)
  assert.equal(bandEnergy(new Uint8Array(0), 0, 1), 0)
  // 区间退化时不越界
  assert.equal(bandEnergy(freq, 0.99, 0.99), 0)
  console.log('ok: bandEnergy')
}

function testIdle(): void {
  const levels = computeIdleLevels(16, 1.5)
  assert.equal(levels.length, 16)
  for (const v of levels) {
    assert.ok(v >= 0 && v <= 1, '待机柱高应在 0..1')
  }
  // 时间推进应变化
  assert.notDeepEqual(computeIdleLevels(16, 1.5), computeIdleLevels(16, 2.5))

  const wave = computeIdleWave(32, 0.8)
  assert.equal(wave.length, 32)
  for (const v of wave) {
    assert.ok(v >= -1 && v <= 1, '待机波形应在 -1..1')
  }
  assert.deepEqual(computeIdleWave(1, 0), [0])
  console.log('ok: computeIdleLevels/computeIdleWave')
}

function testWordAndLineFill(): void {
  const words = [{ timeMs: 100 }, { timeMs: 300 }, { timeMs: 500 }]
  // 第一个词：100→300 区间
  assert.equal(wordFill(words, 0, 100, 900), 0)
  assert.ok(Math.abs(wordFill(words, 0, 200, 900) - 0.5) < 1e-9)
  assert.equal(wordFill(words, 0, 400, 900), 1)
  // 最后一个词：到 lineEndMs
  assert.ok(Math.abs(wordFill(words, 2, 700, 900) - 0.5) < 1e-9)
  assert.equal(wordFill(words, 5, 700, 900), 0, '越界下标按 0')
  // 区间退化（下一词时间相同）不除零
  assert.equal(wordFill([{ timeMs: 100 }, { timeMs: 100 }], 0, 150, 900), 1)

  assert.equal(lineFill(1000, 2000, 500), 0)
  assert.ok(Math.abs(lineFill(1000, 2000, 1500) - 0.5) < 1e-9)
  assert.equal(lineFill(1000, 2000, 2500), 1)
  assert.equal(lineFill(2000, 2000, 2000), 0, '起止相同按 0')
  console.log('ok: wordFill/lineFill')
}

function testColors(): void {
  assert.deepEqual(hexToRgb('#fa2d55'), [250, 45, 85])
  assert.deepEqual(hexToRgb('fa2d55'), [250, 45, 85])
  assert.equal(hexToRgb('#fff'), undefined)
  assert.equal(hexToRgb('red'), undefined)

  assert.equal(withAlpha('#fa2d55', 0.5), 'rgba(250, 45, 85, 0.5)')
  assert.equal(withAlpha('red', 0.5), 'red', '非法输入原样返回')

  const hsl = hexToHsl('#fa2d55')
  assert.ok(hsl && hsl.h >= 340 && hsl.h <= 350, `主题红色相应在 345 左右，实际 ${hsl?.h}`)
  assert.ok(hsl && hsl.s > 90)
  assert.equal(hexToHsl('#000000')?.l, 0)
  assert.equal(hexToHsl('#ffffff')?.l, 100)

  assert.deepEqual(hslToRgb(0, 1, 0.5), [255, 0, 0])
  assert.deepEqual(hslToRgb(120, 1, 0.5), [0, 255, 0])
  assert.deepEqual(hslToRgb(240, 1, 0.5), [0, 0, 255])
  // 与 hexToHsl 互逆
  const roundTrip = hslToRgb(345, 0.95, 0.58)
  assert.ok(Math.abs(roundTrip[0] - 250) <= 3)

  const triad = accentTriadRgb('#fa2d55')
  assert.equal(triad.length, 3)
  assert.deepEqual(triad[0], hexToRgb('#fa2d55'), '主色应与输入一致')
  for (const color of triad) {
    for (const channel of color) {
      assert.ok(channel >= 0 && channel <= 255)
    }
  }
  // 非法输入回退默认主题红
  assert.deepEqual(accentTriadRgb('nope')[0], accentTriadRgb('#fa2d55')[0])
  console.log('ok: colors')
}

testBarHeights()
testBarHeightsWithRange()
testActiveRange()
testWavePoints()
testActiveWordIndex()
testSmoothLevels()
testPeaks()
testBandEnergy()
testIdle()
testWordAndLineFill()
testColors()
