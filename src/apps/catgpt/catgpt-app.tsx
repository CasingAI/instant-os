import { useCallback, useEffect, useMemo, useRef, useState } from 'preact/hooks'
import { useAboutApp } from '../../os/about-app-context.tsx'
import { aboutAppMenuPrefix } from '../../os/about-app-menu.ts'
import { useAppMenuBar } from '../../os/menu-bar-context.tsx'
import type { MenuDefinition } from '../../os/menu-bar-types.ts'
import { useOs } from '../../os/os-context.tsx'
import { generateMeowReply } from './catgpt-agent.ts'
import {
  createMessage,
  createSession,
  deriveSessionTitle,
  readCatGptStore,
  removeSession,
  upsertSession,
  writeCatGptStore,
} from './catgpt-storage.ts'
import type { CatGptMessage, CatGptSession, CatGptStore } from './catgpt-types.ts'
import './catgpt.css'

const SAMPLE_PROMPTS = [
  '猫咪之神，你好',
  '今天运势如何？',
  '我最近有点累',
  '能赐我一句神谕吗？',
] as const

function formatCatGptError(err: unknown): string {
  if (err instanceof Error) {
    return err.message
  }
  return '猫咪之神暂时无法回应，请稍后再试'
}

export function CatGptApp() {
  const { closeWindowsForApp, minimizeWindow, setAppWindowTitle, windows } = useOs()
  const { showBuiltinAbout } = useAboutApp()
  const [store, setStore] = useState<CatGptStore>(() => readCatGptStore())
  const [draft, setDraft] = useState('')
  const [streaming, setStreaming] = useState(false)
  const [sidebarOpen, setSidebarOpen] = useState(false)
  const [streamingText, setStreamingText] = useState('')
  const chatEndRef = useRef<HTMLDivElement | null>(null)

  const activeSession = useMemo(
    () => store.sessions.find((session) => session.id === store.activeSessionId),
    [store.activeSessionId, store.sessions],
  )

  const persistStore = useCallback((next: CatGptStore) => {
    writeCatGptStore(next)
    setStore(next)
  }, [])

  const selectSession = useCallback(
    (sessionId: string) => {
      persistStore({ ...store, activeSessionId: sessionId })
      setStreamingText('')
      setSidebarOpen(false)
    },
    [persistStore, store],
  )

  const handleNewChat = useCallback(() => {
    const session = createSession()
    persistStore({
      sessions: [session, ...store.sessions],
      activeSessionId: session.id,
    })
    setDraft('')
    setStreamingText('')
  }, [persistStore, store.sessions])

  const handleDeleteSession = useCallback(
    (sessionId: string) => {
      persistStore(removeSession(store, sessionId))
      setStreamingText('')
    },
    [persistStore, store],
  )

  const scrollToBottom = useCallback(() => {
    chatEndRef.current?.scrollIntoView({ behavior: 'smooth', block: 'end' })
  }, [])

  const sendMessage = useCallback(
    async (rawText: string) => {
      const text = rawText.trim()
      if (!text || streaming) {
        return
      }

      setDraft('')

      let session = activeSession
      if (!session) {
        session = createSession()
        persistStore({
          sessions: [session, ...store.sessions],
          activeSessionId: session.id,
        })
      }

      const userMessage = createMessage('user', text)
      const pendingMessages: CatGptMessage[] = [...session.messages, userMessage]
      const pendingSession: CatGptSession = {
        ...session,
        messages: pendingMessages,
        title: deriveSessionTitle(pendingMessages),
        updatedAt: Date.now(),
      }

      persistStore(upsertSession(store, { ...pendingSession, id: session.id }))
      setStreaming(true)
      setStreamingText('')

      try {
        const reply = await generateMeowReply(pendingMessages, (_delta, accumulated) => {
          setStreamingText(accumulated)
          scrollToBottom()
        })

        const assistantMessage = createMessage('assistant', reply)
        const finalMessages = [...pendingMessages, assistantMessage]
        const finalSession: CatGptSession = {
          ...pendingSession,
          messages: finalMessages,
          title: deriveSessionTitle(finalMessages),
          updatedAt: Date.now(),
        }

        persistStore(
          upsertSession(
            { ...store, activeSessionId: session.id },
            finalSession,
          ),
        )
      } catch (err) {
        const errorMessage = createMessage('assistant', formatCatGptError(err), { isError: true })
        const finalMessages = [...pendingMessages, errorMessage]
        const finalSession: CatGptSession = {
          ...pendingSession,
          messages: finalMessages,
          title: deriveSessionTitle(finalMessages),
          updatedAt: Date.now(),
        }

        persistStore(
          upsertSession(
            { ...store, activeSessionId: session.id },
            finalSession,
          ),
        )
      } finally {
        setStreaming(false)
        setStreamingText('')
        scrollToBottom()
      }
    },
    [activeSession, persistStore, scrollToBottom, store, streaming],
  )

  const handleSubmit = useCallback(() => {
    void sendMessage(draft)
  }, [draft, sendMessage])

  const handleKeyDown = useCallback(
    (event: KeyboardEvent) => {
      if (event.key === 'Enter' && !event.shiftKey) {
        event.preventDefault()
        void sendMessage(draft)
      }
    },
    [draft, sendMessage],
  )

  useEffect(() => {
    setAppWindowTitle('catgpt', 'CatGPT')
  }, [setAppWindowTitle])

  useEffect(() => {
    scrollToBottom()
  }, [activeSession?.messages.length, streamingText, scrollToBottom])

  const menuBar = useMemo((): MenuDefinition[] => {
    const appWindow = windows.find((window) => window.appId === 'catgpt' && !window.minimized)

    return [
      {
        label: 'CatGPT',
        items: [
          ...aboutAppMenuPrefix('关于 CatGPT', () => showBuiltinAbout('catgpt')),
          {
            type: 'action',
            label: '隐藏 CatGPT',
            shortcut: '⌘H',
            onClick: () => appWindow && minimizeWindow(appWindow.id),
          },
          { type: 'separator' },
          {
            type: 'action',
            label: '退出 CatGPT',
            shortcut: '⌘Q',
            onClick: () => closeWindowsForApp('catgpt'),
          },
        ],
      },
      {
        label: '文件',
        items: [
          {
            type: 'action',
            label: '新建对话',
            shortcut: '⌘N',
            onClick: handleNewChat,
          },
        ],
      },
    ]
  }, [closeWindowsForApp, handleNewChat, minimizeWindow, showBuiltinAbout, windows])

  useAppMenuBar('catgpt', menuBar)

  const showWelcome = !activeSession || activeSession.messages.length === 0

  return (
    <div class={`catgpt-app${sidebarOpen ? ' catgpt-app--sidebar-open' : ''}`}>
      {sidebarOpen && (
        <button
          type="button"
          class="catgpt-app__sidebar-backdrop"
          aria-label="关闭对话列表"
          onClick={() => setSidebarOpen(false)}
        />
      )}
      <aside class="catgpt-app__sidebar">
        <div class="catgpt-app__sidebar-head">
          <div class="catgpt-app__logo">
            <span class="catgpt-app__logo-mark" aria-hidden="true">
              🐱
            </span>
            <span class="catgpt-app__logo-text">CatGPT</span>
          </div>
          <button
            type="button"
            class="catgpt-app__new-chat"
            onClick={handleNewChat}
            disabled={streaming}
          >
            ＋ 新建对话
          </button>
        </div>

        <div class="catgpt-app__session-list">
          {store.sessions.length === 0 ? (
            <p class="catgpt-app__session-empty">暂无对话记录</p>
          ) : (
            store.sessions.map((session) => (
              <div
                key={session.id}
                class={`catgpt-app__session${store.activeSessionId === session.id ? ' catgpt-app__session--active' : ''}`}
              >
                <button
                  type="button"
                  class="catgpt-app__session-open"
                  onClick={() => selectSession(session.id)}
                >
                  <span class="catgpt-app__session-emoji" aria-hidden="true">
                    {session.emoji}
                  </span>
                  <span class="catgpt-app__session-label">{session.title}</span>
                </button>
                <button
                  type="button"
                  class="catgpt-app__session-delete"
                  aria-label={`删除对话 ${session.title}`}
                  onClick={() => handleDeleteSession(session.id)}
                  disabled={streaming}
                >
                  ×
                </button>
              </div>
            ))
          )}
        </div>
      </aside>

      <div class="catgpt-app__main">
        <header class="catgpt-app__toolbar">
          <button
            type="button"
            class="catgpt-app__sidebar-toggle"
            onClick={() => setSidebarOpen((open) => !open)}
            aria-label="对话列表"
            aria-expanded={sidebarOpen}
          >
            ☰
          </button>
          <span class="catgpt-app__toolbar-title">CatGPT</span>
          <span class="catgpt-app__toolbar-hint">
            {activeSession
              ? `${activeSession.emoji} ${activeSession.title}`
              : '和猫咪之神对话'}
          </span>
        </header>

        <div class="catgpt-app__chat">
          {showWelcome ? (
            <div class="catgpt-app__welcome">
              <div class="catgpt-app__welcome-icon" aria-hidden="true">
                🐱
              </div>
              <h2 class="catgpt-app__welcome-title">猫咪之神</h2>
              <p class="catgpt-app__welcome-sub">
                和猫咪之神对话。
                <br />
                你写下心声，神以喵喵喵回应；喵与喵之间或有符号与 emoji。
              </p>
              <div class="catgpt-app__samples" aria-label="示例提问">
                {SAMPLE_PROMPTS.map((prompt) => (
                  <button
                    key={prompt}
                    type="button"
                    class="catgpt-app__sample"
                    onClick={() => void sendMessage(prompt)}
                    disabled={streaming}
                  >
                    {prompt}
                  </button>
                ))}
              </div>
            </div>
          ) : (
            <div class="catgpt-app__messages">
              {activeSession?.messages.map((message) => (
                <div
                  key={message.id}
                  class={`catgpt-app__message catgpt-app__message--${message.role}${message.isError ? ' catgpt-app__message--error' : ''}`}
                >
                  <span class="catgpt-app__avatar" aria-hidden="true">
                    {message.isError ? '⚠️' : message.role === 'assistant' ? '🐱' : '🙂'}
                  </span>
                  <div
                    class={`catgpt-app__bubble${message.isError ? ' catgpt-app__bubble--error' : ''}`}
                  >
                    {message.content}
                  </div>
                </div>
              ))}

              {streaming && streamingText && (
                <div class="catgpt-app__message catgpt-app__message--assistant">
                  <span class="catgpt-app__avatar" aria-hidden="true">
                    🐱
                  </span>
                  <div class="catgpt-app__bubble catgpt-app__bubble--streaming">{streamingText}</div>
                </div>
              )}

              {streaming && !streamingText && (
                <div class="catgpt-app__message catgpt-app__message--assistant">
                  <span class="catgpt-app__avatar" aria-hidden="true">
                    🐱
                  </span>
                  <div class="catgpt-app__bubble catgpt-app__bubble--streaming">喵</div>
                </div>
              )}

              <div ref={chatEndRef} />
            </div>
          )}
        </div>

        <div class="catgpt-app__composer-wrap">
          <div class="catgpt-app__composer">
            <textarea
              class="catgpt-app__input"
              rows={1}
              value={draft}
              placeholder="向猫咪之神说些什么…"
              disabled={streaming}
              onInput={(event) => setDraft((event.target as HTMLTextAreaElement).value)}
              onKeyDown={handleKeyDown}
            />
            <button
              type="button"
              class="catgpt-app__send"
              aria-label="发送"
              onClick={handleSubmit}
              disabled={streaming || !draft.trim()}
            >
              ↑
            </button>
          </div>
        </div>
      </div>
    </div>
  )
}
