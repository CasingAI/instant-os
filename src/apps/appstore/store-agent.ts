import { parseJsonFromAiText } from '../../ai/parse-json-response.ts'
import {
  createNdjsonLineFeed,
  extractPartialObjectFields,
  parseNdjsonLine,
} from '../../ai/parse-streaming-json.ts'
import { streamChatCompletion } from '../../ai/stream-chat.ts'
import type { GeneratedAppRecord, StoreListing, StoreListingDetail, StoreReview } from './types.ts'
import { DEFAULT_APP_VERSION, normalizeAppVersion } from './app-version.ts'
import { ensureListingTags } from './listing-tags.ts'
import { appCapabilityTagsForPrompt } from './app-capability-tags.ts'

const LISTING_FIELDS = {
  slug: '英文小写连字符 id，如 daily-quotes',
  name: '中文应用名',
  description: '一句话描述，30字以内',
  category: '分类，如 工具/娱乐/生活/效率/创意',
  iconEmoji: '一个 emoji 作为图标',
  themeColor: '十六进制主题色，如 #4a90e2',
  tags: `能力标签数组，2~4 个，只能从白名单选取：${appCapabilityTagsForPrompt()}；3D 类必须含 3d`,
} as const

const LISTING_LINE_EXAMPLE = JSON.stringify({
  slug: 'daily-quotes',
  name: '每日一言',
  description: '每天一句灵感语录',
  category: '生活',
  iconEmoji: '💬',
  themeColor: '#4a90e2',
  tags: ['utility', 'creative', 'interactive'],
})

const STORE_CURATOR_PROMPT = `你是 Instant OS 应用集市的策展 AI。
Instant OS 是一个 iOS 6 风格的网页桌面操作系统，用户可以在其中安装轻量微应用。

你的任务：根据用户提示，现场生成一批应用集市列表条目（不是真实存在的应用，而是创意微应用概念）。
只需生成列表卡片展示所需的最基本信息，不要生成详情页内容。

必须采用 NDJSON 格式：每行一个完整 JSON 对象，不要数组包裹，不要 markdown，不要解释。
每行格式：${LISTING_LINE_EXAMPLE}

字段说明：${JSON.stringify(LISTING_FIELDS)}

要求：
- 每次生成 6 个互不重复、有创意的微应用，逐行输出
- slug 必须唯一、URL 安全
- 每个应用必须包含 tags 数组，至少 2 个标签；3D 类应用 tags 必须含 3d
- 应用应适合在 320~860px 宽的窗口中运行
- 生成完一个就立刻输出一行，不要等全部完成再输出`

const STORE_SEARCHER_PROMPT = `你是 Instant OS 应用集市的搜索 AI。
Instant OS 是一个 iOS 6 风格的网页桌面操作系统，用户可以在其中安装轻量微应用。

用户会输入搜索关键词，你需要现场想象并生成与之相关的应用集市搜索结果（不是真实存在的应用，而是创意微应用概念）。
只需生成列表卡片展示所需的最基本信息。

必须采用 NDJSON 格式：每行一个完整 JSON 对象，不要数组包裹，不要 markdown，不要解释。
每行格式：${LISTING_LINE_EXAMPLE}

要求：
- 每次生成 4~8 个与搜索词相关、有创意的微应用，逐行输出
- slug 必须唯一、URL 安全
- 每个应用必须包含 tags 数组，至少 2 个标签；搜索词含 3D/三维/立体 时 tags 必须含 3d
- 结果应贴合用户搜索意图，可以发挥想象力
- 生成完一个就立刻输出一行，不要等全部完成再输出`

const LISTING_DETAIL_PROMPT = `你是 Instant OS 应用集市的详情页撰写 AI。
Instant OS 是一个 iOS 6 风格的网页桌面操作系统，用户可以在其中安装轻量微应用。

用户会提供一个应用的基本信息，你需要为这个微应用概念撰写完整的应用集市详情页内容。

必须只返回 JSON 对象，不要 markdown，不要解释。格式：
{
  "tagline": "一句吸引人的副标题，15~25字",
  "longDescription": "2~3 段详细介绍，共 120~200 字，描述应用功能、使用场景和亮点",
  "developer": "虚构开发者名称",
  "compatibility": "兼容性说明，如 Instant OS 1.0 及以上",
  "language": "支持语言，如 简体中文、English"
}

要求：
- 内容应与提供的基本信息一致，并在此基础上展开想象
- 语气专业、像真实的应用集市详情页
- 强调这是适合在 320~860px 宽窗口中使用的轻量微应用
- 按字段顺序输出：先 tagline，再 longDescription，再 developer、compatibility、language`

const DETAIL_FIELDS = [
  'tagline',
  'longDescription',
  'developer',
  'compatibility',
  'language',
] as const

const REVIEW_LINE_EXAMPLE = JSON.stringify({
  author: '程序员小王',
  rating: 5,
  body: '界面简洁，功能齐全，日常用起来很顺手。',
  version: 'V1',
})

const LISTING_REVIEWS_PROMPT = `你是 Instant OS 应用集市的评论撰写 AI。
Instant OS 是一个 iOS 6 风格的网页桌面操作系统，用户可以在其中安装轻量微应用。

用户会提供一个应用的基本信息，你需要为这个微应用概念撰写 4~6 条虚构的用户评论，像真实应用集市评论区一样。

必须采用 NDJSON 格式：每行一个完整 JSON 对象，不要数组包裹，不要 markdown，不要解释。
每行格式：${REVIEW_LINE_EXAMPLE}

字段说明：
- author：中文昵称
- rating：1~5 的整数星级
- body：评论正文，20~60 字
- version：固定写 "V1"（针对尚未安装的概念版）

要求：
- 评论口吻自然，有褒有建议，但整体偏正面
- 内容应与应用名称、描述和分类相关
- 生成完一条就立刻输出一行，不要等全部完成再输出`

export async function generateStoreListingsStreaming(
  onListing: (listing: StoreListing) => void,
  topic?: string,
): Promise<StoreListing[]> {
  const hint = topic?.trim() || '生成一批适合 Instant OS 的创意微应用'
  return streamListings(STORE_CURATOR_PROMPT, hint, onListing, topic?.trim())
}

export async function searchStoreListingsStreaming(
  query: string,
  onListing: (listing: StoreListing) => void,
): Promise<StoreListing[]> {
  const trimmed = query.trim()
  if (!trimmed) {
    throw new Error('请输入搜索关键词')
  }

  return streamListings(STORE_SEARCHER_PROMPT, `搜索：${trimmed}`, onListing, trimmed)
}

export async function generateListingDetailStreaming(
  listing: StoreListing,
  onUpdate: (partial: Partial<StoreListingDetail>) => void,
): Promise<StoreListingDetail> {
  const input = JSON.stringify({
    slug: listing.slug,
    name: listing.name,
    description: listing.description,
    category: listing.category,
    iconEmoji: listing.iconEmoji,
    themeColor: listing.themeColor,
  })

  const text = await streamChatCompletion({
    system: LISTING_DETAIL_PROMPT,
    user: input,
    onChunk: (_delta, accumulated) => {
      const partial = extractPartialObjectFields<StoreListingDetail>(accumulated, DETAIL_FIELDS)
      if (Object.keys(partial).length > 0) {
        onUpdate(partial)
      }
    },
  })

  const detail = parseJsonFromAiText<StoreListingDetail>(text)
  const normalized = normalizeDetail(detail)
  onUpdate(normalized)
  return normalized
}

export async function generateListingReviewsStreaming(
  listing: StoreListing,
  onReview: (review: StoreReview) => void,
): Promise<StoreReview[]> {
  const input = JSON.stringify({
    slug: listing.slug,
    name: listing.name,
    description: listing.description,
    category: listing.category,
  })

  const reviews: StoreReview[] = []
  const seenBodies = new Set<string>()
  const feed = createNdjsonLineFeed((line) => {
    try {
      const raw = parseNdjsonLine<Omit<StoreReview, 'id' | 'createdAt'>>(line)
      const review = normalizeGeneratedReview(raw)
      if (seenBodies.has(review.body)) {
        return
      }
      seenBodies.add(review.body)
      reviews.push(review)
      onReview(review)
    } catch {
      // 忽略尚未完整的行
    }
  })

  const text = await streamChatCompletion({
    system: LISTING_REVIEWS_PROMPT,
    user: input,
    onChunk: (delta) => {
      feed.push(delta)
    },
  })

  feed.flush()

  if (reviews.length === 0) {
    const fallback = parseJsonFromAiText<Omit<StoreReview, 'id' | 'createdAt'>[]>(text)
    if (!Array.isArray(fallback) || fallback.length === 0) {
      throw new Error('AI 未返回有效的评论')
    }

    for (const raw of fallback) {
      const review = normalizeGeneratedReview(raw)
      if (seenBodies.has(review.body)) {
        continue
      }
      seenBodies.add(review.body)
      reviews.push(review)
      onReview(review)
    }
  }

  return reviews
}

async function streamListings(
  system: string,
  user: string,
  onListing: (listing: StoreListing) => void,
  tagHint?: string,
): Promise<StoreListing[]> {
  const listings: StoreListing[] = []
  const seenSlugs = new Set<string>()
  const feed = createNdjsonLineFeed((line) => {
    try {
      const raw = parseNdjsonLine<StoreListing>(line)
      const listing = normalizeListing(raw, tagHint)
      if (seenSlugs.has(listing.slug)) {
        return
      }
      seenSlugs.add(listing.slug)
      listings.push(listing)
      onListing(listing)
    } catch {
      // 忽略尚未完整的行
    }
  })

  const text = await streamChatCompletion({
    system,
    user,
    onChunk: (delta) => {
      feed.push(delta)
    },
  })

  feed.flush()

  if (listings.length === 0) {
    const fallback = parseJsonFromAiText<StoreListing[]>(text)
    if (!Array.isArray(fallback) || fallback.length === 0) {
      throw new Error('AI 未返回有效的应用列表')
    }

    for (const raw of fallback) {
      const listing = normalizeListing(raw, tagHint)
      if (seenSlugs.has(listing.slug)) {
        continue
      }
      seenSlugs.add(listing.slug)
      listings.push(listing)
      onListing(listing)
    }
  }

  return listings
}

function normalizeDetail(raw: StoreListingDetail): StoreListingDetail {
  return {
    tagline: raw.tagline.trim(),
    longDescription: raw.longDescription.trim(),
    developer: raw.developer.trim(),
    compatibility: raw.compatibility.trim(),
    language: raw.language.trim(),
  }
}

function normalizeGeneratedReview(
  raw: Omit<StoreReview, 'id' | 'createdAt'>,
): StoreReview {
  const rating = Math.max(1, Math.min(5, Math.round(Number(raw.rating) || 5)))
  const body = raw.body.trim()
  return {
    id: `ai-${body.slice(0, 24).replace(/\s+/g, '-')}-${rating}`,
    author: raw.author.trim() || 'Instant 用户',
    rating,
    body,
    version: normalizeAppVersion(raw.version || DEFAULT_APP_VERSION),
    createdAt: Date.now(),
  }
}

function normalizeListing(raw: StoreListing, tagHint?: string): StoreListing {
  const base = {
    slug: raw.slug.trim().toLowerCase().replace(/[^a-z0-9-]/g, '-').replace(/-+/g, '-'),
    name: raw.name.trim(),
    description: raw.description.trim(),
    category: raw.category.trim(),
    iconEmoji: raw.iconEmoji.trim(),
    themeColor: raw.themeColor.trim(),
    tags: raw.tags,
  }

  return {
    ...base,
    tags: ensureListingTags(base, tagHint),
  }
}

export function toGeneratedAppId(slug: string): `gen:${string}` {
  return `gen:${slug}`
}

export function generatedAppIdToSlug(appId: `gen:${string}`): string {
  return appId.slice(4)
}

export function recordToStoreListing(app: GeneratedAppRecord): StoreListing {
  return {
    slug: generatedAppIdToSlug(app.id),
    name: app.name,
    description: app.description,
    category: app.category,
    iconEmoji: app.iconEmoji,
    themeColor: app.themeColor,
    tags: app.tags ?? ensureListingTags(app),
  }
}
