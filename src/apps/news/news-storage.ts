import {
  DEVICE_STORAGE_KEYS,
  getLocalStorageKeyBytes,
  writeLocalStorageItem,
} from '../../os/device-storage.ts'
import type { NewsArticle, NewsComment, NewsCommentThread, NewsStore } from './news-types.ts'

const STORAGE_KEY = DEVICE_STORAGE_KEYS.news

function emptyStore(): NewsStore {
  return { articles: [], commentThreads: {} }
}

function loadStore(): NewsStore {
  try {
    const raw = localStorage.getItem(STORAGE_KEY)
    if (!raw) {
      return emptyStore()
    }
    const parsed = JSON.parse(raw) as NewsStore
    if (!Array.isArray(parsed.articles)) {
      return emptyStore()
    }
    return migrateCommentThreads({
      articles: parsed.articles,
      commentThreads: parsed.commentThreads ?? {},
    })
  } catch {
    return emptyStore()
  }
}

function saveStore(store: NewsStore): boolean {
  const ok = writeLocalStorageItem(STORAGE_KEY, JSON.stringify(store))
  if (ok && typeof window !== 'undefined') {
    window.dispatchEvent(new CustomEvent('instant-os:news-store-changed'))
  }
  return ok
}

export function readNewsStore(): NewsStore {
  return loadStore()
}

export function writeNewsStore(store: NewsStore): boolean {
  return saveStore(store)
}

export function createArticleId(): string {
  return `news-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`
}

export function formatEditionDateLabel(editionDate: string): string {
  const date = new Date(`${editionDate}T00:00:00`)
  if (Number.isNaN(date.getTime())) {
    return editionDate
  }
  return date.toLocaleDateString('zh-CN', {
    year: 'numeric',
    month: 'long',
    day: 'numeric',
    weekday: 'short',
  })
}

function getArticleCreatedAt(id: string): number {
  const m = /^news-(\d+)-/.exec(id)
  return m ? Number(m[1]) : 0
}

function getArticleListPosition(article: NewsArticle): number {
  return article.listPosition ?? getArticleCreatedAt(article.id)
}

export function getArticlesForDate(store: NewsStore, editionDate: string): NewsArticle[] {
  return store.articles
    .filter((a) => a.editionDate === editionDate)
    .sort((a, b) => {
      const pa = getArticleListPosition(a)
      const pb = getArticleListPosition(b)
      if (pa !== pb) return pa - pb
      return a.title.localeCompare(b.title, 'zh-CN')
    })
}

export function assignArticleListPositions(
  store: NewsStore,
  editionDate: string,
  newArticleIdsInOrder: string[],
  baselineArticleIds: string[],
): NewsStore {
  if (newArticleIdsInOrder.length === 0) {
    return store
  }

  const baselineSet = new Set(baselineArticleIds)
  const baselineDay = store.articles.filter(
    (article) => article.editionDate === editionDate && baselineSet.has(article.id),
  )
  const minPos =
    baselineDay.length > 0
      ? Math.min(...baselineDay.map((article) => getArticleListPosition(article)))
      : 0
  const startPos = baselineDay.length > 0 ? minPos - newArticleIdsInOrder.length : 0

  const positionById = new Map<string, number>()
  newArticleIdsInOrder.forEach((id, index) => {
    positionById.set(id, startPos + index)
  })

  const next: NewsStore = {
    articles: store.articles.map((article) => {
      const nextPos = positionById.get(article.id)
      if (nextPos === undefined) {
        return article
      }
      return { ...article, listPosition: nextPos }
    }),
    commentThreads: store.commentThreads,
  }
  saveStore(next)
  return next
}

export function getAllEditionDates(store: NewsStore): string[] {
  const set = new Set(store.articles.map((a) => a.editionDate))
  return Array.from(set).sort((a, b) => (a < b ? 1 : a > b ? -1 : 0))
}

export function addArticles(store: NewsStore, articles: NewsArticle[]): NewsStore {
  const next: NewsStore = {
    articles: [...store.articles, ...articles],
    commentThreads: store.commentThreads,
  }
  saveStore(next)
  return next
}

export function deleteArticle(store: NewsStore, articleId: string): NewsStore {
  const { [articleId]: _removed, ...remainingThreads } = store.commentThreads
  const next: NewsStore = {
    articles: store.articles.filter((a) => a.id !== articleId),
    commentThreads: remainingThreads,
  }
  saveStore(next)
  return next
}

export function deleteArticlesForDate(store: NewsStore, editionDate: string): NewsStore {
  const removedIds = new Set(
    store.articles.filter((a) => a.editionDate === editionDate).map((a) => a.id),
  )
  const commentThreads: Record<string, NewsCommentThread> = {}
  for (const [id, thread] of Object.entries(store.commentThreads)) {
    if (!removedIds.has(id)) {
      commentThreads[id] = thread
    }
  }
  const next: NewsStore = {
    articles: store.articles.filter((a) => a.editionDate !== editionDate),
    commentThreads,
  }
  saveStore(next)
  return next
}

export function getNewsStorageBytes(): number {
  return (
    getLocalStorageKeyBytes(STORAGE_KEY) +
    getLocalStorageKeyBytes(DEVICE_STORAGE_KEYS.newsTokenUsage)
  )
}

export function getCommentThread(
  store: NewsStore,
  articleId: string,
): NewsCommentThread | undefined {
  return store.commentThreads[articleId]
}

export function saveCommentThread(
  store: NewsStore,
  thread: NewsCommentThread,
): NewsStore {
  const next: NewsStore = {
    ...store,
    commentThreads: {
      ...store.commentThreads,
      [thread.articleId]: thread,
    },
  }
  saveStore(next)
  return next
}

export function deleteCommentThread(store: NewsStore, articleId: string): NewsStore {
  const { [articleId]: _removed, ...remainingThreads } = store.commentThreads
  const next: NewsStore = {
    ...store,
    commentThreads: remainingThreads,
  }
  saveStore(next)
  return next
}

export function clearAllCommentThreads(store: NewsStore): NewsStore {
  const next: NewsStore = {
    ...store,
    commentThreads: {},
  }
  saveStore(next)
  return next
}

export type NewsCommentStats = {
  threadCount: number
  totalComments: number
  userComments: number
  reportedCount: number
  totalLikes: number
  totalDislikes: number
}

function migrateCommentThreads(store: NewsStore): NewsStore {
  let changed = false
  const commentThreads: NewsStore['commentThreads'] = {}

  for (const [articleId, thread] of Object.entries(store.commentThreads)) {
    const legacyReported = thread.reportedIds ?? []
    if (legacyReported.length === 0) {
      commentThreads[articleId] = thread
      continue
    }

    const hidden = new Set(legacyReported)
    const comments = thread.comments.filter((comment) => !hidden.has(comment.id))
    const userReactions = { ...thread.userReactions }
    for (const id of legacyReported) {
      delete userReactions[id]
    }

    commentThreads[articleId] = {
      ...thread,
      comments,
      userReactions,
      reportedIds: [],
      userReportCount: (thread.userReportCount ?? 0) + legacyReported.length,
    }
    changed = true
  }

  if (!changed) {
    return store
  }
  saveStore({ ...store, commentThreads })
  return { ...store, commentThreads }
}

export function getNewsCommentStats(store: NewsStore): NewsCommentStats {
  let threadCount = 0
  let totalComments = 0
  let userComments = 0
  let reportedCount = 0
  let totalLikes = 0
  let totalDislikes = 0

  for (const thread of Object.values(store.commentThreads)) {
    threadCount += 1
    reportedCount += thread.userReportCount ?? 0
    for (const comment of thread.comments) {
      totalComments += 1
      if (comment.isUser) {
        userComments += 1
      }
      totalLikes += comment.likes
      totalDislikes += comment.dislikes
    }
  }

  return {
    threadCount,
    totalComments,
    userComments,
    reportedCount,
    totalLikes,
    totalDislikes,
  }
}

export function getCommentCountForArticle(store: NewsStore, articleId: string): number {
  return store.commentThreads[articleId]?.comments.length ?? 0
}

export function setUserReaction(
  store: NewsStore,
  articleId: string,
  commentId: string,
  reaction: 'like' | 'dislike' | undefined,
): NewsStore {
  const thread = store.commentThreads[articleId]
  if (!thread) {
    return store
  }

  const prev = thread.userReactions[commentId]
  const comments = thread.comments.map((comment) => {
    if (comment.id !== commentId) {
      return comment
    }
    let likes = comment.likes
    let dislikes = comment.dislikes
    if (prev === 'like') {
      likes -= 1
    } else if (prev === 'dislike') {
      dislikes -= 1
    }
    if (reaction === 'like') {
      likes += 1
    } else if (reaction === 'dislike') {
      dislikes += 1
    }
    return {
      ...comment,
      likes: Math.max(0, likes),
      dislikes: Math.max(0, dislikes),
    }
  })

  const userReactions = { ...thread.userReactions }
  if (reaction === undefined) {
    delete userReactions[commentId]
  } else {
    userReactions[commentId] = reaction
  }

  return saveCommentThread(store, {
    ...thread,
    comments,
    userReactions,
  })
}

export function removeCommentFromThread(
  store: NewsStore,
  articleId: string,
  commentId: string,
): NewsStore {
  const thread = store.commentThreads[articleId]
  if (!thread) {
    return store
  }

  const target = thread.comments.find((comment) => comment.id === commentId)
  if (!target) {
    return store
  }

  const idsToRemove = new Set<string>([commentId])
  if (!target.parentId) {
    for (const comment of thread.comments) {
      if (comment.parentId === commentId) {
        idsToRemove.add(comment.id)
      }
    }
  }

  const comments = thread.comments.filter((comment) => !idsToRemove.has(comment.id))
  const userReactions = { ...thread.userReactions }
  for (const id of idsToRemove) {
    delete userReactions[id]
  }

  return saveCommentThread(store, {
    ...thread,
    comments,
    userReactions,
    reportedIds: [],
    userReportCount: (thread.userReportCount ?? 0) + 1,
  })
}

export function updateCommentInThread(
  store: NewsStore,
  articleId: string,
  commentId: string,
  patch: Partial<Pick<NewsComment, 'likes' | 'dislikes'>>,
): NewsStore {
  const thread = store.commentThreads[articleId]
  if (!thread) {
    return store
  }

  const comments = thread.comments.map((comment) =>
    comment.id === commentId ? { ...comment, ...patch } : comment,
  )

  return saveCommentThread(store, {
    ...thread,
    comments,
  })
}

export function appendComments(
  store: NewsStore,
  articleId: string,
  newComments: NewsComment[],
): NewsStore {
  const existing = store.commentThreads[articleId]
  if (!existing) {
    return saveCommentThread(store, {
      articleId,
      generatedAt: Date.now(),
      comments: newComments,
      userReactions: {},
      reportedIds: [],
    })
  }
  return saveCommentThread(store, {
    ...existing,
    comments: [...existing.comments, ...newComments],
  })
}

function parseDateToNumber(editionDate: string): number {
  const t = Date.parse(`${editionDate}T00:00:00`)
  return Number.isNaN(t) ? 0 : t
}

export function buildNearbyTitlesContext(
  store: NewsStore,
  targetDate: string,
  maxDaysEachDirection = 10,
): string {
  const byDate = new Map<string, NewsArticle[]>()
  for (const art of store.articles) {
    if (!byDate.has(art.editionDate)) byDate.set(art.editionDate, [])
    byDate.get(art.editionDate)!.push(art)
  }

  const allDates = Array.from(byDate.keys()).sort((a, b) => parseDateToNumber(a) - parseDateToNumber(b))

  if (allDates.length === 0) {
    return ''
  }

  const targetTime = parseDateToNumber(targetDate)
  const index = allDates.findIndex((d) => d === targetDate)
  let prevDates: string[] = []
  let nextDates: string[] = []

  if (index >= 0) {
    prevDates = allDates.slice(Math.max(0, index - maxDaysEachDirection), index)
    nextDates = allDates.slice(index + 1, index + 1 + maxDaysEachDirection)
  } else {
    let inserted = false
    const prev: string[] = []
    const next: string[] = []
    for (const d of allDates) {
      const t = parseDateToNumber(d)
      if (t < targetTime) {
        prev.push(d)
      } else if (t > targetTime && !inserted) {
        inserted = true
        next.push(d)
      } else if (t > targetTime) {
        next.push(d)
      }
    }
    prevDates = prev.slice(-maxDaysEachDirection)
    nextDates = next.slice(0, maxDaysEachDirection)
  }

  const lines: string[] = []
  for (const d of prevDates) {
    const titles = (byDate.get(d) ?? []).map((a) => a.title).join('；')
    lines.push(`${d}：${titles}`)
  }
  for (const d of nextDates) {
    const titles = (byDate.get(d) ?? []).map((a) => a.title).join('；')
    lines.push(`${d}：${titles}`)
  }
  return lines.join('\n')
}