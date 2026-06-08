import type { NewsComment, NewsCommentThread } from './news-types.ts'

/** 找到某条评论所属的顶层评论 id */
export function getRootTopLevelId(
  comment: NewsComment,
  commentsById: Map<string, NewsComment>,
): string {
  if (!comment.parentId) {
    return comment.id
  }

  let current: NewsComment | undefined = comment
  while (current?.parentId) {
    const parent = commentsById.get(current.parentId)
    if (!parent || !parent.parentId) {
      return parent?.id ?? current.parentId
    }
    current = parent
  }

  return comment.id
}

/** 将评论树压平为两级：所有楼中楼都挂在顶层评论下 */
export function flattenCommentsToTwoLevels(comments: NewsComment[]): NewsComment[] {
  const byId = new Map(comments.map((comment) => [comment.id, comment]))

  return comments.map((comment) => {
    if (!comment.parentId) {
      return comment
    }
    const rootId = getRootTopLevelId(comment, byId)
    if (rootId === comment.id || rootId === comment.parentId) {
      return comment
    }
    return { ...comment, parentId: rootId }
  })
}

export function formatReplyBody(body: string, replyToAuthor: string): string {
  const trimmed = body.trim()
  if (!trimmed) {
    return trimmed
  }
  if (trimmed.includes(`@${replyToAuthor}`)) {
    return trimmed
  }
  if (trimmed.startsWith('回复')) {
    return trimmed
  }
  return `回复 @${replyToAuthor}：${trimmed}`
}

export type VisibleComment = NewsComment & {
  depth: 0 | 1
}

function compareTopLevelComments(a: NewsComment, b: NewsComment): number {
  const aIsUser = a.isUser === true
  const bIsUser = b.isUser === true
  if (aIsUser !== bIsUser) {
    return aIsUser ? -1 : 1
  }
  if (aIsUser) {
    return b.createdAt - a.createdAt
  }
  return b.likes - a.likes
}

export function buildVisibleTwoLevelComments(thread: NewsCommentThread): VisibleComment[] {
  const flattened = flattenCommentsToTwoLevels(thread.comments)

  const topLevel = flattened
    .filter((comment) => !comment.parentId)
    .sort(compareTopLevelComments)

  const result: VisibleComment[] = []
  for (const parent of topLevel) {
    result.push({ ...parent, depth: 0 })
    const replies = flattened
      .filter((comment) => comment.parentId === parent.id)
      .sort((a, b) => a.createdAt - b.createdAt)
    for (const reply of replies) {
      result.push({ ...reply, depth: 1 })
    }
  }

  return result
}

export function commentsByIdMap(comments: NewsComment[]): Map<string, NewsComment> {
  return new Map(comments.map((comment) => [comment.id, comment]))
}
