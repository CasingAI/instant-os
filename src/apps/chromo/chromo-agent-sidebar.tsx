import { useCallback, useEffect, useRef, useState } from 'preact/hooks'
import { useOpenAiReady } from '../../ai/use-openai-ready.ts'
import {
  askChromoAgent,
  chromoAgentSupportsVision,
  formatChromoModelNoVisionMessage,
} from './chromo-agent.ts'
import type { ChromoScreenshotOptions, ChromoScreenshotResult } from './chromo-bridge.ts'
import { fetchChromoPageSnapshot } from './chromo-page-snapshot.ts'
import {
  formatChromoAgentError,
  isScreenshotMostlyBlank,
} from './chromo-screenshot-util.ts'

const QUICK_PROMPTS = ['总结网页内容', '这个页面是做什么的？', '截图试试'] as const

function userWantsScreenshot(text: string): boolean {
  return /截图|截屏|screenshot|screen\s*shot/i.test(text)
}

type ChromoAgentMessage = {
  id: string
  role: 'user' | 'assistant' | 'screenshot'
  content: string
  screenshot?: Pick<ChromoScreenshotResult, 'dataUrl' | 'width' | 'height' | 'mime'>
  isError?: boolean
  toolHint?: string
}

type ChromoAgentSidebarProps = {
  pageUrl: string
  pageTitle: string
  pageReady: boolean
  evalInPage: (code: string) => Promise<unknown>
  screenshotInPage: (options?: ChromoScreenshotOptions) => Promise<ChromoScreenshotResult>
}

let nextMessageId = 1

function createMessage(
  role: ChromoAgentMessage['role'],
  content: string,
  extras?: Pick<ChromoAgentMessage, 'isError' | 'toolHint' | 'screenshot'>,
): ChromoAgentMessage {
  return {
    id: `chromo-agent-${nextMessageId++}`,
    role,
    content,
    ...extras,
  }
}

function createScreenshotMessage(shot: ChromoScreenshotResult): ChromoAgentMessage {
  return createMessage('screenshot', '', {
    toolHint: '页面截图',
    screenshot: {
      dataUrl: shot.dataUrl,
      width: shot.width,
      height: shot.height,
      mime: shot.mime,
    },
  })
}

function formatError(err: unknown): string {
  return err instanceof Error ? err.message : String(err)
}

export function ChromoAgentSidebar({
  pageUrl,
  pageTitle,
  pageReady,
  evalInPage,
  screenshotInPage,
}: ChromoAgentSidebarProps) {
  const aiReady = useOpenAiReady()
  const [messages, setMessages] = useState<ChromoAgentMessage[]>([])
  const [draft, setDraft] = useState('')
  const [busy, setBusy] = useState(false)
  const [liveText, setLiveText] = useState('')
  const [liveToolHint, setLiveToolHint] = useState<string | undefined>()
  const liveTextRef = useRef('')
  const chatEndRef = useRef<HTMLDivElement>(null)
  const abortRef = useRef<AbortController | undefined>()

  const scrollToBottom = useCallback(() => {
    chatEndRef.current?.scrollIntoView({ behavior: 'smooth', block: 'end' })
  }, [])

  useEffect(() => {
    scrollToBottom()
  }, [messages.length, liveText, liveToolHint, scrollToBottom])

  useEffect(() => {
    return () => abortRef.current?.abort()
  }, [])

  const handleClear = useCallback(() => {
    if (busy) {
      return
    }
    setMessages([])
    setLiveText('')
    setLiveToolHint(undefined)
  }, [busy])

  const handleStop = useCallback(() => {
    abortRef.current?.abort()
  }, [])

  const sendMessage = useCallback(
    async (rawText: string) => {
      const text = rawText.trim()
      if (!text || busy) {
        return
      }
      if (!aiReady) {
        setMessages((prev) => [
          ...prev,
          createMessage('assistant', '请先在钥匙串中配置 AI 账户。', { isError: true }),
        ])
        return
      }
      if (!pageReady) {
        setMessages((prev) => [
          ...prev,
          createMessage('assistant', '网页尚未加载完成，请稍后再试。', { isError: true }),
        ])
        return
      }

      setDraft('')
      setMessages((prev) => [...prev, createMessage('user', text)])
      setBusy(true)
      setLiveText('')
      setLiveToolHint('读取页面正文…')

      const abortController = new AbortController()
      abortRef.current = abortController

      try {
        const snapshot = await fetchChromoPageSnapshot(evalInPage)
        if (snapshot.error && !snapshot.text) {
          setMessages((prev) => [
            ...prev,
            createMessage(
              'assistant',
              `无法读取页面内容：${snapshot.error}\n\n请确认页面已加载完成，且 virtual-chromo 支持 VC_EVAL。`,
              { isError: true },
            ),
          ])
          return
        }

        let preScreenshot: ChromoScreenshotResult | undefined
        if (userWantsScreenshot(text)) {
          setLiveToolHint('截取页面截图…')
          try {
            preScreenshot = await screenshotInPage({ format: 'jpeg', quality: 0.65, scale: 0.85 })
            setMessages((prev) => [...prev, createScreenshotMessage(preScreenshot!)])
            scrollToBottom()
            if (await isScreenshotMostlyBlank(preScreenshot.dataUrl)) {
              setMessages((prev) => [
                ...prev,
                createMessage(
                  'assistant',
                  '截图几乎全白（常见于 DuckDuckGo 搜索结果/验证码页：页面样式与截图引擎不兼容）。可尝试换用 example.com 等页面，或让助手用 run_javascript 读取文字内容。',
                  { isError: true },
                ),
              ])
              return
            }
            if (!chromoAgentSupportsVision()) {
              setMessages((prev) => [
                ...prev,
                createMessage('assistant', formatChromoModelNoVisionMessage(), { isError: true }),
              ])
              return
            }
          } catch (err) {
            setMessages((prev) => [
              ...prev,
              createMessage('assistant', `截图失败：${formatError(err)}`, { isError: true }),
            ])
            return
          }
        }

        const reply = await askChromoAgent(text, {
          page: { url: pageUrl, title: pageTitle },
          pageSnapshot: snapshot,
          evalInPage,
          screenshotInPage,
          initialScreenshot: preScreenshot,
          signal: abortController.signal,
          onScreenshot: (shot) => {
            setMessages((prev) => [...prev, createScreenshotMessage(shot)])
            scrollToBottom()
          },
          onProgress: (progress) => {
            liveTextRef.current = progress.answerText
            setLiveText(progress.answerText)
            setLiveToolHint(progress.lastToolLabel)
            scrollToBottom()
          },
        })
        setMessages((prev) => [...prev, createMessage('assistant', reply)])
      } catch (err) {
        if (abortController.signal.aborted) {
          const partial = liveTextRef.current.trim()
          setMessages((prev) => [
            ...prev,
            createMessage('assistant', partial || '已停止生成。'),
          ])
        } else {
          setMessages((prev) => [
            ...prev,
            createMessage('assistant', formatChromoAgentError(err), { isError: true }),
          ])
        }
      } finally {
        if (abortRef.current === abortController) {
          abortRef.current = undefined
        }
        setBusy(false)
        setLiveText('')
        setLiveToolHint(undefined)
      }
    },
    [aiReady, busy, evalInPage, pageReady, pageTitle, pageUrl, screenshotInPage, scrollToBottom],
  )

  const handleSubmit = useCallback(
    (event: Event) => {
      event.preventDefault()
      void sendMessage(draft)
    },
    [draft, sendMessage],
  )

  const handleKeyDown = useCallback(
    (event: KeyboardEvent) => {
      if (event.key === 'Enter' && !event.shiftKey) {
        event.preventDefault()
        void sendMessage(draft)
      }
    },
    [draft, sendMessage],
  )

  return (
    <aside class="chromo-agent" aria-label="Chromo AI 助手">
      <header class="chromo-agent__header">
        <div>
          <div class="chromo-agent__title">AI 助手</div>
          <div class="chromo-agent__subtitle">{pageTitle || pageUrl || '无页面'}</div>
        </div>
        <div class="chromo-agent__header-actions">
          <button type="button" class="chromo-agent__header-btn" onClick={handleClear} disabled={busy}>
            清空
          </button>
        </div>
      </header>

      <div class="chromo-agent__messages">
        {messages.length === 0 && !busy && (
          <div class="chromo-agent__quick-prompts">
            {QUICK_PROMPTS.map((prompt) => (
              <button
                key={prompt}
                type="button"
                class="chromo-agent__quick-prompt"
                disabled={!aiReady || !pageReady}
                onClick={() => void sendMessage(prompt)}
              >
                {prompt}
              </button>
            ))}
          </div>
        )}

        {messages.length === 0 && !busy && (
          <div class="chromo-agent__empty">
            问我关于当前网页的问题。我会读取正文；需要看图（验证码、布局等）时会自动截图分析。
          </div>
        )}

        {messages.map((message) => (
          <div
            key={message.id}
            class={[
              'chromo-agent__message',
              `chromo-agent__message--${message.role}`,
              message.isError ? 'chromo-agent__message--error' : '',
            ]
              .filter(Boolean)
              .join(' ')}
          >
            {message.toolHint && (
              <div class="chromo-agent__tool-hint">{message.toolHint}</div>
            )}
            {message.role === 'screenshot' && message.screenshot ? (
              <figure class="chromo-agent__screenshot">
                <img
                  class="chromo-agent__screenshot-img"
                  src={message.screenshot.dataUrl}
                  alt={`页面截图 ${message.screenshot.width}×${message.screenshot.height}`}
                />
                <figcaption class="chromo-agent__screenshot-meta">
                  {message.screenshot.mime || 'image/jpeg'} · {message.screenshot.width}×
                  {message.screenshot.height}
                </figcaption>
              </figure>
            ) : (
              <div class="chromo-agent__bubble">{message.content}</div>
            )}
          </div>
        ))}

        {busy && (
          <div class="chromo-agent__message chromo-agent__message--assistant chromo-agent__message--live">
            {liveToolHint && <div class="chromo-agent__tool-hint">{liveToolHint}</div>}
            <div class="chromo-agent__bubble">
              {liveText || '思考中…'}
              <span class="chromo-agent__cursor" aria-hidden="true" />
            </div>
          </div>
        )}

        <div ref={chatEndRef} />
      </div>

      <form class="chromo-agent__composer" onSubmit={handleSubmit}>
        <textarea
          class="chromo-agent__input"
          value={draft}
          placeholder={aiReady ? '问关于此页的问题…' : '请先配置 AI 钥匙串'}
          rows={3}
          disabled={!aiReady || busy}
          onInput={(event) => setDraft((event.currentTarget as HTMLTextAreaElement).value)}
          onKeyDown={handleKeyDown}
        />
        <div class="chromo-agent__composer-actions">
          {busy ? (
            <button type="button" class="chromo-agent__send" onClick={handleStop}>
              停止
            </button>
          ) : (
            <button type="submit" class="chromo-agent__send" disabled={!aiReady || !draft.trim()}>
              发送
            </button>
          )}
        </div>
      </form>
    </aside>
  )
}
