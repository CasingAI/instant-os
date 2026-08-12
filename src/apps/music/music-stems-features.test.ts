/**
 * 分轨可视化特征纯函数单测。
 * 运行：node --experimental-strip-types src/apps/music/music-stems-features.test.ts
 */
import assert from 'node:assert/strict'
import type { StemAudio } from '../stems/stems-types.ts'
import { STEM_IDS } from '../stems/stems-types.ts'
import {
  beatPhaseAt,
  buildOnsetFromEnvelope,
  buildStemVizFeatures,
  extractStemEnvelopes,
  lerpSeries,
  normalizeSeries,
  sampleStemFeaturesAt,
  tempoBpmAt,
} from './music-stems-features.ts'
import { stemsSidecarNameForAudio } from './music-stems-resolve.ts'

function testLerpSeries(): void {
  const s = new Float32Array([0, 10, 20])
  assert.equal(lerpSeries(s, 0), 0)
  assert.equal(lerpSeries(s, 1), 10)
  assert.equal(lerpSeries(s, 0.5), 5)
  assert.equal(lerpSeries(s, -1), 0)
  assert.equal(lerpSeries(s, 99), 20)
  assert.equal(lerpSeries(new Float32Array(0), 0), 0)
  console.log('ok: lerpSeries')
}

function testNormalizeAndOnset(): void {
  const raw = new Float32Array([0, 0.1, 0.5, 1, 0.2])
  const norm = normalizeSeries(raw)
  assert.equal(norm.length, 5)
  for (const v of norm) {
    assert.ok(v >= 0 && v <= 1)
  }
  assert.ok((norm[3] ?? 0) >= (norm[1] ?? 0))

  const onset = buildOnsetFromEnvelope(new Float32Array([0, 0.2, 0.8, 0.3, 0.9]))
  assert.equal(onset.length, 5)
  assert.ok((onset[2] ?? 0) > 0)
  console.log('ok: normalizeSeries / buildOnsetFromEnvelope')
}

function testExtractEnvelopes(): void {
  // 1 秒 44100Hz 立体声正弦（低频）
  const sr = 44100
  const frames = sr
  const data = new Float32Array(frames * 2)
  for (let i = 0; i < frames; i++) {
    const x = Math.sin((2 * Math.PI * 110 * i) / sr) * 0.5
    data[i * 2] = x
    data[i * 2 + 1] = x
  }
  const env = extractStemEnvelopes(data, 882, 2048)
  assert.ok(env.energy.length > 10)
  assert.equal(env.low.length, env.energy.length)
  assert.ok((env.energy[10] ?? 0) > 0.05)
  console.log('ok: extractStemEnvelopes')
}

function testBuildAndSample(): void {
  const hop = 100
  const frames = 50
  const stems: StemAudio[] = STEM_IDS.map((id, idx) => {
    const data = new Float32Array(frames * hop * 2)
    for (let i = 0; i < frames * hop; i++) {
      const amp = 0.1 + idx * 0.05
      data[i * 2] = amp
      data[i * 2 + 1] = amp
    }
    return { stemId: id, data }
  })
  const features = buildStemVizFeatures({
    trackId: 't1',
    stems,
    sampleRate: 44100,
    durationSec: (frames * hop) / 44100,
    hopSamples: hop,
    frameSamples: hop,
    tempo: {
      bpm: 120,
      segments: [{ startSec: 0, endSec: 10, bpm: 120 }],
    },
  })
  assert.equal(features.trackId, 't1')
  assert.ok(features.frameCount >= 1)
  assert.equal(features.tempo?.bpm, 120)

  const sample = sampleStemFeaturesAt(features, 0)
  for (const id of STEM_IDS) {
    assert.ok(sample.byStem[id])
    assert.ok(sample.byStem[id]!.energy >= 0)
    assert.ok(sample.byStem[id]!.energy <= 1)
  }
  assert.equal(sample.bpm, 120)
  assert.ok(sample.beatPhase >= 0 && sample.beatPhase < 1)
  console.log('ok: buildStemVizFeatures / sampleStemFeaturesAt')
}

function testTempoHelpers(): void {
  assert.equal(tempoBpmAt(undefined, 1), 120)
  assert.equal(
    tempoBpmAt(
      {
        bpm: 100,
        segments: [
          { startSec: 0, endSec: 5, bpm: 90 },
          { startSec: 5, endSec: 20, bpm: 140 },
        ],
      },
      6,
    ),
    140,
  )

  const phase0 = beatPhaseAt({ bpm: 60, segments: [{ startSec: 0, endSec: 100, bpm: 60 }] }, 0)
  const phase1 = beatPhaseAt({ bpm: 60, segments: [{ startSec: 0, endSec: 100, bpm: 60 }] }, 1)
  // 60 BPM → 1 秒刚好 1 拍，相位回到 0
  assert.ok(Math.abs(phase0) < 1e-9)
  assert.ok(Math.abs(phase1) < 1e-9)

  const half = beatPhaseAt({ bpm: 60, segments: [{ startSec: 0, endSec: 100, bpm: 60 }] }, 0.5)
  assert.ok(Math.abs(half - 0.5) < 1e-9)
  console.log('ok: tempoBpmAt / beatPhaseAt')
}

function testSidecarName(): void {
  assert.equal(stemsSidecarNameForAudio('夜航星.mp3'), '夜航星.stems.zip')
  assert.equal(stemsSidecarNameForAudio('a.b.flac'), 'a.b.stems.zip')
  assert.equal(stemsSidecarNameForAudio('noext'), 'noext.stems.zip')
  console.log('ok: stemsSidecarNameForAudio')
}

testLerpSeries()
testNormalizeAndOnset()
testExtractEnvelopes()
testBuildAndSample()
testTempoHelpers()
testSidecarName()
console.log('all music-stems-features tests passed')
