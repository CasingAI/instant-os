export type NewsArticle = {
  id: string
  editionDate: string
  title: string
  category: string
  lead: string
  body: string
  source?: string
  /** 列表展示顺序，数值越小越靠前 */
  listPosition?: number
}

export type NewsComment = {
  id: string
  author: string
  body: string
  createdAt: number
  likes: number
  dislikes: number
  /** 回复目标评论 id；顶层评论无此字段 */
  parentId?: string
  isUser?: boolean
}

export type NewsCommentThread = {
  articleId: string
  generatedAt: number
  comments: NewsComment[]
  /** 用户对评论的点赞/点踩 */
  userReactions: Record<string, 'like' | 'dislike'>
  /** @deprecated 旧版仅隐藏；读取时会迁移为删除 */
  reportedIds?: string[]
  /** 用户通过举报删除的评论次数 */
  userReportCount?: number
}

export type NewsStore = {
  articles: NewsArticle[]
  commentThreads: Record<string, NewsCommentThread>
}

export type GeneratedCommentDraft = {
  author: string
  body: string
  likes?: number
  dislikes?: number
  /** 回复哪条顶层评论：从 0 起算，只计顶层评论顺序 */
  parentIndex?: number
  /** 楼中楼正在回复哪位网友，用于「回复 @某某」 */
  replyTo?: string
}

export type GeneratedReplyDraft = {
  author: string
  body: string
  likes?: number
  dislikes?: number
  /** 用户这条回复获得的虚构点赞数 */
  userLikes?: number
  /** 用户这条回复获得的虚构点踩数 */
  userDislikes?: number
  /** 是否反驳、与用户立场相反 */
  argumentative?: boolean
}

export type UserCommentEngagement = {
  likes: number
  dislikes: number
}

export type UserReplyGenerationResult = {
  userEngagement: UserCommentEngagement
  aiReply?: NewsComment
}

export type UserTopCommentGenerationResult = {
  userEngagement: UserCommentEngagement
  replies: NewsComment[]
}

export type GeneratedTopCommentReplyDraft = {
  author: string
  body: string
  likes?: number
  dislikes?: number
  replyTo?: string
}

export type GeneratedUserTopCommentResponse = {
  userLikes?: number
  userDislikes?: number
  replies?: GeneratedTopCommentReplyDraft[]
}

export type NewsGenerationContext = {
  targetDate: string
  nearbyTitles: string
}

export type GeneratedArticleDraft = {
  title: string
  category: string
  lead: string
  body: string
  source?: string
}