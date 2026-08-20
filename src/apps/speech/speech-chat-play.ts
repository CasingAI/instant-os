/**
 * 语音对话 Demo：按脚本分段直连 MiMo TTS。
 * 支持边生成边播、软暂停、PCM 缓存（再播不重生成）。
 */
import type { AiUsageContext } from '../../ai/ai-usage-context.ts'
import { mergeOpenAiConfig } from '../../ai/openai-config.ts'
import {
  mimoSynthesizeSpeechStream,
  MIMO_TTS_PCM_SAMPLE_RATE,
} from '../../ai/speech-mimo-adapter.ts'
import { createStreamingPcmPlayer } from '../../ai/speech-pcm-player.ts'
import { isStreamAbortError, throwIfStreamAborted } from '../../ai/stream-abort.ts'
import {
  buildTtsStyle,
  buildTtsText,
  type SpeechScriptLine,
} from './speech-chat-script.ts'

export type SpeechLinePlayPhase = 'loading' | 'playing'

export type LineAudioCacheEntry = {
  pcm: Uint8Array
  sampleRate: number
  voice: string
}

export type PlaySpeechScriptOptions = {
  lines: readonly SpeechScriptLine[]
  startIndex?: number
  signal: AbortSignal
  usageContext?: AiUsageContext
  onFirstAudio?: () => void
  onLineStart?: (line: SpeechScriptLine, index: number) => void
  onLinePhase?: (index: number, phase: SpeechLinePlayPhase) => void
  /** 某段合成完整结束后回调（供再播缓存） */
  onLineAudio?: (
    index: number,
    line: SpeechScriptLine,
    audio: LineAudioCacheEntry,
  ) => void
}

function concatUint8Arrays(parts: readonly Uint8Array[]): Uint8Array {
  let total = 0
  for (const part of parts) total += part.byteLength
  const out = new Uint8Array(total)
  let offset = 0
  for (const part of parts) {
    out.set(part, offset)
    offset += part.byteLength
  }
  return out
}

/** 多段顺序流式合成并播放 */
export async function playSpeechScript(
  options: PlaySpeechScriptOptions,
): Promise<void> {
  throwIfStreamAborted(options.signal)
  const startIndex = Math.max(0, options.startIndex ?? 0)
  const lines = options.lines
    .map((line, index) => ({ line, index }))
    .filter(({ line, index }) => index >= startIndex && line.text.trim())
  if (lines.length === 0) {
    return
  }

  const queue = createSpeechScriptPlayQueue({
    signal: options.signal,
    usageContext: options.usageContext,
    onFirstAudio: options.onFirstAudio,
    onLineStart: options.onLineStart,
    onLinePhase: options.onLinePhase,
    onLineAudio: options.onLineAudio,
  })

  for (const { line, index } of lines) {
    queue.enqueue(line, index)
  }
  queue.finish()
  await queue.waitUntilDone()
}

/** 播放已缓存的 PCM（不再请求 TTS） */
export async function playCachedLineAudio(options: {
  audio: LineAudioCacheEntry
  signal: AbortSignal
  onPhase?: (phase: SpeechLinePlayPhase) => void
}): Promise<void> {
  throwIfStreamAborted(options.signal)
  options.onPhase?.('loading')
  const player = createStreamingPcmPlayer({
    sampleRate: options.audio.sampleRate,
    signal: options.signal,
  })
  try {
    options.onPhase?.('playing')
    // 整段入队；分片调度避免一次巨大 buffer
    const pcm = options.audio.pcm
    const chunkSize = 48_000 // ~1s @ 24kHz mono 16-bit
    for (let offset = 0; offset < pcm.byteLength; offset += chunkSize) {
      throwIfStreamAborted(options.signal)
      player.enqueue(pcm.subarray(offset, offset + chunkSize))
    }
    player.markEnd()
    await player.waitUntilEnded()
  } catch (err) {
    player.stop()
    if (isStreamAbortError(err, options.signal) || options.signal.aborted) {
      return
    }
    throw err
  }
}

/** 单段重新合成（换音色等）并返回完整 PCM */
export async function synthesizeSpeechLine(options: {
  line: SpeechScriptLine
  signal: AbortSignal
  usageContext?: AiUsageContext
  onPhase?: (phase: SpeechLinePlayPhase) => void
  onPcmChunk?: (pcm: Uint8Array) => void
}): Promise<LineAudioCacheEntry> {
  throwIfStreamAborted(options.signal)
  const config = mergeOpenAiConfig(undefined, 'speech-synthesis')
  options.onPhase?.('loading')
  const parts: Uint8Array[] = []
  let started = false

  await mimoSynthesizeSpeechStream({
    config,
    text: buildTtsText(options.line),
    styleInstruction: buildTtsStyle(options.line),
    voice: options.line.voice,
    signal: options.signal,
    usageContext: options.usageContext
      ? {
          ...options.usageContext,
          behavior: 'chat-speak-line',
          behaviorLabel: `语音对话合成·${options.line.voice}`,
        }
      : undefined,
    onPcmChunk: (pcm) => {
      if (!started) {
        started = true
        options.onPhase?.('playing')
      }
      parts.push(pcm)
      options.onPcmChunk?.(pcm)
    },
  })

  if (parts.length === 0) {
    throw new Error('合成结果中没有音频数据')
  }

  return {
    pcm: concatUint8Arrays(parts),
    sampleRate: MIMO_TTS_PCM_SAMPLE_RATE,
    voice: options.line.voice,
  }
}

export type SpeechScriptPlayQueue = {
  enqueue: (line: SpeechScriptLine, index: number) => void
  finish: () => void
  cancel: () => void
  pause: () => void
  resume: () => void
  waitUntilDone: () => Promise<void>
  readonly currentIndex: number
  readonly paused: boolean
}

export function createSpeechScriptPlayQueue(options: {
  signal: AbortSignal
  usageContext?: AiUsageContext
  onFirstAudio?: () => void
  onLineStart?: (line: SpeechScriptLine, index: number) => void
  onLinePhase?: (index: number, phase: SpeechLinePlayPhase) => void
  onLineAudio?: (
    index: number,
    line: SpeechScriptLine,
    audio: LineAudioCacheEntry,
  ) => void
}): SpeechScriptPlayQueue {
  const config = mergeOpenAiConfig(undefined, 'speech-synthesis')
  const pending: { line: SpeechScriptLine; index: number }[] = []
  let finished = false
  let cancelled = false
  let paused = false
  let firstAudio = false
  let currentIndex = -1
  let notify: (() => void) | undefined

  const wake = () => {
    notify?.()
    notify = undefined
  }

  const waitForWork = () =>
    new Promise<void>((resolve) => {
      if (cancelled || pending.length > 0 || finished) {
        resolve()
        return
      }
      notify = resolve
    })

  const player = createStreamingPcmPlayer({
    sampleRate: MIMO_TTS_PCM_SAMPLE_RATE,
    signal: options.signal,
  })

  const done = (async () => {
    try {
      while (!cancelled && !options.signal.aborted) {
        if (pending.length === 0) {
          if (finished) break
          await waitForWork()
          continue
        }

        const next = pending.shift()
        if (!next) continue
        currentIndex = next.index
        options.onLineStart?.(next.line, next.index)
        options.onLinePhase?.(next.index, 'loading')

        const parts: Uint8Array[] = []
        let lineStartedPlaying = false
        await mimoSynthesizeSpeechStream({
          config,
          text: buildTtsText(next.line),
          styleInstruction: buildTtsStyle(next.line),
          voice: next.line.voice,
          signal: options.signal,
          usageContext: options.usageContext
            ? {
                ...options.usageContext,
                behavior: 'chat-speak-line',
                behaviorLabel: `语音对话播报·${next.line.voice}`,
              }
            : undefined,
          onPcmChunk: (pcm) => {
            parts.push(pcm)
            if (!firstAudio) {
              firstAudio = true
              options.onFirstAudio?.()
            }
            if (!lineStartedPlaying) {
              lineStartedPlaying = true
              options.onLinePhase?.(next.index, 'playing')
            }
            player.enqueue(pcm)
          },
        })

        if (!cancelled && !options.signal.aborted && parts.length > 0) {
          options.onLineAudio?.(next.index, next.line, {
            pcm: concatUint8Arrays(parts),
            sampleRate: MIMO_TTS_PCM_SAMPLE_RATE,
            voice: next.line.voice,
          })
        }
      }

      if (!cancelled && !options.signal.aborted) {
        player.markEnd()
        await player.waitUntilEnded()
      } else {
        player.stop()
      }
    } catch (err) {
      player.stop()
      if (isStreamAbortError(err, options.signal) || options.signal.aborted || cancelled) {
        return
      }
      throw err
    }
  })()

  return {
    enqueue(line, index) {
      if (cancelled || options.signal.aborted || !line.text.trim()) return
      pending.push({ line, index })
      wake()
    },
    finish() {
      finished = true
      wake()
    },
    cancel() {
      cancelled = true
      pending.length = 0
      wake()
      player.stop()
    },
    pause() {
      if (cancelled || options.signal.aborted) return
      paused = true
      player.suspend()
    },
    resume() {
      if (cancelled || options.signal.aborted) return
      paused = false
      player.resume()
    },
    waitUntilDone: () => done,
    get currentIndex() {
      return currentIndex
    },
    get paused() {
      return paused
    },
  }
}
