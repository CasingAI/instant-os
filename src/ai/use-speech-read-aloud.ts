import { useCallback, useEffect, useRef, useState } from 'preact/hooks'
import type { AiUsageContext } from './ai-usage-context.ts'
import {
  joinSpeechText,
  playObjectUrl,
  revokeObjectUrl,
  streamAndPlaySpeech,
  type SpeechBlock,
} from './speech-read-aloud.ts'

export type SpeechReadAloudPhase =
  | 'idle'
  | 'synthesizing'
  | 'playing'
  | 'paused'
  | 'finished'
  | 'error'

export type SpeechReadAloudControls = {
  phase: SpeechReadAloudPhase
  error: string | undefined
  /** 控制横幅是否展开（与是否正在出声无关） */
  panelOpen: boolean
  /** 是否正在合成或播放 */
  isActive: boolean
  /** 主按钮文案：停止 / 继续 */
  label: string
  phaseLabel: string
  start: (blocks: readonly SpeechBlock[]) => void
  /** 停止出声，横幅保留 */
  stop: () => void
  /** 从缓存重播，或重新流式合成 */
  resume: () => void
  /** 关闭横幅并清理会话 */
  close: () => void
}

function formatError(err: unknown): string {
  if (err instanceof Error && err.message.trim()) {
    return err.message
  }
  return String(err)
}

function phaseToLabel(phase: SpeechReadAloudPhase): string {
  switch (phase) {
    case 'synthesizing':
      return '正在合成'
    case 'playing':
      return '播放中'
    case 'paused':
      return '已停止'
    case 'finished':
      return '已读完'
    case 'error':
      return '出错'
    default:
      return ''
  }
}

export function useSpeechReadAloud(
  usageContext: AiUsageContext,
): SpeechReadAloudControls {
  const [phase, setPhase] = useState<SpeechReadAloudPhase>('idle')
  const [error, setError] = useState<string | undefined>()
  const [panelOpen, setPanelOpen] = useState(false)

  const usageContextRef = useRef(usageContext)
  usageContextRef.current = usageContext

  const textRef = useRef('')
  const cacheUrlRef = useRef<string | undefined>(undefined)
  const sessionRef = useRef(0)
  const playTokenRef = useRef(0)
  const playAbortRef = useRef<AbortController | undefined>(undefined)
  const activeRef = useRef(false)
  const panelOpenRef = useRef(false)

  const clearCache = useCallback(() => {
    revokeObjectUrl(cacheUrlRef.current)
    cacheUrlRef.current = undefined
  }, [])

  const stopPlayback = useCallback(() => {
    playTokenRef.current += 1
    playAbortRef.current?.abort()
    playAbortRef.current = undefined
  }, [])

  const close = useCallback(() => {
    sessionRef.current += 1
    stopPlayback()
    activeRef.current = false
    panelOpenRef.current = false
    textRef.current = ''
    clearCache()
    setPanelOpen(false)
    setPhase('idle')
    setError(undefined)
  }, [clearCache, stopPlayback])

  const stop = useCallback(() => {
    if (!panelOpenRef.current) {
      return
    }
    stopPlayback()
    activeRef.current = false
    setError(undefined)
    setPhase('paused')
  }, [stopPlayback])

  useEffect(() => {
    return () => {
      sessionRef.current += 1
      stopPlayback()
      activeRef.current = false
      panelOpenRef.current = false
      textRef.current = ''
      revokeObjectUrl(cacheUrlRef.current)
      cacheUrlRef.current = undefined
    }
  }, [stopPlayback])

  const playExternalHandlers = useCallback(
    (token: number, session: number) => ({
      onExternalPause: () => {
        if (playTokenRef.current !== token || sessionRef.current !== session) {
          return
        }
        activeRef.current = false
        setPhase('paused')
      },
      onExternalPlay: () => {
        if (
          playTokenRef.current !== token ||
          sessionRef.current !== session ||
          !panelOpenRef.current
        ) {
          return
        }
        activeRef.current = true
        setError(undefined)
        setPhase('playing')
      },
    }),
    [],
  )

  const runPlayback = useCallback(
    async (token: number, session: number) => {
      const text = textRef.current
      if (!text) {
        if (playTokenRef.current === token && sessionRef.current === session) {
          activeRef.current = false
          setPhase(panelOpenRef.current ? 'finished' : 'idle')
        }
        return
      }

      try {
        playAbortRef.current?.abort()
        const playAbort = new AbortController()
        playAbortRef.current = playAbort
        const external = playExternalHandlers(token, session)

        const cached = cacheUrlRef.current
        if (cached) {
          setPhase('playing')
          await playObjectUrl(cached, playAbort.signal, external)
        } else {
          setPhase('synthesizing')
          const url = await streamAndPlaySpeech({
            text,
            usageContext: usageContextRef.current,
            signal: playAbort.signal,
            onFirstAudio: () => {
              if (
                playTokenRef.current === token &&
                sessionRef.current === session &&
                activeRef.current
              ) {
                setPhase('playing')
              }
            },
            ...external,
          })

          if (url) {
            if (sessionRef.current === session) {
              clearCache()
              cacheUrlRef.current = url
            } else {
              revokeObjectUrl(url)
            }
          }
        }

        if (
          playTokenRef.current !== token ||
          sessionRef.current !== session ||
          !activeRef.current
        ) {
          return
        }

        activeRef.current = false
        playAbortRef.current = undefined
        setPhase(panelOpenRef.current ? 'finished' : 'idle')
      } catch (err: unknown) {
        if (
          playTokenRef.current !== token ||
          sessionRef.current !== session ||
          !activeRef.current
        ) {
          return
        }
        activeRef.current = false
        playAbortRef.current = undefined
        setError(formatError(err))
        setPhase('error')
      }
    },
    [clearCache, playExternalHandlers],
  )

  const play = useCallback(() => {
    if (!textRef.current) {
      return
    }
    const session = sessionRef.current
    stopPlayback()
    const token = playTokenRef.current
    activeRef.current = true
    setError(undefined)
    if (cacheUrlRef.current) {
      setPhase('playing')
    } else {
      setPhase('synthesizing')
    }
    void runPlayback(token, session)
  }, [runPlayback, stopPlayback])

  const start = useCallback(
    (blocks: readonly SpeechBlock[]) => {
      const text = joinSpeechText(blocks)
      if (!text) {
        panelOpenRef.current = true
        setPanelOpen(true)
        setError('没有可朗读的内容')
        setPhase('error')
        return
      }

      sessionRef.current += 1
      stopPlayback()
      clearCache()

      textRef.current = text
      panelOpenRef.current = true
      activeRef.current = true
      setPanelOpen(true)
      setError(undefined)
      setPhase('synthesizing')

      const session = sessionRef.current
      const token = playTokenRef.current
      void runPlayback(token, session)
    },
    [clearCache, runPlayback, stopPlayback],
  )

  const resume = useCallback(() => {
    if (!panelOpenRef.current || !textRef.current) {
      return
    }
    if (activeRef.current) {
      return
    }
    play()
  }, [play])

  const isActive = phase === 'synthesizing' || phase === 'playing'

  return {
    phase,
    error,
    panelOpen,
    isActive,
    label: isActive ? '停止' : '继续',
    phaseLabel: phaseToLabel(phase),
    start,
    stop,
    resume,
    close,
  }
}
