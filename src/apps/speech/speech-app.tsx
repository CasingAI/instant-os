import { useCallback, useEffect, useMemo, useRef, useState } from 'preact/hooks'
import { useAboutApp } from '../../os/about-app-context.tsx'
import { aboutAppMenuPrefix } from '../../os/about-app-menu.ts'
import { useAppMenuBar } from '../../os/menu-bar-context.tsx'
import type { MenuDefinition } from '../../os/menu-bar-types.ts'
import { useOs } from '../../os/os-context.tsx'
import './speech.css'

// 浏览器 Web Speech API 类型与能力探测。
// 注意：本仓库内置的 TS lib 不包含 SpeechRecognition 识别器本身与 SpeechRecognitionEventMap，
// 仅含 SpeechRecognitionEvent / SpeechRecognitionErrorEvent / SpeechRecognitionResult / SpeechRecognitionAlternative，
// 因此这里自行声明识别器与构造器形状。

interface SpeechRecognitionLike {
  lang: string
  continuous: boolean
  interimResults: boolean
  maxAlternatives: number
  onstart: (() => void) | null
  onend: (() => void) | null
  onerror: ((event: SpeechRecognitionErrorEvent) => void) | null
  onresult: ((event: SpeechRecognitionEvent) => void) | null
  onaudiostart: (() => void) | null
  onspeechstart: (() => void) | null
  onspeechend: (() => void) | null
  start: () => void
  stop: () => void
  abort: () => void
}

type SpeechRecognitionCtor = new () => SpeechRecognitionLike

type WindowWithSpeech = Window & {
  SpeechRecognition?: SpeechRecognitionCtor
  webkitSpeechRecognition?: SpeechRecognitionCtor
}

function getRecognitionCtor(): SpeechRecognitionCtor | undefined {
  const w = window as WindowWithSpeech
  return w.SpeechRecognition ?? w.webkitSpeechRecognition
}

const LANG_PRESETS = [
  { value: 'zh-CN', label: '中文（简体）' },
  { value: 'zh-TW', label: '中文（繁体）' },
  { value: 'en-US', label: 'English (US)' },
  { value: 'en-GB', label: 'English (UK)' },
  { value: 'ja-JP', label: '日本語' },
  { value: 'ko-KR', label: '한국어' },
  { value: 'fr-FR', label: 'Français' },
  { value: 'de-DE', label: 'Deutsch' },
] as const

const ERROR_LABELS: Record<string, string> = {
  'no-speech': '未检测到语音',
  'aborted': '已中止',
  'audio-capture': '音频采集失败（麦克风）',
  'network': '网络错误（识别服务不可达）',
  'not-allowed': '麦克风权限被拒绝',
  'service-not-allowed': '浏览器不允许使用识别服务',
  'bad-grammar': '语法错误',
  'language-not-supported': '语言不支持',
  'unknown': '未知错误',
}

type LogKind = 'info' | 'event' | 'result' | 'error'
type LogEntry = {
  id: number
  kind: LogKind
  text: string
  time: string
}

function nowTime(): string {
  const d = new Date()
  const pad = (n: number) => String(n).padStart(2, '0')
  return `${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}.${String(d.getMilliseconds()).padStart(3, '0')}`
}

export function SpeechApp() {
  const { closeWindowsForApp, minimizeWindow, setAppWindowTitle, windows } = useOs()
  const { showBuiltinAbout } = useAboutApp()

  const ctorRef = useRef(getRecognitionCtor())
  const recognitionRef = useRef<SpeechRecognitionLike | null>(null)
  const logIdRef = useRef(0)

  const supported = Boolean(ctorRef.current)

  const [lang, setLang] = useState<string>('zh-CN')
  const [continuous, setContinuous] = useState(true)
  const [interim, setInterim] = useState(true)
  const [maxAlternatives, setMaxAlternatives] = useState(1)

  const [listening, setListening] = useState(false)
  const [finalText, setFinalText] = useState('')
  const [interimText, setInterimText] = useState('')
  const [error, setError] = useState<string | undefined>()
  const [lastEvent, setLastEvent] = useState<string | undefined>()

  const [logs, setLogs] = useState<LogEntry[]>([])

  const pushLog = useCallback((kind: LogKind, text: string) => {
    setLogs((prev) => {
      const next = [...prev, { id: ++logIdRef.current, kind, text, time: nowTime() }]
      return next.length > 200 ? next.slice(next.length - 200) : next
    })
  }, [])

  const clearLog = useCallback(() => {
    setLogs([])
    logIdRef.current = 0
  }, [])

  // 构建并启动一个新的识别实例。每次启动都重建，避免复用已 end 的实例。
  const start = useCallback(() => {
    if (!ctorRef.current) {
      setError('当前浏览器不支持 Web Speech API（SpeechRecognition）')
      pushLog('error', '不支持 SpeechRecognition')
      return
    }
    try {
      recognitionRef.current?.abort()
    } catch {
      /* ignore */
    }

    const recognition = new (ctorRef.current as SpeechRecognitionCtor)()
    recognition.lang = lang
    recognition.continuous = continuous
    recognition.interimResults = interim
    recognition.maxAlternatives = maxAlternatives

    recognition.onstart = () => {
      setListening(true)
      setError(undefined)
      pushLog('event', 'onstart — 识别已开始')
    }
    recognition.onaudiostart = () => pushLog('event', 'onaudiostart — 音频流已接通')
    recognition.onspeechstart = () => pushLog('event', 'onspeechstart — 检测到语音开始')
    recognition.onspeechend = () => pushLog('event', 'onspeechend — 检测到语音结束')

    recognition.onresult = (event: SpeechRecognitionEvent) => {
      let finalChunk = ''
      let interimChunk = ''
      for (let i = event.resultIndex; i < event.results.length; i++) {
        const result = event.results[i]
        const first = result[0].transcript
        if (result.isFinal) {
          finalChunk += first
          const conf = result[0].confidence
          pushLog('result', `final[${i}] confidence=${conf.toFixed(3)} → ${JSON.stringify(first)}`)
          if (result.length > 1) {
            const alts = Array.from(result)
              .slice(1)
              .map((alt, idx) => `#${idx + 1} ${alt.confidence.toFixed(3)} ${JSON.stringify(alt.transcript)}`)
              .join('  ')
            pushLog('result', `备选 ${result.length - 1} 个：${alts}`)
          }
        } else {
          interimChunk += first
        }
      }
      if (finalChunk) {
        setFinalText((prev) => (prev ? `${prev}\n${finalChunk}` : finalChunk))
      }
      setInterimText(interimChunk)
      setLastEvent(`resultIndex=${event.resultIndex} results.length=${event.results.length}`)
    }

    recognition.onerror = (event: SpeechRecognitionErrorEvent) => {
      const label = ERROR_LABELS[event.error] ?? event.error
      const msg = event.error === 'no-speech' || event.error === 'aborted' ? undefined : label
      setError(msg)
      pushLog('error', `onerror — ${event.error}（${label}）${event.message ? '：' + event.message : ''}`)
    }

    recognition.onend = () => {
      setListening(false)
      setInterimText('')
      pushLog('event', 'onend — 识别已停止')
    }

    recognitionRef.current = recognition

    try {
      recognition.start()
      pushLog('info', `start() → lang=${lang} continuous=${continuous} interim=${interim} maxAlt=${maxAlternatives}`)
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err)
      setError(`启动失败：${message}`)
      pushLog('error', `start() 抛出异常：${message}`)
      setListening(false)
    }
  }, [continuous, interim, lang, maxAlternatives, pushLog])

  const stop = useCallback(() => {
    const rec = recognitionRef.current
    if (!rec) {
      return
    }
    try {
      rec.stop()
      pushLog('info', 'stop() — 请求停止（等待最终结果）')
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err)
      pushLog('error', `stop() 抛出异常：${message}`)
    }
  }, [pushLog])

  const abort = useCallback(() => {
    const rec = recognitionRef.current
    if (!rec) {
      return
    }
    try {
      rec.abort()
      pushLog('info', 'abort() — 立即中止')
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err)
      pushLog('error', `abort() 抛出异常：${message}`)
    }
    setListening(false)
    setInterimText('')
  }, [pushLog])

  const handleToggle = useCallback(() => {
    if (listening) {
      stop()
    } else {
      start()
    }
  }, [listening, start, stop])

  const clearTranscript = useCallback(() => {
    setFinalText('')
    setInterimText('')
    setError(undefined)
  }, [])

  // 卸载 / 关闭窗口时清理
  useEffect(() => {
    return () => {
      try {
        recognitionRef.current?.abort()
      } catch {
        /* ignore */
      }
      recognitionRef.current = null
    }
  }, [])

  useEffect(() => {
    setAppWindowTitle('speech', '语音识别')
  }, [setAppWindowTitle])

  const vendorNote = useMemo(() => {
    if (typeof window === 'undefined') return ''
    const w = window as WindowWithSpeech
    if (w.SpeechRecognition) return 'window.SpeechRecognition'
    if (w.webkitSpeechRecognition) return 'window.webkitSpeechRecognition'
    return '未定义'
  }, [])

  const menuBar = useMemo((): MenuDefinition[] => {
    const appWindow = windows.find((window) => window.appId === 'speech' && !window.minimized)

    return [
      {
        label: '语音识别',
        items: [
          ...aboutAppMenuPrefix('关于 语音识别', () => showBuiltinAbout('speech')),
          {
            type: 'action',
            label: '隐藏语音识别',
            shortcut: '⌘H',
            onClick: () => appWindow && minimizeWindow(appWindow.id),
          },
          { type: 'separator' },
          {
            type: 'action',
            label: '退出语音识别',
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
            label: listening ? '停止识别' : '开始识别',
            shortcut: '↩',
            onClick: handleToggle,
          },
          { type: 'separator' },
          { type: 'action', label: '清空文本', onClick: clearTranscript },
          { type: 'action', label: '清空日志', onClick: clearLog },
        ],
      },
    ]
  }, [clearLog, clearTranscript, closeWindowsForApp, handleToggle, listening, minimizeWindow, showBuiltinAbout, windows])

  useAppMenuBar('speech', menuBar)

  const liveText = useMemo(() => {
    if (!finalText && !interimText) return ''
    return [finalText, interimText].filter(Boolean).join('\n')
  }, [finalText, interimText])

  return (
    <div class="speech-app">
      <header class="speech-app__toolbar">
        <span class="speech-app__brand">🎙️ 语音识别</span>
        <span class="speech-app__hint">Web Speech API · SpeechRecognition</span>
        <span class={`speech-app__status${listening ? ' speech-app__status--on' : ''}`}>
          <span class="speech-app__status-dot" aria-hidden="true" />
          {listening ? '聆听中' : '已停止'}
        </span>
      </header>

      {!supported && (
        <div class="speech-app__unsupported">
          <strong>当前浏览器不支持 SpeechRecognition。</strong>
          <p>
            桌面端推荐 Chrome / Edge；iOS Safari 与移动端支持有限。
            <br />
            另需通过 HTTPS 或 <code>localhost</code> 访问，并授予麦克风权限。
          </p>
        </div>
      )}

      <div class="speech-app__body">
        <section class="speech-app__panel speech-app__config">
          <div class="speech-app__panel-title">配置</div>
          <div class="speech-app__config-grid">
            <label class="speech-app__field">
              <span>识别语言</span>
              <select value={lang} onChange={(e) => setLang((e.target as HTMLSelectElement).value)} disabled={listening}>
                {LANG_PRESETS.map((p) => (
                  <option key={p.value} value={p.value}>
                    {p.label} — {p.value}
                  </option>
                ))}
              </select>
            </label>

            <label class="speech-app__field speech-app__field--inline">
              <input
                type="checkbox"
                checked={continuous}
                onChange={(e) => setContinuous((e.target as HTMLInputElement).checked)}
                disabled={listening}
              />
              <span>continuous 连续识别</span>
            </label>

            <label class="speech-app__field speech-app__field--inline">
              <input
                type="checkbox"
                checked={interim}
                onChange={(e) => setInterim((e.target as HTMLInputElement).checked)}
                disabled={listening}
              />
              <span>interimResults 中间结果</span>
            </label>

            <label class="speech-app__field">
              <span>maxAlternatives：{maxAlternatives}</span>
              <input
                type="range"
                min={1}
                max={5}
                step={1}
                value={maxAlternatives}
                onInput={(e) => setMaxAlternatives(Number((e.target as HTMLInputElement).value))}
                disabled={listening}
              />
            </label>
          </div>
        </section>

        <section class="speech-app__panel speech-app__controls">
          <button
            type="button"
            class={`speech-app__mic${listening ? ' speech-app__mic--on' : ''}`}
            onClick={handleToggle}
            disabled={!supported}
            aria-label={listening ? '停止识别' : '开始识别'}
          >
            <span class="speech-app__mic-icon" aria-hidden="true">
              {listening ? '⏹' : '🎤'}
            </span>
            <span>{listening ? '停止' : '开始识别'}</span>
          </button>
          <button type="button" class="speech-app__btn" onClick={abort} disabled={!listening}>
            中止 abort
          </button>
          <button type="button" class="speech-app__btn" onClick={clearTranscript}>
            清空文本
          </button>
          <button type="button" class="speech-app__btn" onClick={clearLog}>
            清空日志
          </button>
        </section>

        {error && <p class="speech-app__error">⚠️ {error}</p>}
        {lastEvent && !error && <p class="speech-app__lastevent">最近事件：{lastEvent}</p>}

        <section class="speech-app__panel speech-app__transcript">
          <div class="speech-app__panel-title">
            <span>识别文本</span>
            <span class="speech-app__count">{liveText.length} 字</span>
          </div>
          <div class="speech-app__transcript-body">
            {finalText ? <span class="speech-app__final">{finalText}</span> : null}
            {interimText ? <span class="speech-app__interim"> {interimText}</span> : null}
            {!finalText && !interimText ? <span class="speech-app__placeholder">点击「开始识别」后说话，文本会显示在这里…</span> : null}
          </div>
        </section>

        <section class="speech-app__panel speech-app__log">
          <div class="speech-app__panel-title">
            <span>事件日志</span>
            <span class="speech-app__count">{logs.length}</span>
          </div>
          <div class="speech-app__log-body">
            {logs.length === 0 ? (
              <span class="speech-app__placeholder">尚未产生事件</span>
            ) : (
              <ul class="speech-app__log-list">
                {logs.map((entry) => (
                  <li key={entry.id} class={`speech-app__log-item speech-app__log-item--${entry.kind}`}>
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
          厂商实现：<code>{vendorNote}</code> · 注意：SpeechRecognition 依赖浏览器厂商服务（Chrome/Edge 走 Google 服务器），Safari 走 Apple。
        </p>
      </div>
    </div>
  )
}
