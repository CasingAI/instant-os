/**
 * 语音实验室（实验性）。
 *
 * 默认不出现在桌面/程序坞，需在「设置 → 开发者选项」开启。
 * 作为系统语音服务的测试客户端：只调统一 API，语种 / 音色 / 模型均由系统解析。
 */
import { useCallback, useEffect, useMemo, useRef, useState } from 'preact/hooks'
import {
  readSpeechSystemStatus,
  recognizeSpeech,
  synthesizeSpeech,
  type AsrLanguage,
} from '../../ai/speech-api.ts'
import { readDefaultModelFriendlyName } from '../../ai/openai-config.ts'
import { subscribeOpenAiConfig } from '../../ai/openai-config-events.ts'
import { subscribeSpeechSettings } from '../../os/speech-settings-storage.ts'
import { osNowDate } from '../../os/os-clock.ts'
import { useAboutApp } from '../../os/about-app-context.tsx'
import { aboutAppMenuPrefix } from '../../os/about-app-menu.ts'
import { useAppMenuBar } from '../../os/menu-bar-context.tsx'
import type { MenuDefinition } from '../../os/menu-bar-types.ts'
import { useOs } from '../../os/os-context.tsx'
import { SpeechChatPanel } from './speech-chat-panel.tsx'
import {
  startMicWavRecorder,
  type MicWavRecorder,
} from './speech-record-wav.ts'
import { SpeechStyleLabPanel } from './speech-style-lab-panel.tsx'
import './speech.css'

type SpeechTab = 'chat' | 'recognize' | 'synthesize' | 'style-lab'

type LogKind = 'info' | 'event' | 'result' | 'error'
type LogEntry = {
  id: number
  kind: LogKind
  text: string
  time: string
}

const ASR_LANGUAGE_LABELS: Record<AsrLanguage, string> = {
  auto: '自动检测',
  zh: '中文',
  en: 'English',
}

function nowTime(): string {
  const d = osNowDate()
  const pad = (n: number) => String(n).padStart(2, '0')
  return `${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}.${String(d.getMilliseconds()).padStart(3, '0')}`
}

function formatError(error: unknown): string {
  if (error instanceof Error) return error.message
  return String(error)
}

function voiceLabel(voiceId: string, voices: readonly { id: string; label: string }[]): string {
  return voices.find((item) => item.id === voiceId)?.label ?? voiceId
}

export function SpeechApp() {
  const { closeWindowsForApp, minimizeWindow, setAppWindowTitle, windows } =
    useOs()
  const { showBuiltinAbout } = useAboutApp()

  const [tab, setTab] = useState<SpeechTab>('chat')
  const initialStatus = useMemo(() => readSpeechSystemStatus(), [])
  const [asrModelLabel, setAsrModelLabel] = useState(initialStatus.asrModelLabel)
  const [ttsModelLabel, setTtsModelLabel] = useState(initialStatus.ttsModelLabel)
  const [textModelLabel, setTextModelLabel] = useState(() =>
    readDefaultModelFriendlyName('text'),
  )
  const [languageLabel, setLanguageLabel] = useState(
    () => ASR_LANGUAGE_LABELS[initialStatus.defaultAsrLanguage],
  )
  const [voiceDisplay, setVoiceDisplay] = useState(() =>
    voiceLabel(initialStatus.defaultVoice, initialStatus.voices),
  )

  const logIdRef = useRef(0)
  const [logs, setLogs] = useState<LogEntry[]>([])

  const pushLog = useCallback((kind: LogKind, text: string) => {
    setLogs((prev) => {
      const next = [
        ...prev,
        { id: ++logIdRef.current, kind, text, time: nowTime() },
      ]
      return next.length > 200 ? next.slice(next.length - 200) : next
    })
  }, [])

  const clearLog = useCallback(() => {
    setLogs([])
    logIdRef.current = 0
  }, [])

  useEffect(() => {
    const refresh = () => {
      try {
        const status = readSpeechSystemStatus()
        setAsrModelLabel(status.asrModelLabel)
        setTtsModelLabel(status.ttsModelLabel)
        setTextModelLabel(readDefaultModelFriendlyName('text'))
        setLanguageLabel(ASR_LANGUAGE_LABELS[status.defaultAsrLanguage])
        setVoiceDisplay(voiceLabel(status.defaultVoice, status.voices))
      } catch {
        setAsrModelLabel('未配置')
        setTtsModelLabel('未配置')
        setTextModelLabel('未配置')
      }
    }
    refresh()
    const unsubConfig = subscribeOpenAiConfig(refresh)
    const unsubSpeech = subscribeSpeechSettings(refresh)
    return () => {
      unsubConfig()
      unsubSpeech()
    }
  }, [])

  useEffect(() => {
    setAppWindowTitle('speech', '语音实验室')
  }, [setAppWindowTitle])

  const menuBar = useMemo((): MenuDefinition[] => {
    const appWindow = windows.find(
      (window) => window.appId === 'speech' && !window.minimized,
    )

    return [
      {
        label: '语音实验室',
        items: [
          ...aboutAppMenuPrefix('关于 语音实验室', () =>
            showBuiltinAbout('speech'),
          ),
          {
            type: 'action',
            label: '隐藏语音实验室',
            shortcut: '⌘H',
            onClick: () => appWindow && minimizeWindow(appWindow.id),
          },
          { type: 'separator' },
          {
            type: 'action',
            label: '退出语音实验室',
            shortcut: '⌘Q',
            onClick: () => closeWindowsForApp('speech'),
          },
        ],
      },
      {
        label: '操作',
        items: [
          {
            type: 'action',
            label: '语音对话',
            onClick: () => setTab('chat'),
          },
          {
            type: 'action',
            label: '语音识别',
            onClick: () => setTab('recognize'),
          },
          {
            type: 'action',
            label: '语音合成',
            onClick: () => setTab('synthesize'),
          },
          {
            type: 'action',
            label: '表现力',
            onClick: () => setTab('style-lab'),
          },
          { type: 'separator' },
          { type: 'action', label: '清空日志', onClick: clearLog },
        ],
      },
    ]
  }, [clearLog, closeWindowsForApp, minimizeWindow, showBuiltinAbout, windows])

  useAppMenuBar('speech', menuBar)

  return (
    <div class="speech-app">
      <header class="speech-app__toolbar">
        <span class="speech-app__brand">语音实验室</span>
        <span class="speech-app__hint">实验性 · 系统语音服务</span>
      </header>

      <div class="speech-app__tabs" role="tablist" aria-label="语音能力">
        <button
          type="button"
          role="tab"
          aria-selected={tab === 'chat'}
          class={`speech-app__tab${tab === 'chat' ? ' speech-app__tab--active' : ''}`}
          onClick={() => setTab('chat')}
        >
          语音对话
        </button>
        <button
          type="button"
          role="tab"
          aria-selected={tab === 'recognize'}
          class={`speech-app__tab${tab === 'recognize' ? ' speech-app__tab--active' : ''}`}
          onClick={() => setTab('recognize')}
        >
          语音识别
        </button>
        <button
          type="button"
          role="tab"
          aria-selected={tab === 'synthesize'}
          class={`speech-app__tab${tab === 'synthesize' ? ' speech-app__tab--active' : ''}`}
          onClick={() => setTab('synthesize')}
        >
          语音合成
        </button>
        <button
          type="button"
          role="tab"
          aria-selected={tab === 'style-lab'}
          class={`speech-app__tab${tab === 'style-lab' ? ' speech-app__tab--active' : ''}`}
          onClick={() => setTab('style-lab')}
        >
          表现力
        </button>
      </div>

      <div class="speech-app__body">
        {tab === 'chat' ? (
          <SpeechChatPanel
            asrModelLabel={asrModelLabel}
            ttsModelLabel={ttsModelLabel}
            textModelLabel={textModelLabel}
            pushLog={pushLog}
          />
        ) : tab === 'recognize' ? (
          <RecognizePanel
            modelLabel={asrModelLabel}
            languageLabel={languageLabel}
            pushLog={pushLog}
          />
        ) : tab === 'synthesize' ? (
          <SynthesizePanel
            modelLabel={ttsModelLabel}
            voiceLabel={voiceDisplay}
            pushLog={pushLog}
          />
        ) : (
          <SpeechStyleLabPanel
            modelLabel={ttsModelLabel}
            pushLog={pushLog}
          />
        )}

        <section class="speech-app__panel speech-app__log">
          <div class="speech-app__panel-title">
            <span>事件日志</span>
            <span class="speech-app__count">{logs.length}</span>
            <button
              type="button"
              class="speech-app__btn speech-app__btn--tiny"
              onClick={clearLog}
            >
              清空
            </button>
          </div>
          <div class="speech-app__log-body">
            {logs.length === 0 ? (
              <span class="speech-app__placeholder">尚未产生事件</span>
            ) : (
              <ul class="speech-app__log-list">
                {logs.map((entry) => (
                  <li
                    key={entry.id}
                    class={`speech-app__log-item speech-app__log-item--${entry.kind}`}
                  >
                    <span class="speech-app__log-time">{entry.time}</span>
                    <span class="speech-app__log-kind">{entry.kind}</span>
                    <span class="speech-app__log-text">{entry.text}</span>
                  </li>
                ))}
              </ul>
            )}
          </div>
        </section>

        <p class="speech-app__footnote">
          对话：一点开始后靠停顿自动断句；长说会预识别。回复支持 &lt;speak/sing voice style&gt;（style 必填，建议英文自然语言）与 &lt;ignore/&gt; 误触发。
          「表现力」可试自然语言风格指令、文内标签与唱歌（文首加 (唱歌)）。
          模型在钥匙串按能力选用，默认音色在「系统设置 → 语音」调整。
        </p>
      </div>
    </div>
  )
}

function RecognizePanel({
  modelLabel,
  languageLabel,
  pushLog,
}: {
  modelLabel: string
  languageLabel: string
  pushLog: (kind: LogKind, text: string) => void
}) {
  const recorderRef = useRef<MicWavRecorder | undefined>(undefined)
  const [recording, setRecording] = useState(false)
  const [busy, setBusy] = useState(false)
  const [transcript, setTranscript] = useState('')
  const [error, setError] = useState<string | undefined>()
  const [meta, setMeta] = useState<string | undefined>()

  useEffect(() => {
    return () => {
      recorderRef.current?.abort()
      recorderRef.current = undefined
    }
  }, [])

  const handleStart = useCallback(async () => {
    setError(undefined)
    setMeta(undefined)
    try {
      const recorder = await startMicWavRecorder()
      recorderRef.current = recorder
      setRecording(true)
      pushLog('event', '开始录音（PCM → WAV）')
    } catch (err) {
      const message = formatError(err)
      setError(message)
      pushLog('error', `无法开始录音：${message}`)
    }
  }, [pushLog])

  const handleStopAndRecognize = useCallback(async () => {
    const recorder = recorderRef.current
    if (!recorder) return
    recorderRef.current = undefined
    setRecording(false)
    setBusy(true)
    setError(undefined)

    try {
      const wav = await recorder.stop()
      setMeta(
        `录音 ${(wav.durationMs / 1000).toFixed(1)}s · ${(wav.byteLength / 1024).toFixed(1)} KB`,
      )
      pushLog(
        'info',
        `录音完成 ${wav.durationMs}ms / ${wav.byteLength} bytes，提交系统语音识别`,
      )

      const text = await recognizeSpeech({
        audioBase64: wav.base64,
        mimeType: wav.mimeType,
        usageContext: {
          actor: 'speech',
          behavior: 'recognize',
          behaviorLabel: '语音识别',
        },
      })
      setTranscript(text)
      pushLog('result', `识别成功 → ${JSON.stringify(text)}`)
    } catch (err) {
      const message = formatError(err)
      setError(message)
      pushLog('error', `识别失败：${message}`)
    } finally {
      setBusy(false)
    }
  }, [pushLog])

  const handleAbort = useCallback(() => {
    recorderRef.current?.abort()
    recorderRef.current = undefined
    setRecording(false)
    pushLog('info', '已中止录音')
  }, [pushLog])

  return (
    <>
      <section class="speech-app__panel speech-app__config">
        <div class="speech-app__panel-title">识别配置（系统）</div>
        <div class="speech-app__config-grid">
          <label class="speech-app__field">
            <span>首选模型</span>
            <input class="speech-app__readonly" type="text" value={modelLabel} readOnly />
          </label>
          <label class="speech-app__field">
            <span>语种</span>
            <input class="speech-app__readonly" type="text" value={languageLabel} readOnly />
          </label>
        </div>
      </section>

      <section class="speech-app__panel speech-app__controls">
        {!recording ? (
          <button
            type="button"
            class="speech-app__mic"
            disabled={busy}
            onClick={handleStart}
          >
            开始录音
          </button>
        ) : (
          <button
            type="button"
            class="speech-app__mic speech-app__mic--on"
            onClick={handleStopAndRecognize}
          >
            停止并识别
          </button>
        )}
        <button
          type="button"
          class="speech-app__btn"
          disabled={!recording}
          onClick={handleAbort}
        >
          中止
        </button>
        <button
          type="button"
          class="speech-app__btn"
          disabled={busy || !transcript}
          onClick={() => setTranscript('')}
        >
          清空文本
        </button>
        <span
          class={`speech-app__status${recording ? ' speech-app__status--on' : ''}${busy ? ' speech-app__status--busy' : ''}`}
        >
          <span class="speech-app__status-dot" aria-hidden="true" />
          {busy ? '识别中' : recording ? '录音中' : '空闲'}
        </span>
      </section>

      {error && <p class="speech-app__error">{error}</p>}
      {meta && !error && <p class="speech-app__lastevent">{meta}</p>}

      <section class="speech-app__panel speech-app__transcript">
        <div class="speech-app__panel-title">
          <span>识别文本</span>
          <span class="speech-app__count">{transcript.length} 字</span>
        </div>
        <div class="speech-app__transcript-body">
          {transcript ? (
            <span class="speech-app__final">{transcript}</span>
          ) : (
            <span class="speech-app__placeholder">
              录音后点击「停止并识别」，结果会显示在这里…
            </span>
          )}
        </div>
      </section>
    </>
  )
}

function SynthesizePanel({
  modelLabel,
  voiceLabel,
  pushLog,
}: {
  modelLabel: string
  voiceLabel: string
  pushLog: (kind: LogKind, text: string) => void
}) {
  const audioUrlRef = useRef<string | undefined>(undefined)
  const [text, setText] = useState('你好，欢迎使用语音实验室。')
  const [styleInstruction, setStyleInstruction] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | undefined>()
  const [audioUrl, setAudioUrl] = useState<string | undefined>()
  const [meta, setMeta] = useState<string | undefined>()

  useEffect(() => {
    return () => {
      if (audioUrlRef.current) {
        URL.revokeObjectURL(audioUrlRef.current)
        audioUrlRef.current = undefined
      }
    }
  }, [])

  const handleSynthesize = useCallback(async () => {
    setBusy(true)
    setError(undefined)
    setMeta(undefined)
    pushLog('info', `开始系统语音合成 chars=${text.trim().length}`)

    try {
      const result = await synthesizeSpeech({
        text,
        styleInstruction: styleInstruction.trim() || undefined,
        format: 'wav',
        usageContext: {
          actor: 'speech',
          behavior: 'synthesize',
          behaviorLabel: '语音合成',
        },
      })

      const binary = atob(result.audioBase64)
      const bytes = new Uint8Array(binary.length)
      for (let i = 0; i < binary.length; i++) {
        bytes[i] = binary.charCodeAt(i)
      }
      const blob = new Blob([bytes], { type: 'audio/wav' })
      if (audioUrlRef.current) {
        URL.revokeObjectURL(audioUrlRef.current)
      }
      const url = URL.createObjectURL(blob)
      audioUrlRef.current = url
      setAudioUrl(url)
      setMeta(`模型 ${result.model} · ${(bytes.byteLength / 1024).toFixed(1)} KB`)
      pushLog(
        'result',
        `合成成功 model=${result.model} bytes=${bytes.byteLength}`,
      )
    } catch (err) {
      const message = formatError(err)
      setError(message)
      pushLog('error', `合成失败：${message}`)
    } finally {
      setBusy(false)
    }
  }, [pushLog, styleInstruction, text])

  return (
    <>
      <section class="speech-app__panel speech-app__config">
        <div class="speech-app__panel-title">合成配置（系统）</div>
        <div class="speech-app__config-grid">
          <label class="speech-app__field">
            <span>首选模型</span>
            <input class="speech-app__readonly" type="text" value={modelLabel} readOnly />
          </label>
          <label class="speech-app__field">
            <span>音色</span>
            <input class="speech-app__readonly" type="text" value={voiceLabel} readOnly />
          </label>
          <label class="speech-app__field speech-app__field--wide">
            <span>风格指令（可选）</span>
            <textarea
              rows={2}
              value={styleInstruction}
              disabled={busy}
              placeholder="例如：语速稍快，语气轻松愉快"
              onInput={(e) =>
                setStyleInstruction((e.target as HTMLTextAreaElement).value)
              }
            />
          </label>
          <label class="speech-app__field speech-app__field--wide">
            <span>合成文本</span>
            <textarea
              rows={4}
              value={text}
              disabled={busy}
              onInput={(e) => setText((e.target as HTMLTextAreaElement).value)}
            />
          </label>
        </div>
      </section>

      <section class="speech-app__panel speech-app__controls">
        <button
          type="button"
          class="speech-app__mic"
          disabled={busy || !text.trim()}
          onClick={handleSynthesize}
        >
          {busy ? '合成中…' : '开始合成'}
        </button>
        <span
          class={`speech-app__status${busy ? ' speech-app__status--busy' : ''}`}
        >
          <span class="speech-app__status-dot" aria-hidden="true" />
          {busy ? '请求中' : '空闲'}
        </span>
      </section>

      {error && <p class="speech-app__error">{error}</p>}
      {meta && !error && <p class="speech-app__lastevent">{meta}</p>}

      <section class="speech-app__panel speech-app__player">
        <div class="speech-app__panel-title">试听</div>
        {audioUrl ? (
          <audio class="speech-app__audio" controls src={audioUrl} autoplay />
        ) : (
          <span class="speech-app__placeholder">合成完成后可在此播放</span>
        )}
      </section>
    </>
  )
}
