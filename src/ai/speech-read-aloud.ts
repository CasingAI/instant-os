import type { AiUsageContext } from './ai-usage-context.ts'
import { isStreamAbortError } from './stream-abort.ts'
import {
  MIMO_TTS_PCM_SAMPLE_RATE,
  synthesizeSpeechStream,
} from './speech-api.ts'
import {
  createStreamingPcmPlayer,
  pcm16LeToWavObjectUrl,
  type StreamingPcmPlayerOptions,
} from './speech-pcm-player.ts'

/** 朗读内容块（拼接后整篇一次流式合成） */
export type SpeechBlock = {
  id: string
  text: string
}

/** 将内容块拼成单次合成文本 */
export function joinSpeechText(blocks: readonly SpeechBlock[]): string {
  return blocks
    .map((block) => block.text.trim())
    .filter(Boolean)
    .join('\n')
}

export function audioBase64ToObjectUrl(
  audioBase64: string,
  mimeType = 'audio/wav',
): string {
  const binary = atob(audioBase64)
  const bytes = new Uint8Array(binary.length)
  for (let i = 0; i < binary.length; i++) {
    bytes[i] = binary.charCodeAt(i)
  }
  return URL.createObjectURL(new Blob([bytes], { type: mimeType }))
}

export type PlayObjectUrlOptions = {
  /** 系统媒体控件等外部暂停（非本端 abort） */
  onExternalPause?: () => void
  /** 系统媒体控件等外部继续播放 */
  onExternalPlay?: () => void
}

export function playObjectUrl(
  url: string,
  signal: AbortSignal,
  options: PlayObjectUrlOptions = {},
): Promise<void> {
  return new Promise((resolve, reject) => {
    if (signal.aborted) {
      resolve()
      return
    }

    const audio = new Audio(url)
    let settled = false
    /** 本端 abort / 正常结束触发的 pause，不算外部暂停 */
    let ignorePause = false

    const settle = (fn: () => void) => {
      if (settled) {
        return
      }
      settled = true
      fn()
    }

    const onAbort = () => {
      ignorePause = true
      audio.pause()
      audio.removeAttribute('src')
      audio.load()
      cleanup()
      settle(() => resolve())
    }

    const onPause = () => {
      if (settled || ignorePause || signal.aborted || audio.ended) {
        return
      }
      options.onExternalPause?.()
    }

    const onPlay = () => {
      if (settled || signal.aborted) {
        return
      }
      options.onExternalPlay?.()
    }

    const cleanup = () => {
      signal.removeEventListener('abort', onAbort)
      audio.removeEventListener('pause', onPause)
      audio.removeEventListener('play', onPlay)
      audio.onended = null
      audio.onerror = null
    }

    signal.addEventListener('abort', onAbort, { once: true })
    audio.addEventListener('pause', onPause)
    audio.addEventListener('play', onPlay)

    audio.onended = () => {
      ignorePause = true
      cleanup()
      settle(() => resolve())
    }
    audio.onerror = () => {
      ignorePause = true
      cleanup()
      settle(() => reject(new Error('音频播放失败')))
    }

    void audio.play().catch((err: unknown) => {
      ignorePause = true
      cleanup()
      settle(() => {
        reject(err instanceof Error ? err : new Error(String(err)))
      })
    })
  })
}

export type StreamAndPlaySpeechOptions = {
  text: string
  usageContext: AiUsageContext
  styleInstruction?: string
  signal: AbortSignal
  onFirstAudio?: () => void
  onExternalPause?: () => void
  onExternalPlay?: () => void
}

/**
 * 流式合成并边收边播；结束后返回可缓存的 WAV Object URL。
 * 若 signal 已 abort，返回 undefined（不抛错）。
 */
export async function streamAndPlaySpeech(
  options: StreamAndPlaySpeechOptions,
): Promise<string | undefined> {
  if (options.signal.aborted) {
    return undefined
  }

  let player: ReturnType<typeof createStreamingPcmPlayer> | undefined
  let firstAudio = false

  const playerOpts: StreamingPcmPlayerOptions = {
    sampleRate: MIMO_TTS_PCM_SAMPLE_RATE,
    signal: options.signal,
    onExternalPause: options.onExternalPause,
    onExternalPlay: options.onExternalPlay,
  }

  try {
    const result = await synthesizeSpeechStream({
      text: options.text,
      styleInstruction: options.styleInstruction,
      usageContext: options.usageContext,
      signal: options.signal,
      onPcmChunk: (pcm) => {
        if (!player) {
          player = createStreamingPcmPlayer({
            ...playerOpts,
            sampleRate: MIMO_TTS_PCM_SAMPLE_RATE,
          })
        }
        if (!firstAudio) {
          firstAudio = true
          options.onFirstAudio?.()
        }
        player.enqueue(pcm)
      },
    })

    if (!player) {
      return pcm16LeToWavObjectUrl(result.pcm, result.sampleRate)
    }

    player.markEnd()
    await player.waitUntilEnded()

    if (options.signal.aborted) {
      return undefined
    }

    return pcm16LeToWavObjectUrl(result.pcm, result.sampleRate)
  } catch (err) {
    player?.stop()
    if (isStreamAbortError(err, options.signal) || options.signal.aborted) {
      return undefined
    }
    throw err
  }
}

export function revokeObjectUrl(url: string | undefined): void {
  if (url) {
    URL.revokeObjectURL(url)
  }
}
