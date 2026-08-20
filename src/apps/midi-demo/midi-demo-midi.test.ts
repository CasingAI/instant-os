/**
 * 运行：node --experimental-strip-types src/apps/midi-demo/midi-demo-midi.test.ts
 */
import assert from 'node:assert/strict'
import { DEFAULT_SAMPLE_ABC, parseAbc, type ScoreNote } from './midi-demo-abc.ts'
import {
  channelForVoice,
  decodeMidi,
  DRUM_CHANNEL,
  encodeMidi,
  PIANO_PROGRAM,
} from './midi-demo-midi.ts'

function compact(notes: ScoreNote[]) {
  return notes
    .map((note) => ({
      midi: note.midi,
      startTick: note.startTick,
      durationTick: note.durationTick,
      voice: note.voice,
    }))
    .sort((a, b) => a.startTick - b.startTick || a.midi - b.midi || a.voice - b.voice)
}

function testHeaderProgramAndRoundTrip(): void {
  const score = parseAbc(`X:1
T:Round
M:4/4
L:1/4
Q:1/4=100
K:C
V:1
C E
V:2
C, G,`)
  const bytes = encodeMidi(score)
  const text = String.fromCharCode(...bytes.subarray(0, 4))
  assert.equal(text, 'MThd')
  const decoded = decodeMidi(bytes)
  assert.equal(decoded.format, 1)
  assert.equal(decoded.ticksPerQuarter, score.ticksPerQuarter)
  assert.equal(decoded.tempoBpm, 100)
  assert.ok(decoded.programs.length > 0)
  assert.ok(decoded.programs.every((program) => program === PIANO_PROGRAM))
  assert.deepEqual(compact(decoded.notes), compact(score.notes))
}

function testNeverUsesDrumChannel(): void {
  assert.notEqual(channelForVoice(1), DRUM_CHANNEL)
  assert.notEqual(channelForVoice(2), DRUM_CHANNEL)
  assert.notEqual(channelForVoice(10), DRUM_CHANNEL)
  assert.notEqual(channelForVoice(11), DRUM_CHANNEL)
}

function testSampleRoundTrip(): void {
  const score = parseAbc(DEFAULT_SAMPLE_ABC)
  const decoded = decodeMidi(encodeMidi(score))
  assert.deepEqual(compact(decoded.notes), compact(score.notes))
  assert.equal(decoded.tempoBpm, score.tempoBpm)
}

function testRejectsGarbage(): void {
  assert.throws(() => decodeMidi(new Uint8Array([1, 2, 3, 4])), /MIDI/)
}

function run(): void {
  testHeaderProgramAndRoundTrip()
  testNeverUsesDrumChannel()
  testSampleRoundTrip()
  testRejectsGarbage()
  console.log('midi-demo-midi.test.ts ok')
}

run()
