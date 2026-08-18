import {
  calendarInstantToMs,
  formatEditionDateLabel as formatEditionDateLabelFromCalendar,
  parseEditionDateKey,
} from '../../os/calendar-instant.ts'
import { formatChineseDynastySuffixForEditionDate } from '../../os/chinese-dynasty-label.ts'
import { osNowMs } from '../../os/os-clock.ts'
import { createRegistryStore } from '../../os/registry-store.ts'
import type { NewsArticle, NewsComment, NewsCommentThread, NewsStore } from './news-types.ts'

function emptyStore(): NewsStore {
  return { articles: [], commentThreads: {} }
}

function normalizeArticles(value: unknown): NewsArticle[] {
  if (!Array.isArray(value)) {
    return []
  }
  return value.filter(isArticleLike)
}

function isArticleLike(value: unknown): value is NewsArticle {
  if (typeof value !== 'object' || value === undefined) {
    return false
  }
  const article = value as Record<string, unknown>
  return (
    typeof article.id === 'string' &&
    typeof article.editionDate === 'string' &&
    typeof article.title === 'string' &&
    typeof article.category === 'string' &&
    typeof article.lead === 'string' &&
    typeof article.body === 'string'
  )
}

function normalizeCommentThreads(value: unknown): NewsStore['commentThreads'] {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    return {}
  }
  const commentThreads: NewsStore['commentThreads'] = {}
  for (const [articleId, thread] of Object.entries(value as Record<string, unknown>)) {
    const normalized = normalizeThread(thread)
    if (normalized) {
      commentThreads[articleId] = normalized
    }
  }
  return migrateCommentThreads({ articles: [], commentThreads }).commentThreads
}

function isThreadLike(value: unknown): value is NewsCommentThread {
  if (typeof value !== 'object' || value === undefined) {
    return false
  }
  const thread = value as Record<string, unknown>
  return (
    typeof thread.articleId === 'string' &&
    typeof thread.generatedAt === 'number' &&
    Array.isArray(thread.comments) &&
    typeof thread.userReactions === 'object' &&
    thread.userReactions !== null
  )
}

function normalizeThread(value: unknown): NewsCommentThread | undefined {
  if (!isThreadLike(value)) {
    return undefined
  }
  const thread = value as Record<string, unknown>
  const userReactions: NewsCommentThread['userReactions'] = {}
  if (thread.userReactions && typeof thread.userReactions === 'object') {
    for (const [commentId, reaction] of Object.entries(
      thread.userReactions as Record<string, unknown>,
    )) {
      if (reaction === 'like' || reaction === 'dislike') {
        userReactions[commentId] = reaction
      }
    }
  }
  return {
    articleId: thread.articleId as string,
    generatedAt: thread.generatedAt as number,
    comments: (thread.comments as unknown[]).filter(isCommentLike),
    userReactions,
    reportedIds: Array.isArray(thread.reportedIds) ? (thread.reportedIds as string[]) : [],
    userReportCount:
      typeof thread.userReportCount === 'number' ? thread.userReportCount : undefined,
  }
}

function isCommentLike(value: unknown): value is NewsComment {
  if (typeof value !== 'object' || value === undefined) {
    return false
  }
  const comment = value as Record<string, unknown>
  return (
    typeof comment.id === 'string' &&
    typeof comment.author === 'string' &&
    typeof comment.body === 'string' &&
    typeof comment.createdAt === 'number' &&
    typeof comment.likes === 'number' &&
    typeof comment.dislikes === 'number'
  )
}

const registryStore = createRegistryStore<NewsStore>({
  appId: 'news',
  defaultValue: emptyStore,
  legacyKey: 'store',
  fields: [
    {
      key: 'articles',
      read: (store) => store.articles,
      write: (value, draft) => ({ ...draft, articles: value }),
      serialize: (value) => JSON.stringify(value),
      deserialize: (raw) => {
        if (!raw) {
          return []
        }
        try {
          return normalizeArticles(JSON.parse(raw))
        } catch {
          return []
        }
      },
    },
    {
      key: 'commentThreads',
      read: (store) => store.commentThreads,
      write: (value, draft) => ({ ...draft, commentThreads: value }),
      serialize: (value) => JSON.stringify(value),
      deserialize: (raw) => {
        if (!raw) {
          return {}
        }
        try {
          return normalizeCommentThreads(JSON.parse(raw))
        } catch {
          return {}
        }
      },
    },
  ],
  changedEventName: 'instant-os:news-store-changed',
})

export function subscribeNewsStore(listener: () => void): () => void {
  return registryStore.subscribe(listener)
}

export async function readNewsStore(): Promise<NewsStore> {
  return registryStore.read()
}

export async function writeNewsStore(store: NewsStore): Promise<void> {
  await registryStore.write(store)
}

export function createArticleId(): string {
  return `news-${osNowMs()}-${Math.random().toString(36).slice(2, 10)}`
}

export function formatEditionDateLabel(editionDate: string): string {
  return formatEditionDateLabelFromCalendar(editionDate)
}

export function formatEditionDateDetailLabel(editionDate: string): string {
  const base = formatEditionDateLabelFromCalendar(editionDate)
  const suffix = formatChineseDynastySuffixForEditionDate(editionDate)
  return suffix ? `${base}${suffix}` : base
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

export async function assignArticleListPositions(
  store: NewsStore,
  editionDate: string,
  newArticleIdsInOrder: string[],
  baselineArticleIds: string[],
): Promise<NewsStore> {
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
  await writeNewsStore(next)
  return next
}

export function getAllEditionDates(store: NewsStore): string[] {
  const set = new Set(store.articles.map((a) => a.editionDate))
  return Array.from(set).sort((a, b) => (a < b ? 1 : a > b ? -1 : 0))
}

export async function addArticles(store: NewsStore, articles: NewsArticle[]): Promise<NewsStore> {
  const next: NewsStore = {
    articles: [...store.articles, ...articles],
    commentThreads: store.commentThreads,
  }
  await writeNewsStore(next)
  return next
}

export async function deleteArticle(store: NewsStore, articleId: string): Promise<NewsStore> {
  const { [articleId]: _removed, ...remainingThreads } = store.commentThreads
  const next: NewsStore = {
    articles: store.articles.filter((a) => a.id !== articleId),
    commentThreads: remainingThreads,
  }
  await writeNewsStore(next)
  return next
}

export async function deleteArticlesForDate(store: NewsStore, editionDate: string): Promise<NewsStore> {
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
  await writeNewsStore(next)
  return next
}

export function getCommentThread(
  store: NewsStore,
  articleId: string,
): NewsCommentThread | undefined {
  return store.commentThreads[articleId]
}

export async function saveCommentThread(
  store: NewsStore,
  thread: NewsCommentThread,
): Promise<NewsStore> {
  const next: NewsStore = {
    ...store,
    commentThreads: {
      ...store.commentThreads,
      [thread.articleId]: thread,
    },
  }
  await writeNewsStore(next)
  return next
}

export async function deleteCommentThread(store: NewsStore, articleId: string): Promise<NewsStore> {
  const { [articleId]: _removed, ...remainingThreads } = store.commentThreads
  const next: NewsStore = {
    ...store,
    commentThreads: remainingThreads,
  }
  await writeNewsStore(next)
  return next
}

export async function clearAllCommentThreads(store: NewsStore): Promise<NewsStore> {
  const next: NewsStore = {
    ...store,
    commentThreads: {},
  }
  await writeNewsStore(next)
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

export async function setUserReaction(
  store: NewsStore,
  articleId: string,
  commentId: string,
  reaction: 'like' | 'dislike' | undefined,
): Promise<NewsStore> {
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

export async function removeCommentFromThread(
  store: NewsStore,
  articleId: string,
  commentId: string,
): Promise<NewsStore> {
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

export async function updateCommentInThread(
  store: NewsStore,
  articleId: string,
  commentId: string,
  patch: Partial<Pick<NewsComment, 'likes' | 'dislikes'>>,
): Promise<NewsStore> {
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

export async function appendComments(
  store: NewsStore,
  articleId: string,
  newComments: NewsComment[],
): Promise<NewsStore> {
  const existing = store.commentThreads[articleId]
  if (!existing) {
    return saveCommentThread(store, {
      articleId,
      generatedAt: osNowMs(),
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
  return calendarInstantToMs(parseEditionDateKey(editionDate))
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
