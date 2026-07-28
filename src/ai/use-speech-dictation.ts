import { useCallback, useEffect, useRef, useState } from 'preact/hooks'
import type { JSX } from 'preact'
import {
  EXPERIMENTAL_SETTINGS_CHANGED_EVENT,
  loadExperimentalSettings,
} from '../os/experimental-settings-storage.ts'
import { insertTextAtInput } from './insert-text-at-input.ts'
import { recognizeSpeech } from './speech-api.ts'
import {
  startMicWavRecorder,
  type MicWavRecorder,
} from './speech-mic-recorder.ts'

const HOLD_MS = 300

const ALLOWED_TYPES = new Set(['text', 'search', 'url'])

export type SpeechDictationPhase =
  | 'idle'
  | 'holdPending'
  | 'arming'
  | 'recording'
  | 'recognizing'

export type UseSpeechDictationOptions = {
  /** undefined = 跟随 speechApp；false = 强制关闭；true = 在 speechApp 开启时启用 */
  voiceDictation?: boolean
  type?: string
  disabled?: boolean
  readOnly?: boolean
}

export type SpeechDictationBind = {
  phase: SpeechDictationPhase
  /** recording / arming / recognizing 时为 true，用于样式 */
  isDictating: boolean
  onKeyDown: JSX.GenericEventHandler<HTMLInputElement>
  onKeyUp: JSX.GenericEventHandler<HTMLInputElement>
  onBlur: JSX.GenericEventHandler<HTMLInputElement>
  onCompositionStart: JSX.GenericEventHandler<HTMLInputElement>
  onCompositionEnd: JSX.GenericEventHandler<HTMLInputElement>
}

function isAllowedInputType(type: string | undefined): boolean {
  return ALLOWED_TYPES.has((type ?? 'text').toLowerCase())
}

function isSpaceKey(event: KeyboardEvent): boolean {
  return event.key === ' ' || event.code === 'Space'
}

/**
 * 输入框长按空格语音听写。
 * 仅在开发者选项「语音实验室」开启且未强制关闭时生效。
 */
export function useSpeechDictation(
  options: UseSpeechDictationOptions = {},
): SpeechDictationBind {
  const { voiceDictation, type = 'text', disabled, readOnly } = options

  const [speechApp, setSpeechApp] = useState(
    () => loadExperimentalSettings().speechApp === true,
  )
  const [phase, setPhase] = useState<SpeechDictationPhase>('idle')

  const phaseRef = useRef(phase)
  phaseRef.current = phase

  const composingRef = useRef(false)
  const holdTimerRef = useRef<number | undefined>(undefined)
  const recorderRef = useRef<MicWavRecorder | undefined>(undefined)
  const sessionRef = useRef(0)

  useEffect(() => {
    const sync = () => {
      setSpeechApp(loadExperimentalSettings().speechApp === true)
    }
    window.addEventListener(EXPERIMENTAL_SETTINGS_CHANGED_EVENT, sync)
    return () => window.removeEventListener(EXPERIMENTAL_SETTINGS_CHANGED_EVENT, sync)
  }, [])

  const featureEnabled =
    voiceDictation !== false && speechApp && isAllowedInputType(type) && !disabled && !readOnly

  const featureEnabledRef = useRef(featureEnabled)
  featureEnabledRef.current = featureEnabled

  const clearHoldTimer = useCallback(() => {
    if (holdTimerRef.current !== undefined) {
      window.clearTimeout(holdTimerRef.current)
      holdTimerRef.current = undefined
    }
  }, [])

  const abortSession = useCallback(() => {
    clearHoldTimer()
    sessionRef.current += 1
    const recorder = recorderRef.current
    recorderRef.current = undefined
    recorder?.abort()
    setPhase('idle')
  }, [clearHoldTimer])

  useEffect(() => {
    if (!featureEnabled) {
      abortSession()
    }
  }, [featureEnabled, abortSession])

  useEffect(() => {
    return () => {
      abortSession()
    }
  }, [abortSession])

  const beginRecording = useCallback(async () => {
    const session = sessionRef.current
    setPhase('arming')
    try {
      const recorder = await startMicWavRecorder()
      if (sessionRef.current !== session) {
        recorder.abort()
        return
      }
      recorderRef.current = recorder
      setPhase('recording')
    } catch {
      if (sessionRef.current === session) {
        setPhase('idle')
      }
    }
  }, [])

  const finishRecording = useCallback(async (el: HTMLInputElement) => {
    const recorder = recorderRef.current
    recorderRef.current = undefined
    if (!recorder) {
      setPhase('idle')
      return
    }

    const session = sessionRef.current
    setPhase('recognizing')
    try {
      const wav = await recorder.stop()
      if (sessionRef.current !== session) return

      const text = await recognizeSpeech({
        audioBase64: wav.base64,
        mimeType: wav.mimeType,
        usageContext: {
          actor: 'system',
          behavior: 'input-dictation',
          behaviorLabel: '输入框语音输入',
        },
      })
      if (sessionRef.current !== session) return

      const trimmed = text.trim()
      if (trimmed) {
        insertTextAtInput(el, trimmed)
      }
    } catch {
      /* 未配置 ASR / 录音失败等：静默回 idle */
    } finally {
      if (sessionRef.current === session) {
        setPhase('idle')
      }
    }
  }, [])

  const onKeyDown = useCallback(
    (event: JSX.TargetedKeyboardEvent<HTMLInputElement>) => {
      if (!featureEnabledRef.current) return
      if (composingRef.current) return
      if (!isSpaceKey(event as unknown as KeyboardEvent)) return

      const native = event as unknown as KeyboardEvent
      const current = phaseRef.current

      if (native.repeat) {
        if (current !== 'idle') {
          event.preventDefault()
        }
        return
      }

      if (current !== 'idle') {
        event.preventDefault()
        return
      }

      event.preventDefault()
      setPhase('holdPending')
      clearHoldTimer()
      holdTimerRef.current = window.setTimeout(() => {
        holdTimerRef.current = undefined
        if (phaseRef.current === 'holdPending') {
          void beginRecording()
        }
      }, HOLD_MS)
    },
    [beginRecording, clearHoldTimer],
  )

  const onKeyUp = useCallback(
    (event: JSX.TargetedKeyboardEvent<HTMLInputElement>) => {
      if (!isSpaceKey(event as unknown as KeyboardEvent)) return

      const current = phaseRef.current
      const el = event.currentTarget

      if (current === 'holdPending') {
        clearHoldTimer()
        setPhase('idle')
        if (featureEnabledRef.current && !composingRef.current) {
          insertTextAtInput(el, ' ')
        }
        return
      }

      if (current === 'arming') {
        // 松手发生在 getUserMedia 完成前：取消本轮
        abortSession()
        return
      }

      if (current === 'recording') {
        event.preventDefault()
        void finishRecording(el)
      }
    },
    [abortSession, clearHoldTimer, finishRecording],
  )

  const onBlur = useCallback(() => {
    if (phaseRef.current !== 'idle') {
      abortSession()
    }
  }, [abortSession])

  const onCompositionStart = useCallback(() => {
    composingRef.current = true
    if (phaseRef.current !== 'idle') {
      abortSession()
    }
  }, [abortSession])

  const onCompositionEnd = useCallback(() => {
    composingRef.current = false
  }, [])

  return {
    phase,
    isDictating:
      phase === 'arming' || phase === 'recording' || phase === 'recognizing',
    onKeyDown,
    onKeyUp,
    onBlur,
    onCompositionStart,
    onCompositionEnd,
  }
}
