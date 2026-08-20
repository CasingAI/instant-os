/**
 * 受控 ABC 子集：给 LLM 写乐谱、再转 MIDI 用。
 * 支持 T/M/L/Q/K、音名与八度、时值、休止、和弦、小节线、升降、双手 V:、基础三连音。
 */

export const TICKS_PER_QUARTER = 480
export const DEFAULT_VELOCITY = 80

export type ScoreNote = {
  midi: number
  startTick: number
  durationTick: number
  velocity: number
  voice: number
}

export type Score = {
  title: string
  tempoBpm: number
  meterNum: number
  meterDen: number
  key: string
  ticksPerQuarter: number
  notes: ScoreNote[]
  warnings: string[]
}

export class AbcParseError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'AbcParseError'
  }
}

export const DEFAULT_SAMPLE_ABC = `X:1
T:Demo Prelude
M:4/4
L:1/8
Q:1/4=96
K:C
V:1 clef=treble
C2 E2 G2 c2 | B2 A2 G4 | A2 G2 F2 E2 | D4 C4 |
E2 G2 c2 e2 | d2 c2 B4 | c2 A2 G2 E2 | C8 |
V:2 clef=bass
C,2 G,2 E,2 G,2 | F,2 A,2 G,2 B,2 | F,2 A,2 G,2 C2 | G,4 C,4 |
C,2 E,2 G,2 C2 | F,2 A,2 G,2 D2 | E,2 C2 G,2 E,2 | C,8 |
`

const LETTER_SEMITONE: Record<string, number> = {
  C: 0,
  D: 2,
  E: 4,
  F: 5,
  G: 7,
  A: 9,
  B: 11,
}

const SHARP_ORDER = ['F', 'C', 'G', 'D', 'A', 'E', 'B'] as const
const FLAT_ORDER = ['B', 'E', 'A', 'D', 'G', 'C', 'F'] as const

const MAJOR_SHARP_COUNT: Record<string, number> = {
  C: 0,
  G: 1,
  D: 2,
  A: 3,
  E: 4,
  B: 5,
  'F#': 6,
  'C#': 7,
}

const MAJOR_FLAT_COUNT: Record<string, number> = {
  F: 1,
  Bb: 2,
  Eb: 3,
  Ab: 4,
  Db: 5,
  Gb: 6,
  Cb: 7,
}

const MINOR_TO_MAJOR: Record<string, string> = {
  A: 'C',
  E: 'G',
  B: 'D',
  'F#': 'A',
  'C#': 'E',
  'G#': 'B',
  'D#': 'F#',
  'A#': 'C#',
  D: 'F',
  G: 'Bb',
  C: 'Eb',
  F: 'Ab',
  Bb: 'Db',
  Eb: 'Gb',
  Ab: 'Cb',
}

type VoiceState = {
  tick: number
}

type ParseState = {
  title: string
  tempoBpm: number
  meterNum: number
  meterDen: number
  key: string
  unitQuarter: number
  keyAccidentals: Map<string, number>
  measureAccidentals: Map<string, number>
  voices: Map<number, VoiceState>
  voice: number
  notes: ScoreNote[]
  warnings: string[]
  tupletLeft: number
  tupletScale: number
  sawField: boolean
}

export function extractAbcSource(raw: string): string {
  const trimmed = raw.trim()
  if (!trimmed) return ''
  const fence = trimmed.match(/```(?:abc)?\s*\r?\n?([\s\S]*?)```/i)
  if (fence?.[1]) return fence[1].trim()
  const idx = trimmed.search(/^(?:X:|T:|M:|L:|Q:|K:|V:)/m)
  if (idx > 0) return trimmed.slice(idx).trim()
  return trimmed
}

export function parseAbc(source: string): Score {
  const text = extractAbcSource(source).replace(/\r\n/g, '\n').replace(/\\\n/g, '')
  if (!text.trim()) {
    throw new AbcParseError('乐谱为空')
  }

  const state = createState()
  const lines = text.split('\n')
  for (const rawLine of lines) {
    const line = rawLine.replace(/%.*$/, '')
    const trimmed = line.trim()
    if (!trimmed) continue
    const field = trimmed.match(/^([A-Za-z]):\s*(.*)$/)
    if (field) {
      applyField(state, field[1]!, field[2] ?? '')
      continue
    }
    parseBody(state, line)
  }

  if (state.notes.length === 0) {
    throw new AbcParseError('没有解析到音符。请确认输出是 ABC 乐谱（含音名 CDEFGAB）。')
  }
  if (!state.sawField && state.warnings.length > 0) {
    throw new AbcParseError('没有解析到完整 ABC 乐谱。请确认输出以 X: 或 K: 开头，并只包含音名 CDEFGAB。')
  }

  return {
    title: state.title || 'Untitled',
    tempoBpm: state.tempoBpm,
    meterNum: state.meterNum,
    meterDen: state.meterDen,
    key: state.key,
    ticksPerQuarter: TICKS_PER_QUARTER,
    notes: state.notes,
    warnings: state.warnings,
  }
}

function createState(): ParseState {
  return {
    title: '',
    tempoBpm: 120,
    meterNum: 4,
    meterDen: 4,
    key: 'C',
    unitQuarter: 0.5,
    keyAccidentals: new Map(),
    measureAccidentals: new Map(),
    voices: new Map([[1, { tick: 0 }]]),
    voice: 1,
    notes: [],
    warnings: [],
    tupletLeft: 0,
    tupletScale: 1,
    sawField: false,
  }
}

function voiceState(state: ParseState): VoiceState {
  let current = state.voices.get(state.voice)
  if (!current) {
    current = { tick: 0 }
    state.voices.set(state.voice, current)
  }
  return current
}

function applyField(state: ParseState, letter: string, value: string): void {
  state.sawField = true
  const field = letter.toUpperCase()
  const trimmed = value.trim()
  if (field === 'T' && !state.title) {
    state.title = trimmed
    return
  }
  if (field === 'M') {
    applyMeter(state, trimmed)
    return
  }
  if (field === 'L') {
    const ratio = parseRatio(trimmed)
    if (!ratio) {
      state.warnings.push(`无法解析 L:${trimmed}`)
      return
    }
    state.unitQuarter = (ratio.num / ratio.den) * 4
    return
  }
  if (field === 'Q') {
    applyTempo(state, trimmed)
    return
  }
  if (field === 'K') {
    applyKey(state, trimmed)
    return
  }
  if (field === 'V') {
    const match = trimmed.match(/^(\d+)/)
    const voice = match ? Number(match[1]) : 1
    state.voice = Number.isFinite(voice) && voice > 0 ? voice : 1
    voiceState(state)
    return
  }
}

function applyMeter(state: ParseState, raw: string): void {
  const token = raw.trim()
  if (token === 'C') {
    state.meterNum = 4
    state.meterDen = 4
    return
  }
  if (token === 'C|') {
    state.meterNum = 2
    state.meterDen = 2
    return
  }
  const match = token.match(/^(\d+)\s*\/\s*(\d+)/)
  if (!match) {
    state.warnings.push(`无法解析拍号 M:${raw}`)
    return
  }
  state.meterNum = Number(match[1])
  state.meterDen = Number(match[2])
}

function applyTempo(state: ParseState, raw: string): void {
  const cleaned = raw.replace(/"[^"]*"/g, '').trim()
  const withBeat = cleaned.match(/(\d+)\s*\/\s*(\d+)\s*=\s*(\d+)/)
  if (withBeat) {
    const num = Number(withBeat[1])
    const den = Number(withBeat[2])
    const bpm = Number(withBeat[3])
    const beatQuarter = (num / den) * 4
    state.tempoBpm = Math.max(1, Math.round(bpm * beatQuarter))
    return
  }
  const bare = cleaned.match(/(\d+)/)
  if (bare) {
    state.tempoBpm = Math.max(1, Number(bare[1]))
    return
  }
  state.warnings.push(`无法解析速度 Q:${raw}`)
}

function applyKey(state: ParseState, raw: string): void {
  const token = raw
    .replace(/\b(treble|bass|alto|tenor|perc|none|clef)\b/gi, '')
    .replace(/\b(major|maj|ionian|minor|min|m|aeolian)\b/gi, (match) =>
      /min|aeolian|^m$/i.test(match) ? 'minor' : '',
    )
    .replace(/=.*/g, '')
    .trim()
  const match = token.match(/^([A-Ga-g][b#]?)(.*)$/)
  if (!match) {
    if (token) state.warnings.push(`无法解析调号 K:${raw}`)
    return
  }
  const tonic = normalizeTonic(match[1]!)
  const rest = match[2] ?? ''
  const minor = /minor/.test(rest)
  const majorTonic = minor ? (MINOR_TO_MAJOR[tonic] ?? 'C') : tonic
  state.key = `${tonic}${minor ? 'm' : ''}`
  state.keyAccidentals = accidentalsForMajor(majorTonic)
  state.measureAccidentals.clear()
}

function normalizeTonic(raw: string): string {
  const letter = raw.charAt(0).toUpperCase()
  const acc = raw.slice(1)
  if (acc === '#') return `${letter}#`
  if (acc === 'b') return `${letter}b`
  return letter
}

function accidentalsForMajor(tonic: string): Map<string, number> {
  const map = new Map<string, number>()
  const sharps = MAJOR_SHARP_COUNT[tonic]
  if (sharps != null) {
    for (let i = 0; i < sharps; i += 1) {
      map.set(SHARP_ORDER[i]!, 1)
    }
    return map
  }
  const flats = MAJOR_FLAT_COUNT[tonic]
  if (flats != null) {
    for (let i = 0; i < flats; i += 1) {
      map.set(FLAT_ORDER[i]!, -1)
    }
  }
  return map
}

function parseBody(state: ParseState, line: string): void {
  let i = 0
  while (i < line.length) {
    i = skipIgnored(state, line, i)
    if (i >= line.length) break
    const ch = line[i]!

    if (ch === '[' && /[A-Za-z]:/.test(line.slice(i + 1, i + 4))) {
      const close = line.indexOf(']', i + 1)
      if (close < 0) {
        throw new AbcParseError('内联字段缺少 ]')
      }
      const inner = line.slice(i + 1, close)
      const field = inner.match(/^([A-Za-z]):\s*(.*)$/)
      if (field) applyField(state, field[1]!, field[2] ?? '')
      i = close + 1
      continue
    }

    if (ch === '|') {
      state.measureAccidentals.clear()
      i = skipBarLine(line, i)
      continue
    }

    if (ch === ':' || ch === ']') {
      i += 1
      continue
    }

    if (ch === '(' && /\d/.test(line[i + 1] ?? '')) {
      i = startTuplet(state, line, i)
      continue
    }

    if (ch === ')') {
      i += 1
      continue
    }

    if (ch === 'z' || ch === 'x' || ch === 'Z') {
      const rest = parseRest(state, line, i)
      i = rest.next
      advanceTime(state, rest.ticks)
      consumeTuplet(state)
      continue
    }

    if (ch === '[') {
      const chord = parseChord(state, line, i)
      i = chord.next
      const voice = voiceState(state)
      for (const midi of chord.midis) {
        state.notes.push({
          midi,
          startTick: voice.tick,
          durationTick: chord.ticks,
          velocity: DEFAULT_VELOCITY,
          voice: state.voice,
        })
      }
      advanceTime(state, chord.ticks)
      consumeTuplet(state)
      continue
    }

    if (/[A-Ga-g]/.test(ch) || ch === '^' || ch === '_' || ch === '=') {
      const note = parseNote(state, line, i)
      i = note.next
      const voice = voiceState(state)
      state.notes.push({
        midi: note.midi,
        startTick: voice.tick,
        durationTick: note.ticks,
        velocity: DEFAULT_VELOCITY,
        voice: state.voice,
      })
      advanceTime(state, note.ticks)
      consumeTuplet(state)
      continue
    }

    if (ch === '-' || ch === '>' || ch === '<' || ch === '~' || ch === '.' || ch === 'u' || ch === 'v') {
      if (ch === '>' || ch === '<') {
        state.warnings.push(`未支持的时值记号 ${ch}，已跳过（可能影响节奏）`)
      }
      i += 1
      continue
    }

    if (ch === '*' || ch === '+' || ch === '#' || ch === ',') {
      i += 1
      continue
    }

    state.warnings.push(`跳过无法识别的记号「${ch}」`)
    i += 1
  }
}

function skipIgnored(state: ParseState, line: string, start: number): number {
  let i = start
  while (i < line.length) {
    const ch = line[i]!
    if (/\s/.test(ch)) {
      i += 1
      continue
    }
    if (ch === '"') {
      const close = line.indexOf('"', i + 1)
      if (close < 0) {
        state.warnings.push('和弦标记缺少结束引号')
        return i + 1
      }
      i = close + 1
      continue
    }
    if (ch === '!') {
      const close = line.indexOf('!', i + 1)
      i = close < 0 ? i + 1 : close + 1
      continue
    }
    if (ch === '{') {
      const close = line.indexOf('}', i + 1)
      i = close < 0 ? i + 1 : close + 1
      continue
    }
    break
  }
  return i
}

function skipBarLine(line: string, start: number): number {
  let i = start
  while (i < line.length && /[|:\]]/.test(line[i]!)) i += 1
  while (i < line.length && /[0-9,]/.test(line[i]!)) i += 1
  return i
}

function startTuplet(state: ParseState, line: string, start: number): number {
  let i = start + 1
  let p = 0
  while (i < line.length && /\d/.test(line[i]!)) {
    p = p * 10 + Number(line[i])
    i += 1
  }
  let q = p === 3 ? 2 : p === 2 ? 3 : p === 4 ? 3 : 2
  let r = p
  if (line[i] === ':') {
    i += 1
    const parsedQ = parseLeadingInt(line, i)
    if (parsedQ) {
      q = parsedQ.value
      i = parsedQ.next
    }
    if (line[i] === ':') {
      i += 1
      const parsedR = parseLeadingInt(line, i)
      if (parsedR) {
        r = parsedR.value
        i = parsedR.next
      }
    }
  }
  if (p <= 0) {
    throw new AbcParseError('三连音记号无效')
  }
  state.tupletLeft = r
  state.tupletScale = q / p
  return i
}

function consumeTuplet(state: ParseState): void {
  if (state.tupletLeft <= 0) return
  state.tupletLeft -= 1
  if (state.tupletLeft === 0) state.tupletScale = 1
}

function parseRest(state: ParseState, line: string, start: number): { ticks: number; next: number } {
  const kind = line[start]!
  const duration = parseDuration(line, start + 1)
  const measureTicks =
    (state.meterNum / state.meterDen) * 4 * TICKS_PER_QUARTER
  const units = kind === 'Z' ? duration.value * (measureTicks / (state.unitQuarter * TICKS_PER_QUARTER)) : duration.value
  return { ticks: durationTicks(state, units), next: duration.next }
}

function parseChord(state: ParseState, line: string, start: number): { midis: number[]; ticks: number; next: number } {
  const close = line.indexOf(']', start + 1)
  if (close < 0) throw new AbcParseError('和弦缺少 ]')
  const inner = line.slice(start + 1, close)
  const midis: number[] = []
  let i = 0
  while (i < inner.length) {
    i = skipIgnored(state, inner, i)
    if (i >= inner.length) break
    if (!/[A-Ga-g^=_]/.test(inner[i]!)) {
      i += 1
      continue
    }
    const note = parsePitch(state, inner, i)
    midis.push(note.midi)
    i = note.next
  }
  const duration = parseDuration(line, close + 1)
  return { midis, ticks: durationTicks(state, duration.value), next: duration.next }
}

function parseNote(state: ParseState, line: string, start: number): { midi: number; ticks: number; next: number } {
  const pitch = parsePitch(state, line, start)
  const duration = parseDuration(line, pitch.next)
  return { midi: pitch.midi, ticks: durationTicks(state, duration.value), next: duration.next }
}

function parsePitch(
  state: ParseState,
  src: string,
  start: number,
): { midi: number; next: number } {
  let i = start
  let accidental: number | undefined
  while (src[i] === '^' || src[i] === '_' || src[i] === '=') {
    if (src[i] === '=') accidental = 0
    else if (src[i] === '^') accidental = (accidental ?? 0) + 1
    else accidental = (accidental ?? 0) - 1
    i += 1
  }
  const letterCh = src[i]
  if (!letterCh || !/[A-Ga-g]/.test(letterCh)) {
    throw new AbcParseError('升降号后面缺少音名')
  }
  i += 1
  const upper = letterCh.toUpperCase()
  let octave = letterCh === upper ? 4 : 5
  while (src[i] === ',') {
    octave -= 1
    i += 1
  }
  while (src[i] === "'") {
    octave += 1
    i += 1
  }

  const pitchId = `${upper}${octave}`
  let shift = 0
  if (accidental != null) {
    shift = accidental
    state.measureAccidentals.set(pitchId, accidental)
  } else if (state.measureAccidentals.has(pitchId)) {
    shift = state.measureAccidentals.get(pitchId)!
  } else {
    shift = state.keyAccidentals.get(upper) ?? 0
  }

  const midi = 12 * (octave + 1) + LETTER_SEMITONE[upper]! + shift
  if (midi < 0 || midi > 127) {
    throw new AbcParseError(`音高超出 MIDI 范围：${letterCh}`)
  }
  return { midi, next: i }
}

function parseDuration(src: string, start: number): { value: number; next: number } {
  let i = start
  const numPart = parseLeadingInt(src, i)
  let num = 1
  if (numPart) {
    num = numPart.value
    i = numPart.next
  }
  let den = 1
  if (src[i] === '/') {
    i += 1
    den = 2
    while (src[i] === '/') {
      den *= 2
      i += 1
    }
    const denPart = parseLeadingInt(src, i)
    if (denPart) {
      den = denPart.value
      i = denPart.next
    }
  } else if (!numPart) {
    num = 1
  }
  if (den === 0) throw new AbcParseError('时值分母不能为 0')
  return { value: num / den, next: i }
}

function parseLeadingInt(src: string, start: number): { value: number; next: number } | undefined {
  if (!/\d/.test(src[start] ?? '')) return undefined
  let i = start
  let value = 0
  while (i < src.length && /\d/.test(src[i]!)) {
    value = value * 10 + Number(src[i])
    i += 1
  }
  return { value, next: i }
}

function parseRatio(raw: string): { num: number; den: number } | undefined {
  const match = raw.trim().match(/^(\d+)\s*\/\s*(\d+)/)
  if (!match) return undefined
  const den = Number(match[2])
  if (den === 0) return undefined
  return { num: Number(match[1]), den }
}

function durationTicks(state: ParseState, units: number): number {
  const scale = state.tupletLeft > 0 ? state.tupletScale : 1
  return Math.max(1, Math.round(units * state.unitQuarter * TICKS_PER_QUARTER * scale))
}

function advanceTime(state: ParseState, ticks: number): void {
  voiceState(state).tick += ticks
}

export function scoreDurationTicks(score: Score): number {
  let end = 0
  for (const note of score.notes) {
    end = Math.max(end, note.startTick + note.durationTick)
  }
  return end
}

export function measureTicks(score: Pick<Score, 'meterNum' | 'meterDen' | 'ticksPerQuarter'>): number {
  return (score.meterNum / score.meterDen) * 4 * score.ticksPerQuarter
}
