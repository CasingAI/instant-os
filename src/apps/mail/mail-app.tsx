import { useCallback, useEffect, useMemo, useState } from 'preact/hooks'
import { osNowMs } from '../../os/os-clock.ts'
import { IosNavBackButton } from '../../ui/ios-nav-back-button.tsx'
import { useAppNarrowLayout } from '../../ui/use-app-narrow-layout.ts'
import { useAppMenuBar } from '../../os/menu-bar-context.tsx'
import type { MenuDefinition } from '../../os/menu-bar-types.ts'
import { useOs } from '../../os/os-context.tsx'
import { generateNewContactReply, generateThreadReply } from './mail-agent.ts'
import { ensureMailStoreInitialized } from './mail-init.ts'
import { formatMailDetailDate, formatMailListDate } from './format-mail-date.ts'
import { MailComposeSheet } from './mail-compose-sheet.tsx'
import {
  MailDeleteConfirmSheet,
  type MailDeleteConfirmTarget,
} from './mail-delete-confirm-sheet.tsx'
import {
  addThread,
  appendMessageToThread,
  createMessageId,
  createThreadId,
  deleteMessageFromThread,
  deleteThread,
  getOtherParty,
  isFromUser,
  markThreadRead,
  readMailStore,
  subscribeMailStore,
  threadHasUserMessage,
  writeMailStore,
} from './mail-storage.ts'
import { formatMailAddress, parseMailAddressInput } from './parse-mail-address.ts'
import type { MailAddress, MailMailbox, MailMessage, MailStore, MailThread } from './types.ts'
import './mail.css'

function senderLabel(store: MailStore, thread: MailThread): string {
  const other = getOtherParty(store, thread)
  if (other) {
    return other.name || other.email
  }
  const last = thread.messages[thread.messages.length - 1]
  return last?.from.name || last?.from.email || '未知'
}

function collapseInlineWhitespace(text: string): string {
  return text.replace(/\s+/g, ' ').trim()
}

function formatMailBodyForDisplay(body: string): string {
  return body
    .replace(/\r\n/g, '\n')
    .split('\n')
    .map((line) => collapseInlineWhitespace(line))
    .join('\n')
    .trim()
}

function previewText(thread: MailThread): string {
  const last = thread.messages[thread.messages.length - 1]
  return last ? collapseInlineWhitespace(last.body) : ''
}

function filterThreads(store: MailStore, mailbox: MailMailbox): MailThread[] {
  const sorted = [...store.threads].sort((a, b) => b.lastMessageAt - a.lastMessageAt)
  if (mailbox === 'sent') {
    return sorted.filter((thread) => threadHasUserMessage(store, thread))
  }
  return sorted
}

function countUnreadInbox(store: MailStore): number {
  return store.threads.filter((thread) => thread.unread).length
}

export function MailApp() {
  const { setAppWindowTitle } = useOs()
  const { hostRef, narrowLayout } = useAppNarrowLayout()
  const [store, setStore] = useState<MailStore | undefined>(undefined)
  const [mailbox, setMailbox] = useState<MailMailbox>('inbox')
  const [selectedThreadId, setSelectedThreadId] = useState<string | undefined>()
  const [stackedDetailOpen, setStackedDetailOpen] = useState(false)
  const [composeOpen, setComposeOpen] = useState(false)
  const [replyDraft, setReplyDraft] = useState('')
  const [sending, setSending] = useState(false)
  const [replyingThreadIds, setReplyingThreadIds] = useState<Set<string>>(() => new Set())
  const [pendingDelete, setPendingDelete] = useState<MailDeleteConfirmTarget | undefined>()

  const threads = useMemo(() => (store ? filterThreads(store, mailbox) : []), [store, mailbox])
  const selectedThread = threads.find((thread) => thread.id === selectedThreadId)
  const unreadCount = useMemo(() => (store ? countUnreadInbox(store) : 0), [store])

  useEffect(() => {
    setAppWindowTitle('mail', '邮件')
  }, [setAppWindowTitle])

  useEffect(() => {
    if (narrowLayout) {
      setStackedDetailOpen(false)
    }
  }, [narrowLayout])

  const updateStore = useCallback(async (next: MailStore) => {
    await writeMailStore(next)
    setStore(next)
  }, [])

  const handleDeleteThread = useCallback(
    async (threadId: string) => {
      if (!store) {
        return
      }
      const next = await deleteThread(store, threadId)
      await updateStore(next)
      if (selectedThreadId === threadId) {
        setSelectedThreadId(undefined)
        setReplyDraft('')
      }
    },
    [selectedThreadId, store, updateStore],
  )

  const handleDeleteMessage = useCallback(
    async (threadId: string, messageId: string) => {
      if (!store) {
        return
      }
      const next = await deleteMessageFromThread(store, threadId, messageId)
      await updateStore(next)
      if (!next.threads.some((thread) => thread.id === threadId)) {
        setSelectedThreadId(undefined)
        setReplyDraft('')
      }
    },
    [store, updateStore],
  )

  const handleConfirmDelete = useCallback(async () => {
    if (!pendingDelete) {
      return
    }

    if (pendingDelete.kind === 'thread') {
      await handleDeleteThread(pendingDelete.threadId)
    } else {
      await handleDeleteMessage(pendingDelete.threadId, pendingDelete.messageId)
    }

    setPendingDelete(undefined)
  }, [handleDeleteMessage, handleDeleteThread, pendingDelete])

  const requestDeleteThread = useCallback((threadId: string, subject: string) => {
    setPendingDelete({ kind: 'thread', threadId, subject })
  }, [])

  const requestDeleteMessage = useCallback((threadId: string, messageId: string) => {
    setPendingDelete({ kind: 'message', threadId, messageId })
  }, [])

  const menuBar = useMemo((): MenuDefinition[] => {
    return [
      {
        label: '文件',
        items: [
          { type: 'action', label: '新建邮件', shortcut: '⌘N', onClick: () => setComposeOpen(true) },
          ...(selectedThread
            ? [
                { type: 'separator' as const },
                {
                  type: 'action' as const,
                  label: '删除对话',
                  shortcut: '⌫',
                  onClick: () => requestDeleteThread(selectedThread.id, selectedThread.subject),
                },
              ]
            : []),
        ],
      },
      {
        label: '邮箱',
        items: [
          { type: 'action', label: '收件箱', onClick: () => setMailbox('inbox') },
          { type: 'action', label: '已发送', onClick: () => setMailbox('sent') },
        ],
      },
    ]
  }, [requestDeleteThread, selectedThread])

  useAppMenuBar('mail', menuBar)

  useEffect(() => {
    if (threads.length === 0) {
      setSelectedThreadId(undefined)
      return
    }
    if (selectedThreadId && !threads.some((thread) => thread.id === selectedThreadId)) {
      setSelectedThreadId(undefined)
    }
  }, [threads, selectedThreadId])

  useEffect(() => {
    let alive = true
    const load = () => {
      ensureMailStoreInitialized().then((next) => {
        if (alive) {
          setStore(next)
        }
      })
    }
    load()
    const unsubscribe = subscribeMailStore(load)
    return () => {
      alive = false
      unsubscribe()
    }
  }, [])

  const queueAiReply = useCallback(
    async (threadId: string, contact: MailAddress) => {
      setReplyingThreadIds((prev) => new Set(prev).add(threadId))

      try {
        const current = await readMailStore()
        const thread = current.threads.find((item) => item.id === threadId)
        if (!thread) {
          return
        }

        const reply = await generateThreadReply({
          userAddress: current.userAddress,
          thread,
          contact,
        })

        const latest = await readMailStore()
        const stillExists = latest.threads.some((item) => item.id === threadId)
        if (!stillExists) {
          return
        }

        const next = await appendMessageToThread(latest, threadId, reply)
        setStore(next)
      } catch {
        // 静默失败，用户仍可继续写信
      } finally {
        setReplyingThreadIds((prev) => {
          const next = new Set(prev)
          next.delete(threadId)
          return next
        })
      }
    },
    [],
  )

  const clearStackedDetail = useCallback(() => {
    setStackedDetailOpen(false)
    setSelectedThreadId(undefined)
    setReplyDraft('')
  }, [])

  const handleSelectThread = async (threadId: string) => {
    if (!store) {
      return
    }
    setSelectedThreadId(threadId)
    if (narrowLayout) {
      setStackedDetailOpen(true)
    }
    setReplyDraft('')
    const next = await markThreadRead(store, threadId)
    setStore(next)
  }

  const handleSendReply = async () => {
    if (!store || !selectedThread || !replyDraft.trim() || sending) {
      return
    }

    const body = replyDraft.trim()
    const userMessage: MailMessage = {
      id: createMessageId(),
      from: store.userAddress,
      to: (() => {
        const other = getOtherParty(store, selectedThread)
        return other ? [other] : []
      })(),
      body,
      sentAt: osNowMs(),
    }

    if (userMessage.to.length === 0) {
      return
    }

    setSending(true)
    const threadId = selectedThread.id
    const contact = userMessage.to[0]
    const next = await appendMessageToThread(store, threadId, userMessage)
    await updateStore(next)
    setReplyDraft('')
    setSending(false)

    void queueAiReply(threadId, contact)
  }

  const handleComposeSend = async (payload: { to: string; subject: string; body: string }) => {
    if (!store) {
      return
    }

    const recipient = parseMailAddressInput(payload.to)
    if (!recipient) {
      return
    }

    setSending(true)
    const now = osNowMs()
    const userMessage: MailMessage = {
      id: createMessageId(),
      from: store.userAddress,
      to: [recipient],
      body: payload.body,
      sentAt: now,
    }

    const thread: MailThread = {
      id: createThreadId(),
      subject: payload.subject,
      messages: [userMessage],
      lastMessageAt: now,
      unread: false,
    }

    const next = await addThread(store, thread)
    await updateStore(next)
    setComposeOpen(false)
    setMailbox('sent')
    setSelectedThreadId(thread.id)
    if (narrowLayout) {
      setStackedDetailOpen(true)
    }
    setSending(false)

    setReplyingThreadIds((prev) => new Set(prev).add(thread.id))

    try {
      const reply = await generateNewContactReply({
        userAddress: store.userAddress,
        subject: payload.subject,
        userBody: payload.body,
        recipient,
      })

      const latest = await readMailStore()
      const updated = await appendMessageToThread(latest, thread.id, reply)
      setStore(updated)
      setMailbox('inbox')
    } catch {
      // 新联系人回复失败时保留已发送邮件
    } finally {
      setReplyingThreadIds((prev) => {
        const next = new Set(prev)
        next.delete(thread.id)
        return next
      })
    }
  }

  if (store === undefined) {
    return (
      <div ref={hostRef} class="mail">
        <div class="mail__loading" role="status" aria-live="polite">
          <div class="mail__loading-spinner" aria-hidden="true" />
          <p>正在加载</p>
        </div>
      </div>
    )
  }

  return (
    <div
      ref={hostRef}
      class={`mail${narrowLayout ? ' mail--narrow' : ''}${narrowLayout && stackedDetailOpen ? ' mail--detail-open' : ''}`}
    >
      <header class="mail__toolbar">
        <IosNavBackButton
          class="mail__toolbar-back"
          iconSize={14}
          label="邮件"
          aria-label="返回邮件列表"
          onClick={clearStackedDetail}
        />
        <button
          type="button"
          class="mail__compose-btn"
          onClick={() => setComposeOpen(true)}
          aria-label="新建邮件"
          title="新建邮件"
        >
          <ComposeIcon />
        </button>
        <div class="mail__toolbar-mailboxes" role="tablist" aria-label="邮箱">
          <button
            type="button"
            role="tab"
            aria-selected={mailbox === 'inbox'}
            class={`mail__toolbar-mailbox${mailbox === 'inbox' ? ' mail__toolbar-mailbox--active' : ''}`}
            onClick={() => {
              setMailbox('inbox')
              clearStackedDetail()
            }}
          >
            收件箱{unreadCount > 0 ? ` (${unreadCount})` : ''}
          </button>
          <button
            type="button"
            role="tab"
            aria-selected={mailbox === 'sent'}
            class={`mail__toolbar-mailbox${mailbox === 'sent' ? ' mail__toolbar-mailbox--active' : ''}`}
            onClick={() => {
              setMailbox('sent')
              clearStackedDetail()
            }}
          >
            已发送
          </button>
        </div>
        <span class="mail__toolbar-title">
          {mailbox === 'inbox' ? '收件箱' : '已发送'}
        </span>
        <span class="mail__toolbar-spacer" />
      </header>

      <div class="mail__body">
        <aside class="mail__sidebar">
          <button
            type="button"
            class={`mail__mailbox${mailbox === 'inbox' ? ' mail__mailbox--active' : ''}`}
            onClick={() => {
              setMailbox('inbox')
              clearStackedDetail()
            }}
          >
            <span>收件箱</span>
            {unreadCount > 0 && <span class="mail__mailbox-count">{unreadCount}</span>}
          </button>
          <button
            type="button"
            class={`mail__mailbox${mailbox === 'sent' ? ' mail__mailbox--active' : ''}`}
            onClick={() => {
              setMailbox('sent')
              clearStackedDetail()
            }}
          >
            <span>已发送</span>
          </button>
        </aside>

        <section class="mail__list-pane">
          <div class="mail__thread-list">
            {threads.length === 0 ? (
              <div class="mail__thread-empty">没有邮件</div>
            ) : (
              threads.map((thread) => (
                <button
                  key={thread.id}
                  type="button"
                  class={`mail__thread-row${thread.id === selectedThreadId ? ' mail__thread-row--selected' : ''}${thread.unread && mailbox === 'inbox' ? ' mail__thread-row--unread' : ''}`}
                  onClick={() => handleSelectThread(thread.id)}
                >
                  <div class="mail__thread-row-top">
                    <span class="mail__thread-sender">
                      {collapseInlineWhitespace(senderLabel(store, thread))}
                    </span>
                    <span class="mail__thread-date">{formatMailListDate(thread.lastMessageAt)}</span>
                  </div>
                  <span class="mail__thread-subject">{collapseInlineWhitespace(thread.subject)}</span>
                  <span class="mail__thread-preview">{previewText(thread)}</span>
                </button>
              ))
            )}
          </div>
        </section>

        <section class="mail__detail-pane">
          {selectedThread ? (
            <>
              <header class="mail__detail-header">
                <div class="mail__detail-header-top">
                  <h1 class="mail__detail-subject">
                    {collapseInlineWhitespace(selectedThread.subject)}
                  </h1>
                  <button
                    type="button"
                    class="mail__detail-delete"
                    aria-label="删除对话"
                    title="删除对话"
                    onClick={() => requestDeleteThread(selectedThread.id, selectedThread.subject)}
                  >
                    <TrashIcon />
                  </button>
                </div>
                <div class="mail__detail-meta">
                  {selectedThread.messages.length > 0 && (
                    <>
                      <span>
                        发件人：<strong>{formatMailAddress(selectedThread.messages[0].from)}</strong>
                      </span>
                      <span>
                        收件人：
                        <strong>
                          {selectedThread.messages[0].to.map((address) => formatMailAddress(address)).join('、')}
                        </strong>
                      </span>
                    </>
                  )}
                </div>
              </header>

              <div class="mail__messages">
                {selectedThread.messages.map((message) => (
                  <article key={message.id} class="mail__message">
                    <div class="mail__message-header">
                      <span class="mail__message-from">
                        {isFromUser(store, message) ? '我' : message.from.name}
                      </span>
                      <div class="mail__message-header-end">
                        <time class="mail__message-date" dateTime={new Date(message.sentAt).toISOString()}>
                          {formatMailDetailDate(message.sentAt)}
                        </time>
                        <button
                          type="button"
                          class="mail__message-delete"
                          aria-label="删除此消息"
                          title="删除此消息"
                          onClick={() => requestDeleteMessage(selectedThread.id, message.id)}
                        >
                          <TrashIcon />
                        </button>
                      </div>
                    </div>
                    <p class="mail__message-body">{formatMailBodyForDisplay(message.body)}</p>
                  </article>
                ))}
              </div>

              {replyingThreadIds.has(selectedThread.id) && (
                <div class="mail__typing">
                  <div class="mail__typing-dots" aria-hidden="true">
                    <span />
                    <span />
                    <span />
                  </div>
                  <span>对方正在输入…</span>
                </div>
              )}

              <div class="mail__reply">
                <label class="mail__reply-label" for="mail-reply-input">
                  回复
                </label>
                <textarea
                  id="mail-reply-input"
                  class="mail__reply-input"
                  placeholder="输入回复内容…"
                  value={replyDraft}
                  onInput={(event) => setReplyDraft((event.target as HTMLTextAreaElement).value)}
                  onKeyDown={(event) => {
                    if (event.key === 'Enter' && (event.metaKey || event.ctrlKey)) {
                      event.preventDefault()
                      void handleSendReply()
                    }
                  }}
                />
                <div class="mail__reply-actions">
                  <button
                    type="button"
                    class="mail__btn mail__btn--primary"
                    onClick={() => void handleSendReply()}
                    disabled={!replyDraft.trim() || sending}
                  >
                    发送
                  </button>
                </div>
              </div>
            </>
          ) : (
            <div class="mail__detail-empty">
              <span class="mail__detail-empty-icon" aria-hidden="true">
                ✉️
              </span>
              <span>选择一封邮件以阅读</span>
            </div>
          )}
        </section>

      </div>

      {composeOpen && (
        <MailComposeSheet
          userEmail={store.userAddress.email}
          onClose={() => setComposeOpen(false)}
          onSend={(payload) => void handleComposeSend(payload)}
          sending={sending}
        />
      )}

      {pendingDelete && (
        <MailDeleteConfirmSheet
          target={pendingDelete}
          onCancel={() => setPendingDelete(undefined)}
          onConfirm={handleConfirmDelete}
        />
      )}
    </div>
  )
}

function ComposeIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 16 16" aria-hidden="true">
      <path
        d="M2 11.5V14h2.5L12 6.5 9.5 4 2 11.5z"
        fill="currentColor"
      />
      <path
        d="M11 3.5l1.5 1.5"
        stroke="currentColor"
        stroke-width="1.5"
        stroke-linecap="round"
      />
    </svg>
  )
}

function TrashIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 14 14" aria-hidden="true">
      <path
        d="M5 1.5h4L8.5 2H10v1H4V2h1.5L5 1.5zM4 4.5h6v7.5a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1V4.5z"
        fill="currentColor"
      />
    </svg>
  )
}
