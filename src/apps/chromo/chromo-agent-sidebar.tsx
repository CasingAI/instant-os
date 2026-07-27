import { useCallback, useEffect, useRef, useState } from 'preact/hooks'
import { useOpenAiReady } from '../../ai/use-openai-ready.ts'
import { askChromoAgent } from './chromo-agent.ts'
import { fetchChromoPageSnapshot } from './chromo-page-snapshot.ts'

const QUICK_PROMPTS = ['总结网页内容', '这个页面是做什么的？', '页面标题是什么？'] as const

type ChromoAgentMessage = {
  id: string
  role: 'user' | 'assistant'
  content: string
  isError?: boolean
  toolHint?: string
}

type ChromoAgentSidebarProps = {
  pageUrl: string
  pageTitle: string
  pageReady: boolean
  evalInPage: (code: string) => Promise<unknown>
}

let nextMessageId = 1

function createMessage(
  role: ChromoAgentMessage['role'],
  content: string,
  extras?: Pick<ChromoAgentMessage, 'isError' | 'toolHint'>,
): ChromoAgentMessage {
  return {
    id: `chromo-agent-${nextMessageId++}`,
    role,
    content,
    ...extras,
  }
}

function formatError(err: unknown): string {
  return err instanceof Error ? err.message : String(err)
}

export function ChromoAgentSidebar({
  pageUrl,
  pageTitle,
  pageReady,
  evalInPage,
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

        const reply = await askChromoAgent(text, {
          page: { url: pageUrl, title: pageTitle },
          pageSnapshot: snapshot,
          evalInPage,
          signal: abortController.signal,
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
            createMessage('assistant', formatError(err), { isError: true }),
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
    [aiReady, busy, evalInPage, pageReady, pageTitle, pageUrl, scrollToBottom],
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
            问我关于当前网页的问题，我会先读取页面正文再回答。
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
            <div class="chromo-agent__bubble">{message.content}</div>
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
