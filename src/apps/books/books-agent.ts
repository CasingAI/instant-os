import { parseJsonFromAiText } from '../../ai/parse-json-response.ts'
import { osNowMs } from '../../os/os-clock.ts'
import {
  createNdjsonLineFeed,
  extractPartialObjectFields,
  parseNdjsonLine,
} from '../../ai/parse-streaming-json.ts'
import { isStreamIdleTimeoutError, streamChatCompletion } from '../../ai/stream-chat.ts'
import type { StreamChatTurn } from '../../ai/stream-chat.ts'
import { hasOpenAiApiKey } from '../../ai/openai-config.ts'
import { dismissOsNotification, postOsNotification } from '../../os/os-notifications.ts'
import { setBookStream, clearBookStream } from '../../os/book-stream-store.ts'
import {
  appendChapterIndex,
  buildSeedChapters,
  buildSeedListings,
  createChapterId,
  findLibraryBookById,
  readBooksStore,
  updateBookInLibrary,
  writeBooksStore,
} from './books-storage.ts'
import {
  countNovelCharacters,
  deleteBookChapterRecords,
  deleteBookChapters,
  loadChapterBody,
  saveBookChapterOrThrow,
} from './books-data-storage.ts'
import {
  beginBookGeneration,
  endBookGeneration,
  isBookGenerationCancelled,
  publishBookGenerationProgress,
} from './books-generation.ts'
import type {
  BookCategory,
  BookDetail,
  BookListing,
  BookRecordMeta,
  GeneratedDetailDraft,
  GeneratedListingDraft,
} from './books-types.ts'
import { BOOK_CATEGORIES } from './books-types.ts'
import { normalizeBookCategory } from './books-genre-templates.ts'
import {
  formatGenreTemplateForPrompt,
  pickGenreTemplateForBook,
} from './books-genre-templates.ts'

const LISTING_LINE_EXAMPLE = JSON.stringify({
  slug: 'doubao-gaokao-guide',
  title: '如何让豆包推迟高考全指南',
  author: '离谱教程编辑部',
  category: '离谱指南',
  synopsis: '一本声称能教你用 AI 影响国家级考试的伪教程。',
  coverColor: '#ff9500',
  coverEmoji: '📕',
})

const SEARCH_PROMPT = `你是 Instant OS 图书城 AI 搜索助手。
Instant OS 是一个 iOS 6 拟物风格的网页桌面系统，图书 App 仿 iBooks，所有书籍均为 AI 虚构网文。

用户会输入搜索关键词，你需要现场想象并生成与之相关的虚构网文目录条目（不是真实出版的书）。
只需生成列表卡片展示所需的最基本信息。

必须采用 NDJSON 格式：每行一个完整 JSON 对象，不要数组包裹，不要 markdown，不要解释。
每行格式：${LISTING_LINE_EXAMPLE}

字段：slug（英文连字符 id）、title、author、category、synopsis（40~80字）、coverColor（十六进制）、coverEmoji（一个 emoji）

分类只能从以下选取：${BOOK_CATEGORIES.join('、')}

要求：
- 每次生成 6~10 本与搜索词相关、有创意的虚构网文，逐行输出
- slug 必须唯一、URL 安全
- 结果应贴合用户搜索意图：搜索某个题材就生成该题材的书；搜索某个人物/设定就围绕它展开；可以发挥想象力
- 标题可以很长、很野、很好笑；内容设定虚构，不涉及真实名人造谣
- 每本书的 title 与 synopsis 必须贴合其 category 的经典网文套路
- 生成完一本就立刻输出一行`

const CATALOG_PROMPT = `你是 Instant OS 图书城 AI 编辑。
Instant OS 是一个 iOS 6 拟物风格的网页桌面系统，图书 App 仿 iBooks，所有书籍均为 AI 虚构网文。

任务：生成一批原创中文书籍目录条目（不是真实出版的书）。

必须采用 NDJSON 格式：每行一个完整 JSON 对象，不要数组包裹，不要 markdown，不要解释。
每行格式：${LISTING_LINE_EXAMPLE}

字段：slug（英文连字符 id）、title、author、category、synopsis（40~80字）、coverColor（十六进制）、coverEmoji（一个 emoji）

分类只能从以下选取：${BOOK_CATEGORIES.join('、')}

要求：
- 生成 8~10 本书，逐行输出
- 每批至少覆盖 4 个不同分类
- 至少 1 本必须是「系统」类（任务面板/签到/属性加点，可与其他题材组合如末世+系统、都市+系统）
- 至少 1 本必须是「末日」类（天灾/丧尸/秩序崩塌，优先考虑囤货、空间、倒计时求生）
- 至少 2 本必须是逆天/沙雕/标题党网文风格
- 至少 1 本必须是「离谱指南」类伪教程（如：如何让豆包推迟高考全指南）
- 标题可以很长、很野、很好笑；内容设定虚构，不涉及真实名人造谣
- slug 必须唯一、URL 安全
- 每本书的 title 与 synopsis 必须贴合其 category 的经典网文套路（如系统=任务面板/签到、末日=囤货倒计时/空间、都市=赘婿逆袭、离谱指南=伪教程）
- 生成完一本就立刻输出一行`

function buildDetailPrompt(templateBlock: string): string {
  return `你是 Instant OS 图书城 AI 详情页撰写助手。
用户会提供一本书的基本信息（含书城列表里的一句话简介），请撰写详情页扩展内容。

必须只返回 JSON 对象，不要 markdown，不要解释。格式：
{
  "longSynopsis": "2~4段介绍，300~600字，网文推荐语风格，段落间用\\n\\n分隔。在列表简介基础上扩写，不要重复粘贴原句",
  "chapterOutline": ["第一章 xxx", "第二章 xxx", ... 共 4~6 章]
}

要求：风格搞笑、逆天、吸引人；chapterOutline 每章标题要有网文感，且严格对应下方套路模板的章节推进。不要生成 tagline 或副标题字段。

${templateBlock}`
}

const DETAIL_STREAM_FIELDS = ['longSynopsis'] as const

function extractPartialChapterOutline(text: string): string[] {
  const cleaned = text.replace(/^```(?:json)?\s*/i, '').replace(/\s*```\s*$/, '')
  const keyIndex = cleaned.indexOf('"chapterOutline"')
  if (keyIndex === -1) {
    return []
  }

  const bracketStart = cleaned.indexOf('[', keyIndex)
  if (bracketStart === -1) {
    return []
  }

  const items: string[] = []
  let index = bracketStart + 1

  while (index < cleaned.length) {
    while (index < cleaned.length && /[\s,]/.test(cleaned[index])) {
      index += 1
    }

    if (cleaned[index] === ']') {
      break
    }

    if (cleaned[index] !== '"') {
      break
    }

    index += 1
    let value = ''
    let escaped = false
    let closed = false

    for (; index < cleaned.length; index += 1) {
      const char = cleaned[index]

      if (escaped) {
        if (char === 'n') {
          value += '\n'
        } else if (char === 't') {
          value += '\t'
        } else {
          value += char
        }
        escaped = false
        continue
      }

      if (char === '\\') {
        escaped = true
        continue
      }

      if (char === '"') {
        closed = true
        index += 1
        break
      }

      value += char
    }

    if (!closed) {
      break
    }

    const trimmed = value.trim()
    if (trimmed) {
      items.push(trimmed)
    }
  }

  return items
}

function mergeDetailPartial(
  accumulated: string,
  partial: Partial<Pick<BookDetail, 'longSynopsis'>>,
): Partial<BookDetail> {
  const outline = extractPartialChapterOutline(accumulated)
  return {
    ...partial,
    ...(outline.length > 0 ? { chapterOutline: outline } : {}),
  }
}

async function simulateDetailStream(
  listing: BookListing,
  detail: Omit<BookDetail, 'tagline'>,
  onUpdate: (partial: Partial<BookDetail>) => void,
): Promise<void> {
  const tagline = listing.synopsis
  const synopsis = detail.longSynopsis

  onUpdate({ tagline })

  for (let length = 1; length <= synopsis.length; length += 4) {
    onUpdate({ tagline, longSynopsis: synopsis.slice(0, length) })
    await new Promise((resolve) => setTimeout(resolve, 16))
  }

  for (let count = 1; count <= detail.chapterOutline.length; count += 1) {
    onUpdate({
      tagline,
      longSynopsis: synopsis,
      chapterOutline: detail.chapterOutline.slice(0, count),
    })
    await new Promise((resolve) => setTimeout(resolve, 120))
  }
}

/** 连续收不到任何流式分片超过此时长才判定卡死（与生成总耗时无关） */
const BOOK_CHAPTER_STREAM_IDLE_MS = 300_000

const MAX_BOOK_GENERATION_ATTEMPTS = 3

function buildAllChaptersPrompt(templateBlock: string): string {
  return `你是 Instant OS 图书 App 的 AI 网文写手。
Instant OS 是 iOS 6 拟物风格桌面，所有书籍均为虚构娱乐内容。

任务：根据书籍信息与章节目录，一次性撰写全部章节正文。

必须使用 XML 格式输出，每章用 <chapter> 标签包裹。不要 markdown，不要解释，不要输出 XML 之外的任何文字。
格式示例：
<chapter index="1" title="第一章 离谱的开端">
正文第一段...

正文第二段...
</chapter>
<chapter index="2" title="第二章 事情不对劲了">
正文第二段...
</chapter>

要求：
- 严格按章节目录顺序，一次性输出所有章节
- index 从 1 开始递增，title 与目录给出的标题一致或轻微润色
- 每章正文 800~1500 字，3~6 段，段落间用空行分隔
- 严格遵循下方套路模板：落实模板中的结构节点与必备元素
- 网文口语化，梗密集，情节离谱但自洽
- 每章至少一个小爽点或笑点，章末留钩子（悬念/反转/震惊反应）
- 章节之间保持连贯，人物、情节、设定前后一致，不要把每章当成独立故事
- 对话用中文引号
- title 属性必须用英文双引号闭合，例如 title="第一章 标题"，不要用 】 或其他符号代替引号
- 不涉及真实名人、不越安全红线；可以荒诞搞笑

${templateBlock}`
}

type ParsedChapter = {
  index: number
  title: string
  body: string
}

function parseChapterOpeningAttributes(
  attrText: string,
): { index: number; title: string } | undefined {
  const indexMatch = attrText.match(/index\s*=\s*"(\d+)"/i)
  if (!indexMatch) {
    return undefined
  }

  let titleMatch = attrText.match(/title\s*=\s*"([^"]*)"/i)
  if (!titleMatch) {
    // AI 偶发把 title 结尾的 `"` 写成 `】` 或漏写 `"`/`>`
    titleMatch = attrText.match(/title\s*=\s*"([^>\n】]+)/i)
  }
  if (!titleMatch) {
    titleMatch = attrText.match(/title\s*=\s*'([^']*)'/i)
  }
  if (!titleMatch) {
    return undefined
  }

  return {
    index: Number(indexMatch[1]),
    title: titleMatch[1].trim(),
  }
}

function stripOptionalBodyWrapper(body: string): string {
  const wrapped = body.match(/^<body>([\s\S]*)<\/body>$/i)
  return wrapped ? wrapped[1].trim() : body
}

function parseChaptersFromXmlText(text: string): ParsedChapter[] {
  const byIndex = new Map<number, ParsedChapter>()
  // 不要求 `>` 紧跟属性——兼容 title 引号未闭合、缺少 `>` 的畸形开标签
  const blockRegex = /<chapter\s+([\s\S]*?)<\/chapter>/gi

  let match: RegExpExecArray | null
  while ((match = blockRegex.exec(text)) !== null) {
    const inner = match[1]
    const gtIndex = inner.indexOf('>')
    let attrText: string
    let bodyText: string

    if (gtIndex !== -1) {
      attrText = inner.slice(0, gtIndex)
      bodyText = inner.slice(gtIndex + 1)
    } else {
      const newlineIndex = inner.indexOf('\n')
      if (newlineIndex === -1) {
        continue
      }
      attrText = inner.slice(0, newlineIndex)
      bodyText = inner.slice(newlineIndex + 1)
    }

    const opening = parseChapterOpeningAttributes(attrText)
    if (!opening) {
      continue
    }

    const body = stripOptionalBodyWrapper(bodyText.trim())
    if (!body) {
      continue
    }

    byIndex.set(opening.index, {
      index: opening.index,
      title: opening.title,
      body,
    })
  }

  return [...byIndex.values()].sort((a, b) => a.index - b.index)
}

function findFirstMissingChapterIndex(
  savedIndexes: Set<number>,
  total: number,
): number | undefined {
  for (let index = 1; index <= total; index += 1) {
    if (!savedIndexes.has(index)) {
      return index
    }
  }
  return undefined
}

function extractChapterRawSnippet(fullText: string, chapterIndex: number): string | undefined {
  const pattern = new RegExp(
    `<chapter\\s+[^>]*index\\s*=\\s*"${chapterIndex}"[\\s\\S]{0,600}`,
    'i',
  )
  const match = fullText.match(pattern)
  if (!match) {
    return undefined
  }
  return match[0].trim()
}

function describeMissingChapterFailure(
  firstMissing: number,
  fullText: string,
  parsedIndexes: Set<number>,
): { reason: string; snippet?: string } {
  const snippet = extractChapterRawSnippet(fullText, firstMissing)

  if (parsedIndexes.has(firstMissing)) {
    return {
      reason: `第 ${firstMissing} 章已从 AI 输出中解析，但未能成功保存`,
      snippet,
    }
  }

  if (snippet) {
    return {
      reason: `第 ${firstMissing} 章的 XML 标签或正文无法被正确解析`,
      snippet,
    }
  }

  return {
    reason: `第 ${firstMissing} 章未在 AI 输出中出现，或输出在到达该章之前已中断`,
    snippet,
  }
}

function buildInitialChapterUserMessage(
  listing: BookListing,
  detail: BookDetail,
  total: number,
): string {
  const outlineText = detail.chapterOutline.map((title, index) => `${index + 1}. ${title}`).join('\n')
  return `书名：${listing.title}
作者：${listing.author}
分类：${listing.category}
列表简介：${listing.synopsis}
详细介绍：${detail.longSynopsis}

全书章节目录（共 ${total} 章）：
${outlineText}

请一次性撰写全部 ${total} 章，每章用 <chapter> 标签包裹。`
}

function buildContinueChapterUserMessage(
  fromChapterIndex: number,
  total: number,
  outline: string[],
  failureReason: string,
  rawSnippet?: string,
): string {
  const remainingOutline = outline
    .slice(fromChapterIndex - 1)
    .map((title, offset) => `${fromChapterIndex + offset}. ${title}`)
    .join('\n')

  const snippetBlock = rawSnippet
    ? `\n\n上次输出中第 ${fromChapterIndex} 章附近的内容（格式有问题，仅供参考，请重写）：\n${rawSnippet}`
    : ''

  return `上次生成的内容有问题：${failureReason}

请重新撰写第 ${fromChapterIndex} 章至第 ${total} 章（共 ${total - fromChapterIndex + 1} 章），仍用 <chapter index="N" title="..."> 标签包裹。

要求：
- 不要重复输出前 ${fromChapterIndex - 1} 章（这些章节已经保存成功）
- index 从 ${fromChapterIndex} 递增到 ${total}
- title 与下方目录一致或轻微润色，title 属性必须用英文双引号闭合
- 必须与前面已写章节的情节、人物、设定保持连贯

剩余章节目录：
${remainingOutline}${snippetBlock}`
}

function normalizeListing(
  raw: GeneratedListingDraft,
  index: number,
  forcedCategory?: BookCategory,
): BookListing {
  const slug =
    raw.slug?.trim().replace(/[^a-z0-9-]/gi, '-').toLowerCase() ||
    `book-${osNowMs()}-${index}`
  const category = forcedCategory ?? normalizeBookCategory(raw.category?.trim() || '脑洞')
  return {
    slug,
    title: raw.title?.trim() || '未命名奇书',
    author: raw.author?.trim() || '匿名作者',
    category,
    synopsis: raw.synopsis?.trim() || '一本来历不明的好书。',
    coverColor: raw.coverColor?.trim() || '#ff9500',
    coverEmoji: raw.coverEmoji?.trim() || '📖',
  }
}

function buildCategoryCatalogPrompt(category: BookCategory): string {
  return `${CATALOG_PROMPT}

本批次附加硬性要求：
- 生成的 6~8 本书，category 字段必须全部是「${category}」
- 不得出现其他分类
- 每本必须深度贴合「${category}」类网文经典套路与读者期待`
}

function buildSeedListingsForCategory(category: BookCategory): BookListing[] {
  const matched = buildSeedListings().filter(
    (listing) => normalizeBookCategory(listing.category) === category,
  )
  if (matched.length > 0) {
    return matched
  }

  const placeholders: BookListing[] = []
  for (let index = 0; index < 3; index += 1) {
    placeholders.push({
      slug: `${category}-preview-${osNowMs()}-${index}`,
      title: `【${category}】本地预览 ${index + 1}`,
      author: 'Instant OS 书城',
      category,
      synopsis: `「${category}」分类预览书目。配置 AI 后将自动生成该分类的完整逆天目录。`,
      coverColor: '#ff9500',
      coverEmoji: '📖',
    })
  }
  return placeholders
}

async function streamCatalogListings(
  system: string,
  user: string,
  onListing: (listing: BookListing) => void,
  forcedCategory?: BookCategory,
): Promise<BookListing[]> {
  if (!hasOpenAiApiKey()) {
    const seeds = forcedCategory ? buildSeedListingsForCategory(forcedCategory) : buildSeedListings()
    for (const listing of seeds) {
      onListing(listing)
    }
    return seeds
  }

  const listings: BookListing[] = []
  const seenSlugs = new Set<string>()
  const feed = createNdjsonLineFeed((line) => {
    try {
      const raw = parseNdjsonLine<GeneratedListingDraft>(line)
      const listing = normalizeListing(raw, listings.length, forcedCategory)
      if (seenSlugs.has(listing.slug)) {
        return
      }
      seenSlugs.add(listing.slug)
      listings.push(listing)
      onListing(listing)
    } catch {
      // ignore partial lines
    }
  })

  try {
    const text = await streamChatCompletion({
      system,
      user,
      usageContext: { actor: 'books', behavior: 'catalog-gen', behaviorLabel: '生成图书目录' },
      onChunk: (delta) => feed.push(delta),
    })
    feed.flush()

    if (listings.length === 0) {
      const drafts = parseJsonFromAiText<GeneratedListingDraft[]>(text)
      if (Array.isArray(drafts)) {
        for (const [index, raw] of drafts.entries()) {
          const listing = normalizeListing(raw, index, forcedCategory)
          if (!seenSlugs.has(listing.slug)) {
            seenSlugs.add(listing.slug)
            listings.push(listing)
            onListing(listing)
          }
        }
      }
    }

    if (listings.length === 0) {
      throw new Error('empty catalog')
    }
    return listings
  } catch {
    const seeds = forcedCategory ? buildSeedListingsForCategory(forcedCategory) : buildSeedListings()
    for (const listing of seeds) {
      onListing(listing)
    }
    return seeds
  }
}

function normalizeDetail(raw: GeneratedDetailDraft, listing: BookListing): BookDetail {
  const outline = Array.isArray(raw.chapterOutline)
    ? raw.chapterOutline.filter((item) => typeof item === 'string' && item.trim())
    : []
  return {
    tagline: listing.synopsis,
    longSynopsis: raw.longSynopsis?.trim() || '',
    chapterOutline: outline.length > 0 ? outline : ['第一章', '第二章', '第三章'],
  }
}

function withListingTagline(listing: BookListing, partial: Partial<BookDetail>): Partial<BookDetail> {
  return { ...partial, tagline: listing.synopsis }
}

function finalizeDetail(listing: BookListing, partial: Partial<BookDetail>): BookDetail {
  return {
    tagline: listing.synopsis,
    longSynopsis: partial.longSynopsis?.trim() || listing.synopsis,
    chapterOutline:
      partial.chapterOutline && partial.chapterOutline.length > 0
        ? partial.chapterOutline
        : ['第一章', '第二章', '第三章'],
  }
}

export async function generateStoreCatalogStreaming(
  onListing: (listing: BookListing) => void,
): Promise<BookListing[]> {
  return streamCatalogListings(
    CATALOG_PROMPT,
    '请生成一批图书城新书目录，风格要多搞笑、多逆天、多猎奇。',
    onListing,
  )
}

export async function generateStoreCatalogForCategoryStreaming(
  category: BookCategory,
  onListing: (listing: BookListing) => void,
): Promise<BookListing[]> {
  return streamCatalogListings(
    buildCategoryCatalogPrompt(category),
    `请专门为「${category}」分类生成一批新书目录，风格要多搞笑、多逆天，严格贴合该类型网文套路。`,
    onListing,
    category,
  )
}

export async function searchStoreCatalogStreaming(
  query: string,
  onListing: (listing: BookListing) => void,
): Promise<BookListing[]> {
  const trimmed = query.trim()
  if (!trimmed) {
    throw new Error('请输入搜索关键词')
  }
  return streamCatalogListings(
    SEARCH_PROMPT,
    `搜索：${trimmed}`,
    onListing,
  )
}

export async function generateBookDetailStreaming(
  listing: BookListing,
  onUpdate: (partial: Partial<BookDetail>) => void,
): Promise<BookDetail> {
  const emit = (partial: Partial<BookDetail>) => onUpdate(withListingTagline(listing, partial))

  emit({ tagline: listing.synopsis })

  const fallbackBody = {
    longSynopsis: listing.synopsis,
    chapterOutline: ['第一章', '第二章', '第三章'],
  }

  if (!hasOpenAiApiKey()) {
    const seedBody = {
      longSynopsis: `${listing.synopsis}\n\n（本地预览 · 配置 AI 后生成完整详情）`,
      chapterOutline: ['第一章 开篇即高潮', '第二章 事情不对劲了', '第三章 全网震惊'],
    }
    await simulateDetailStream(listing, seedBody, emit)
    const seed = finalizeDetail(listing, seedBody)
    emit(seed)
    return seed
  }

  const template = pickGenreTemplateForBook(listing.category, listing.slug)
  const templateBlock = formatGenreTemplateForPrompt(template)
  const userMessage = `书名：${listing.title}\n作者：${listing.author}\n分类：${listing.category}\n列表简介（详情页头部将直接展示此句，请勿改写）：${listing.synopsis}\n\n请按「${template.name}」套路设计 longSynopsis 与 chapterOutline。`

  try {
    const text = await streamChatCompletion({
      system: buildDetailPrompt(templateBlock),
      user: userMessage,
      usageContext: { actor: 'books', behavior: 'detail-gen', behaviorLabel: '生成图书详情' },
      onChunk: (_delta, accumulated) => {
        const stringPartial = extractPartialObjectFields<Pick<BookDetail, 'longSynopsis'>>(
          accumulated,
          DETAIL_STREAM_FIELDS,
        )
        const merged = mergeDetailPartial(accumulated, stringPartial)
        if (Object.keys(merged).length > 0) {
          emit(merged)
        }
      },
    })

    const raw = parseJsonFromAiText<GeneratedDetailDraft>(text)
    const normalized = normalizeDetail(raw, listing)
    emit(normalized)
    return normalized
  } catch {
    await simulateDetailStream(listing, fallbackBody, emit)
    const fallback = finalizeDetail(listing, fallbackBody)
    emit(fallback)
    return fallback
  }
}

export async function generateBookDetail(listing: BookListing): Promise<BookDetail> {
  return generateBookDetailStreaming(listing, () => {})
}

function extractPartialChapterBodyFromTail(tail: string): string {
  const trimmed = tail.trim()
  if (!trimmed || !/<chapter\s/i.test(trimmed)) {
    return ''
  }

  const gtIndex = trimmed.indexOf('>')
  let body: string
  if (gtIndex !== -1) {
    body = trimmed.slice(gtIndex + 1)
  } else {
    const newlineIndex = trimmed.indexOf('\n')
    if (newlineIndex === -1) {
      return ''
    }
    body = trimmed.slice(newlineIndex + 1)
  }

  return body.replace(/<\/chapter>[\s\S]*$/i, '').trim()
}

function estimateLiveCharacterCountFromXmlStream(accumulated: string): number {
  let total = 0
  for (const chapter of parseChaptersFromXmlText(accumulated)) {
    total += countNovelCharacters(chapter.body)
  }

  let lastCloseIndex = -1
  const closeRegex = /<\/chapter>/gi
  let match: RegExpExecArray | null
  while ((match = closeRegex.exec(accumulated)) !== null) {
    lastCloseIndex = match.index
  }

  const tail =
    lastCloseIndex >= 0
      ? accumulated.slice(lastCloseIndex + '</chapter>'.length)
      : accumulated
  const partialBody = extractPartialChapterBodyFromTail(tail)
  if (partialBody) {
    total += countNovelCharacters(partialBody)
  }

  return total
}

function estimateLiveChapterCharacterCount(chapterBodies: Map<number, string>): number {
  let total = 0
  for (const body of chapterBodies.values()) {
    total += countNovelCharacters(body)
  }
  return total
}


export async function generateBookChaptersStreaming(
  bookId: string,
  listing: BookListing,
  detail: BookDetail,
  onChapterSaved: (chapterIndex: number, total: number) => void,
): Promise<void> {
  beginBookGeneration(bookId)
  clearBookStream(listing.slug)
  const chapterBodies = new Map<number, string>()

  const shouldStop = async () =>
    isBookGenerationCancelled(bookId) || !findLibraryBookById(await readBooksStore(), bookId)

  const publishLiveCharacterCount = (accumulatedXml?: string) => {
    const count =
      accumulatedXml !== undefined
        ? estimateLiveCharacterCountFromXmlStream(accumulatedXml)
        : estimateLiveChapterCharacterCount(chapterBodies)
    publishBookGenerationProgress(bookId, {
      count,
      phase: 'writing',
    })
  }

  const markBookFailed = async (errorMessage?: string) => {
    const msg = errorMessage ?? '书籍下载失败，请稍后重试'
    console.error(`[books] 书籍「${listing.title}」(${bookId}) 生成失败：${msg}`)

    if (await shouldStop()) {
      return
    }
    let store = await readBooksStore()
    store = updateBookInLibrary(store, bookId, { status: 'failed' })
    await writeBooksStore(store)

    postOsNotification(
      {
        id: `book:${listing.slug}`,
        title: listing.title,
        subtitle: '生成失败',
        phase: 'failure',
        icon: {
          kind: 'tile',
          emoji: listing.coverEmoji,
          color: listing.coverColor,
        },
        body: msg,
        banner: 'once',
        streamSlug: listing.slug,
        streamKind: 'book',
        actions: [{ id: 'dismiss', label: '忽略' }],
      },
      {
        onAction: {
          dismiss: () => dismissOsNotification(`book:${listing.slug}`),
        },
      },
    )
  }

  const resetBookForRetry = async () => {
    chapterBodies.clear()
    clearBookStream(listing.slug)
    await deleteBookChapters(bookId)
    let store = await readBooksStore()
    store = updateBookInLibrary(store, bookId, { status: 'generating', chapters: [] })
    await writeBooksStore(store)
    publishBookGenerationProgress(bookId, { count: 0, phase: 'connecting' })
  }

  const preloadSavedChapterBodies = async () => {
    chapterBodies.clear()
    const store = await readBooksStore()
    const book = findLibraryBookById(store, bookId)
    if (!book) {
      return
    }
    for (const chapter of book.chapters) {
      const body = await loadChapterBody(bookId, chapter.id)
      if (body) {
        chapterBodies.set(chapter.index, body)
      }
    }
    publishLiveCharacterCount()
  }

  const trimChaptersFromIndex = async (fromIndex: number) => {
    const store = await readBooksStore()
    const book = findLibraryBookById(store, bookId)
    if (!book) {
      return
    }

    const toRemove = book.chapters.filter((chapter) => chapter.index >= fromIndex)
    if (toRemove.length > 0) {
      await deleteBookChapterRecords(
        bookId,
        toRemove.map((chapter) => chapter.id),
      )
    }

    for (let index = fromIndex; index <= detail.chapterOutline.length; index += 1) {
      chapterBodies.delete(index)
    }

    let nextStore = updateBookInLibrary(store, bookId, {
      chapters: book.chapters.filter((chapter) => chapter.index < fromIndex),
      status: 'generating',
    })
    await writeBooksStore(nextStore)
  }

  try {
    const total = detail.chapterOutline.length
    const template = pickGenreTemplateForBook(listing.category, listing.slug)
    const templateBlock = formatGenreTemplateForPrompt(template)

    const persistChapter = async (index: number, title: string, body: string) => {
      if (await shouldStop()) {
        return
      }

      chapterBodies.set(index, body)

      const chapterId = createChapterId()
      await saveBookChapterOrThrow({
        bookId,
        chapterId,
        index,
        title,
        body,
      })

      if (await shouldStop()) {
        return
      }

      let store = await readBooksStore()
      store = appendChapterIndex(store, bookId, { id: chapterId, index, title })
      store = updateBookInLibrary(store, bookId, {
        status: index >= total ? 'complete' : 'generating',
      })
      await writeBooksStore(store)
      onChapterSaved(index, total)
      publishLiveCharacterCount()
    }

    if (!hasOpenAiApiKey()) {
      const store = await readBooksStore()
      const book = findLibraryBookById(store, bookId)
      if (!book) {
        return
      }
      const seeds = buildSeedChapters(book)
      for (const chapter of seeds) {
        if (await shouldStop()) {
          return
        }
        await persistChapter(chapter.index, chapter.title, chapter.body)
      }
      if (await shouldStop()) {
        return
      }
      let nextStore = await readBooksStore()
      nextStore = updateBookInLibrary(nextStore, bookId, { status: 'complete' })
      await writeBooksStore(nextStore)
      return
    }

    type GenerationAttemptResult = {
      fullText: string
      error?: string
    }

    const initialUserMessage = buildInitialChapterUserMessage(listing, detail, total)

    const runAiGenerationAttempt = async (options: {
      followUp?: StreamChatTurn[]
      isContinuation: boolean
    }): Promise<GenerationAttemptResult> => {
      publishBookGenerationProgress(bookId, { phase: 'connecting' })

      const persistedChapterIndexes = new Set<number>()
      const storeBefore = await readBooksStore()
      const bookBefore = findLibraryBookById(storeBefore, bookId)
      for (const chapter of bookBefore?.chapters ?? []) {
        persistedChapterIndexes.add(chapter.index)
      }

      let persistQueue: Promise<void> = Promise.resolve()
      let persistError: string | undefined

      const enqueueCompleteChapters = (text: string) => {
        for (const chapter of parseChaptersFromXmlText(text)) {
          if (persistedChapterIndexes.has(chapter.index)) {
            continue
          }
          persistedChapterIndexes.add(chapter.index)
          persistQueue = persistQueue.then(async () => {
            if (await shouldStop()) {
              persistedChapterIndexes.delete(chapter.index)
              return
            }
            try {
              await persistChapter(chapter.index, chapter.title, chapter.body)
            } catch {
              persistedChapterIndexes.delete(chapter.index)
              persistError = '保存章节数据时发生错误'
            }
          })
        }
      }

      let fullText = ''
      try {
        fullText = await streamChatCompletion({
          system: buildAllChaptersPrompt(templateBlock),
          user: initialUserMessage,
          followUp: options.followUp,
          usageContext: {
            actor: 'books',
            behavior: 'chapter-gen',
            behaviorLabel: options.isContinuation ? '续写章节' : '生成全部章节',
          },
          thinkingEnabled: false,
          idleTimeoutMs: BOOK_CHAPTER_STREAM_IDLE_MS,
          maxCompletionTokens: 32768,
          onStreamActivity: (kind) => {
            publishBookGenerationProgress(bookId, {
              phase: kind === 'reasoning' ? 'thinking' : 'writing',
            })
          },
          onAnyStreamChunk: () => {
            publishBookGenerationProgress(bookId, {})
          },
          onChunk: (_delta, accumulated) => {
            setBookStream(listing.slug, { rawText: accumulated })
            enqueueCompleteChapters(accumulated)
            publishLiveCharacterCount(accumulated)
          },
        })
      } catch (error) {
        if (await shouldStop()) {
          return { fullText }
        }
        if (isStreamIdleTimeoutError(error)) {
          return { fullText, error: 'AI 响应超时，生成全部章节耗时过长' }
        }
        throw error
      }

      setBookStream(listing.slug, { rawText: fullText })

      await persistQueue
      if (persistError) {
        return { fullText, error: persistError }
      }

      const parsedChapters = parseChaptersFromXmlText(fullText)
      const parsedIndexes = new Set(parsedChapters.map((chapter) => chapter.index))

      for (const chapter of parsedChapters) {
        if (await shouldStop()) {
          return { fullText }
        }
        if (persistedChapterIndexes.has(chapter.index)) {
          continue
        }

        try {
          await persistChapter(chapter.index, chapter.title, chapter.body)
        } catch {
          return { fullText, error: '保存章节数据时发生错误' }
        }
      }

      if (await shouldStop()) {
        return { fullText }
      }

      let finalStore = await readBooksStore()
      const finalBook = findLibraryBookById(finalStore, bookId)
      const savedIndexes = new Set(finalBook?.chapters.map((chapter) => chapter.index) ?? [])

      if (finalBook && finalBook.chapters.length >= total) {
        finalStore = updateBookInLibrary(finalStore, bookId, { status: 'complete' })
        await writeBooksStore(finalStore)
        return { fullText }
      }

      if (parsedChapters.length === 0 && savedIndexes.size === 0) {
        const snippet = fullText.slice(0, 200)
        return {
          fullText,
          error: `AI 返回了 ${fullText.length} 字符，但未包含任何 <chapter> 标签。开头：${snippet}`,
        }
      }

      const firstMissing = findFirstMissingChapterIndex(savedIndexes, total)
      if (firstMissing === undefined) {
        return { fullText }
      }

      const { reason } = describeMissingChapterFailure(firstMissing, fullText, parsedIndexes)
      return { fullText, error: reason }
    }

    let conversationFollowUp: StreamChatTurn[] = []
    let lastFullText = ''
    let lastFailureReason = ''

    await preloadSavedChapterBodies()

    for (let attempt = 1; attempt <= MAX_BOOK_GENERATION_ATTEMPTS; attempt += 1) {
      if (await shouldStop()) {
        break
      }

      if (attempt > 1) {
        const store = await readBooksStore()
        const book = findLibraryBookById(store, bookId)
        const savedIndexes = new Set(book?.chapters.map((chapter) => chapter.index) ?? [])
        const firstMissing = findFirstMissingChapterIndex(savedIndexes, total)

        if (savedIndexes.size === 0 || firstMissing === undefined) {
          console.warn(
            `[books] 书籍「${listing.title}」(${bookId}) 第 ${attempt}/${MAX_BOOK_GENERATION_ATTEMPTS} 次完整重试…`,
          )
          await resetBookForRetry()
          conversationFollowUp = []
          onChapterSaved(0, total)
        } else {
          const parsedIndexes = new Set(
            parseChaptersFromXmlText(lastFullText).map((chapter) => chapter.index),
          )
          const { reason, snippet } = describeMissingChapterFailure(
            firstMissing,
            lastFullText,
            parsedIndexes,
          )
          const continueMessage = buildContinueChapterUserMessage(
            firstMissing,
            total,
            detail.chapterOutline,
            lastFailureReason || reason,
            snippet,
          )

          conversationFollowUp = [
            ...conversationFollowUp,
            { role: 'assistant', content: lastFullText },
            { role: 'user', content: continueMessage },
          ]

          console.warn(
            `[books] 书籍「${listing.title}」(${bookId}) 从第 ${firstMissing} 章续写（第 ${attempt}/${MAX_BOOK_GENERATION_ATTEMPTS} 次）…`,
          )

          await trimChaptersFromIndex(firstMissing)
          await preloadSavedChapterBodies()
          onChapterSaved(firstMissing - 1, total)
        }

        clearBookStream(listing.slug)
      }

      try {
        const result = await runAiGenerationAttempt({
          followUp: conversationFollowUp.length > 0 ? conversationFollowUp : undefined,
          isContinuation: conversationFollowUp.length > 0,
        })

        lastFullText = result.fullText

        if (!result.error) {
          break
        }

        lastFailureReason = result.error

        console.error(
          `[books] 书籍「${listing.title}」(${bookId}) 第 ${attempt} 次尝试失败：${result.error}`,
        )

        if (attempt >= MAX_BOOK_GENERATION_ATTEMPTS) {
          await markBookFailed(`${result.error}（已自动重试 ${MAX_BOOK_GENERATION_ATTEMPTS} 次）`)
        }
      } catch (outerError) {
        if (await shouldStop()) {
          break
        }

        const store = await readBooksStore()
        const book = findLibraryBookById(store, bookId)
        if (book && book.chapters.length === 0) {
          const seeds = buildSeedChapters(book)
          for (const chapter of seeds) {
            if (await shouldStop()) {
              break
            }
            await persistChapter(chapter.index, chapter.title, chapter.body)
          }
          if (await shouldStop()) {
            break
          }
          let nextStore = await readBooksStore()
          nextStore = updateBookInLibrary(nextStore, bookId, { status: 'complete' })
          await writeBooksStore(nextStore)
          break
        }

        const errorMessage =
          outerError instanceof Error ? outerError.message : '下载书籍时发生未知错误'
        lastFailureReason = errorMessage

        console.error(
          `[books] 书籍「${listing.title}」(${bookId}) 第 ${attempt} 次尝试失败：${errorMessage}`,
        )

        if (attempt >= MAX_BOOK_GENERATION_ATTEMPTS) {
          await markBookFailed(`${errorMessage}（已自动重试 ${MAX_BOOK_GENERATION_ATTEMPTS} 次）`)
        }
      }
    }
  } finally {
    endBookGeneration(bookId)
  }
}

export async function seedBookContent(book: BookRecordMeta): Promise<void> {
  const seeds = buildSeedChapters(book)
  for (const chapter of seeds) {
    const chapterId = createChapterId()
    await saveBookChapterOrThrow({
      bookId: book.id,
      chapterId,
      index: chapter.index,
      title: chapter.title,
      body: chapter.body,
    })
    let store = await readBooksStore()
    store = appendChapterIndex(store, book.id, {
      id: chapterId,
      index: chapter.index,
      title: chapter.title,
    })
    await writeBooksStore(store)
  }
  let store = await readBooksStore()
  store = updateBookInLibrary(store, book.id, { status: 'complete' })
  await writeBooksStore(store)
}
