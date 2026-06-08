import { useCallback, useEffect, useMemo, useRef, useState } from 'preact/hooks'
import {
  appendComments,
  deleteCommentThread,
  getCommentThread,
  readNewsStore,
  removeCommentFromThread,
  saveCommentThread,
  setUserReaction,
  updateCommentInThread,
} from './news-storage.ts'
import { NewsCommentReportSheet } from './news-comment-report-sheet.tsx'
import {
  buildVisibleTwoLevelComments,
  flattenCommentsToTwoLevels,
  formatReplyBody,
  getRootTopLevelId,
  commentsByIdMap,
  type VisibleComment,
} from './news-comment-layout.ts'
import {
  generateCommentsForArticleStreaming,
  generateRepliesToUserTopComment,
  generateReplyToUser,
} from './news-comments-agent.ts'
import type { NewsArticle, NewsComment, NewsCommentThread, NewsStore } from './news-types.ts'

type NewsCommentsSectionProps = {
  article: NewsArticle
  store: NewsStore
  onStoreChange: (store: NewsStore) => void
}

function createCommentId(): string {
  return `comment-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`
}

function formatCount(value: number): string {
  if (value >= 10_000) {
    return `${(value / 10_000).toFixed(1)}万`
  }
  return value.toLocaleString('zh-CN')
}

function isStalePartialThread(thread: NewsCommentThread): boolean {
  if (thread.comments.length > 2) {
    return false
  }
  if (thread.comments.some((comment) => comment.isUser)) {
    return false
  }
  if (Object.keys(thread.userReactions).length > 0) {
    return false
  }
  return true
}

function countParticipants(thread: NewsCommentThread): number {
  const authors = new Set(thread.comments.map((comment) => comment.author))
  return authors.size
}

type CommentRowProps = {
  comment: VisibleComment
  userReaction: 'like' | 'dislike' | undefined
  replying: boolean
  replyBusy: boolean
  onLike: () => void
  onDislike: () => void
  onReport: () => void
  onReplyToggle: () => void
  onReplySubmit: (body: string) => void
}

function CommentRow({
  comment,
  userReaction,
  replying,
  replyBusy,
  onLike,
  onDislike,
  onReport,
  onReplyToggle,
  onReplySubmit,
}: CommentRowProps) {
  const [draft, setDraft] = useState('')

  useEffect(() => {
    if (!replying) {
      setDraft('')
    }
  }, [replying])

  return (
    <article
      class={`news-comment${comment.depth > 0 ? ' news-comment--reply' : ''}${comment.isUser ? ' news-comment--user' : ''}`}
    >
      <div class="news-comment__head">
        <span class="news-comment__author">{comment.isUser ? '我' : comment.author}</span>
        {comment.depth === 0 && comment.likes + comment.dislikes > 200 && (
          <span class="news-comment__hot">热评</span>
        )}
      </div>
      <p class="news-comment__body">{comment.body}</p>
      <div class="news-comment__actions">
        <button
          type="button"
          class={`news-comment__vote${userReaction === 'like' ? ' news-comment__vote--active' : ''}`}
          onClick={onLike}
          aria-pressed={userReaction === 'like'}
        >
          👍 {formatCount(comment.likes)}
        </button>
        <button
          type="button"
          class={`news-comment__vote${userReaction === 'dislike' ? ' news-comment__vote--active' : ''}`}
          onClick={onDislike}
          aria-pressed={userReaction === 'dislike'}
        >
          👎 {formatCount(comment.dislikes)}
        </button>
        <button type="button" class="news-comment__action" onClick={onReplyToggle}>
          回复
        </button>
        <button type="button" class="news-comment__action news-comment__action--report" onClick={onReport}>
          举报
        </button>
      </div>

      {replying && (
        <form
          class="news-comment__reply-form"
          onSubmit={(event) => {
            event.preventDefault()
            const body = draft.trim()
            if (!body || replyBusy) {
              return
            }
            onReplySubmit(body)
            setDraft('')
          }}
        >
          <textarea
            class="news-comment__reply-input"
            rows={2}
            placeholder="写下你的回复…"
            value={draft}
            onInput={(event) => setDraft((event.currentTarget as HTMLTextAreaElement).value)}
            disabled={replyBusy}
          />
          <div class="news-comment__reply-actions">
            <button type="button" class="news-comment__reply-cancel" onClick={onReplyToggle} disabled={replyBusy}>
              取消
            </button>
            <button type="submit" class="news-comment__reply-send" disabled={replyBusy || !draft.trim()}>
              {replyBusy ? '发送中…' : '发送'}
            </button>
          </div>
        </form>
      )}
    </article>
  )
}

export function NewsCommentsSection({ article, store, onStoreChange }: NewsCommentsSectionProps) {
  const [generating, setGenerating] = useState(false)
  const [pendingComments, setPendingComments] = useState<NewsComment[]>([])
  const [replyingToId, setReplyingToId] = useState<string | undefined>()
  const [replyBusy, setReplyBusy] = useState(false)
  const [composeDraft, setComposeDraft] = useState('')
  const [composeBusy, setComposeBusy] = useState(false)
  const [reportTargetId, setReportTargetId] = useState<string | undefined>()
  const inflightRef = useRef<string | undefined>()

  const savedThread = useMemo(() => getCommentThread(store, article.id), [store, article.id])

  const thread = useMemo((): NewsCommentThread | undefined => {
    if (savedThread) {
      return savedThread
    }
    if (pendingComments.length === 0) {
      return undefined
    }
    return {
      articleId: article.id,
      generatedAt: Date.now(),
      comments: pendingComments,
      userReactions: {},
      reportedIds: [],
    }
  }, [article.id, pendingComments, savedThread])

  const visibleComments = useMemo(
    () => (thread ? buildVisibleTwoLevelComments(thread) : []),
    [thread],
  )

  const stats = useMemo(() => {
    if (!thread) {
      return { total: 0, participants: 0 }
    }
    return {
      total: thread.comments.length,
      participants: countParticipants(thread),
    }
  }, [thread])

  useEffect(() => {
    if (savedThread && isStalePartialThread(savedThread)) {
      if (inflightRef.current !== article.id) {
        onStoreChange(deleteCommentThread(readNewsStore(), article.id))
      }
      return
    }

    if (savedThread) {
      setPendingComments([])
      return
    }

    if (inflightRef.current === article.id) {
      return
    }
    inflightRef.current = article.id

    let cancelled = false
    setGenerating(true)
    setPendingComments([])

    void generateCommentsForArticleStreaming(article, (comment) => {
      if (cancelled) {
        return
      }
      setPendingComments((current) => [...current, comment])
    })
      .then((comments) => {
        if (cancelled || comments.length === 0) {
          return
        }
        const fresh = readNewsStore()
        const flattened = flattenCommentsToTwoLevels(comments)
        const existing = getCommentThread(fresh, article.id)
        if (existing) {
          const existingIds = new Set(existing.comments.map((comment) => comment.id))
          const newComments = flattened.filter((comment) => !existingIds.has(comment.id))
          if (newComments.length > 0) {
            onStoreChange(appendComments(fresh, article.id, newComments))
          }
        } else {
          const next = saveCommentThread(fresh, {
            articleId: article.id,
            generatedAt: Date.now(),
            comments: flattened,
            userReactions: {},
            reportedIds: [],
          })
          onStoreChange(next)
        }
        setPendingComments([])
      })
      .finally(() => {
        if (inflightRef.current === article.id) {
          inflightRef.current = undefined
        }
        if (!cancelled) {
          setGenerating(false)
        }
      })

    return () => {
      cancelled = true
      if (inflightRef.current === article.id) {
        inflightRef.current = undefined
      }
      setGenerating(false)
    }
  }, [article, article.id, onStoreChange, savedThread])

  const handleReaction = useCallback(
    (commentId: string, reaction: 'like' | 'dislike') => {
      const current = getCommentThread(store, article.id)
      if (!current) {
        return
      }
      const prev = current.userReactions[commentId]
      const nextReaction = prev === reaction ? undefined : reaction
      onStoreChange(setUserReaction(store, article.id, commentId, nextReaction))
    },
    [article.id, onStoreChange, store],
  )

  const handleReportSubmit = useCallback(
    (commentId: string, _reasons: string[]) => {
      onStoreChange(removeCommentFromThread(store, article.id, commentId))
      setReportTargetId(undefined)
      if (replyingToId === commentId) {
        setReplyingToId(undefined)
      }
    },
    [article.id, onStoreChange, replyingToId, store],
  )

  const handleComposeSubmit = useCallback(
    async (body: string) => {
      const trimmed = body.trim()
      if (!trimmed || composeBusy) {
        return
      }

      setComposeBusy(true)
      const userComment: NewsComment = {
        id: createCommentId(),
        author: '我',
        body: trimmed,
        createdAt: Date.now(),
        likes: 0,
        dislikes: 0,
        isUser: true,
      }

      let next = appendComments(store, article.id, [userComment])
      onStoreChange(next)
      setComposeDraft('')

      const result = await generateRepliesToUserTopComment(article, userComment.id, trimmed)
      next = updateCommentInThread(next, article.id, userComment.id, result.userEngagement)
      next = appendComments(next, article.id, result.replies)
      onStoreChange(next)
      setComposeBusy(false)
    },
    [article, composeBusy, onStoreChange, store],
  )

  const handleReplySubmit = useCallback(
    async (parentComment: NewsComment, body: string) => {
      setReplyBusy(true)

      const currentThread = getCommentThread(store, article.id)
      const byId = commentsByIdMap(currentThread?.comments ?? [])
      const rootId = getRootTopLevelId(parentComment, byId)
      const replyToAuthor = parentComment.isUser ? '我' : parentComment.author

      const userComment: NewsComment = {
        id: createCommentId(),
        author: '我',
        body: formatReplyBody(body, replyToAuthor),
        createdAt: Date.now(),
        likes: 0,
        dislikes: 0,
        parentId: rootId,
        isUser: true,
      }

      let next = appendComments(store, article.id, [userComment])
      onStoreChange(next)
      setReplyingToId(undefined)

      const threadAfterUser = getCommentThread(next, article.id)
      if (!threadAfterUser) {
        setReplyBusy(false)
        return
      }

      const result = await generateReplyToUser(
        article,
        parentComment,
        userComment.body,
        threadAfterUser.comments,
      )

      next = updateCommentInThread(next, article.id, userComment.id, result.userEngagement)
      onStoreChange(next)

      if (result.aiReply) {
        next = appendComments(next, article.id, [result.aiReply])
        onStoreChange(next)
      }

      setReplyBusy(false)
    },
    [article, onStoreChange, store],
  )

  return (
    <section class="news-comments" aria-label="评论区">
      <header class="news-comments__head">
        <h2 class="news-comments__title">评论区</h2>
        <p class="news-comments__stats">
          {generating && visibleComments.length === 0
            ? '正在加载评论'
            : `${stats.total} 条评论 · ${stats.participants} 人参与`}
          {generating && visibleComments.length > 0 && ' · 正在加载更多评论'}
        </p>
      </header>

      <form
        class="news-comments__compose"
        onSubmit={(event) => {
          event.preventDefault()
          void handleComposeSubmit(composeDraft)
        }}
      >
        <label class="news-comments__compose-label" for={`news-compose-${article.id}`}>
          发表评论
        </label>
        <textarea
          id={`news-compose-${article.id}`}
          class="news-comments__compose-input"
          rows={3}
          placeholder="说说你的看法…"
          value={composeDraft}
          onInput={(event) => setComposeDraft((event.currentTarget as HTMLTextAreaElement).value)}
          disabled={composeBusy}
        />
        <div class="news-comments__compose-actions">
          <button
            type="submit"
            class="news-comments__compose-send"
            disabled={composeBusy || !composeDraft.trim()}
          >
            {composeBusy ? '发表中…' : '发表'}
          </button>
        </div>
      </form>

      {visibleComments.length === 0 && generating ? (
        <div class="news-comments__loading" role="status" aria-live="polite">
          <div class="news-comments__spinner" aria-hidden="true" />
          <p>正在加载评论</p>
        </div>
      ) : visibleComments.length === 0 ? (
        <p class="news-comments__empty">暂无评论</p>
      ) : (
        <div class="news-comments__list">
          {visibleComments.map((comment) => (
            <CommentRow
              key={comment.id}
              comment={comment}
              userReaction={thread?.userReactions[comment.id]}
              replying={replyingToId === comment.id}
              replyBusy={replyBusy}
              onLike={() => handleReaction(comment.id, 'like')}
              onDislike={() => handleReaction(comment.id, 'dislike')}
              onReport={() => setReportTargetId(comment.id)}
              onReplyToggle={() =>
                setReplyingToId((current) => (current === comment.id ? undefined : comment.id))
              }
              onReplySubmit={(body) => void handleReplySubmit(comment, body)}
            />
          ))}
          {generating && (
            <div class="news-comments__loading-footer" role="status" aria-live="polite">
              <div class="news-comments__spinner news-comments__spinner--small" aria-hidden="true" />
              <span>正在加载评论</span>
            </div>
          )}
        </div>
      )}
      {reportTargetId && (
        <NewsCommentReportSheet
          onCancel={() => setReportTargetId(undefined)}
          onSubmit={(reasons) => handleReportSubmit(reportTargetId, reasons)}
        />
      )}
    </section>
  )
}
