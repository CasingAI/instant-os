/**
 * 标准 MIDI 文件（SMF Type 1）编解码。
 * 乐器固定为 GM Acoustic Grand Piano（Program 0）；双手用通道 0/1，不用通道 10。
 */

import type { Score, ScoreNote } from './midi-demo-abc.ts'
import { TICKS_PER_QUARTER } from './midi-demo-abc.ts'

export const PIANO_PROGRAM = 0
export const PIANO_PROGRAM_NAME = 'Acoustic Grand Piano'
/** MIDI 通道 10（index 9）是鼓组，钢琴禁用。 */
export const DRUM_CHANNEL = 9

export type DecodedMidi = {
  format: number
  ticksPerQuarter: number
  tempoBpm: number
  notes: ScoreNote[]
  programs: number[]
}

export function encodeMidi(score: Score): Uint8Array {
  const voices = new Map<number, ScoreNote[]>()
  for (const note of score.notes) {
    const voice = note.voice || 1
    const list = voices.get(voice) ?? []
    list.push(note)
    voices.set(voice, list)
  }
  const voiceIds = [...voices.keys()].sort((a, b) => a - b)
  const tracks: Uint8Array[] = [encodeConductorTrack(score)]
  for (const voice of voiceIds) {
    tracks.push(encodeNoteTrack(voices.get(voice)!, channelForVoice(voice), score.ticksPerQuarter))
  }

  const bytes: number[] = []
  bytes.push(...ascii('MThd'), ...u32(6), ...u16(1), ...u16(tracks.length), ...u16(score.ticksPerQuarter))
  for (const track of tracks) bytes.push(...track)
  return Uint8Array.from(bytes)
}

export function decodeMidi(bytes: Uint8Array): DecodedMidi {
  if (bytes.length < 14) throw new Error('MIDI 文件过短')
  let offset = 0
  const chunk = readChunk(bytes, offset)
  if (chunk.type !== 'MThd') throw new Error('不是标准 MIDI 文件（缺少 MThd）')
  offset = chunk.next
  const header = chunk.data
  if (header.length < 6) throw new Error('MIDI 头损坏')
  const format = readU16(header, 0)
  const ntrks = readU16(header, 2)
  const division = readU16(header, 4)
  if (division & 0x8000) throw new Error('不支持 SMPTE 时基')
  const ticksPerQuarter = division || TICKS_PER_QUARTER

  const notes: ScoreNote[] = []
  const programs: number[] = []
  let tempoBpm = 120

  for (let t = 0; t < ntrks; t += 1) {
    if (offset >= bytes.length) break
    const track = readChunk(bytes, offset)
    if (track.type !== 'MTrk') throw new Error('MIDI 音轨损坏（缺少 MTrk）')
    offset = track.next
    const parsed = parseTrack(track.data, ticksPerQuarter)
    notes.push(...parsed.notes)
    programs.push(...parsed.programs)
    if (parsed.tempoBpm != null) tempoBpm = parsed.tempoBpm
  }

  notes.sort(compareNotes)
  return { format, ticksPerQuarter, tempoBpm, notes, programs }
}

export function channelForVoice(voice: number): number {
  const index = Math.max(0, voice - 1)
  const channel = index % 15
  return channel >= DRUM_CHANNEL ? channel + 1 : channel
}

function encodeConductorTrack(score: Score): Uint8Array {
  const usec = Math.max(1, Math.round(60_000_000 / score.tempoBpm))
  const dd = Math.round(Math.log2(score.meterDen))
  const events: number[] = [
    ...varLen(0),
    0xff,
    0x51,
    0x03,
    (usec >> 16) & 0xff,
    (usec >> 8) & 0xff,
    usec & 0xff,
    ...varLen(0),
    0xff,
    0x58,
    0x04,
    score.meterNum & 0xff,
    dd & 0xff,
    24,
    8,
    ...varLen(0),
    0xff,
    0x2f,
    0x00,
  ]
  return wrapTrack(events)
}

function encodeNoteTrack(notes: ScoreNote[], channel: number, _ticksPerQuarter: number): Uint8Array {
  type Ev = { tick: number; order: number; bytes: number[] }
  const events: Ev[] = [
    { tick: 0, order: 0, bytes: [0xc0 | (channel & 0x0f), PIANO_PROGRAM] },
  ]
  for (const note of notes) {
    const vel = clamp(Math.round(note.velocity), 1, 127)
    const pitch = clamp(Math.round(note.midi), 0, 127)
    events.push({
      tick: note.startTick,
      order: 2,
      bytes: [0x90 | (channel & 0x0f), pitch, vel],
    })
    events.push({
      tick: note.startTick + note.durationTick,
      order: 1,
      bytes: [0x80 | (channel & 0x0f), pitch, 0],
    })
  }
  events.sort((a, b) => a.tick - b.tick || a.order - b.order)

  const bytes: number[] = []
  let cursor = 0
  for (const event of events) {
    bytes.push(...varLen(event.tick - cursor), ...event.bytes)
    cursor = event.tick
  }
  bytes.push(...varLen(0), 0xff, 0x2f, 0x00)
  return wrapTrack(bytes)
}

function wrapTrack(events: number[]): Uint8Array {
  return Uint8Array.from([...ascii('MTrk'), ...u32(events.length), ...events])
}

function parseTrack(
  data: Uint8Array,
  _ticksPerQuarter: number,
): { notes: ScoreNote[]; programs: number[]; tempoBpm?: number } {
  const notes: ScoreNote[] = []
  const programs: number[] = []
  const pending = new Map<string, { tick: number; velocity: number }[]>()
  let i = 0
  let tick = 0
  let running: number | undefined
  let tempoBpm: number | undefined
  const channelVoice = new Map<number, number>()

  while (i < data.length) {
    const delta = readVarLen(data, i)
    i = delta.next
    tick += delta.value
    if (i >= data.length) break

    let status = data[i]!
    if (status < 0x80) {
      if (running == null) throw new Error('MIDI running status 缺失')
      status = running
    } else {
      i += 1
      running = status < 0xf0 ? status : undefined
    }

    if (status === 0xff) {
      const type = data[i++]!
      const len = readVarLen(data, i)
      i = len.next
      const payload = data.subarray(i, i + len.value)
      i += len.value
      if (type === 0x51 && payload.length >= 3) {
        const usec = (payload[0]! << 16) | (payload[1]! << 8) | payload[2]!
        if (usec > 0) tempoBpm = Math.round(60_000_000 / usec)
      }
      if (type === 0x2f) break
      continue
    }

    if (status === 0xf0 || status === 0xf7) {
      const len = readVarLen(data, i)
      i = len.next + len.value
      continue
    }

    const command = status & 0xf0
    const channel = status & 0x0f
    if (command === 0xc0 || command === 0xd0) {
      const value = data[i++]!
      if (command === 0xc0) programs.push(value)
      continue
    }

    const data1 = data[i++]!
    const data2 = command === 0xf0 ? 0 : data[i++]!
    if (command === 0x90 && data2 > 0) {
      const key = `${channel}:${data1}`
      const stack = pending.get(key) ?? []
      stack.push({ tick, velocity: data2 })
      pending.set(key, stack)
      continue
    }
    if (command === 0x80 || (command === 0x90 && data2 === 0)) {
      const key = `${channel}:${data1}`
      const stack = pending.get(key)
      const start = stack?.shift()
      if (start == null) continue
      if (!channelVoice.has(channel)) {
        channelVoice.set(channel, channel === 0 ? 1 : channel < DRUM_CHANNEL ? channel + 1 : channel)
      }
      notes.push({
        midi: data1,
        startTick: start.tick,
        durationTick: Math.max(1, tick - start.tick),
        velocity: start.velocity,
        voice: channelVoice.get(channel) ?? 1,
      })
    }
  }

  return { notes, programs, tempoBpm }
}

function readChunk(bytes: Uint8Array, offset: number): { type: string; data: Uint8Array; next: number } {
  if (offset + 8 > bytes.length) throw new Error('MIDI chunk 头不完整')
  const type = String.fromCharCode(bytes[offset]!, bytes[offset + 1]!, bytes[offset + 2]!, bytes[offset + 3]!)
  const length = readU32(bytes, offset + 4)
  const start = offset + 8
  const end = start + length
  if (end > bytes.length) throw new Error('MIDI chunk 长度越界')
  return { type, data: bytes.subarray(start, end), next: end }
}

function compareNotes(a: ScoreNote, b: ScoreNote): number {
  return a.startTick - b.startTick || a.midi - b.midi || a.voice - b.voice
}

function ascii(text: string): number[] {
  return [...text].map((ch) => ch.charCodeAt(0))
}

function u16(value: number): number[] {
  return [(value >> 8) & 0xff, value & 0xff]
}

function u32(value: number): number[] {
  return [(value >>> 24) & 0xff, (value >>> 16) & 0xff, (value >>> 8) & 0xff, value & 0xff]
}

function readU16(bytes: Uint8Array, offset: number): number {
  return ((bytes[offset] ?? 0) << 8) | (bytes[offset + 1] ?? 0)
}

function readU32(bytes: Uint8Array, offset: number): number {
  return (
    ((bytes[offset] ?? 0) << 24) |
    ((bytes[offset + 1] ?? 0) << 16) |
    ((bytes[offset + 2] ?? 0) << 8) |
    (bytes[offset + 3] ?? 0)
  ) >>> 0
}

function varLen(value: number): number[] {
  let n = Math.max(0, value >>> 0)
  const bytes = [n & 0x7f]
  n >>= 7
  while (n > 0) {
    bytes.unshift((n & 0x7f) | 0x80)
    n >>= 7
  }
  return bytes
}

function readVarLen(bytes: Uint8Array, start: number): { value: number; next: number } {
  let i = start
  let value = 0
  for (let step = 0; step < 4; step += 1) {
    const byte = bytes[i++] ?? 0
    value = (value << 7) | (byte & 0x7f)
    if ((byte & 0x80) === 0) return { value, next: i }
  }
  throw new Error('MIDI 变长数量过长')
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value))
}
