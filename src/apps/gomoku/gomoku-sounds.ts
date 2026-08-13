import { getEffectiveSystemVolume } from '../../os/system-volume.ts'

let audioContext: AudioContext | undefined

function getAudioContext(): AudioContext | undefined {
  if (typeof window === 'undefined') return undefined
  if (!audioContext) {
    const Ctx = window.AudioContext ?? (window as typeof window & { webkitAudioContext?: typeof AudioContext }).webkitAudioContext
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

function playTone(
  frequency: number,
  duration: number,
  type: OscillatorType = 'sine',
  gain = 0.08,
  startOffset = 0,
): void {
  const ctx = getAudioContext()
  if (!ctx) return

  const effectiveGain = gain * getEffectiveSystemVolume()
  if (effectiveGain <= 0) return

  void resumeContext(ctx).then(() => {
    const oscillator = ctx.createOscillator()
    const gainNode = ctx.createGain()
    oscillator.type = type
    oscillator.frequency.value = frequency
    gainNode.gain.setValueAtTime(0, ctx.currentTime + startOffset)
    gainNode.gain.linearRampToValueAtTime(effectiveGain, ctx.currentTime + startOffset + 0.008)
    gainNode.gain.exponentialRampToValueAtTime(0.0001, ctx.currentTime + startOffset + duration)
    oscillator.connect(gainNode)
    gainNode.connect(ctx.destination)
    oscillator.start(ctx.currentTime + startOffset)
    oscillator.stop(ctx.currentTime + startOffset + duration + 0.02)
  })
}

export function playPlaceSound(player: 1 | 2): void {
  const base = player === 1 ? 280 : 360
  playTone(base, 0.09, 'triangle', 0.1)
  playTone(base * 1.5, 0.05, 'sine', 0.04, 0.01)
}

export function playInvalidSound(): void {
  playTone(140, 0.12, 'square', 0.05)
}

export function playWinSound(): void {
  const notes = [523.25, 659.25, 783.99, 1046.5]
  notes.forEach((freq, index) => {
    playTone(freq, 0.35, 'triangle', 0.09, index * 0.1)
  })
  playTone(1567.98, 0.5, 'sine', 0.06, 0.42)
}

export function playUndoSound(): void {
  playTone(220, 0.08, 'sine', 0.06)
  playTone(180, 0.1, 'sine', 0.05, 0.04)
}

export function playLotteryTickSound(step: number, totalSteps: number): void {
  const progress = step / Math.max(totalSteps - 1, 1)
  const frequency = 320 + progress * 180
  playTone(frequency, 0.05, 'triangle', 0.04 + progress * 0.02)
}

export function playLotteryRevealSound(humanFirst: boolean): void {
  const base = humanFirst ? 440 : 360
  playTone(base, 0.14, 'triangle', 0.1)
  playTone(base * 1.25, 0.2, 'sine', 0.07, 0.08)
  playTone(base * 1.5, 0.28, 'triangle', 0.05, 0.16)
}
