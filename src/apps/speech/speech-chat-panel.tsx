/**
 * 语音对话 MVP：一点「开始对话」后，靠 VAD 自动断句。
 * - 可打断 / 软暂停续播
 * - <speak> 朗读 · <sing song style> 唱歌
 * - 再播走 PCM 缓存；可换音色重生成
 */
import { useCallback, useEffect, useRef, useState } from 'preact/hooks'
import {
  listSpeechVoices,
  MIMO_TTS_PCM_SAMPLE_RATE,
  recognizeSpeech,
  resolveDefaultSpeechVoice,
} from '../../ai/speech-api.ts'
import { createStreamingPcmPlayer } from '../../ai/speech-pcm-player.ts'
import { formatThinkingDurationMs } from '../../ai/format-human-duration.ts'
import { isStreamAbortError } from '../../ai/stream-abort.ts'
import { streamChatCompletion } from '../../ai/stream-chat.ts'
import { CheckToggle } from '../../ui/check-toggle.tsx'
import '../../ui/check-toggle.css'
import {
  createSpeechScriptPlayQueue,
  playCachedLineAudio,
  synthesizeSpeechLine,
  type LineAudioCacheEntry,
  type SpeechScriptPlayQueue,
} from './speech-chat-play.ts'
import {
  formatStreamingSpeechView,
  isSingingSpeechLine,
  isSpeechIgnoreReply,
  parseSpeechReply,
  SPEECH_IGNORE_TAG,
  speechLineDisplayText,
  speechVoicePromptList,
  type SpeechScriptLine,
} from './speech-chat-script.ts'
import { shouldDropNoiseUtterance } from './speech-noise-filter.ts'
import {
  startVadSession,
  type VadListenState,
  type VadSession,
  type VadUtterance,
} from './speech-vad-session.ts'

type LogKind = 'info' | 'event' | 'result' | 'error'

type ChatRole = 'user' | 'assistant'

type ChatBubble = {
  id: number
  role: ChatRole
  content: string
  interim?: boolean
  scriptLines?: SpeechScriptLine[]
  draft?: string
  raw?: string
  viewMode?: 'friendly' | 'raw'
  playingLineIndex?: number
  playingLinePhase?: 'loading' | 'playing'
  /** 模型思考链原文 */
  reasoning?: string
  /** 思考是否仍在流式输出 */
  reasoningLive?: boolean
  reasoningDurationMs?: number
}

type ChatPhase =
  | 'idle'
  | 'listening'
  | 'speech'
  | 'recognizing'
  | 'thinking'
  | 'speaking'
  | 'error'

function buildChatSystemPrompt(defaultVoice: string): string {
  return `你是 Instant OS「语音实验室」里的语音助手。用户通过麦克风说话，你的回复会被朗读 / 演唱出来。

要求：
- 用简洁自然的口语中文回答（用户若说英文可跟英文）
- 不要 markdown，不要「作为 AI」之类的元话
- 单轮尽量简短，方便听懂；唱歌歌词可稍长

误触发：
若用户最新一句明显不像在对你说话（噪音转写、敲击误识别、纯语气词如「嗯啊」「好啊」「呃」、无意义碎片等），只输出：
${SPEECH_IGNORE_TAG}
注意：单独的「好啊」「嗯」「哦」在没有上文请求确认时，更可能是误触发，应忽略。

普通朗读（可多段、可多音色）：
<speak voice="音色id" style="必填风格" name="可选角色名">台词</speak>

唱歌（必须用 sing，不要用 speak 假装唱）：
<sing voice="音色id" song="歌名" style="必填唱法" name="可选角色名">歌词</sing>

说明：
- voice 必须用下列音色 id 之一
- style 必填：自然语言风格指令（送入 TTS user message）。优先用英文短句（与官网示例一致，如 Warm and gentle. / Soft and lyrical.）；中文也可
- song：歌名，不要带书名号外的废话（系统会与 style 一并送入 TTS）
- 正文用自然标点和省略号表达停顿，不要写 [停顿][笑声] 这类方括号标签（MiMo 适配不稳定）
- 属性值不要用英文双引号，可用中文标点或单引号

示例：
<speak voice="${defaultVoice}" style="Warm, friendly, conversational.">好呀，我给你唱两句。</speak>
<sing voice="${defaultVoice}" song="月亮代表我的心" style="Soft, lyrical, slightly nostalgic.">你问我爱你有多深，我爱你有几分。我的情也真，我的爱也真，月亮代表我的心。</sing>
<sing voice="${defaultVoice}" song="祝你生日快乐" style="Cheerful birthday song, clear melody.">祝你生日快乐，祝你生日快乐，祝你生日快乐，祝你生日快乐。</sing>

可用音色 id：
${speechVoicePromptList()}

规则：
- 用户要唱歌时请真的输出 <sing>，不要只说「好啊我唱」
- 纯文本也可（将用 ${defaultVoice} 当 speak）
- 不要输出除 <speak> / <sing> / <ignore/> 以外的 XML
- 正常回复不要包含 ${SPEECH_IGNORE_TAG}`
}

function latestReasoningSnippet(text: string, maxLen = 72): string {
  const trimmed = text.trim()
  if (!trimmed) return ''
  const lines = trimmed.split(/\n+/).filter(Boolean)
  const last = lines[lines.length - 1] ?? trimmed
  if (last.length <= maxLen) return last
  return `…${last.slice(-maxLen)}`
}

function SpeechReasoningBlock({
  text,
  live,
  durationMs,
}: {
  text: string
  live?: boolean
  durationMs?: number
}) {
  const [expanded, setExpanded] = useState(false)
  const body = text.trim()
  if (!body && !live) return undefined

  if (live) {
    const snippet = latestReasoningSnippet(body)
    return (
      <div class="speech-app__chat-reasoning speech-app__chat-reasoning--live" aria-live="polite">
        <span class="speech-app__chat-reasoning-label">正在思考</span>
        {snippet ? (
          <span class="speech-app__chat-reasoning-snippet">{snippet}</span>
        ) : undefined}
      </div>
    )
  }

  return (
    <div
      class={`speech-app__chat-reasoning${expanded ? ' speech-app__chat-reasoning--expanded' : ''}`}
    >
      <button
        type="button"
        class="speech-app__chat-reasoning-toggle"
        aria-expanded={expanded}
        onClick={() => setExpanded((value) => !value)}
      >
        {durationMs !== undefined
          ? formatThinkingDurationMs(durationMs)
          : '查看思考'}
      </button>
      {expanded ? (
        <pre class="speech-app__chat-reasoning-body">
          {body || '（没有留下思考原文）'}
        </pre>
      ) : undefined}
    </div>
  )
}

const PHASE_LABEL: Record<ChatPhase, string> = {
  idle: '未开始',
  listening: '聆听中',
  speech: '检测到说话',
  recognizing: '识别中',
  thinking: '思考中',
  speaking: '播报中',
  error: '出错',
}

function formatError(error: unknown): string {
  if (error instanceof Error) return error.message
  return String(error)
}

export function SpeechChatPanel({
  asrModelLabel,
  ttsModelLabel,
  textModelLabel,
  pushLog,
}: {
  asrModelLabel: string
  ttsModelLabel: string
  textModelLabel: string
  pushLog: (kind: LogKind, text: string) => void
}) {
  const sessionRef = useRef<VadSession | undefined>(undefined)
  const activeRef = useRef(false)
  const turnBusyRef = useRef(false)
  const speakingRef = useRef(false)
  const turnGenRef = useRef(0)
  const phaseRef = useRef<ChatPhase>('idle')
  const historyRef = useRef<{ role: ChatRole; content: string }[]>([])
  const bubbleIdRef = useRef(0)
  const playAbortRef = useRef<AbortController | undefined>(undefined)
  const playQueueRef = useRef<SpeechScriptPlayQueue | undefined>(undefined)
  const replayAbortRef = useRef<AbortController | undefined>(undefined)
  /** bubbleId:lineIndex → 已合成 PCM，再播不重生成 */
  const audioCacheRef = useRef<Map<string, LineAudioCacheEntry>>(new Map())
  const speakingBubbleIdRef = useRef<number | undefined>(undefined)
  const partialAbortRef = useRef<AbortController | undefined>(undefined)
  const interimBubbleIdRef = useRef<number | undefined>(undefined)
  const listRef = useRef<HTMLDivElement>(null)
  /** 当前正在播的完整脚本 */
  const activeScriptRef = useRef<SpeechScriptLine[] | undefined>(undefined)
  const activeScriptIndexRef = useRef(0)

  const handlePartialRef = useRef<(wav: VadUtterance) => void>(() => undefined)
  const handleUtteranceRef = useRef<(wav: VadUtterance) => void>(() => undefined)
  const softPauseSpeakingRef = useRef<() => boolean>(() => false)

  const [running, setRunning] = useState(false)
  const [phase, setPhase] = useState<ChatPhase>('idle')
  const [level, setLevel] = useState(0)
  const [bubbles, setBubbles] = useState<ChatBubble[]>([])
  const [error, setError] = useState<string | undefined>()
  const voices = listSpeechVoices()
  const [voice, setVoice] = useState(() => resolveDefaultSpeechVoice())
  const voiceRef = useRef(voice)
  voiceRef.current = voice
  /** 播报途中是否允许语音插话打断 */
  const [bargeInEnabled, setBargeInEnabled] = useState(true)
  const bargeInEnabledRef = useRef(bargeInEnabled)
  bargeInEnabledRef.current = bargeInEnabled
  /** 回复是否开启模型思考模式 */
  const [thinkingEnabled, setThinkingEnabled] = useState(false)
  const thinkingEnabledRef = useRef(thinkingEnabled)
  thinkingEnabledRef.current = thinkingEnabled

  const setPhaseBoth = useCallback((next: ChatPhase) => {
    phaseRef.current = next
    setPhase(next)
  }, [])

  const appendBubble = useCallback(
    (role: ChatRole, content: string, interim?: boolean) => {
      const id = ++bubbleIdRef.current
      setBubbles((prev) => [...prev, { id, role, content, interim }])
      return id
    },
    [],
  )

  const patchBubble = useCallback(
    (
      id: number,
      /** 传 undefined 表示不改正文（用于只更新思考链） */
      content: string | undefined,
      interim?: boolean,
      extras?: {
        scriptLines?: SpeechScriptLine[]
        draft?: string
        raw?: string
        playingLineIndex?: number
        playingLinePhase?: 'loading' | 'playing'
        clearPlaying?: boolean
        reasoning?: string
        reasoningLive?: boolean
        reasoningDurationMs?: number
      },
    ) => {
      setBubbles((prev) =>
        prev.map((item) =>
          item.id === id
            ? {
                ...item,
                content: content === undefined ? item.content : content,
                interim: interim === undefined ? item.interim : interim,
                scriptLines:
                  extras && 'scriptLines' in extras
                    ? extras.scriptLines
                    : item.scriptLines,
                draft: extras && 'draft' in extras ? extras.draft : item.draft,
                raw: extras?.raw !== undefined ? extras.raw : item.raw,
                playingLineIndex: extras?.clearPlaying
                  ? undefined
                  : extras?.playingLineIndex !== undefined
                    ? extras.playingLineIndex
                    : item.playingLineIndex,
                playingLinePhase: extras?.clearPlaying
                  ? undefined
                  : extras?.playingLinePhase !== undefined
                    ? extras.playingLinePhase
                    : item.playingLinePhase,
                reasoning:
                  extras && 'reasoning' in extras
                    ? extras.reasoning
                    : item.reasoning,
                reasoningLive:
                  extras && 'reasoningLive' in extras
                    ? extras.reasoningLive
                    : item.reasoningLive,
                reasoningDurationMs:
                  extras && 'reasoningDurationMs' in extras
                    ? extras.reasoningDurationMs
                    : item.reasoningDurationMs,
              }
            : item,
        ),
      )
    },
    [],
  )

  const setBubblePlayingPhase = useCallback(
    (id: number, index: number, phase: 'loading' | 'playing') => {
      setBubbles((prev) =>
        prev.map((item) =>
          item.id === id
            ? {
                ...item,
                playingLineIndex: index,
                playingLinePhase: phase,
              }
            : item,
        ),
      )
    },
    [],
  )

  const clearBubblePlaying = useCallback((id: number | undefined) => {
    if (id === undefined) return
    setBubbles((prev) =>
      prev.map((item) =>
        item.id === id
          ? {
              ...item,
              playingLineIndex: undefined,
              playingLinePhase: undefined,
            }
          : item,
      ),
    )
  }, [])

  const cacheKey = (bubbleId: number, index: number) => `${bubbleId}:${index}`

  const storeLineAudio = useCallback(
    (bubbleId: number, index: number, audio: LineAudioCacheEntry) => {
      audioCacheRef.current.set(cacheKey(bubbleId, index), audio)
    },
    [],
  )

  const clearBubbleAudioCache = useCallback((bubbleId: number) => {
    const prefix = `${bubbleId}:`
    for (const key of [...audioCacheRef.current.keys()]) {
      if (key.startsWith(prefix)) {
        audioCacheRef.current.delete(key)
      }
    }
  }, [])

  const [, bumpCacheUi] = useState(0)
  const refreshCacheUi = useCallback(() => {
    bumpCacheUi((n) => n + 1)
  }, [])

  const hasCachedAudio = useCallback((bubbleId: number, index: number) => {
    return audioCacheRef.current.has(cacheKey(bubbleId, index))
  }, [])

  const hasAnyCachedAudio = useCallback((bubbleId: number, lineCount: number) => {
    for (let i = 0; i < lineCount; i++) {
      if (audioCacheRef.current.has(cacheKey(bubbleId, i))) return true
    }
    return false
  }, [])

  const toggleBubbleView = useCallback((id: number) => {
    setBubbles((prev) =>
      prev.map((item) =>
        item.id === id
          ? {
              ...item,
              viewMode: item.viewMode === 'raw' ? 'friendly' : 'raw',
            }
          : item,
      ),
    )
  }, [])

  const removeBubble = useCallback((id: number) => {
    clearBubbleAudioCache(id)
    setBubbles((prev) => prev.filter((item) => item.id !== id))
  }, [clearBubbleAudioCache])

  useEffect(() => {
    const el = listRef.current
    if (!el) return
    el.scrollTop = el.scrollHeight
  }, [bubbles, phase])

  const abortPartials = useCallback(() => {
    partialAbortRef.current?.abort()
    partialAbortRef.current = undefined
  }, [])

  /** 插话：只暂停出声，合成继续缓冲，误触发后可无缝续播 */
  const softPauseSpeaking = useCallback(() => {
    const queue = playQueueRef.current
    if (!queue || !speakingRef.current) return false
    if (queue.paused) return true
    queue.pause()
    pushLog('event', '播报已暂停，等待判定是否为有效插话')
    return true
  }, [pushLog])

  /** 硬中断：停止合成与播放（手动打断 / 确认有效插话） */
  const hardStopSpeaking = useCallback(
    (reason: string) => {
      turnGenRef.current += 1
      abortPartials()
      replayAbortRef.current?.abort()
      replayAbortRef.current = undefined
      playQueueRef.current?.cancel()
      playQueueRef.current = undefined
      playAbortRef.current?.abort()
      playAbortRef.current = undefined
      speakingRef.current = false
      turnBusyRef.current = false
      activeScriptRef.current = undefined
      clearBubblePlaying(speakingBubbleIdRef.current)
      speakingBubbleIdRef.current = undefined
      sessionRef.current?.setPickMode('normal')
      pushLog('event', `已打断：${reason}`)
    },
    [abortPartials, clearBubblePlaying, pushLog],
  )

  softPauseSpeakingRef.current = softPauseSpeaking

  /** 进入播报听音模式：开打断则 barge-in 聆听；关则暂停拾音，避免喇叭串音 */
  const enableSpeakingPickup = useCallback(() => {
    if (bargeInEnabledRef.current) {
      sessionRef.current?.setPickMode('barge-in')
      sessionRef.current?.resumeListening()
    } else {
      sessionRef.current?.setPickMode('normal')
      sessionRef.current?.pauseListening()
    }
  }, [])

  // 播报中切换开关：立刻生效
  useEffect(() => {
    if (!running || !speakingRef.current) return
    if (bargeInEnabled) {
      sessionRef.current?.setPickMode('barge-in')
      sessionRef.current?.resumeListening()
    } else {
      // 若正软暂停着，先恢复播放再关拾音
      if (playQueueRef.current?.paused) {
        playQueueRef.current.resume()
        pushLog('event', '已关闭途中打断，继续播报')
      }
      sessionRef.current?.setPickMode('normal')
      sessionRef.current?.pauseListening()
    }
  }, [bargeInEnabled, pushLog, running])

  const stopSession = useCallback(() => {
    activeRef.current = false
    hardStopSpeaking('结束对话')
    interimBubbleIdRef.current = undefined
    sessionRef.current?.stop()
    sessionRef.current = undefined
    setRunning(false)
    setPhaseBoth('idle')
    setLevel(0)
  }, [hardStopSpeaking, setPhaseBoth])

  useEffect(() => {
    return () => {
      stopSession()
    }
  }, [stopSession])

  const ensureInterimBubble = useCallback(() => {
    if (interimBubbleIdRef.current !== undefined) {
      return interimBubbleIdRef.current
    }
    const id = appendBubble('user', '', true)
    interimBubbleIdRef.current = id
    return id
  }, [appendBubble])

  const discardInterim = useCallback(() => {
    const id = interimBubbleIdRef.current
    if (id !== undefined) {
      removeBubble(id)
      interimBubbleIdRef.current = undefined
    }
  }, [removeBubble])

  const handlePartial = useCallback(
    async (wav: VadUtterance) => {
      if (!activeRef.current || turnBusyRef.current) {
        return
      }

      abortPartials()
      const abort = new AbortController()
      partialAbortRef.current = abort

      const bubbleId = ensureInterimBubble()
      setPhaseBoth('speech')
      pushLog(
        'event',
        `预识别 ${wav.durationMs}ms / ${(wav.byteLength / 1024).toFixed(1)} KB`,
      )

      try {
        // 非流式：整段结果一次性替换，避免字一个个蹦、以及多次预识别反复「清空→变长」
        const text = (
          await recognizeSpeech({
            audioBase64: wav.base64,
            mimeType: wav.mimeType,
            usageContext: {
              actor: 'speech',
              behavior: 'chat-recognize-partial',
              behaviorLabel: '语音对话预识别',
            },
          })
        ).trim()
        if (abort.signal.aborted || !activeRef.current) return
        if (text) {
          patchBubble(bubbleId, text, true)
        }
      } catch (err) {
        if (isStreamAbortError(err, abort.signal) || abort.signal.aborted) {
          return
        }
        pushLog('event', `预识别跳过：${formatError(err)}`)
      }
    },
    [abortPartials, ensureInterimBubble, patchBubble, pushLog, setPhaseBoth],
  )

  const handleUtterance = useCallback(
    async (wav: VadUtterance) => {
      if (!activeRef.current) {
        return
      }

      // 正在播报 → 仅当开启途中打断时软暂停；思考中 → 硬打断
      const bargeFromSpeaking =
        bargeInEnabledRef.current &&
        speakingRef.current &&
        Boolean(playQueueRef.current)
      if (speakingRef.current && playQueueRef.current && !bargeInEnabledRef.current) {
        // 关闭打断时忽略播报途中收到的语音（拾音本应已暂停）
        return
      }
      if (bargeFromSpeaking) {
        softPauseSpeaking()
      } else if (turnBusyRef.current) {
        const canBarge =
          phaseRef.current === 'thinking' || phaseRef.current === 'speaking'
        if (!canBarge) {
          return
        }
        hardStopSpeaking('用户插话')
      }

      abortPartials()
      setError(undefined)

      // 软暂停插话：识别/判定期间不要 bump turnGen，以便误触发后原轮次继续播
      const bargeGen = bargeFromSpeaking ? turnGenRef.current : ++turnGenRef.current
      if (!bargeFromSpeaking) {
        turnBusyRef.current = true
        sessionRef.current?.setPickMode('normal')
        sessionRef.current?.pauseListening()
      } else {
        sessionRef.current?.pauseListening()
      }

      const bubbleId = ensureInterimBubble()
      /** 软暂停后判定为误触发并恢复了原播报 → finally 不得清掉原轮次 */
      let keptOriginalSpeech = false
      /** 软暂停后确认为有效插话并开始了新播报 */
      let playedReplacementSpeech = false

      const resumePausedSpeech = () => {
        const queue = playQueueRef.current
        if (!queue) return false
        queue.resume()
        speakingRef.current = true
        turnBusyRef.current = true
        setPhaseBoth('speaking')
        enableSpeakingPickup()
        keptOriginalSpeech = true
        pushLog('event', '误触发，继续原播报（不重新合成）')
        return true
      }

      try {
        setPhaseBoth('recognizing')
        pushLog(
          'info',
          `终识别 ${wav.durationMs}ms / ${wav.byteLength} bytes` +
            (wav.crestFactor !== undefined
              ? ` crest=${wav.crestFactor.toFixed(1)} active=${Math.round(wav.activeSpeechMs ?? 0)}ms`
              : ''),
        )

        const userText = (
          await recognizeSpeech({
            audioBase64: wav.base64,
            mimeType: wav.mimeType,
            usageContext: {
              actor: 'speech',
              behavior: 'chat-recognize',
              behaviorLabel: '语音对话识别',
            },
          })
        ).trim()

        if (!activeRef.current) return
        if (!bargeFromSpeaking && bargeGen !== turnGenRef.current) return
        if (bargeFromSpeaking && !playQueueRef.current) return

        if (!userText) {
          discardInterim()
          if (bargeFromSpeaking) {
            resumePausedSpeech()
          } else {
            pushLog('event', '识别为空，继续聆听')
          }
          return
        }

        const noise = shouldDropNoiseUtterance(wav, userText)
        if (noise.drop) {
          discardInterim()
          pushLog(
            'event',
            `前端判定误触发（${noise.reason}），忽略：${JSON.stringify(userText)} · ${noise.detail}`,
          )
          if (bargeFromSpeaking) {
            resumePausedSpeech()
          }
          return
        }

        patchBubble(bubbleId, userText, false)
        interimBubbleIdRef.current = undefined
        historyRef.current = [
          ...historyRef.current,
          { role: 'user', content: userText },
        ]
        pushLog('result', `用户：${userText}`)

        setPhaseBoth('thinking')
        const assistantId = appendBubble('assistant', '')
        const defaultVoice = voiceRef.current
        const transcript = historyRef.current
          .map((item) =>
            `${item.role === 'user' ? '用户' : '助手'}：${item.content}`,
          )
          .join('\n')
        const thinkingStartedAt = performance.now()
        let sawReasoning = false

        // 普通轮次：边生成边入队；插话软暂停：先等完整判定，ignore 则续播原音频
        let playAbort = new AbortController()
        let playQueue: SpeechScriptPlayQueue | undefined
        let enqueued = 0
        let startedSpeaking = false
        const streamGen = bargeGen

        if (!bargeFromSpeaking) {
          playAbortRef.current = playAbort
          speakingBubbleIdRef.current = assistantId
          playQueue = createSpeechScriptPlayQueue({
            signal: playAbort.signal,
            usageContext: {
              actor: 'speech',
              behavior: 'chat-speak',
              behaviorLabel: '语音对话播报',
            },
            onLineStart: (line, index) => {
              activeScriptIndexRef.current = index
              const styleHint = line.style
                ? ` style=${JSON.stringify(line.style.slice(0, 40))}`
                : ''
              const singHint = isSingingSpeechLine(line) ? ' ·唱' : ''
              pushLog(
                'event',
                `播报段 ${index + 1} voice=${line.voice}${singHint}${styleHint}`,
              )
            },
            onLinePhase: (index, linePhase) => {
              if (streamGen !== turnGenRef.current) return
              setBubblePlayingPhase(assistantId, index, linePhase)
            },
            onLineAudio: (index, _line, audio) => {
              storeLineAudio(assistantId, index, audio)
              refreshCacheUi()
            },
          })
          playQueueRef.current = playQueue
        }

        const finishReasoningUi = () => {
          if (!sawReasoning) return
          sawReasoning = false
          patchBubble(assistantId, undefined, undefined, {
            reasoningLive: false,
            reasoningDurationMs: Math.round(performance.now() - thinkingStartedAt),
          })
        }

        const reply = (
          await streamChatCompletion({
            system: buildChatSystemPrompt(defaultVoice),
            user: `对话记录：\n${transcript}\n\n请针对用户最新一句处理：误触发则只输出 ${SPEECH_IGNORE_TAG}；否则用 <speak> / <sing song="歌名"> 分段回复。唱歌必须用 <sing>；正文不要写 [停顿] 等方括号标签。每写完一个闭合标签就会开始合成，请尽快闭合。`,
            thinkingEnabled: thinkingEnabledRef.current,
            usageContext: {
              actor: 'speech',
              behavior: 'chat-reply',
              behaviorLabel: '语音对话回复',
            },
            onReasoningChunk: (_delta, accumulated) => {
              if (!bargeFromSpeaking && streamGen !== turnGenRef.current) return
              sawReasoning = true
              patchBubble(assistantId, undefined, undefined, {
                reasoning: accumulated,
                reasoningLive: true,
              })
            },
            onChunk: (_delta, accumulated) => {
              if (!bargeFromSpeaking && streamGen !== turnGenRef.current) return
              finishReasoningUi()
              if (isSpeechIgnoreReply(accumulated)) {
                patchBubble(assistantId, '')
                return
              }
              const view = formatStreamingSpeechView(accumulated, defaultVoice)
              patchBubble(assistantId, view.displayText, undefined, {
                scriptLines: view.lines.length > 0 ? view.lines : undefined,
                draft: view.draft,
                raw: accumulated,
                reasoningLive: false,
              })

              if (!playQueue || bargeFromSpeaking) return
              const closed = view.lines
              while (enqueued < closed.length) {
                const line = closed[enqueued]
                if (!line) break
                if (!startedSpeaking) {
                  startedSpeaking = true
                  setPhaseBoth('speaking')
                  speakingRef.current = true
                  enableSpeakingPickup()
                }
                activeScriptRef.current = closed.slice(0, enqueued + 1)
                playQueue.enqueue(line, enqueued)
                enqueued += 1
              }
            },
          })
        ).trim()

        finishReasoningUi()

        if (!activeRef.current) {
          playQueue?.cancel()
          return
        }
        if (!bargeFromSpeaking && streamGen !== turnGenRef.current) {
          playQueue?.cancel()
          return
        }
        if (bargeFromSpeaking && !playQueueRef.current) return

        const parsed = parseSpeechReply(reply, defaultVoice)
        if (parsed.kind === 'ignore') {
          playQueue?.cancel()
          if (playQueueRef.current === playQueue) {
            playQueueRef.current = undefined
          }
          removeBubble(assistantId)
          removeBubble(bubbleId)
          historyRef.current = historyRef.current.slice(0, -1)
          pushLog('event', `模型判定误触发，忽略：${JSON.stringify(userText)}`)
          if (bargeFromSpeaking) {
            resumePausedSpeech()
          }
          return
        }

        // 有效插话：硬停旧播报（会 +1 gen），再播新回复
        let gen = streamGen
        if (bargeFromSpeaking) {
          hardStopSpeaking('确认有效插话')
          gen = turnGenRef.current
          turnBusyRef.current = true
          playedReplacementSpeech = true
          playAbort = new AbortController()
          playAbortRef.current = playAbort
          speakingBubbleIdRef.current = assistantId
          playQueue = createSpeechScriptPlayQueue({
            signal: playAbort.signal,
            usageContext: {
              actor: 'speech',
              behavior: 'chat-speak',
              behaviorLabel: '语音对话播报',
            },
            onLineStart: (line, index) => {
              activeScriptIndexRef.current = index
              const styleHint = line.style
                ? ` style=${JSON.stringify(line.style.slice(0, 40))}`
                : ''
              const singHint = isSingingSpeechLine(line) ? ' ·唱' : ''
              pushLog(
                'event',
                `播报段 ${index + 1} voice=${line.voice}${singHint}${styleHint}`,
              )
            },
            onLinePhase: (index, linePhase) => {
              if (gen !== turnGenRef.current) return
              setBubblePlayingPhase(assistantId, index, linePhase)
            },
            onLineAudio: (index, _line, audio) => {
              storeLineAudio(assistantId, index, audio)
              refreshCacheUi()
            },
          })
          playQueueRef.current = playQueue
          enqueued = 0
          startedSpeaking = false
        }

        if (!playQueue) return

        patchBubble(assistantId, parsed.displayText, undefined, {
          scriptLines: parsed.lines,
          draft: undefined,
          raw: reply,
        })
        historyRef.current = [
          ...historyRef.current,
          { role: 'assistant', content: parsed.displayText },
        ]
        pushLog(
          'result',
          `助手（${parsed.lines.length} 段音色）：${parsed.displayText}`,
        )

        activeScriptRef.current = parsed.lines
        while (enqueued < parsed.lines.length) {
          const line = parsed.lines[enqueued]
          if (!line) break
          if (!startedSpeaking) {
            startedSpeaking = true
            setPhaseBoth('speaking')
            speakingRef.current = true
            enableSpeakingPickup()
          }
          playQueue.enqueue(line, enqueued)
          enqueued += 1
        }
        playQueue.finish()
        await playQueue.waitUntilDone()

        if (gen === turnGenRef.current) {
          clearBubblePlaying(assistantId)
        }
      } catch (err) {
        if (!activeRef.current) return
        if (keptOriginalSpeech) return
        if (!bargeFromSpeaking && bargeGen !== turnGenRef.current) return
        const message = formatError(err)
        if (
          isStreamAbortError(err) ||
          message === 'Aborted' ||
          message.includes('abort')
        ) {
          return
        }
        setError(message)
        setPhaseBoth('error')
        pushLog('error', `对话轮次失败：${message}`)
      } finally {
        if (keptOriginalSpeech) return
        if (!bargeFromSpeaking && bargeGen !== turnGenRef.current) return
        if (bargeFromSpeaking && !playedReplacementSpeech) return
        speakingRef.current = false
        turnBusyRef.current = false
        interimBubbleIdRef.current = undefined
        activeScriptRef.current = undefined
        playQueueRef.current = undefined
        clearBubblePlaying(speakingBubbleIdRef.current)
        speakingBubbleIdRef.current = undefined
        sessionRef.current?.setPickMode('normal')
        if (activeRef.current) {
          setPhaseBoth('listening')
          sessionRef.current?.resumeListening()
        }
      }
    },
    [
      abortPartials,
      appendBubble,
      clearBubblePlaying,
      discardInterim,
      enableSpeakingPickup,
      ensureInterimBubble,
      hardStopSpeaking,
      patchBubble,
      pushLog,
      refreshCacheUi,
      removeBubble,
      setBubblePlayingPhase,
      setPhaseBoth,
      softPauseSpeaking,
      storeLineAudio,
    ],
  )

  handlePartialRef.current = (wav) => {
    void handlePartial(wav)
  }
  handleUtteranceRef.current = (wav) => {
    void handleUtterance(wav)
  }

  const handleInterruptClick = useCallback(() => {
    if (!running) return
    discardInterim()
    hardStopSpeaking('手动打断')
    sessionRef.current?.setPickMode('normal')
    sessionRef.current?.resumeListening()
    setPhaseBoth('listening')
  }, [discardInterim, hardStopSpeaking, running, setPhaseBoth])

  const stopReplay = useCallback(() => {
    replayAbortRef.current?.abort()
    replayAbortRef.current = undefined
  }, [])

  /** 再播：只播已缓存 PCM，绝不重新请求 TTS */
  const handleReplay = useCallback(
    async (
      bubbleId: number,
      lines: readonly SpeechScriptLine[],
      lineIndex?: number,
    ) => {
      const indices =
        lineIndex === undefined
          ? lines.map((_, index) => index)
          : [lineIndex]
      const playable = indices.filter((index) =>
        audioCacheRef.current.has(cacheKey(bubbleId, index)),
      )
      if (playable.length === 0) {
        pushLog('event', '尚无缓存音频，等首次播完后再点「再播」')
        return
      }

      stopReplay()
      const abort = new AbortController()
      replayAbortRef.current = abort
      pushLog(
        'event',
        lineIndex === undefined
          ? `再播缓存（${playable.length}/${lines.length} 段）`
          : `再播缓存·第 ${lineIndex + 1} 段`,
      )

      try {
        for (const index of playable) {
          if (abort.signal.aborted) break
          const audio = audioCacheRef.current.get(cacheKey(bubbleId, index))
          if (!audio) continue
          await playCachedLineAudio({
            audio,
            signal: abort.signal,
            onPhase: (linePhase) => {
              if (abort.signal.aborted) return
              setBubblePlayingPhase(bubbleId, index, linePhase)
            },
          })
        }
      } catch (err) {
        if (isStreamAbortError(err, abort.signal) || abort.signal.aborted) {
          return
        }
        pushLog('error', `再播失败：${formatError(err)}`)
      } finally {
        if (replayAbortRef.current === abort) {
          replayAbortRef.current = undefined
          clearBubblePlaying(bubbleId)
        }
      }
    },
    [clearBubblePlaying, pushLog, setBubblePlayingPhase, stopReplay],
  )

  /** 换音色：重新合成该段并更新缓存 */
  const handleRegenWithVoice = useCallback(
    async (bubbleId: number, lineIndex: number, nextVoice: string) => {
      const bubble = bubbles.find((item) => item.id === bubbleId)
      const line = bubble?.scriptLines?.[lineIndex]
      if (!line || line.voice === nextVoice) return

      stopReplay()
      const abort = new AbortController()
      replayAbortRef.current = abort

      const updated: SpeechScriptLine = { ...line, voice: nextVoice }
      setBubbles((prev) =>
        prev.map((item) => {
          if (item.id !== bubbleId || !item.scriptLines) return item
          const scriptLines = item.scriptLines.slice()
          scriptLines[lineIndex] = updated
          return { ...item, scriptLines }
        }),
      )

      pushLog('event', `换音色重生成 voice=${nextVoice} · 第 ${lineIndex + 1} 段`)
      try {
        const player = createStreamingPcmPlayer({
          sampleRate: MIMO_TTS_PCM_SAMPLE_RATE,
          signal: abort.signal,
        })
        try {
          const audio = await synthesizeSpeechLine({
            line: updated,
            signal: abort.signal,
            usageContext: {
              actor: 'speech',
              behavior: 'chat-regen-voice',
              behaviorLabel: '语音对话换音色',
            },
            onPhase: (linePhase) => {
              if (abort.signal.aborted) return
              setBubblePlayingPhase(bubbleId, lineIndex, linePhase)
            },
            onPcmChunk: (pcm) => {
              player.enqueue(pcm)
            },
          })
          storeLineAudio(bubbleId, lineIndex, audio)
          refreshCacheUi()
          player.markEnd()
          await player.waitUntilEnded()
        } catch (err) {
          player.stop()
          throw err
        }
      } catch (err) {
        if (isStreamAbortError(err, abort.signal) || abort.signal.aborted) {
          return
        }
        pushLog('error', `换音色失败：${formatError(err)}`)
      } finally {
        if (replayAbortRef.current === abort) {
          replayAbortRef.current = undefined
          clearBubblePlaying(bubbleId)
        }
      }
    },
    [
      bubbles,
      clearBubblePlaying,
      pushLog,
      refreshCacheUi,
      setBubblePlayingPhase,
      stopReplay,
      storeLineAudio,
    ],
  )

  const handleStart = useCallback(async () => {
    setError(undefined)
    try {
      pushLog('event', '开始语音对话（前端滤噪 · 可打断 · 模型兜底误触发）')
      const session = await startVadSession({
        minSpeechMs: 550,
        onPartial: (wav) => {
          handlePartialRef.current(wav)
        },
        onUtterance: (wav) => {
          handleUtteranceRef.current(wav)
        },
        onLevel: (rms) => {
          setLevel(Math.min(1, rms * 8))
        },
        onListenState: (state: VadListenState) => {
          if (!activeRef.current) return
          // 播报中检测到开口 → 仅当开启途中打断时软暂停
          if (
            state === 'speech' &&
            speakingRef.current &&
            bargeInEnabledRef.current
          ) {
            softPauseSpeakingRef.current()
            setPhaseBoth('speech')
            return
          }
          if (turnBusyRef.current) return
          setPhaseBoth(state === 'speech' ? 'speech' : 'listening')
        },
      })
      sessionRef.current = session
      activeRef.current = true
      setRunning(true)
      setPhaseBoth('listening')
    } catch (err) {
      const message = formatError(err)
      setError(message)
      setPhaseBoth('error')
      pushLog('error', `无法开始对话：${message}`)
    }
  }, [pushLog, setPhaseBoth])

  const handleStop = useCallback(() => {
    pushLog('info', '结束语音对话')
    stopSession()
  }, [pushLog, stopSession])

  const handleClear = useCallback(() => {
    stopReplay()
    audioCacheRef.current.clear()
    historyRef.current = []
    interimBubbleIdRef.current = undefined
    setBubbles([])
    bubbleIdRef.current = 0
    setError(undefined)
    pushLog('info', '已清空对话')
  }, [pushLog, stopReplay])

  const canInterrupt =
    running &&
    (phase === 'speaking' || phase === 'thinking' || phase === 'recognizing')

  /** 对话轮次空闲时可重播历史段落 */
  const replayAllowed =
    phase === 'idle' ||
    phase === 'listening' ||
    phase === 'error'

  const statusClass =
    phase === 'listening' || phase === 'speech'
      ? ' speech-app__status--on'
      : phase === 'recognizing' ||
          phase === 'thinking' ||
          phase === 'speaking'
        ? ' speech-app__status--busy'
        : phase === 'error'
          ? ' speech-app__status--error'
          : ''

  return (
    <>
      <section class="speech-app__panel speech-app__config">
        <div class="speech-app__panel-title">对话配置（系统）</div>
        <div class="speech-app__config-grid">
          <label class="speech-app__field">
            <span>识别</span>
            <input class="speech-app__readonly" type="text" value={asrModelLabel} readOnly />
          </label>
          <label class="speech-app__field">
            <span>回复</span>
            <input class="speech-app__readonly" type="text" value={textModelLabel} readOnly />
          </label>
          <label class="speech-app__field">
            <span>播报模型</span>
            <input class="speech-app__readonly" type="text" value={ttsModelLabel} readOnly />
          </label>
          <label class="speech-app__field">
            <span>默认音色</span>
            <select
              value={voice}
              onChange={(e) => setVoice((e.target as HTMLSelectElement).value)}
            >
              {voices.map((item) => (
                <option key={item.id} value={item.id}>
                  {item.label}
                </option>
              ))}
            </select>
          </label>
          <label class="speech-app__field speech-app__field--wide speech-app__field--toggle">
            <span>播报途中可打断</span>
            <div class="speech-app__toggle-row">
              <CheckToggle
                checked={bargeInEnabled}
                label="播报途中可打断"
                onChange={setBargeInEnabled}
              />
              <span class="speech-app__toggle-hint">
                {bargeInEnabled
                  ? '说话可打断助手；杂音会被忽略并续播'
                  : '播报时不拾音，说完一轮后再听'}
              </span>
            </div>
          </label>
          <label class="speech-app__field speech-app__field--wide speech-app__field--toggle">
            <span>深度思考</span>
            <div class="speech-app__toggle-row">
              <CheckToggle
                checked={thinkingEnabled}
                label="深度思考"
                onChange={setThinkingEnabled}
              />
              <span class="speech-app__toggle-hint">
                {thinkingEnabled
                  ? '开启模型思考链，回复可能更准但更慢'
                  : '关闭思考，更快开口播报'}
              </span>
            </div>
          </label>
        </div>
      </section>

      <section class="speech-app__panel speech-app__controls">
        {!running ? (
          <button type="button" class="speech-app__mic" onClick={handleStart}>
            开始对话
          </button>
        ) : (
          <button
            type="button"
            class="speech-app__mic speech-app__mic--on"
            onClick={handleStop}
          >
            结束对话
          </button>
        )}
        <button
          type="button"
          class="speech-app__btn"
          disabled={!canInterrupt}
          onClick={handleInterruptClick}
        >
          打断
        </button>
        <button
          type="button"
          class="speech-app__btn"
          disabled={running || bubbles.length === 0}
          onClick={handleClear}
        >
          清空对话
        </button>
        <span class={`speech-app__status${statusClass}`}>
          <span class="speech-app__status-dot" aria-hidden="true" />
          {PHASE_LABEL[phase]}
        </span>
        {running && (
          <div
            class="speech-app__level"
            title="输入音量"
            aria-hidden="true"
          >
            <div
              class="speech-app__level-fill"
              style={{ transform: `scaleX(${Math.max(0.04, level)})` }}
            />
          </div>
        )}
      </section>

      {error && <p class="speech-app__error">{error}</p>}

      <section class="speech-app__panel speech-app__chat">
        <div class="speech-app__panel-title">
          <span>对话</span>
          <span class="speech-app__count">{bubbles.length} 条</span>
        </div>
        <div class="speech-app__chat-body" ref={listRef}>
          {bubbles.length === 0 ? (
            <span class="speech-app__placeholder">
              点一次「开始对话」后直接说。唱歌用 &lt;sing song&gt;；「再播」走缓存不重合成，旁路下拉可换音色重生成。
            </span>
          ) : (
            <ul class="speech-app__chat-list">
              {bubbles.map((bubble) => {
                const showRaw =
                  bubble.role === 'assistant' &&
                  bubble.viewMode === 'raw' &&
                  Boolean(bubble.raw?.trim())
                const hasFriendlyScript =
                  bubble.role === 'assistant' &&
                  ((bubble.scriptLines && bubble.scriptLines.length > 0) ||
                    bubble.draft)
                const canToggleRaw =
                  bubble.role === 'assistant' && Boolean(bubble.raw?.trim())

                return (
                  <li
                    key={bubble.id}
                    class={[
                      'speech-app__chat-bubble',
                      `speech-app__chat-bubble--${bubble.role}`,
                      bubble.interim ? 'speech-app__chat-bubble--interim' : '',
                      showRaw ? 'speech-app__chat-bubble--raw' : '',
                    ]
                      .filter(Boolean)
                      .join(' ')}
                  >
                    <div class="speech-app__chat-bubble-head">
                      <span class="speech-app__chat-role">
                        {bubble.role === 'user'
                          ? bubble.interim
                            ? '你（识别中）'
                            : '你'
                          : '助手'}
                      </span>
                      <div class="speech-app__chat-bubble-actions">
                        {bubble.role === 'assistant' &&
                        bubble.scriptLines &&
                        bubble.scriptLines.length > 0 ? (
                          <button
                            type="button"
                            class="speech-app__chat-replay"
                            disabled={
                              !replayAllowed ||
                              !hasAnyCachedAudio(
                                bubble.id,
                                bubble.scriptLines.length,
                              )
                            }
                            title={
                              hasAnyCachedAudio(
                                bubble.id,
                                bubble.scriptLines.length,
                              )
                                ? '再播整条（缓存，不重新合成）'
                                : '首次播完后可再播'
                            }
                            onClick={() =>
                              void handleReplay(bubble.id, bubble.scriptLines!)
                            }
                          >
                            再播
                          </button>
                        ) : undefined}
                        {canToggleRaw ? (
                          <button
                            type="button"
                            class="speech-app__chat-view-toggle"
                            onClick={() => toggleBubbleView(bubble.id)}
                            title={
                              showRaw
                                ? '切换为友好展示'
                                : '切换为模型原始输出'
                            }
                          >
                            {showRaw ? '原始' : '友好'}
                          </button>
                        ) : undefined}
                      </div>
                    </div>
                    {bubble.role === 'assistant' &&
                    (bubble.reasoning || bubble.reasoningLive) ? (
                      <SpeechReasoningBlock
                        text={bubble.reasoning ?? ''}
                        live={bubble.reasoningLive}
                        durationMs={bubble.reasoningDurationMs}
                      />
                    ) : undefined}
                    {showRaw ? (
                      <pre class="speech-app__chat-raw">{bubble.raw}</pre>
                    ) : hasFriendlyScript ? (
                      <div class="speech-app__chat-script">
                        {bubble.scriptLines?.map((line, index) => {
                          const isActiveLine =
                            bubble.playingLineIndex === index
                          const lineLoading =
                            isActiveLine &&
                            bubble.playingLinePhase === 'loading'
                          const linePlaying =
                            isActiveLine &&
                            bubble.playingLinePhase === 'playing'
                          const cached = hasCachedAudio(bubble.id, index)
                          return (
                            <div
                              key={`${bubble.id}-${index}-${line.voice}`}
                              class={[
                                'speech-app__chat-line',
                                isSingingSpeechLine(line)
                                  ? 'speech-app__chat-line--sing'
                                  : '',
                                lineLoading
                                  ? 'speech-app__chat-line--loading'
                                  : '',
                                linePlaying
                                  ? 'speech-app__chat-line--playing'
                                  : '',
                              ]
                                .filter(Boolean)
                                .join(' ')}
                            >
                              <div class="speech-app__chat-line-head">
                                <span class="speech-app__chat-speaker">
                                  {line.name?.trim() || line.voice}
                                  {isSingingSpeechLine(line) ? (
                                    <span class="speech-app__chat-speaker-badge">
                                      {line.song
                                        ? `唱·${line.song}`
                                        : '唱'}
                                    </span>
                                  ) : undefined}
                                  {lineLoading ? (
                                    <span
                                      class="speech-app__chat-line-spinner"
                                      aria-label="合成中"
                                      title="语音合成中"
                                    />
                                  ) : undefined}
                                </span>
                                <div class="speech-app__chat-line-actions">
                                  <select
                                    class="speech-app__chat-voice-select"
                                    value={line.voice}
                                    disabled={!replayAllowed}
                                    title="换音色并重新合成"
                                    onChange={(e) => {
                                      const next = (
                                        e.target as HTMLSelectElement
                                      ).value
                                      void handleRegenWithVoice(
                                        bubble.id,
                                        index,
                                        next,
                                      )
                                    }}
                                  >
                                    {voices.map((item) => (
                                      <option key={item.id} value={item.id}>
                                        {item.label}
                                      </option>
                                    ))}
                                  </select>
                                  <button
                                    type="button"
                                    class="speech-app__chat-replay speech-app__chat-replay--line"
                                    disabled={!replayAllowed || !cached}
                                    title={
                                      cached
                                        ? '再播这一段（缓存）'
                                        : '首次播完后可再播'
                                    }
                                    onClick={() =>
                                      void handleReplay(
                                        bubble.id,
                                        bubble.scriptLines!,
                                        index,
                                      )
                                    }
                                  >
                                    再播
                                  </button>
                                </div>
                              </div>
                              {line.style ? (
                                <span
                                  class="speech-app__chat-style"
                                  title={line.style}
                                >
                                  {line.style}
                                </span>
                              ) : undefined}
                              <span class="speech-app__chat-line-text">
                                {speechLineDisplayText(line)}
                              </span>
                            </div>
                          )
                        })}
                        {bubble.draft ? (
                          <div class="speech-app__chat-line speech-app__chat-line--draft">
                            <span class="speech-app__chat-line-text">
                              {bubble.draft}
                            </span>
                          </div>
                        ) : undefined}
                      </div>
                    ) : (
                      <span class="speech-app__chat-text">
                        {bubble.content ||
                          (bubble.reasoningLive
                            ? ''
                            : phase === 'thinking' || bubble.interim
                              ? '…'
                              : '')}
                      </span>
                    )}
                  </li>
                )
              })}
            </ul>
          )}
        </div>
      </section>
    </>
  )
}
