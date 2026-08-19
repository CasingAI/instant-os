import { getEffectiveSystemVolume } from '../../os/system-volume.ts'
import { isSystemVolumeBusActive } from '../../os/audio-bus.ts'
import type { ScoreNote } from './midi-demo-abc.ts'

export type MidiPlayHandle = {
  stop: () => void
}

export function ticksToSeconds(ticks: number, tempoBpm: number, ticksPerQuarter: number): number {
  if (tempoBpm <= 0 || ticksPerQuarter <= 0) return 0
  return (ticks / ticksPerQuarter) * (60 / tempoBpm)
}

let audioContext: AudioContext | undefined
let playGeneration = 0
let activeStop: (() => void) | undefined

function getAudioContext(): AudioContext | undefined {
  if (typeof window === 'undefined') return undefined
  if (!audioContext) {
    const Ctx =
      window.AudioContext ??
      (window as typeof window & { webkitAudioContext?: typeof AudioContext }).webkitAudioContext
    if (!Ctx) return undefined
    audioContext = new Ctx()
  }
  return audioContext
}

async function resumeContext(ctx: AudioContext): Promise<void> {
  if (ctx.state === 'suspended') {
    await ctx.resume()
  }
}

function midiToHz(midi: number): number {
  return 440 * 2 ** ((midi - 69) / 12)
}

export function playDecodedMidi(options: {
  notes: readonly ScoreNote[]
  tempoBpm: number
  ticksPerQuarter: number
  onProgress?: (elapsedSec: number, totalSec: number) => void
  onEnded?: () => void
}): MidiPlayHandle {
  activeStop?.()
  const generation = ++playGeneration
  const ctx = getAudioContext()
  const oscillators: OscillatorNode[] = []
  const gains: GainNode[] = []
  let raf = 0
  let endedTimer = 0

  const teardown = () => {
    if (raf) cancelAnimationFrame(raf)
    raf = 0
    if (endedTimer) window.clearTimeout(endedTimer)
    endedTimer = 0
    const now = ctx?.currentTime ?? 0
    for (const gain of gains) {
      try {
        gain.gain.cancelScheduledValues(now)
        gain.gain.setTargetAtTime(0.0001, now, 0.02)
      } catch {
        /* closed */
      }
    }
    for (const osc of oscillators) {
      try {
        osc.stop(now + 0.06)
      } catch {
        /* already stopped */
      }
    }
    oscillators.length = 0
    gains.length = 0
    if (activeStop === stop) activeStop = undefined
  }

  const stop = () => {
    if (generation !== playGeneration) return
    playGeneration += 1
    teardown()
  }
  activeStop = stop

  if (!ctx || options.notes.length === 0) {
    options.onEnded?.()
    return { stop }
  }

  const totalSec = Math.max(
    0.05,
    ...options.notes.map((note) =>
      ticksToSeconds(note.startTick + note.durationTick, options.tempoBpm, options.ticksPerQuarter),
    ),
  )

  void resumeContext(ctx).then(() => {
    if (generation !== playGeneration) return
    const origin = ctx.currentTime + 0.04
    const volume = isSystemVolumeBusActive() ? 1 : getEffectiveSystemVolume()
    if (volume <= 0) {
      options.onEnded?.()
      return
    }

    for (const note of options.notes) {
      const start = origin + ticksToSeconds(note.startTick, options.tempoBpm, options.ticksPerQuarter)
      const end =
        origin +
        ticksToSeconds(note.startTick + note.durationTick, options.tempoBpm, options.ticksPerQuarter)
      schedulePianoVoice(ctx, oscillators, gains, note.midi, note.velocity, start, end, volume)
    }

    const wallOrigin = performance.now()
    const tick = () => {
      if (generation !== playGeneration) return
      const elapsed = (performance.now() - wallOrigin) / 1000
      options.onProgress?.(Math.min(elapsed, totalSec), totalSec)
      if (elapsed < totalSec) {
        raf = requestAnimationFrame(tick)
      }
    }
    raf = requestAnimationFrame(tick)
    endedTimer = window.setTimeout(() => {
      if (generation !== playGeneration) return
      options.onProgress?.(totalSec, totalSec)
      options.onEnded?.()
    }, (totalSec + 0.28) * 1000)
  })

  return { stop }
}

function schedulePianoVoice(
  ctx: AudioContext,
  oscillators: OscillatorNode[],
  gains: GainNode[],
  midi: number,
  velocity: number,
  start: number,
  end: number,
  volume: number,
): void {
  const duration = Math.max(0.04, end - start)
  const peak = 0.09 * (Math.min(127, Math.max(1, velocity)) / 80) * volume
  const freq = midiToHz(midi)
  const master = ctx.createGain()
  master.gain.setValueAtTime(0, start)
  master.gain.linearRampToValueAtTime(peak, start + 0.008)
  master.gain.exponentialRampToValueAtTime(
    Math.max(peak * 0.28, 0.0001),
    start + Math.min(0.16, duration * 0.4),
  )
  master.gain.exponentialRampToValueAtTime(Math.max(peak * 0.1, 0.0001), start + duration)
  master.gain.exponentialRampToValueAtTime(0.0001, start + duration + 0.2)
  master.connect(ctx.destination)
  gains.push(master)

  const partials: { type: OscillatorType; ratio: number; gain: number }[] = [
    { type: 'triangle', ratio: 1, gain: 1 },
    { type: 'sine', ratio: 2, gain: 0.28 },
    { type: 'sine', ratio: 3, gain: 0.12 },
    { type: 'sine', ratio: 4.01, gain: 0.05 },
  ]
  for (const partial of partials) {
    const osc = ctx.createOscillator()
    const gain = ctx.createGain()
    osc.type = partial.type
    osc.frequency.value = freq * partial.ratio
    gain.gain.value = partial.gain
    osc.connect(gain)
    gain.connect(master)
    osc.start(start)
    osc.stop(start + duration + 0.24)
    oscillators.push(osc)
    gains.push(gain)
  }
}

export function stopAllMidiPlayback(): void {
  activeStop?.()
}
