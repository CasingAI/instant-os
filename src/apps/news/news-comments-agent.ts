import { parseJsonFromAiText } from '../../ai/parse-json-response.ts'
import { osNowMs } from '../../os/os-clock.ts'
import { createNdjsonLineFeed, parseNdjsonLine } from '../../ai/parse-streaming-json.ts'
import { streamChatCompletion } from '../../ai/stream-chat.ts'
import { mergeOpenAiConfig } from '../../ai/openai-config.ts'
import {
  buildLiveTokenUsageAsync,
  estimatePromptTokensAsync,
  prepareTokenEstimation,
  type LiveTokenUsage,
} from '../browser/estimate-token-usage.ts'
import {
  flattenCommentsToTwoLevels,
  formatReplyBody,
  getRootTopLevelId,
  commentsByIdMap,
} from './news-comment-layout.ts'
import { recordNewsTokenUsage } from './news-token-usage.ts'
import { describeEditionDateForPrompt } from './news-agent.ts'
import type {
  GeneratedCommentDraft,
  GeneratedReplyDraft,
  GeneratedTopCommentReplyDraft,
  GeneratedUserTopCommentResponse,
  NewsArticle,
  NewsComment,
  UserCommentEngagement,
  UserReplyGenerationResult,
  UserTopCommentGenerationResult,
} from './news-types.ts'

const TOP_COMMENT_EXAMPLE = JSON.stringify({
  author: '路过网友',
  body: '这报道一看就是洗地，信的人脑子呢？',
  likes: 234,
  dislikes: 12,
})

const REPLY_COMMENT_EXAMPLE = JSON.stringify({
  author: '理中客本客',
  body: '回复 @路过网友：急什么，报道写得挺清楚，不爱看别看',
  likes: 89,
  dislikes: 34,
  parentIndex: 0,
  replyTo: '路过网友',
})

const GENERATE_COMMENTS_PROMPT = `你是新闻评论区 AI 生成器。
所有评论均为虚构，模拟中文新闻/舆论场下的两级评论区——热闹、对立、火药味十足，绝不是温和理性的讨论。

## 版面日期（极其重要）
- 用户消息会给出该新闻所属版面日期、相对真实世界的时间取向及时代约束；把该日期当作绝对「现在」
- 评论语气、用词、传播载体与争论方式须贴合该历史阶段：古代可用市井议论、邸抄跟帖口吻；近代可用报馆读者来信；当代才可用微博/哔哩哔哩式网评；未来版面可用更超前但仍内洽的网民口吻
- 若时间取向为「未来」：评论里也不要把早于版面年份的年份当成「还没发生」；时态须与新闻正文一致
- **严禁**在远古/近代新闻下出现手机、短视频、AI、当代明星梗等不合时宜的互联网黑话

任务：针对给定新闻，生成两级评论区（顶层评论 + 楼中楼），类似微博/哔哩哔哩：
- 第一层：顶层评论
- 第二层：全部平铺在对应顶层评论下方，不再嵌套更深层级
- 楼中楼回复某人时，正文必须以「回复 @网名：」开头（replyTo 字段填被 @ 的网名）

必须采用 NDJSON 格式：每行一个完整 JSON 对象，不要数组包裹，不要 markdown，不要解释。

顶层评论每行格式：${TOP_COMMENT_EXAMPLE}
楼中楼每行格式：${REPLY_COMMENT_EXAMPLE}（必须带 parentIndex 和 replyTo）

字段：
- author：中文网名
- body：评论正文；楼中楼必须以「回复 @某某：」开头
- likes / dislikes：虚构整数
- parentIndex：仅楼中楼需要。指向顶层评论的序号（从 0 开始，只数顶层评论，不含楼中楼）
- replyTo：仅楼中楼需要。正在回复哪位网友的 author

要求：
- 合计 10~20 条：约 4~6 条顶层评论，其余为楼中楼
- 每条顶层下 1~4 条楼中楼即可，网友互相反驳、站队、抬杠
- 楼中楼可以回复顶层作者，也可以回复同楼里的其他人，但 parentIndex 始终指向所属顶层评论
- 语气要冲，可讽刺嘲讽，但不要脏话、不要涉政敏感、不要暴力血腥
- 内容必须与新闻主题相关
- 逐行输出，生成完一行立刻输出下一行`

const REPLY_PROMPT = `你是新闻评论区 AI。
用户刚回复了一条评论。你需要：
1. 虚构围观网友对用户这条回复的点赞/点踩数
2. 以原评论作者或其他围观网友身份写楼中楼回复，大概率（约 80%）继续反驳、质疑、阴阳怪气

必须只返回 JSON 对象，不要 markdown，不要解释。格式：
{
  "userLikes": 45,
  "userDislikes": 12,
  "author": "网名",
  "body": "回复 @我：回复正文，10~70字",
  "likes": 12,
  "dislikes": 3,
  "argumentative": true
}

要求：
- userLikes / userDislikes：用户刚发的回复获得的赞踩，像发出来几分钟后的数据（一般个位数到一百多）；争议大可两边都高
- body 必须以「回复 @某某：」开头
- argumentative 为 true 表示反驳，false 表示附和；优先 true
- 不要脏话、不要涉政敏感
- 回复语气须与新闻版面日期的时代一致（见用户消息中的时代约束）`

const USER_ENGAGEMENT_PROMPT = `你是新闻评论区数据生成器。
根据用户刚发表的评论内容，虚构围观网友的点赞/点踩数，像真实评论区刚发布几分钟后的样子。

必须只返回 JSON 对象，不要 markdown，不要解释。格式：
{"userLikes": 34, "userDislikes": 6}

要求：
- userLikes：整数，通常 3~150
- userDislikes：整数，通常 0~80
- 语气冲、争议大的评论赞踩都可以偏高`

const USER_TOP_COMMENT_PROMPT = `你是新闻评论区 AI。
用户刚发了一条顶层评论（主楼），网名显示为「我」。你需要：
1. 虚构该评论的点赞/点踩数
2. 生成 2~4 条楼中楼回复，网友来反驳、质疑、阴阳怪气或少数附和

必须只返回 JSON 对象，不要 markdown，不要解释。格式：
{
  "userLikes": 56,
  "userDislikes": 9,
  "replies": [
    {
      "author": "路过网友",
      "body": "回复 @我：就这？",
      "likes": 23,
      "dislikes": 4,
      "replyTo": "我"
    }
  ]
}

要求：
- replies 数组 2~4 条，全部挂在这层主楼下
- body 必须以「回复 @某某：」开头；多数回复 @我，也可楼中楼互怼（回复 @其他网友）
- 语气要冲、像真实评论区，但不要脏话、不要涉政敏感
- 内容与新闻主题及用户评论相关；用语须贴合版面日期的时代（见用户消息）`

const MIN_COMMENTS = 8
const MAX_COMMENTS = 22

function createCommentId(): string {
  return `comment-${osNowMs()}-${Math.random().toString(36).slice(2, 10)}`
}

function normalizeDraft(
  raw: GeneratedCommentDraft,
  parentId?: string,
  isUser = false,
): NewsComment {
  return {
    id: createCommentId(),
    author: raw.author?.trim() || '匿名网友',
    body: raw.body?.trim() || '……',
    createdAt: osNowMs(),
    likes: Math.max(0, Math.floor(raw.likes ?? Math.random() * 80 + 5)),
    dislikes: Math.max(0, Math.floor(raw.dislikes ?? Math.random() * 20)),
    parentId,
    isUser,
  }
}

type DraftWithParent = GeneratedCommentDraft & { parentIndex?: number; replyTo?: string }

type EmitContext = {
  seenBodies: Set<string>
  topLevelIds: string[]
  comments: NewsComment[]
  onComment: (comment: NewsComment) => void
}

function emitDraft(draft: DraftWithParent, ctx: EmitContext): void {
  const body = draft.body?.trim()
  if (!body || ctx.seenBodies.has(body)) {
    return
  }

  let parentId: string | undefined
  if (draft.parentIndex !== undefined) {
    parentId = ctx.topLevelIds[draft.parentIndex]
    if (!parentId && ctx.topLevelIds.length > 0) {
      parentId = ctx.topLevelIds[ctx.topLevelIds.length - 1]
    }
  }

  const finalBody =
    parentId && draft.replyTo
      ? formatReplyBody(body, draft.replyTo.trim())
      : parentId
        ? body
        : body

  ctx.seenBodies.add(finalBody)
  const comment = normalizeDraft({ ...draft, body: finalBody }, parentId)
  ctx.comments.push(comment)
  if (!parentId) {
    ctx.topLevelIds.push(comment.id)
  }
  ctx.onComment(comment)
}

function emitDrafts(drafts: DraftWithParent[], ctx: EmitContext): void {
  for (const draft of drafts) {
    emitDraft(draft, ctx)
  }
}

function draftsToComments(
  drafts: DraftWithParent[],
  onComment?: (comment: NewsComment) => void,
): NewsComment[] {
  const ctx: EmitContext = {
    seenBodies: new Set(),
    topLevelIds: [],
    comments: [],
    onComment: onComment ?? (() => {}),
  }
  emitDrafts(drafts, ctx)
  return flattenCommentsToTwoLevels(ctx.comments)
}

function buildSeedDrafts(article: NewsArticle): DraftWithParent[] {
  return [
    { author: '朝阳群众', body: '笑死，这标题党吧？点进来就这？', likes: 412, dislikes: 23 },
    {
      author: '理中客本客',
      body: '回复 @朝阳群众：急什么，报道写得挺清楚，不爱看别看',
      likes: 198,
      dislikes: 67,
      parentIndex: 0,
      replyTo: '朝阳群众',
    },
    {
      author: '破防了是吧',
      body: '回复 @理中客本客：洗地党又来团建了？',
      likes: 156,
      dislikes: 41,
      parentIndex: 0,
      replyTo: '理中客本客',
    },
    { author: '本地土著', body: '我就在现场附近，跟报道说的根本两码事', likes: 521, dislikes: 19 },
    {
      author: '杠精本精',
      body: '回复 @本地土著：张口就来，证据呢？',
      likes: 167,
      dislikes: 88,
      parentIndex: 1,
      replyTo: '本地土著',
    },
    {
      author: '本地土著',
      body: '回复 @杠精本精：爱信不信，反正我亲眼看见的',
      likes: 203,
      dislikes: 31,
      parentIndex: 1,
      replyTo: '杠精本精',
    },
    { author: '键盘侠007', body: '媒体就会带节奏，真相永远在最后', likes: 445, dislikes: 33 },
    {
      author: '反杠联盟',
      body: '回复 @键盘侠007：你自己不也在带节奏？',
      likes: 212,
      dislikes: 44,
      parentIndex: 2,
      replyTo: '键盘侠007',
    },
    { author: '路过围观', body: '评论区比正文精彩，已收藏', likes: 278, dislikes: 12 },
    {
      author: '较真星人',
      body: `回复 @路过围观：「${article.source ?? '媒体'}」的话你们也信？`,
      likes: 201,
      dislikes: 56,
      parentIndex: 3,
      replyTo: '路过围观',
    },
    { author: '佛系青年', body: '吵半天有啥用，该干嘛干嘛', likes: 88, dislikes: 102 },
    {
      author: '暴躁老哥',
      body: '回复 @佛系青年：这种事不发声等着被割？',
      likes: 233,
      dislikes: 27,
      parentIndex: 4,
      replyTo: '佛系青年',
    },
    {
      author: '阴谋论小能手',
      body: '回复 @暴躁老哥：重点明明是报道里没提的那一段',
      likes: 167,
      dislikes: 38,
      parentIndex: 4,
      replyTo: '暴躁老哥',
    },
    { author: '打工人A', body: '吃瓜归吃瓜，明天还得早起搬砖', likes: 167, dislikes: 6 },
    {
      author: 'HR姐姐',
      body: '回复 @打工人A：这种新闻少转工作群，小心被谈话',
      likes: 189,
      dislikes: 14,
      parentIndex: 5,
      replyTo: '打工人A',
    },
  ]
}

function buildSeedComments(article: NewsArticle): NewsComment[] {
  return draftsToComments(buildSeedDrafts(article))
}

function trimCommentCount(comments: NewsComment[], max = 20): NewsComment[] {
  if (comments.length <= max) {
    return comments
  }

  const topLevel = comments.filter((comment) => !comment.parentId)
  const keptTop = topLevel.slice(0, 6)
  const keptTopIds = new Set(keptTop.map((comment) => comment.id))
  const replies = comments.filter(
    (comment) => comment.parentId && keptTopIds.has(comment.parentId),
  )
  const keptReplies = replies.slice(0, max - keptTop.length)
  return flattenCommentsToTwoLevels([...keptTop, ...keptReplies])
}

async function recordEstimatedUsage(
  kind: 'comment' | 'reply',
  system: string,
  user: string,
  output: string,
): Promise<void> {
  const model = mergeOpenAiConfig().defaultModel
  await prepareTokenEstimation(model)
  const promptTokens = await estimatePromptTokensAsync(system, user, model)
  const live = await buildLiveTokenUsageAsync(promptTokens, output, true, model)
  recordNewsTokenUsage(kind, {
    promptTokens: live.promptTokens,
    completionTokens: live.completionTokens,
    totalTokens: live.totalTokens,
  })
}

export type CommentGenerationProgress = {
  comments: NewsComment[]
  streaming: boolean
}

function buildArticleContextBlock(article: NewsArticle): string {
  return [
    describeEditionDateForPrompt(article.editionDate),
    '',
    `新闻标题：${article.title}`,
    `分类：${article.category}`,
    `来源：${article.source ?? '即时新闻'}`,
    `导语：${article.lead}`,
    '',
    '正文：',
    article.body,
  ].join('\n')
}

export async function generateCommentsForArticleStreaming(
  article: NewsArticle,
  onComment: (comment: NewsComment) => void,
): Promise<NewsComment[]> {
  const userMessage = `${buildArticleContextBlock(article)}

请生成 10~20 条两级评论区（顶层 + 楼中楼，楼中楼用回复 @某人）。评论须贴合上述版面日期与时代约束。`

  const ctx: EmitContext = {
    seenBodies: new Set(),
    topLevelIds: [],
    comments: [],
    onComment: (comment) => {
      onComment(comment)
    },
  }

  const feed = createNdjsonLineFeed((line) => {
    try {
      const raw = parseNdjsonLine<DraftWithParent>(line)
      emitDraft(raw, ctx)
    } catch {
      // 忽略尚未完整的行
    }
  })

  try {
    const text = await streamChatCompletion({
      system: GENERATE_COMMENTS_PROMPT,
      user: userMessage,
      usageContext: { actor: 'news', behavior: 'comment-gen', behaviorLabel: '生成评论' },
      onChunk: (delta) => {
        feed.push(delta)
      },
    })
    feed.flush()

    if (ctx.comments.length < MIN_COMMENTS) {
      for (const line of text.split('\n')) {
        const trimmed = line.trim()
        if (!trimmed.startsWith('{')) {
          continue
        }
        try {
          const raw = parseNdjsonLine<DraftWithParent>(trimmed)
          emitDraft(raw, ctx)
        } catch {
          // 忽略无法解析的行
        }
      }
    }

    if (ctx.comments.length < MIN_COMMENTS) {
      const drafts = parseJsonFromAiText<DraftWithParent[]>(text)
      if (Array.isArray(drafts)) {
        emitDrafts(drafts, ctx)
      }
    }

    let comments = flattenCommentsToTwoLevels(ctx.comments)
    comments = trimCommentCount(comments, MAX_COMMENTS)

    if (comments.length < MIN_COMMENTS) {
      throw new Error('too few comments')
    }

    await recordEstimatedUsage('comment', GENERATE_COMMENTS_PROMPT, userMessage, text)
    return comments
  } catch {
    const seeds = buildSeedComments(article)
    for (const comment of seeds) {
      onComment(comment)
    }
    await recordEstimatedUsage('comment', GENERATE_COMMENTS_PROMPT, userMessage, JSON.stringify(seeds))
    return seeds
  }
}

function parseUserEngagement(
  raw: { userLikes?: number; userDislikes?: number },
  fallbackControversial = false,
): UserCommentEngagement {
  if (raw.userLikes !== undefined || raw.userDislikes !== undefined) {
    return {
      likes: Math.max(0, Math.floor(raw.userLikes ?? 0)),
      dislikes: Math.max(0, Math.floor(raw.userDislikes ?? 0)),
    }
  }
  return rollFallbackUserEngagement(fallbackControversial)
}

function rollFallbackUserEngagement(controversial = false): UserCommentEngagement {
  if (controversial) {
    return {
      likes: Math.floor(Math.random() * 90 + 8),
      dislikes: Math.floor(Math.random() * 55 + 5),
    }
  }
  return {
    likes: Math.floor(Math.random() * 45 + 3),
    dislikes: Math.floor(Math.random() * 18),
  }
}

function normalizeTopCommentReplies(
  drafts: GeneratedTopCommentReplyDraft[],
  parentId: string,
  seenBodies: Set<string>,
): NewsComment[] {
  const replies: NewsComment[] = []
  for (const draft of drafts) {
    const replyTo = draft.replyTo?.trim() || '我'
    const body = formatReplyBody(draft.body?.trim() || '……', replyTo)
    if (seenBodies.has(body)) {
      continue
    }
    seenBodies.add(body)
    replies.push(normalizeDraft({ ...draft, body }, parentId))
  }
  return replies
}

function buildFallbackRepliesToUserTopComment(parentId: string): NewsComment[] {
  const drafts: GeneratedTopCommentReplyDraft[] = [
    {
      author: '路过网友',
      body: '回复 @我：就这？',
      likes: 34,
      dislikes: 6,
      replyTo: '我',
    },
    {
      author: '杠精本精',
      body: '回复 @我：张口就来，证据呢？',
      likes: 21,
      dislikes: 11,
      replyTo: '我',
    },
    {
      author: '吃瓜不嫌事大',
      body: '回复 @杠精本精：人家就发个评论，你急啥',
      likes: 18,
      dislikes: 4,
      replyTo: '杠精本精',
    },
  ]
  return normalizeTopCommentReplies(drafts, parentId, new Set())
}

export async function generateRepliesToUserTopComment(
  article: NewsArticle,
  userCommentId: string,
  userBody: string,
): Promise<UserTopCommentGenerationResult> {
  const userMessage = `${buildArticleContextBlock(article)}

用户主楼评论：
${userBody}

请生成赞踩数据及楼中楼回复。`

  try {
    const text = await streamChatCompletion({
      system: USER_TOP_COMMENT_PROMPT,
      user: userMessage,
      usageContext: { actor: 'news', behavior: 'comment-gen', behaviorLabel: '生成评论' },
      onChunk: () => {},
    })

    const raw = parseJsonFromAiText<GeneratedUserTopCommentResponse>(text)
    const userEngagement = parseUserEngagement(raw, true)
    const replies = normalizeTopCommentReplies(raw.replies ?? [], userCommentId, new Set())

    if (replies.length === 0) {
      throw new Error('no replies')
    }

    await recordEstimatedUsage('reply', USER_TOP_COMMENT_PROMPT, userMessage, text)
    return { userEngagement, replies }
  } catch {
    const userEngagement = rollFallbackUserEngagement(true)
    const replies = buildFallbackRepliesToUserTopComment(userCommentId)
    await recordEstimatedUsage('reply', USER_TOP_COMMENT_PROMPT, userMessage, JSON.stringify({ userEngagement, replies }))
    return { userEngagement, replies }
  }
}

export async function generateUserCommentEngagement(
  article: NewsArticle,
  userBody: string,
): Promise<UserCommentEngagement> {
  const userMessage = `${describeEditionDateForPrompt(article.editionDate)}

新闻标题：${article.title}

用户发表的顶层评论：
${userBody}

请生成该评论的赞踩数据。`

  try {
    const text = await streamChatCompletion({
      system: USER_ENGAGEMENT_PROMPT,
      user: userMessage,
      usageContext: { actor: 'news', behavior: 'reply-gen', behaviorLabel: '生成回复' },
      onChunk: () => {},
    })
    const raw = parseJsonFromAiText<{ userLikes?: number; userDislikes?: number }>(text)
    const engagement = parseUserEngagement(raw)
    await recordEstimatedUsage('reply', USER_ENGAGEMENT_PROMPT, userMessage, text)
    return engagement
  } catch {
    const engagement = rollFallbackUserEngagement()
    await recordEstimatedUsage('reply', USER_ENGAGEMENT_PROMPT, userMessage, JSON.stringify(engagement))
    return engagement
  }
}

export async function generateReplyToUser(
  article: NewsArticle,
  parentComment: NewsComment,
  userReplyBody: string,
  allComments: NewsComment[],
): Promise<UserReplyGenerationResult> {
  const byId = commentsByIdMap(allComments)
  const rootId = getRootTopLevelId(parentComment, byId)

  const context = allComments
    .slice(-8)
    .map((c) => `${c.author}：${c.body}`)
    .join('\n')

  const userMessage = `${describeEditionDateForPrompt(article.editionDate)}

新闻标题：${article.title}

被回复的评论（${parentComment.author}）：${parentComment.body}

用户回复：${userReplyBody}

近期评论：
${context || '（无）'}

请生成用户回复的赞踩数据，以及 AI 楼中楼回复。`

  try {
    const text = await streamChatCompletion({
      system: REPLY_PROMPT,
      user: userMessage,
      usageContext: { actor: 'news', behavior: 'reply-gen', behaviorLabel: '生成回复' },
      onChunk: () => {},
    })

    const raw = parseJsonFromAiText<GeneratedReplyDraft>(text)
    const userEngagement = parseUserEngagement(raw, true)
    const argumentative = raw.argumentative !== false

    if (!argumentative && Math.random() > 0.2) {
      await recordEstimatedUsage('reply', REPLY_PROMPT, userMessage, text)
      return { userEngagement }
    }

    const body = formatReplyBody(raw.body?.trim() || '……', '我')
    const aiReply = normalizeDraft({ ...raw, body }, rootId)
    await recordEstimatedUsage('reply', REPLY_PROMPT, userMessage, text)
    return { userEngagement, aiReply }
  } catch {
    const userEngagement = rollFallbackUserEngagement(true)
    const fallbackBodies = [
      '回复 @我：就你这逻辑？建议重开吧',
      '回复 @我：急了急了，说不过就开始扣帽子了？',
      '回复 @我：笑死，你回复了个寂寞，论点呢？',
      '回复 @我：行行行，你说的都对，行了吧',
    ]
    const body = fallbackBodies[Math.floor(Math.random() * fallbackBodies.length)]
    await recordEstimatedUsage('reply', REPLY_PROMPT, userMessage, body)
    return {
      userEngagement,
      aiReply: normalizeDraft(
        {
          author: parentComment.author,
          body,
          likes: Math.floor(Math.random() * 40 + 3),
          dislikes: Math.floor(Math.random() * 15),
        },
        rootId,
      ),
    }
  }
}

export async function buildLiveCommentTokenUsage(
  system: string,
  user: string,
  output: string,
): Promise<LiveTokenUsage> {
  const model = mergeOpenAiConfig().defaultModel
  await prepareTokenEstimation(model)
  const promptTokens = await estimatePromptTokensAsync(system, user, model)
  return buildLiveTokenUsageAsync(promptTokens, output, true, model)
}
