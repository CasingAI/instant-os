/**
 * 运行：node --experimental-strip-types src/apps/midi-demo/midi-demo-abc.test.ts
 */
import assert from 'node:assert/strict'
import {
  DEFAULT_SAMPLE_ABC,
  extractAbcSource,
  measureTicks,
  parseAbc,
  scoreDurationTicks,
  TICKS_PER_QUARTER,
} from './midi-demo-abc.ts'

function noteAt(startTick: number, midi: number, durationTick: number, voice = 1) {
  return { midi, startTick, durationTick, voice }
}

function testExtractFenceAndPrefix(): void {
  const fenced = extractAbcSource('说明如下：\n```abc\nX:1\nC2\n```\n完')
  assert.equal(fenced, 'X:1\nC2')
  const prefixed = extractAbcSource('模型说：\nX:1\nT:Hi\nK:C\nC2')
  assert.equal(prefixed.startsWith('X:1'), true)
}

function testMeasureFillsFourFour(): void {
  const score = parseAbc(`X:1
M:4/4
L:1/8
Q:1/4=100
K:C
C2 E2 G2 c2 | B2 A2 G4 |`)
  const bar = measureTicks(score)
  assert.equal(bar, 4 * TICKS_PER_QUARTER)
  const firstBar = score.notes.filter((note) => note.startTick < bar)
  const firstEnd = Math.max(...firstBar.map((note) => note.startTick + note.durationTick))
  assert.equal(firstEnd, bar)
  const second = score.notes.filter((note) => note.startTick >= bar)
  assert.equal(second[0]?.startTick, bar)
  assert.equal(scoreDurationTicks(score), bar * 2)
}

function testOctavesAndMiddleC(): void {
  const score = parseAbc('X:1\nL:1/4\nK:C\nC, C c c\'')
  const pitches = score.notes.map((note) => note.midi)
  assert.deepEqual(pitches, [48, 60, 72, 84])
}

function testChordSharesOnset(): void {
  const score = parseAbc('X:1\nL:1/4\nK:C\n[CEG]2 D')
  const chord = score.notes.filter((note) => note.startTick === 0)
  assert.equal(chord.length, 3)
  assert.deepEqual(chord.map((note) => note.midi).sort((a, b) => a - b), [60, 64, 67])
  assert.ok(chord.every((note) => note.durationTick === 2 * TICKS_PER_QUARTER))
  const d = score.notes.find((note) => note.midi === 62)
  assert.equal(d?.startTick, 2 * TICKS_PER_QUARTER)
}

function testTwoHandsIndependentTime(): void {
  const score = parseAbc(`X:1
L:1/4
K:C
V:1
C D
V:2
E, F,`)
  const treble = score.notes.filter((note) => note.voice === 1)
  const bass = score.notes.filter((note) => note.voice === 2)
  assert.equal(treble.length, 2)
  assert.equal(bass.length, 2)
  assert.equal(treble[0]?.startTick, 0)
  assert.equal(bass[0]?.startTick, 0)
  assert.equal(treble[1]?.startTick, TICKS_PER_QUARTER)
  assert.equal(bass[1]?.startTick, TICKS_PER_QUARTER)
}

function testKeySignatureAppliesUntilBar(): void {
  const gMajor = parseAbc('X:1\nL:1/4\nK:G\nF | F')
  assert.equal(gMajor.notes[0]?.midi, 66)
  assert.equal(gMajor.notes[1]?.midi, 66)
  const natural = parseAbc('X:1\nL:1/4\nK:G\n=F')
  assert.equal(natural.notes[0]?.midi, 65)
}

function testTupletThreeInTimeOfTwo(): void {
  const score = parseAbc('X:1\nL:1/8\nK:C\n(3CDE')
  assert.equal(score.notes.length, 3)
  const span = scoreDurationTicks(score)
  assert.equal(span, TICKS_PER_QUARTER)
  assert.ok(score.notes.every((note) => note.durationTick === Math.round((TICKS_PER_QUARTER * 2) / 6)))
}

function testDefaultSampleIsEightBarsTwoHands(): void {
  const score = parseAbc(DEFAULT_SAMPLE_ABC)
  const bar = measureTicks(score)
  assert.equal(score.title, 'Demo Prelude')
  assert.equal(score.tempoBpm, 96)
  const v1 = score.notes.filter((note) => note.voice === 1)
  const v2 = score.notes.filter((note) => note.voice === 2)
  assert.ok(v1.length > 0 && v2.length > 0)
  assert.equal(scoreDurationTicks({ ...score, notes: v1 }), bar * 8)
  assert.equal(scoreDurationTicks({ ...score, notes: v2 }), bar * 8)
}

function testEmptyThrows(): void {
  assert.throws(() => parseAbc('hello'), /没有解析到/)
}

function run(): void {
  testExtractFenceAndPrefix()
  testMeasureFillsFourFour()
  testOctavesAndMiddleC()
  testChordSharesOnset()
  testTwoHandsIndependentTime()
  testKeySignatureAppliesUntilBar()
  testTupletThreeInTimeOfTwo()
  testDefaultSampleIsEightBarsTwoHands()
  testEmptyThrows()
  void noteAt
  console.log('midi-demo-abc.test.ts ok')
}

run()
